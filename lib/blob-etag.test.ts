import assert from "node:assert/strict";
import test from "node:test";
import { strongEtag } from "./blob-etag";

test("a weak validator loses its marker but keeps its quotes", () => {
  // Both halves matter. Verified against live Blob: passing the W/ form fails the precondition,
  // and stripping the quotes as well fails it too. Only the quoted hash matches.
  assert.equal(strongEtag('W/"86ecc3c49e3d476adcf6b4f0df2b0ffb"'), '"86ecc3c49e3d476adcf6b4f0df2b0ffb"');
});

test("a strong validator passes through untouched", () => {
  assert.equal(strongEtag('"082c26c8a6bc75226a31da5495cc9292"'), '"082c26c8a6bc75226a31da5495cc9292"');
});

test("absent or empty values normalize to null so the caller writes without a precondition", () => {
  assert.equal(strongEtag(null), null);
  assert.equal(strongEtag(undefined), null);
  assert.equal(strongEtag(""), null);
  assert.equal(strongEtag("   "), null);
});

test("only a leading marker is removed, never a W inside the hash", () => {
  assert.equal(strongEtag('"W/notamarker"'), '"W/notamarker"');
  assert.equal(strongEtag('"WWW"'), '"WWW"');
});

test("normalizing twice is the same as normalizing once", () => {
  const once = strongEtag('W/"abc"');
  assert.equal(strongEtag(once), once);
});
