import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedUpstreamJson } from "./safe-upstream-response";

test("parses bounded upstream JSON and rejects declared or streamed oversize bodies", async () => {
  assert.deepEqual(await readBoundedUpstreamJson(new Response('{"ok":true}'), 64, "Test"), { ok: true });
  await assert.rejects(
    () => readBoundedUpstreamJson(new Response("{}", { headers: { "content-length": "100" } }), 64, "Test"),
    /exceeds/,
  );
  await assert.rejects(
    () => readBoundedUpstreamJson(new Response(JSON.stringify({ value: "x".repeat(100) })), 32, "Test"),
    /exceeds/,
  );
  await assert.rejects(() => readBoundedUpstreamJson(new Response("not-json"), 64, "Test"), /malformed/);
});
