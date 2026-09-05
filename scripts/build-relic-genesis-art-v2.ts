import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const SIZE = 1254;
const ROOT = path.resolve(process.cwd(), "public/assets/relics");
const V1 = path.join(ROOT, "genesis-v1");
const OUT = path.join(ROOT, "genesis-v2");
const ATLASES = path.join(OUT, "source-atlases");
const MASTERS = path.join(OUT, "masters");
const FINAL = path.join(OUT, "final");
const METADATA = path.join(OUT, "metadata");

type Tier = "Common" | "Uncommon" | "Rare" | "Epic" | "Legendary";
type Traits = Record<string, string>;

type MasterDefinition = {
  atlas: string;
  cell: number;
  id: string;
  mineral: string;
  craft: string;
};

type PreparedMaster = MasterDefinition & {
  source: Buffer;
  file: string;
};

type Relic = {
  edition: number;
  tier: Tier;
  artefact: string;
  redemptionTargetUsd: number;
  traits: Traits;
  recipeHash: string;
  image: string;
  imageSha256: string;
};

const tierSupply: Record<Tier, number> = {
  Common: 55,
  Uncommon: 25,
  Rare: 14,
  Epic: 5,
  Legendary: 1,
};

const redemptionTargetUsd: Record<Tier, number> = {
  Common: 15,
  Uncommon: 24,
  Rare: 45,
  Epic: 110,
  Legendary: 370,
};

const commonMasters: MasterDefinition[] = [
  ["common-atlas-01.png", 0, "oxblood-garnet-ribs", "Oxblood garnet", "Ribbed shoulders"],
  ["common-atlas-01.png", 1, "emerald-orbital-relief", "Emerald", "Structural orbital rail"],
  ["common-atlas-01.png", 2, "sapphire-labyrinth", "Midnight sapphire", "Blackened labyrinth"],
  ["common-atlas-01.png", 3, "moonstone-hammered", "Moonstone", "Hammered gold"],
  ["common-atlas-01.png", 4, "diamond-constellation", "Diamond", "Constellation settings"],
  ["common-atlas-01.png", 5, "onyx-chevrons", "Black onyx", "Architectural chevrons"],
  ["common-atlas-02.png", 0, "smoky-quartz-braid", "Smoky quartz", "Braided rope relief"],
  ["common-atlas-02.png", 1, "amber-sunburst", "Amber", "Granulated sunburst"],
  ["common-atlas-02.png", 2, "amethyst-fan", "Amethyst", "Stepped fan channels"],
  ["common-atlas-02.png", 3, "turquoise-scarab", "Turquoise", "Scarab and hammered field"],
  ["common-atlas-02.png", 4, "citrine-colonnade", "Citrine", "Fluted colonnade"],
  ["common-atlas-02.png", 5, "jade-knot", "Dark jade", "Interlocking knot relief"],
  ["common-atlas-03.png", 0, "spinel-scale", "Red spinel", "Scale-chased shoulders"],
  ["common-atlas-03.png", 1, "lapis-celestial", "Lapis lazuli", "Inset gold stars"],
  ["common-atlas-03.png", 2, "moss-agate-vine", "Moss agate", "Raised vine relief"],
  ["common-atlas-03.png", 3, "pearl-tide", "Pearl", "Wave-chased shoulders"],
  ["common-atlas-03.png", 4, "fire-opal-sunburst", "Fire opal", "Fluted sunburst bezel"],
  ["common-atlas-03.png", 5, "obsidian-brutalist", "Obsidian", "Brutalist stepped ridges"],
].map(([atlas, cell, id, mineral, craft]) => ({ atlas: String(atlas), cell: Number(cell), id: String(id), mineral: String(mineral), craft: String(craft) }));

const uncommonMasters: MasterDefinition[] = [
  ["uncommon-atlas-01.png", 0, "garnet-ribbed-cuff", "Oxblood garnet", "Ribbed cuff"],
  ["uncommon-atlas-01.png", 1, "emerald-rail-bracelet", "Emerald", "Structural orbital rail"],
  ["uncommon-atlas-01.png", 2, "sapphire-labyrinth-cuff", "Midnight sapphire", "Labyrinth cuff"],
  ["uncommon-atlas-01.png", 3, "moonstone-hammered-cuff", "Moonstone", "Hammered open cuff"],
  ["uncommon-atlas-01.png", 4, "diamond-constellation-bracelet", "Diamond", "Articulated constellation plates"],
  ["uncommon-atlas-01.png", 5, "onyx-chevron-cuff", "Black onyx", "Architectural chevrons"],
  ["uncommon-atlas-02.png", 0, "ruby-scale-links", "Ruby", "Articulated scale links"],
  ["uncommon-atlas-02.png", 1, "lapis-celestial-cuff", "Lapis lazuli", "Celestial seal cuff"],
  ["uncommon-atlas-02.png", 2, "moss-agate-vine-cuff", "Moss agate", "Wrapped vine relief"],
  ["uncommon-atlas-02.png", 3, "pearl-wave-cuff", "Pearl", "Wave-chased open cuff"],
  ["uncommon-atlas-02.png", 4, "fire-opal-segmented-bracelet", "Fire opal", "Segmented sunburst band"],
  ["uncommon-atlas-02.png", 5, "obsidian-brutalist-cuff", "Obsidian", "Blackened stepped ribs"],
].map(([atlas, cell, id, mineral, craft]) => ({ atlas: String(atlas), cell: Number(cell), id: String(id), mineral: String(mineral), craft: String(craft) }));

