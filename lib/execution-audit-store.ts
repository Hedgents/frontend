import { get, put } from "@vercel/blob";
import { ApiSecurityError } from "@/lib/api-security";
import {
  createExecutionAuditIntentRecord,
  createExecutionAuditObservationRecord,
  ExecutionAuditSchemaError,
  validateExecutionAuditIntentRecord,
  type ExecutionAuditIntentInput,
  type ExecutionAuditIntentRecord,
  type ExecutionAuditObservationInput,
  type ExecutionAuditObservationRecord,
} from "@/lib/execution-audit-schema";

const AUDIT_PREFIX = "execution-audit/v1";
const DEVELOPMENT_AUDIT_SECRET = "hedgents-local-execution-audit-secret-do-not-use-in-production";

export interface ExecutionAuditImmutableWritePolicy {
  access: "private";
  addRandomSuffix: false;
  allowOverwrite: false;
  contentType: "application/json";
  cacheControlMaxAge: number;
}

export type ExecutionAuditImmutableWriteResult = "stored" | "duplicate";

export interface ExecutionAuditStorage {
  writeImmutable(
    pathname: string,
    content: string,
    policy: ExecutionAuditImmutableWritePolicy,
  ): Promise<ExecutionAuditImmutableWriteResult>;
  readImmutable?(pathname: string): Promise<string | null>;
}

export interface ExecutionAuditStoreOptions {
  production?: boolean;
  environment?: Record<string, string | undefined>;
  secret?: string;
  storage?: ExecutionAuditStorage;
  now?: () => Date;
}

export type ExecutionAuditObservationWriteResult =
  | { recorded: true; reason: "stored"; pathname: string }
  | { recorded: false; reason: "duplicate" | "unavailable" | "invalid"; pathname: string | null };

export interface ExecutionAuditConfigurationStatus {
  ready: boolean;
  detail: string;
}

export class ExecutionAuditUnavailableError extends ApiSecurityError {
  constructor(message = "Private execution audit storage is temporarily unavailable.") {
    super(message, 503);
    this.name = "ExecutionAuditUnavailableError";
  }
}

export class ExecutionAuditDuplicateIntentError extends ApiSecurityError {
  constructor(public readonly signature: string) {
    super(
      "A submission intent already exists for this Solana signature; submission state is unknown and the transaction must not be resubmitted.",
      409,
    );
    this.name = "ExecutionAuditDuplicateIntentError";
  }
}

export class ExecutionAuditWriteOutcomeUnknownError extends ApiSecurityError {
  constructor(public readonly signature: string) {
    super(
      "The immutable audit-intent write had an uncertain outcome; submission remains unknown and this signature must not be resubmitted.",
      503,
    );
    this.name = "ExecutionAuditWriteOutcomeUnknownError";
  }
}

const globalAuditState = globalThis as typeof globalThis & {
  __hedgentsExecutionAuditRecords?: Map<string, string>;
};

function privateImmutablePolicy(): ExecutionAuditImmutableWritePolicy {
  return {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "application/json",
    cacheControlMaxAge: 31_536_000,
  };
}

function hmacPathSegment(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new ExecutionAuditSchemaError("The execution audit path identifier is malformed.");
  }
  return value;
}

function shard(signatureHmac: string) {
  return hmacPathSegment(signatureHmac).slice(0, 2);
}

export function executionAuditIntentPath(signatureHmac: string) {
  return `${AUDIT_PREFIX}/intents/${shard(signatureHmac)}/${signatureHmac}.json`;
}

export function executionAuditObservationPath(input: Pick<
  ExecutionAuditObservationRecord,
  "signatureHmac" | "submissionState" | "settlementState" | "errorCode"
>) {
  const errorCode = input.errorCode ?? "none";
  return `${AUDIT_PREFIX}/observations/${shard(input.signatureHmac)}/${input.signatureHmac}/${input.submissionState}--${input.settlementState}--${errorCode}.json`;
}

function memoryStorage(): ExecutionAuditStorage {
  globalAuditState.__hedgentsExecutionAuditRecords ??= new Map();
  return {
    async writeImmutable(pathname, content) {
      const records = globalAuditState.__hedgentsExecutionAuditRecords!;
      if (records.has(pathname)) return "duplicate";
      records.set(pathname, content);
      return "stored";
    },
    async readImmutable(pathname) {
      return globalAuditState.__hedgentsExecutionAuditRecords?.get(pathname) ?? null;
    },
  };
}

function blobStorage(environment: Record<string, string | undefined>): ExecutionAuditStorage {
  const credentials = {
    ...(environment.BLOB_READ_WRITE_TOKEN?.trim()
      ? { token: environment.BLOB_READ_WRITE_TOKEN.trim() }
      : {}),
    ...(environment.BLOB_STORE_ID?.trim() ? { storeId: environment.BLOB_STORE_ID.trim() } : {}),
    ...(environment.VERCEL_OIDC_TOKEN?.trim()
      ? { oidcToken: environment.VERCEL_OIDC_TOKEN.trim() }
      : {}),
  };
  return {
    async writeImmutable(pathname, content, policy) {
      await put(pathname, content, { ...policy, ...credentials });
      return "stored";
    },
    async readImmutable(pathname) {
      const result = await get(pathname, { access: "private", useCache: false, ...credentials });
      if (!result || result.statusCode !== 200) return null;
      return new Response(result.stream).text();
    },
  };
}

