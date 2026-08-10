import "server-only";
import { get, put } from "@vercel/blob";
import { ApiSecurityError } from "@/lib/api-security";
import {
  compileVerifiedResolutionReport,
  type ResolutionReport,
} from "@/lib/scarcity-markets";
import { getStoredScarcityMarket } from "@/lib/scarcity-market-store";
import { readScarcityArtifact } from "@/lib/scarcity-data-store";
import { loadProductionScarcityDataset } from "@/lib/scarcity-data-store";
import { loadOnlineDetectorState, readOnlineDetectorArtifact } from "@/lib/scarcity-detector-store";
import { sha256Hex } from "@/lib/scarcity-markets";
import type { ScarcityMarketRecord } from "@/lib/scarcity-markets";

const globalResolutionState = globalThis as typeof globalThis & {
  __hedgentsResolutionReports?: Map<string, string>;
};

function storageConfigured() {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

function pathFor(hash: string) {
  return `scarcity/resolutions/${hash}.json`;
}

function trustedArtifactOrigins() {
  const configured = (process.env.HEDGENTS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([
    "https://terminal.hedgents.com",
    "https://hedgents.com",
    ...(process.env.NODE_ENV === "production" ? [] : ["http://127.0.0.1:3001", "http://localhost:3001"]),
    ...configured,
  ]);
}

async function verifyResolutionArtifacts(report: ResolutionReport, market: ScarcityMarketRecord) {
  const origins = trustedArtifactOrigins();
  const reviewedDataset = market.question.kind === "data" ? await loadProductionScarcityDataset() : null;
  const detectorState = market.question.kind === "event" ? await loadOnlineDetectorState() : null;
  for (const observation of report.observations) {
    const url = new URL(observation.artifactUrl);
    if (!origins.has(url.origin) || url.search || url.hash) {
      throw new Error("Resolution artifacts must use an approved Hedgents evidence origin.");
    }
    const dataMatch = url.pathname.match(/^\/api\/scarcity\/artifacts\/([a-f0-9]{64})$/);
    const detectorMatch = url.pathname.match(/^\/api\/scarcity\/detector\/artifacts\/([a-f0-9]{64})$/);
    const referencedHash = dataMatch?.[1] ?? detectorMatch?.[1];
    if (!referencedHash || referencedHash !== observation.artifactHash) {
      throw new Error("Resolution artifact URL does not match its committed content hash.");
    }
    const artifact = dataMatch
      ? await readScarcityArtifact(referencedHash)
      : await readOnlineDetectorArtifact(referencedHash);
    if (!artifact || sha256Hex(artifact.content) !== referencedHash) {
      throw new Error(`Resolution artifact ${referencedHash} is missing or failed content verification.`);
    }
    if (market.question.kind === "data") {
      const reviewed = reviewedDataset?.observations.some((candidate) => (
        candidate.sourceId === observation.sourceId
        && candidate.value === observation.value
        && candidate.unit === observation.unit
        && candidate.observedAt === observation.observedAt
        && candidate.publishedAt === observation.publishedAt
        && candidate.retrievedAt === observation.retrievedAt
        && candidate.artifactHash === observation.artifactHash
        && candidate.artifactPath === url.pathname
      ));
      if (!reviewed) {
        throw new Error("Numerical resolution evidence must exactly match a previously reviewed observation record.");
      }
    } else {
      const approved = detectorState?.evidence.some((candidate) => (
        candidate.status === "approved"
        && candidate.sourceId === observation.sourceId
        && candidate.publishedAt === observation.publishedAt
        && candidate.retrievedAt === observation.retrievedAt
        && candidate.artifactHash === observation.artifactHash
        && candidate.artifactPath === url.pathname
      ));
      if (!approved) {
        throw new Error("Event resolution evidence must exactly match an approved detector record.");
      }
    }
  }
}

export async function publishResolutionReport(report: ResolutionReport) {
  const market = await getStoredScarcityMarket(report.marketId);
  if (!market) throw new Error("Resolution report references an unknown market.");
  const compiled = compileVerifiedResolutionReport(report, market);
  await verifyResolutionArtifacts(report, market);
  const existing = await readResolutionReport(compiled.resolutionReportHash);
  if (existing && existing !== compiled.canonicalReport) {
    throw new Error("Resolution evidence hash collision detected.");
  }
  if (!storageConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new ApiSecurityError("Resolution evidence storage is not configured.", 503);
    }
    globalResolutionState.__hedgentsResolutionReports ??= new Map();
    globalResolutionState.__hedgentsResolutionReports.set(compiled.resolutionReportHash, compiled.canonicalReport);
  } else if (!existing) {
    await put(pathFor(compiled.resolutionReportHash), compiled.canonicalReport, {
      access: "private",
      contentType: "application/json",
      cacheControlMaxAge: 31_536_000,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  }
  return {
    marketId: report.marketId,
    outcome: report.outcome,
    resolutionReportHash: compiled.resolutionReportHash,
    canonicalReport: compiled.canonicalReport,
    evidencePath: `/api/scarcity/resolutions/${compiled.resolutionReportHash}`,
    persisted: true,
  };
}

export async function readResolutionReport(hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  if (!storageConfigured()) {
    return globalResolutionState.__hedgentsResolutionReports?.get(hash) ?? null;
  }
  const result = await get(pathFor(hash), { access: "private", useCache: true });
  if (!result || result.statusCode !== 200) return null;
  return new Response(result.stream).text();
}