const rareMasters: MasterDefinition[] = [
  ["rare-atlas-01.png", 0, "garnet-heraldic-torque", "Garnet", "Heraldic stepped ribs"],
  ["rare-atlas-01.png", 1, "emerald-orbital-collar", "Emerald", "Structural orbital rails"],
  ["rare-atlas-01.png", 2, "sapphire-labyrinth-gorget", "Sapphire", "Blackened labyrinth panels"],
  ["rare-atlas-01.png", 3, "moonstone-hammered-torque", "Moonstone", "Hammered open torque"],
  ["rare-atlas-01.png", 4, "diamond-constellation-collar", "Diamond", "Articulated constellation settings"],
  ["rare-atlas-01.png", 5, "onyx-chevron-necklace", "Black onyx", "Architectural chevrons"],
  ["rare-atlas-02.png", 0, "ruby-scale-collar", "Ruby", "Heraldic scale links"],
  ["rare-atlas-02.png", 1, "lapis-celestial-gorget", "Lapis lazuli", "Inset celestial plates"],
  ["rare-atlas-02.png", 2, "moss-agate-vine-torque", "Moss agate", "Wrapped botanical relief"],
  ["rare-atlas-02.png", 3, "pearl-wave-collar", "Pearl", "Wave-chased ridges"],
  ["rare-atlas-02.png", 4, "fire-opal-sunburst-necklace", "Fire opal", "Stepped sunburst panels"],
  ["rare-atlas-02.png", 5, "obsidian-brutalist-torque", "Obsidian", "Layered architectural ribs"],
].map(([atlas, cell, id, mineral, craft]) => ({ atlas: String(atlas), cell: Number(cell), id: String(id), mineral: String(mineral), craft: String(craft) }));

const patinaGrades = ["museum-satin", "warm-heirloom", "deep-recess", "lightly-worn"] as const;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

async function prepareMaster(tier: Tier, definition: MasterDefinition): Promise<PreparedMaster> {
  const atlasPath = path.join(ATLASES, definition.atlas);
  const info = await sharp(atlasPath).metadata();
  if (!info.width || !info.height) throw new Error(`Missing atlas dimensions: ${definition.atlas}`);

  const column = definition.cell % 3;
  const row = Math.floor(definition.cell / 3);
  const cellWidth = Math.floor(info.width / 3);
  const cellHeight = Math.floor(info.height / 2);
  const inset = 2;
  const source = await sharp(atlasPath)
    .extract({
      left: column * cellWidth + inset,
      top: row * cellHeight + inset,
      width: cellWidth - inset * 2,
      height: cellHeight - inset * 2,
    })
    .resize(SIZE, SIZE, { fit: "contain", background: "#050605" })
    .sharpen({ sigma: 0.45 })
    .webp({ quality: 96, effort: 5 })
    .toBuffer();

  const tierDir = path.join(MASTERS, tier.toLowerCase());
  await mkdir(tierDir, { recursive: true });
  const file = `${String(definition.cell + 1).padStart(2, "0")}-${definition.id}.webp`;
  await writeFile(path.join(tierDir, file), source);
  return { ...definition, source, file: `masters/${tier.toLowerCase()}/${file}` };
}

async function prepareMasters(tier: Tier, definitions: MasterDefinition[]) {
  return Promise.all(definitions.map((definition) => prepareMaster(tier, definition)));
}

