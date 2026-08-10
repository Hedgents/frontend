import assert from "node:assert/strict";
import test from "node:test";
import {
  METAL_REFERENCE_COVERAGE,
  METAL_REFERENCE_MARKETS,
  SCARCITY_METALS,
  getMetalReferenceMarket,
} from "./scarcity";

test("maps an objective reference to every trackable metal cell", () => {
  assert.equal(METAL_REFERENCE_MARKETS.length, SCARCITY_METALS.length);
  assert.equal(METAL_REFERENCE_COVERAGE.mapped, SCARCITY_METALS.length);
  assert.equal(METAL_REFERENCE_COVERAGE.unmapped, 0);
  assert.equal(METAL_REFERENCE_COVERAGE.observed, 50);
  assert.equal(METAL_REFERENCE_COVERAGE.proxy, 18);
  assert.equal(METAL_REFERENCE_COVERAGE.scientific, 31);
  assert.equal(new Set(METAL_REFERENCE_MARKETS.map((reference) => reference.metalId)).size, SCARCITY_METALS.length);
  assert.ok(METAL_REFERENCE_MARKETS.every((reference) => reference.binaryQuestion.endsWith("?")));
  assert.ok(METAL_REFERENCE_MARKETS.every((reference) => reference.source.url.startsWith("https://")));
});

test("maps every metalloid, including boron and germanium, to an honest commercial form", () => {
  const boron = getMetalReferenceMarket("B");
  const germanium = getMetalReferenceMarket("Ge");
  assert.ok(boron && germanium);
  assert.equal(boron.coverageStage, "mapped");
  assert.equal(boron.relationship, "compound");
  assert.match(boron.referenceName, /borates/i);
  assert.match(boron.caveat, /not an elemental-boron spot price/i);
  assert.equal(germanium.coverageStage, "mapped");
  assert.equal(germanium.relationship, "commercial-form");
  assert.match(germanium.referenceUnit, /dollars per kilogram/i);
  assert.match(germanium.caveat, /metal, dioxide, tetrachloride/i);
});

test("labels calcium coral data as an application signal rather than elemental price", () => {
  const calcium = getMetalReferenceMarket("Ca");
  assert.ok(calcium);
  assert.equal(calcium.coverageStage, "mapped");
  assert.equal(calcium.relationship, "application");
  assert.equal(calcium.marketUse, "application-signal");
  assert.match(calcium.referenceName, /Coral/i);
  assert.match(calcium.source.name, /NOAA Coral Reef Watch/i);
  assert.match(calcium.caveat, /never be presented as calcium supply, scarcity, or price/i);
});

test("keeps commercial-form and scientific references outside automatic settlement", () => {
  const uranium = getMetalReferenceMarket("U");
  const technetium = getMetalReferenceMarket("Tc");
  const gold = getMetalReferenceMarket("Au");
  assert.ok(uranium && technetium && gold);
  assert.equal(uranium.coverageStage, "mapped");
  assert.equal(uranium.referenceName, "Uranium (U3O8 equivalent)");
  assert.equal(technetium.coverageStage, "scientific");
  assert.equal(technetium.marketUse, "scientific-event-only");
  assert.equal(gold.coverageStage, "observed");
  assert.ok([uranium, technetium, gold].every((reference) => reference.settlementReadiness === "research-only"));
});
