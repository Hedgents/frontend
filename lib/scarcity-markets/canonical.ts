import { createHash } from "node:crypto";

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function normalize(value: unknown, path: string): CanonicalValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => normalize(entry, `${path}[${index}]`));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, CanonicalValue> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry === undefined) throw new Error(`${path}.${key} is undefined.`);
      output[key] = normalize(entry, `${path}.${key}`);
    }
    return output;
  }
  throw new Error(`${path} contains an unsupported value.`);
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(normalize(value, "$"));
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hexToBytes(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("Expected a 32-byte hexadecimal value.");
  return Uint8Array.from(Buffer.from(value, "hex"));
}