async function writeRelic(
  edition: number,
  tier: Tier,
  artefact: string,
  source: string | Buffer,
  traits: Traits,
  grade = 0,
) {
  const id = String(edition).padStart(3, "0");
  const outputName = `${id}-${tier.toLowerCase()}-${artefact.toLowerCase().replaceAll(" ", "-")}.webp`;
  const outputPath = path.join(FINAL, outputName);
  const gradeSettings = [
    { brightness: 0.985, saturation: 0.985, hue: -1 },
    { brightness: 1.005, saturation: 1.01, hue: 0 },
    { brightness: 0.995, saturation: 1.025, hue: 1 },
    { brightness: 1.012, saturation: 0.995, hue: 2 },
  ][grade % 4];

  const pipeline = sharp(source).resize(SIZE, SIZE, { fit: "cover" });
  if (tier === "Common" || tier === "Uncommon" || tier === "Rare") {
    pipeline.modulate(gradeSettings).sharpen({ sigma: 0.35 + grade * 0.04 });
  }
  await pipeline.webp({ quality: 94, effort: 5 }).toFile(outputPath);

  const bytes = await readFile(outputPath);
  const imageHash = sha256(bytes);
  const recipeHash = sha256(JSON.stringify({ edition, tier, artefact, traits }));
  const article = tier === "Epic" ? "An" : "A";
  const metadata = {
    name: `Hedgents Relic #${id} — ${artefact}`,
    symbol: "RELIC",
    description: `${article} ${tier} ${artefact} from the fixed 100-piece Hedgents Genesis collection. Its engraving, stones, patina, and metal grain are baked into the artwork. Burn redemption transfers the ticket's exact onchain PAXG amount. No physical artefact delivery.`,
    image: `../final/${outputName}`,
    attributes: [
      { trait_type: "Edition", value: edition },
      { trait_type: "Tier", value: tier },
      { trait_type: "Artefact", value: artefact },
      ...Object.entries(traits).map(([trait_type, value]) => ({ trait_type, value })),
      { trait_type: "Redemption target at funding snapshot (USD)", value: redemptionTargetUsd[tier] },
    ],
    properties: {
      category: "image",
      files: [{ uri: `../final/${outputName}`, type: "image/webp" }],
      collection: "Hedgents Relics — Genesis",
      artworkPipeline: "baked-material-master-v2",
      noPhysicalDelivery: true,
      metadataStatus: "template-until-campaign-funding",
      authoritativeRedemption: "Exact atomic PAXG amount recorded in the campaign ticket account",
      recipeSha256: recipeHash,
      imageSha256: imageHash,
    },
  };
  await writeFile(path.join(METADATA, `${id}.json`), `${JSON.stringify(metadata, null, 2)}\n`);
  return {
    edition,
    tier,
    artefact,
    redemptionTargetUsd: redemptionTargetUsd[tier],
    traits,
    recipeHash,
    image: `final/${outputName}`,
    imageSha256: imageHash,
  } satisfies Relic;
}

async function buildTier(
  startEdition: number,
  tier: "Common" | "Uncommon" | "Rare",
  artefact: string,
  supply: number,
  masters: PreparedMaster[],
) {
  const relics: Relic[] = [];
  for (let index = 0; index < supply; index += 1) {
    const master = masters[index % masters.length];
    const grade = Math.floor(index / masters.length);
    relics.push(await writeRelic(startEdition + index, tier, artefact, master.source, {
      "Master design": master.id,
      Mineral: master.mineral,
      Metalwork: master.craft,
      "Patina grade": patinaGrades[grade],
      "Artwork construction": "Fully baked material render",
    }, grade));
  }
  return relics;
}

async function contactSheet(relics: Relic[], outputName = "contact-sheet.webp") {
  const cell = 154;
  const gap = 6;
  const sheetSize = cell * 10 + gap * 11;
  const inputs = await Promise.all(relics.map(async (relic, index) => ({
    input: await sharp(path.join(OUT, relic.image)).resize(cell, cell, { fit: "cover" }).webp().toBuffer(),
    left: gap + (index % 10) * (cell + gap),
    top: gap + Math.floor(index / 10) * (cell + gap),
  })));
  await sharp({ create: { width: sheetSize, height: sheetSize, channels: 3, background: "#080807" } })
    .composite(inputs)
    .webp({ quality: 90, effort: 5 })
    .toFile(path.join(OUT, outputName));
}

async function masterContactSheet(masters: PreparedMaster[]) {
  const columns = 6;
  const cell = 220;
  const gap = 8;
  const rows = Math.ceil(masters.length / columns);
  const inputs = await Promise.all(masters.map(async (master, index) => ({
    input: await sharp(master.source).resize(cell, cell, { fit: "cover" }).webp().toBuffer(),
    left: gap + (index % columns) * (cell + gap),
    top: gap + Math.floor(index / columns) * (cell + gap),
  })));
  await sharp({
    create: {
      width: columns * cell + (columns + 1) * gap,
      height: rows * cell + (rows + 1) * gap,
      channels: 3,
      background: "#080807",
    },
  }).composite(inputs).webp({ quality: 91, effort: 5 }).toFile(path.join(OUT, "master-contact-sheet.webp"));
}