function storageConfigured(environment: Record<string, string | undefined>) {
  return Boolean(
    environment.BLOB_READ_WRITE_TOKEN?.trim()
    || (environment.BLOB_STORE_ID?.trim() && environment.VERCEL_OIDC_TOKEN?.trim()),
  );
}

function resolveSecret(
  production: boolean,
  environment: Record<string, string | undefined>,
  override?: string,
) {
  const secret = override?.trim() || environment.HEDGENTS_EXECUTION_AUDIT_SECRET?.trim();
  if (secret && secret.length >= 32 && secret.length <= 4_096) return secret;
  if (secret) {
    throw new ExecutionAuditUnavailableError(
      "Private execution audit is not configured: HEDGENTS_EXECUTION_AUDIT_SECRET must contain at least 32 characters.",
    );
  }
  if (!production) return DEVELOPMENT_AUDIT_SECRET;
  throw new ExecutionAuditUnavailableError(
    "Private execution audit is not configured: HEDGENTS_EXECUTION_AUDIT_SECRET is required.",
  );
}

function resolveStorage(
  production: boolean,
  environment: Record<string, string | undefined>,
  override?: ExecutionAuditStorage,
) {
  if (override) return override;
  if (storageConfigured(environment)) return blobStorage(environment);
  if (!production) return memoryStorage();
  throw new ExecutionAuditUnavailableError(
    "Private execution audit is not configured: Vercel Blob storage is required.",
  );
}

export function createExecutionAuditStore(options: ExecutionAuditStoreOptions = {}) {
  const production = options.production ?? process.env.NODE_ENV === "production";
  const environment = options.environment ?? process.env;
  const now = options.now ?? (() => new Date());

  async function recordSubmissionIntent(input: ExecutionAuditIntentInput): Promise<ExecutionAuditIntentRecord> {
    const secret = resolveSecret(production, environment, options.secret);
    const storage = resolveStorage(production, environment, options.storage);
    const record = createExecutionAuditIntentRecord(input, secret, now());
    const pathname = executionAuditIntentPath(record.signatureHmac);
    let result: ExecutionAuditImmutableWriteResult;
    try {
      result = await storage.writeImmutable(
        pathname,
        JSON.stringify(record),
        privateImmutablePolicy(),
      );
    } catch {
      // allowOverwrite:false does not expose one stable, documented collision
      // error across Blob transports. Resolve an existing record by a fresh
      // private read and integrity-check it; every other post-write failure is
      // ambiguous and therefore must prohibit submission/retry.
      try {
        const existing = await storage.readImmutable?.(pathname);
        if (existing) {
          const validated = validateExecutionAuditIntentRecord(JSON.parse(existing), secret);
          if (validated.signatureHmac === record.signatureHmac) {
            throw new ExecutionAuditDuplicateIntentError(input.signature);
          }
        }
      } catch (error) {
        if (error instanceof ExecutionAuditDuplicateIntentError) throw error;
      }
      throw new ExecutionAuditWriteOutcomeUnknownError(input.signature);
    }
    if (result === "duplicate") throw new ExecutionAuditDuplicateIntentError(input.signature);
    if (result !== "stored") throw new ExecutionAuditWriteOutcomeUnknownError(input.signature);
    return record;
  }

  async function recordObservation(input: ExecutionAuditObservationInput): Promise<ExecutionAuditObservationWriteResult> {
    let pathname: string | null = null;
    try {
      const secret = resolveSecret(production, environment, options.secret);
      const storage = resolveStorage(production, environment, options.storage);
      const record = createExecutionAuditObservationRecord(input, secret, now());
      pathname = executionAuditObservationPath(record);
      const result = await storage.writeImmutable(
        pathname,
        JSON.stringify(record),
        privateImmutablePolicy(),
      );
      if (result === "stored") return { recorded: true, reason: "stored", pathname };
      if (result === "duplicate") return { recorded: false, reason: "duplicate", pathname };
      throw new Error("Execution audit storage returned an unsupported write outcome.");
    } catch (error) {
      return {
        recorded: false,
        reason: error instanceof ExecutionAuditSchemaError ? "invalid" : "unavailable",
        pathname,
      };
    }
  }

  return { recordSubmissionIntent, recordObservation };
}

export async function recordExecutionSubmissionIntent(input: ExecutionAuditIntentInput) {
  return createExecutionAuditStore().recordSubmissionIntent(input);
}

export async function recordExecutionAuditObservation(input: ExecutionAuditObservationInput) {
  return createExecutionAuditStore().recordObservation(input);
}

export function resetExecutionAuditStoreForTests() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Cannot reset execution audit storage in production.");
  }
  globalAuditState.__hedgentsExecutionAuditRecords = undefined;
}

export function executionAuditConfigurationStatus(options: {
  production?: boolean;
  environment?: Record<string, string | undefined>;
} = {}): ExecutionAuditConfigurationStatus {
  const production = options.production ?? process.env.NODE_ENV === "production";
  const environment = options.environment ?? process.env;
  try {
    resolveSecret(production, environment);
    resolveStorage(production, environment);
    return {
      ready: true,
      detail: production
        ? "Private immutable execution-audit storage credentials and its dedicated integrity secret are configured; preview write/read canary still required."
        : "Development execution-audit storage is available.",
    };
  } catch (error) {
    return {
      ready: false,
      detail: error instanceof Error ? error.message : "Private execution audit is not configured.",
    };
  }
}

export function readDevelopmentExecutionAuditRecordForTests(pathname: string) {
  if (process.env.NODE_ENV === "production") return null;
  return globalAuditState.__hedgentsExecutionAuditRecords?.get(pathname) ?? null;
}