async function verify(relics: Relic[]) {
  if (relics.length !== 100) throw new Error(`Expected 100 relics, received ${relics.length}`);
  const counts = relics.reduce<Record<string, number>>((acc, relic) => ({
    ...acc,
    [relic.tier]: (acc[relic.tier] ?? 0) + 1,
  }), {});
  for (const [tier, expected] of Object.entries(tierSupply)) {
    if (counts[tier] !== expected) throw new Error(`${tier}: expected ${expected}, received ${counts[tier]}`);
  }
  const recipeHashes = new Set(relics.map((relic) => relic.recipeHash));
  const imageHashes = new Set(relics.map((relic) => relic.imageSha256));
  if (recipeHashes.size !== 100) throw new Error(`Duplicate recipe tuple detected (${recipeHashes.size}/100 unique)`);
  if (imageHashes.size !== 100) throw new Error(`Duplicate rendered image detected (${imageHashes.size}/100 unique)`);
  for (const relic of relics) {
    const info = await sharp(path.join(OUT, relic.image)).metadata();
    if (info.width !== SIZE || info.height !== SIZE) throw new Error(`${relic.image} is ${info.width}x${info.height}`);
  }
  return { counts, uniqueRecipeHashes: recipeHashes.size, uniqueImageHashes: imageHashes.size, dimensions: `${SIZE}x${SIZE}` };
}

async function main() {
  await Promise.all([
    rm(MASTERS, { recursive: true, force: true }),
    rm(FINAL, { recursive: true, force: true }),
    rm(METADATA, { recursive: true, force: true }),
  ]);
  await Promise.all([mkdir(MASTERS, { recursive: true }), mkdir(FINAL, { recursive: true }), mkdir(METADATA, { recursive: true })]);

  const [common, uncommon, rare] = await Promise.all([
    prepareMasters("Common", commonMasters),
    prepareMasters("Uncommon", uncommonMasters),
    prepareMasters("Rare", rareMasters),
  ]);

  const relics: Relic[] = [];
  relics.push(...await buildTier(1, "Common", "Gold Signet", tierSupply.Common, common));
  relics.push(...await buildTier(56, "Uncommon", "Orbit Bracelet", tierSupply.Uncommon, uncommon));
  relics.push(...await buildTier(81, "Rare", "Royal Torque", tierSupply.Rare, rare));

  const epicNames = ["ember-lattice", "midnight-observatory", "verdant-engine", "lunar-frost", "obsidian-eclipse"];
  for (let index = 0; index < 5; index += 1) {
    relics.push(await writeRelic(95 + index, "Epic", "Imperial Ovoid", path.join(V1, "final", `${String(95 + index).padStart(3, "0")}-epic-imperial-ovoid.webp`), {
      "Master design": epicNames[index],
      "Artwork construction": "Fully baked material render",
      Edition: "One of five",
    }));
  }
  relics.push(await writeRelic(100, "Legendary", "Crown Jewel", path.join(V1, "final", "100-legendary-crown-jewel.webp"), {
    "Master design": "sovereign-crown-jewel",
    "Artwork construction": "Fully baked material render",
    Edition: "One of one",
  }));

  const verification = await verify(relics);
  await Promise.all([contactSheet(relics), masterContactSheet([...common, ...uncommon, ...rare])]);
  const manifest = {
    schemaVersion: 2,
    collection: "Hedgents Relics — Genesis",
    seedDomain: "hedgents-genesis-v2-baked-materials",
    artworkPipeline: "baked-material-master-v2",
    canvas: { width: SIZE, height: SIZE },
    supply: tierSupply,
    masterCount: { Common: common.length, Uncommon: uncommon.length, Rare: rare.length, Epic: 5, Legendary: 1 },
    sourceAtlases: [...new Set([...commonMasters, ...uncommonMasters, ...rareMasters].map((master) => `source-atlases/${master.atlas}`))],
    pullPriceUsdc: 35,
    redemptionTargetsUsdAtFundingSnapshot: redemptionTargetUsd,
    warning: "USD figures are design targets only. Exact atomic PAXG amounts committed by the deployed campaign are authoritative. No physical artefact delivery.",
    verification,
    relics,
  };
  await writeFile(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(OUT, "verification.json"), `${JSON.stringify(verification, null, 2)}\n`);
  console.log(JSON.stringify({ output: OUT, bakedMasters: common.length + uncommon.length + rare.length + 6, relics: relics.length, ...verification }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
