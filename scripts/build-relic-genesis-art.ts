import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp, { type OverlayOptions } from "sharp";

const SIZE = 1254;
const ROOT = path.resolve(process.cwd(), "public/assets/relics");
const BASE_ROOT = path.join(ROOT, "genesis");
const OUT = path.join(ROOT, "genesis-v1");
const LAYERS = path.join(OUT, "layers");
const FINAL = path.join(OUT, "final");
const METADATA = path.join(OUT, "metadata");

type Tier = "Common" | "Uncommon" | "Rare" | "Epic" | "Legendary";
type Traits = Record<string, string>;

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

type LayerDefinition = {
  slot: string;
  id: string;
  body: string;
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

const baseByTier: Record<Tier, string> = {
  Common: path.join(BASE_ROOT, "common-gold-signet.png"),
  Uncommon: path.join(BASE_ROOT, "uncommon-orbit-bracelet.png"),
  Rare: path.join(BASE_ROOT, "rare-royal-torque.png"),
  Epic: path.join(OUT, "epic", "epic-01-ember-lattice.png"),
  Legendary: path.join(BASE_ROOT, "legendary-crown-jewel.png"),
};

const defs = `
  <defs>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff0aa"/>
      <stop offset=".28" stop-color="#d8a63d"/>
      <stop offset=".65" stop-color="#70420e"/>
      <stop offset="1" stop-color="#ffd979"/>
    </linearGradient>
    <linearGradient id="garnet" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#ff6d54"/><stop offset=".4" stop-color="#8c1424"/><stop offset="1" stop-color="#250008"/>
    </linearGradient>
    <linearGradient id="emerald" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#8bffd4"/><stop offset=".42" stop-color="#07855b"/><stop offset="1" stop-color="#00261b"/>
    </linearGradient>
    <linearGradient id="sapphire" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#b4d8ff"/><stop offset=".45" stop-color="#285ca9"/><stop offset="1" stop-color="#071631"/>
    </linearGradient>
    <linearGradient id="moonstone" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#ffffff"/><stop offset=".45" stop-color="#b6d4d8"/><stop offset="1" stop-color="#536a76"/>
    </linearGradient>
    <radialGradient id="amberGlow">
      <stop stop-color="#ffca64" stop-opacity=".85"/><stop offset=".45" stop-color="#d87a1f" stop-opacity=".22"/><stop offset="1" stop-color="#a65200" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="10" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>`;

function svg(body: string) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${defs}${body}</svg>`);
}

function points(seed: number, count: number, yMax = 900) {
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  return Array.from({ length: count }, () => {
    const cx = Math.round(125 + next() * 1004);
    const cy = Math.round(80 + next() * (yMax - 80));
    const r = (0.8 + next() * 2.2).toFixed(1);
    const opacity = (0.18 + next() * 0.52).toFixed(2);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f2c66d" opacity="${opacity}"/>`;
  }).join("");
}

const shared: LayerDefinition[] = [
  {
    slot: "field",
    id: "assay-circles",
    body: `<g fill="none" stroke="#d6a747" opacity=".2"><circle cx="627" cy="484" r="402" stroke-width="2"/><circle cx="627" cy="484" r="334"/><path d="M627 65V155M627 812V900M206 484H287M968 484H1048"/></g>`,
  },
  {
    slot: "field",
    id: "eclipse",
    body: `<circle cx="627" cy="470" r="363" fill="none" stroke="#efb94d" stroke-width="5" opacity=".2" filter="url(#glow)"/><circle cx="627" cy="470" r="355" fill="#000" opacity=".08"/>`,
  },
  {
    slot: "field",
    id: "vault-grid",
    body: `<g fill="none" stroke="#b98a37" stroke-width="1" opacity=".14"><path d="M170 170H1084M140 310H1114M120 450H1134M140 590H1114M170 730H1084"/><path d="M230 95V810M430 70V850M627 55V875M824 70V850M1024 95V810"/></g><rect x="196" y="126" width="862" height="650" rx="70" fill="none" stroke="#f0c66b" opacity=".09"/>`,
  },
  {
    slot: "field",
    id: "star-map",
    body: `<g>${points(71, 42, 840)}</g><g stroke="#82aadb" stroke-width="1" opacity=".16" fill="none"><path d="M252 302L391 212L517 351L708 189L906 331L1022 222"/><path d="M208 624L369 515L513 639L764 491L1035 651"/></g>`,
  },
  {
    slot: "aura",
    id: "assay-dust",
    body: `<g filter="url(#soft)">${points(19, 68, 930)}</g>`,
  },
  {
    slot: "aura",
    id: "orbital-trail",
    body: `<g fill="none" stroke="#e4a93b" filter="url(#glow)"><ellipse cx="627" cy="626" rx="492" ry="150" stroke-width="2" opacity=".55" transform="rotate(-12 627 626)"/><ellipse cx="627" cy="626" rx="430" ry="118" opacity=".24" transform="rotate(17 627 626)"/></g>`,
  },
  {
    slot: "aura",
    id: "emerald-seal",
    body: `<circle cx="627" cy="905" r="190" fill="url(#amberGlow)" opacity=".35"/><g fill="none" stroke="#45d69e" opacity=".42" filter="url(#glow)"><circle cx="627" cy="903" r="139"/><path d="M627 748L758 981H496Z"/></g>`,
  },
  {
    slot: "aura",
    id: "garnet-inner-radiance",
    body: `<ellipse cx="627" cy="610" rx="310" ry="430" fill="#bd2718" opacity=".1" filter="url(#glow)"/><path d="M627 167L720 566L627 1040L534 566Z" fill="#ff7d31" opacity=".08" filter="url(#glow)"/>`,
  },
  {
    slot: "aura",
    id: "sapphire-constellation",
    body: `<g fill="#b5d7ff" filter="url(#glow)">${points(125, 48, 920)}</g><g fill="none" stroke="#77aee8" opacity=".32"><path d="M182 332L337 205L490 312L619 164L791 288L1056 210"/><path d="M144 688L314 534L482 650L705 479L935 655L1101 517"/></g>`,
  },
  {
    slot: "aura",
    id: "solar-corona",
    body: `<circle cx="627" cy="480" r="414" fill="none" stroke="#ffd875" stroke-width="8" opacity=".46" filter="url(#glow)"/><g stroke="#e9b64d" opacity=".3">${Array.from({ length: 24 }, (_, i) => `<path d="M627 24V86" transform="rotate(${i * 15} 627 480)"/>`).join("")}</g>`,
  },
];

const common: LayerDefinition[] = [
  { slot: "finish", id: "satin-assay", body: `<path d="M340 408L681 409L739 470L707 794L630 857L331 814L312 552Z" fill="#e5b455" opacity=".055"/>` },
  { slot: "finish", id: "mirror-edge", body: `<path d="M350 435L674 432L714 486" fill="none" stroke="#fff0ae" stroke-width="13" opacity=".38" filter="url(#soft)"/><path d="M715 492L687 788" stroke="#f0b34b" stroke-width="8" opacity=".3"/>` },
  { slot: "finish", id: "hammered-field", body: `<g fill="#f6d47d" opacity=".13">${Array.from({ length: 32 }, (_, i) => `<circle cx="${710 + (i % 8) * 31}" cy="${495 + Math.floor(i / 8) * 62}" r="${3 + (i % 3)}"/>`).join("")}</g>` },
  { slot: "finish", id: "blackened-recess", body: `<path d="M400 477L604 470L638 507L621 767L576 795L393 775L370 720L378 530Z" fill="#020203" opacity=".3"/><path d="M717 607L943 658" stroke="#1c1205" stroke-width="19" opacity=".55"/>` },

  { slot: "engraving", id: "sun-ray", body: `<g stroke="url(#gold)" stroke-width="5" opacity=".78">${Array.from({ length: 12 }, (_, i) => `<path d="M505 624L505 510" transform="rotate(${i * 30} 505 624)"/>`).join("")}</g><circle cx="505" cy="624" r="45" fill="none" stroke="#e9ba58" stroke-width="5"/>` },
  { slot: "engraving", id: "orbital-groove", body: `<g fill="none" stroke="#e8bd67" opacity=".72"><ellipse cx="505" cy="625" rx="117" ry="63" stroke-width="7" transform="rotate(-18 505 625)"/><ellipse cx="505" cy="625" rx="84" ry="122" stroke-width="4" transform="rotate(24 505 625)"/><circle cx="505" cy="625" r="17" fill="#dca63e"/></g>` },
  { slot: "engraving", id: "labyrinth", body: `<g fill="none" stroke="#e4b252" stroke-width="6" opacity=".75"><path d="M420 545H574V704H445V573H546V676H470V600H521V650H493V624"/><path d="M402 526L593 526L614 550V727L588 752H412"/></g>` },
  { slot: "engraving", id: "chevron", body: `<g fill="none" stroke="#ecc66b" stroke-width="8" opacity=".68"><path d="M400 560L505 640L610 560"/><path d="M400 615L505 695L610 615"/><path d="M400 670L505 750L610 670"/></g>` },
  { slot: "engraving", id: "constellation", body: `<g stroke="#e6bd63" stroke-width="3" opacity=".7"><path d="M407 705L455 566L519 631L584 525L610 727" fill="none"/><circle cx="407" cy="705" r="8" fill="#fff0a4"/><circle cx="455" cy="566" r="6" fill="#fff0a4"/><circle cx="519" cy="631" r="10" fill="#fff0a4"/><circle cx="584" cy="525" r="7" fill="#fff0a4"/><circle cx="610" cy="727" r="8" fill="#fff0a4"/></g>` },
  { slot: "engraving", id: "assay-bars", body: `<g fill="#dfad4e" opacity=".75"><rect x="411" y="548" width="188" height="12" rx="6"/><rect x="430" y="590" width="151" height="12" rx="6"/><rect x="451" y="632" width="110" height="12" rx="6"/><rect x="430" y="674" width="151" height="12" rx="6"/><rect x="411" y="716" width="188" height="12" rx="6"/></g>` },
  { slot: "engraving", id: "stepped-grid", body: `<g fill="none" stroke="#d9a84a" stroke-width="5" opacity=".72"><path d="M410 535H600V744H410Z"/><path d="M440 565H570V714H440Z"/><path d="M470 595H540V684H470Z"/><path d="M410 640H600M505 535V744"/></g>` },
  { slot: "engraving", id: "tidal-line", body: `<g fill="none" stroke="#e5b756" stroke-width="7" opacity=".7"><path d="M402 578C445 528 474 628 516 578S586 628 614 578"/><path d="M399 644C443 594 474 694 518 644S586 694 612 644"/><path d="M405 710C448 660 476 760 515 710S582 760 606 710"/></g>` },

  { slot: "inset", id: "obsidian", body: `<path d="M399 483L590 477L630 515L615 758L578 790L399 770L374 715L382 535Z" fill="#07090d" opacity=".22"/><path d="M411 501L579 495" stroke="#9fb0bd" opacity=".2"/>` },
  { slot: "inset", id: "garnet", body: `<path d="M399 483L590 477L630 515L615 758L578 790L399 770L374 715L382 535Z" fill="url(#garnet)" opacity=".62"/><path d="M406 500L572 493L600 520" stroke="#ffb293" stroke-width="5" opacity=".5"/>` },
  { slot: "inset", id: "emerald", body: `<path d="M399 483L590 477L630 515L615 758L578 790L399 770L374 715L382 535Z" fill="url(#emerald)" opacity=".58"/><path d="M406 500L572 493L600 520" stroke="#b5ffe3" stroke-width="5" opacity=".48"/>` },
  { slot: "inset", id: "moonstone", body: `<path d="M399 483L590 477L630 515L615 758L578 790L399 770L374 715L382 535Z" fill="url(#moonstone)" opacity=".52"/><ellipse cx="478" cy="600" rx="82" ry="145" fill="#d9f5ff" opacity=".12" filter="url(#glow)"/>` },
];

const uncommon: LayerDefinition[] = [
  { slot: "finish", id: "satin-assay", body: `<g fill="none" stroke="#f2c766" stroke-width="4" opacity=".22"><ellipse cx="620" cy="610" rx="335" ry="337"/><ellipse cx="620" cy="610" rx="301" ry="302"/></g>` },
  { slot: "finish", id: "mirror-edge", body: `<path d="M336 493Q425 269 631 273Q839 280 934 519" fill="none" stroke="#fff2a9" stroke-width="10" opacity=".27" filter="url(#soft)"/>` },
  { slot: "finish", id: "blackened-recess", body: `<g fill="none" stroke="#0e0b07" stroke-width="13" opacity=".62"><ellipse cx="620" cy="610" rx="327" ry="329"/><ellipse cx="620" cy="610" rx="293" ry="294"/></g>` },

  { slot: "clasp", id: "monolith", body: `<path d="M839 553L908 528L964 571L950 687L882 734L823 691Z" fill="#050609" opacity=".42" stroke="url(#gold)" stroke-width="7"/>` },
  { slot: "clasp", id: "twin-orbit", body: `<g fill="none" stroke="#e9b84d" filter="url(#glow)"><ellipse cx="890" cy="635" rx="83" ry="42" stroke-width="5" transform="rotate(70 890 635)"/><ellipse cx="890" cy="635" rx="83" ry="42" stroke-width="3" transform="rotate(-18 890 635)"/><circle cx="890" cy="635" r="16" fill="#dca441"/></g>` },
  { slot: "clasp", id: "garnet-assay", body: `<path d="M846 570L903 547L946 581L937 674L882 711L837 678Z" fill="url(#garnet)" opacity=".78" stroke="#efc567" stroke-width="5"/><path d="M858 618H929M855 646H928" stroke="#ffd47e" stroke-width="5"/>` },
  { slot: "clasp", id: "emerald-gate", body: `<path d="M844 573L904 548L945 582L936 674L882 711L837 677Z" fill="url(#emerald)" opacity=".75" stroke="#edc164" stroke-width="6"/><path d="M865 688V590H920V688" fill="none" stroke="#ffe192" stroke-width="7"/>` },
  { slot: "clasp", id: "sapphire-lozenge", body: `<path d="M891 552L944 632L891 712L838 632Z" fill="url(#sapphire)" opacity=".8" stroke="url(#gold)" stroke-width="7"/><path d="M891 579L923 632L891 685L859 632Z" fill="none" stroke="#b9dcff" stroke-width="4" opacity=".65"/>` },

  { slot: "charm", id: "celestial-coin", body: `<g filter="url(#glow)"><circle cx="618" cy="928" r="25" fill="#bf8429" stroke="#ffe08a" stroke-width="5"/><path d="M618 911V945M601 928H635" stroke="#3b2207" stroke-width="4"/></g>` },
  { slot: "charm", id: "garnet-drop", body: `<path d="M337 802L358 826L337 866L316 826Z" fill="url(#garnet)" stroke="#e7b95b" stroke-width="5" filter="url(#glow)"/>` },
  { slot: "charm", id: "emerald-knot", body: `<path d="M674 287L696 314L674 341L652 314Z" fill="url(#emerald)" stroke="#e7ba5c" stroke-width="5" filter="url(#glow)"/>` },
  { slot: "charm", id: "moonstone-claw", body: `<ellipse cx="339" cy="493" rx="18" ry="27" fill="url(#moonstone)" stroke="#e8bd64" stroke-width="5" filter="url(#glow)"/>` },

  { slot: "orbit", id: "single-orbit", body: `<ellipse cx="627" cy="630" rx="486" ry="142" fill="none" stroke="#f0b946" stroke-width="3" opacity=".52" transform="rotate(-12 627 630)" filter="url(#glow)"/>` },
  { slot: "orbit", id: "twin-orbit", body: `<g fill="none" filter="url(#glow)"><ellipse cx="627" cy="624" rx="492" ry="146" stroke="#efb13e" stroke-width="3" opacity=".56" transform="rotate(-12 627 624)"/><ellipse cx="627" cy="614" rx="444" ry="116" stroke="#e8ca78" stroke-width="2" opacity=".36" transform="rotate(19 627 614)"/></g>` },
  { slot: "orbit", id: "broken-orbit", body: `<g fill="none" stroke="#f1c45f" stroke-width="4" filter="url(#glow)"><path d="M154 702C283 848 556 854 785 764" opacity=".55"/><path d="M832 742C994 664 1074 549 1101 432" opacity=".4"/></g>` },
];

const rare: LayerDefinition[] = [
  { slot: "finish", id: "satin-assay", body: `<path d="M251 340Q330 190 570 187M690 187Q925 198 1003 345" fill="none" stroke="#f6ce78" stroke-width="9" opacity=".22" filter="url(#soft)"/>` },
  { slot: "finish", id: "mirror-edge", body: `<path d="M253 349Q333 186 569 184M688 184Q927 194 1004 348" fill="none" stroke="#fff1ae" stroke-width="13" opacity=".3" filter="url(#soft)"/>` },
  { slot: "finish", id: "blackened-recess", body: `<path d="M276 363Q373 241 565 221M691 220Q878 243 980 367" fill="none" stroke="#150d04" stroke-width="18" opacity=".55"/>` },

  { slot: "seal", id: "octagonal-assay", body: `<path d="M573 903L606 879H660L696 914V1020L660 1054H598L560 1018V927Z" fill="none" stroke="url(#gold)" stroke-width="8"/><path d="M586 928H673M586 957H673M586 986H673M586 1015H673" stroke="#e2ae4c" stroke-width="4" opacity=".72"/>` },
  { slot: "seal", id: "sun", body: `<g stroke="#edbe5a" stroke-width="6" opacity=".8">${Array.from({ length: 12 }, (_, i) => `<path d="M628 975V890" transform="rotate(${i * 30} 628 975)"/>`).join("")}</g><circle cx="628" cy="975" r="43" fill="#c78c2d" opacity=".5" stroke="#ffe29a" stroke-width="6"/>` },
  { slot: "seal", id: "orbit", body: `<g fill="none" stroke="#edbd5d" filter="url(#glow)"><ellipse cx="628" cy="970" rx="70" ry="34" stroke-width="6" transform="rotate(-20 628 970)"/><ellipse cx="628" cy="970" rx="70" ry="34" stroke-width="4" transform="rotate(70 628 970)"/><circle cx="628" cy="970" r="15" fill="#e1a543"/></g>` },
  { slot: "seal", id: "labyrinth", body: `<path d="M582 915H674V1026H592V936H654V1006H612V957H638V985" fill="none" stroke="#e9bb5c" stroke-width="7" opacity=".83"/>` },
  { slot: "seal", id: "celestial-compass", body: `<path d="M628 894L661 950L710 974L661 998L628 1053L595 998L546 974L595 950Z" fill="none" stroke="url(#gold)" stroke-width="7"/><circle cx="628" cy="974" r="30" fill="#061226" stroke="#8fbcef" stroke-width="4"/>` },
  { slot: "seal", id: "lattice", body: `<g fill="none" stroke="#e9b952" stroke-width="5" opacity=".8"><path d="M566 914L689 1028M689 914L566 1028M628 890V1055M550 972H707"/><path d="M628 896L697 972L628 1048L557 972Z" stroke-width="7"/></g>` },
  { slot: "seal", id: "eclipse", body: `<circle cx="628" cy="972" r="70" fill="#020205" opacity=".8" stroke="#f2c46c" stroke-width="7"/><path d="M674 909A76 76 0 0 1 674 1035" fill="none" stroke="#ffd77d" stroke-width="13" filter="url(#glow)"/>` },

  { slot: "mineral", id: "emerald-pair", body: `<g fill="url(#emerald)" stroke="#a7ffe0" stroke-width="3" opacity=".82"><path d="M382 606L429 635L450 687L416 704L371 662Z"/><path d="M874 606L827 635L806 687L840 704L885 662Z"/></g>` },
  { slot: "mineral", id: "garnet-pair", body: `<g fill="url(#garnet)" stroke="#ff9e7d" stroke-width="3" opacity=".84"><path d="M382 606L429 635L450 687L416 704L371 662Z"/><path d="M874 606L827 635L806 687L840 704L885 662Z"/></g>` },
  { slot: "mineral", id: "sapphire-pair", body: `<g fill="url(#sapphire)" stroke="#b3d9ff" stroke-width="3" opacity=".84"><path d="M382 606L429 635L450 687L416 704L371 662Z"/><path d="M874 606L827 635L806 687L840 704L885 662Z"/></g>` },
  { slot: "mineral", id: "moonstone-pair", body: `<g fill="url(#moonstone)" stroke="#efffff" stroke-width="3" opacity=".8" filter="url(#glow)"><path d="M382 606L429 635L450 687L416 704L371 662Z"/><path d="M874 606L827 635L806 687L840 704L885 662Z"/></g>` },
];

const layerGroups: Record<string, LayerDefinition[]> = { shared, common, uncommon, rare };

async function createLayerPng(group: string, definition: LayerDefinition) {
  const directory = path.join(LAYERS, group, definition.slot);
  await mkdir(directory, { recursive: true });
  const output = path.join(directory, `${definition.id}.png`);
  await sharp(svg(definition.body)).png().toFile(output);
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function selectRecipes(tier: Tier, candidates: Traits[], amount: number) {
  const unique = new Map<string, Traits>();
  for (const candidate of candidates) {
    const tuple = JSON.stringify(candidate);
    unique.set(tuple, candidate);
  }
  if (unique.size < amount) throw new Error(`${tier} only has ${unique.size} unique recipes for ${amount} editions`);
  return [...unique.values()]
    .map((traits) => ({ traits, score: sha256(`hedgents-genesis-v1:${tier}:${JSON.stringify(traits)}`) }))
    .sort((a, b) => a.score.localeCompare(b.score))
    .slice(0, amount)
    .map(({ traits }) => traits);
}

function product(spec: Record<string, string[]>) {
  return Object.entries(spec).reduce<Traits[]>((rows, [key, values]) => rows.flatMap((row) => values.map((value) => ({ ...row, [key]: value }))), [{}]);
}

function layerPath(group: string, slot: string, id: string) {
  return path.join(LAYERS, group, slot, `${id}.png`);
}

function overlaysFor(tier: Tier, traits: Traits): OverlayOptions[] {
  const group = tier.toLowerCase();
  const order = tier === "Common"
    ? ["field", "aura", "finish", "engraving", "inset"]
    : tier === "Uncommon"
      ? ["field", "aura", "finish", "clasp", "charm", "orbit"]
      : ["field", "aura", "finish", "seal", "mineral"];
  return order.flatMap((slot) => {
    const id = traits[slot];
    if (!id || id === "none") return [];
    const owner = slot === "field" || slot === "aura" ? "shared" : group;
    return [{ input: layerPath(owner, slot, id), blend: "over" as const }];
  });
}

const commonRecipes = selectRecipes("Common", product({
  field: ["assay-circles", "eclipse"],
  aura: ["none", "assay-dust"],
  finish: ["satin-assay", "mirror-edge", "hammered-field", "blackened-recess"],
  engraving: ["sun-ray", "orbital-groove", "labyrinth", "chevron", "constellation", "assay-bars", "stepped-grid", "tidal-line"],
  inset: ["obsidian", "garnet", "emerald", "moonstone"],
}), tierSupply.Common);

const uncommonRecipes = selectRecipes("Uncommon", product({
  field: ["assay-circles", "eclipse", "vault-grid"],
  aura: ["none", "assay-dust", "orbital-trail"],
  finish: ["satin-assay", "mirror-edge", "blackened-recess"],
  clasp: ["monolith", "twin-orbit", "garnet-assay", "emerald-gate", "sapphire-lozenge"],
  charm: ["celestial-coin", "garnet-drop", "emerald-knot", "moonstone-claw"],
  orbit: ["single-orbit", "twin-orbit", "broken-orbit"],
}), tierSupply.Uncommon);

const rareRecipes = selectRecipes("Rare", product({
  field: ["eclipse", "vault-grid", "star-map"],
  aura: ["assay-dust", "orbital-trail", "emerald-seal", "sapphire-constellation"],
  finish: ["satin-assay", "mirror-edge", "blackened-recess"],
  seal: ["octagonal-assay", "sun", "orbit", "labyrinth", "celestial-compass", "lattice", "eclipse"],
  mineral: ["emerald-pair", "garnet-pair", "sapphire-pair", "moonstone-pair"],
}), tierSupply.Rare);

const epicTraits: Traits[] = [
  { field: "assay-circles", aura: "garnet-inner-radiance", finish: "warm-polished-gold", lattice: "ember-lattice", enamel: "oxblood", mineral: "garnet" },
  { field: "star-map", aura: "sapphire-constellation", finish: "pale-celestial-gold", lattice: "observatory-lattice", enamel: "midnight-blue", mineral: "sapphire" },
  { field: "vault-grid", aura: "emerald-seal", finish: "antique-gold", lattice: "engine-lattice", enamel: "forest-green", mineral: "emerald" },
  { field: "assay-circles", aura: "lunar-frost", finish: "pale-gold", lattice: "frost-lattice", enamel: "ivory", mineral: "moonstone" },
  { field: "eclipse", aura: "restrained-amber", finish: "blackened-gold", lattice: "eclipse-lattice", enamel: "obsidian", mineral: "onyx" },
];

async function writeRelic(edition: number, tier: Tier, artefact: string, traits: Traits, source?: string) {
  const id = String(edition).padStart(3, "0");
  const outputName = `${id}-${tier.toLowerCase()}-${artefact.toLowerCase().replaceAll(" ", "-")}.webp`;
  const outputPath = path.join(FINAL, outputName);
  const pipeline = sharp(source ?? baseByTier[tier]);
  if (!source && (tier === "Common" || tier === "Uncommon" || tier === "Rare")) {
    pipeline.composite(overlaysFor(tier, traits));
  }
  await pipeline.webp({ quality: 94, effort: 5 }).toFile(outputPath);
  const bytes = await readFile(outputPath);
  const imageHash = sha256(bytes);
  const recipeHash = sha256(JSON.stringify({ tier, artefact, traits }));
  const article = tier === "Epic" ? "An" : "A";
  const metadata = {
    name: `Hedgents Relic #${id} — ${artefact}`,
    symbol: "RELIC",
    description: `${article} ${tier} ${artefact} from the fixed 100-piece Hedgents Genesis collection. Burn redemption transfers the ticket's exact onchain PAXG amount. No physical artefact delivery.`,
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

async function contactSheet(relics: Relic[]) {
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
    .toFile(path.join(OUT, "contact-sheet.webp"));
}

async function layerContactSheet() {
  const catalog = Object.entries(layerGroups).flatMap(([group, definitions]) => definitions.map((definition) => ({
    group,
    slot: definition.slot,
    id: definition.id,
    file: `layers/${group}/${definition.slot}/${definition.id}.png`,
  })));
  const columns = 8;
  const cell = 188;
  const gap = 6;
  const rows = Math.ceil(catalog.length / columns);
  const sheetWidth = columns * cell + (columns + 1) * gap;
  const sheetHeight = rows * cell + (rows + 1) * gap;
  const checker = svg(`<defs><pattern id="checker" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#191917"/><rect width="20" height="20" fill="#272722"/><rect x="20" y="20" width="20" height="20" fill="#272722"/></pattern></defs><rect width="1254" height="1254" fill="url(#checker)"/>`);
  const inputs = await Promise.all(catalog.map(async (item, index) => {
    const artwork = await sharp(path.join(OUT, item.file)).resize(1130, 1010, { fit: "contain" }).png().toBuffer();
    const label = svg(`<rect x="0" y="1070" width="1254" height="184" fill="#080807" opacity=".88"/><text x="627" y="1140" text-anchor="middle" fill="#f5dfae" font-family="Arial, sans-serif" font-size="58">${item.group} / ${item.slot}</text><text x="627" y="1214" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="66">${item.id}</text>`);
    const fullTile = await sharp(checker)
      .composite([{ input: artwork, gravity: "north" }, { input: label }])
      .png()
      .toBuffer();
    const tile = await sharp(fullTile).resize(cell, cell).webp({ quality: 88 }).toBuffer();
    return {
      input: tile,
      left: gap + (index % columns) * (cell + gap),
      top: gap + Math.floor(index / columns) * (cell + gap),
    };
  }));
  await sharp({ create: { width: sheetWidth, height: sheetHeight, channels: 3, background: "#080807" } })
    .composite(inputs)
    .webp({ quality: 90, effort: 5 })
    .toFile(path.join(OUT, "layer-contact-sheet.webp"));
  await writeFile(path.join(OUT, "layer-catalog.json"), `${JSON.stringify({ canvas: { width: SIZE, height: SIZE }, count: catalog.length, layers: catalog }, null, 2)}\n`);
  return catalog;
}

async function verify(relics: Relic[]) {
  if (relics.length !== 100) throw new Error(`Expected 100 relics, received ${relics.length}`);
  const counts = relics.reduce<Record<string, number>>((acc, relic) => ({ ...acc, [relic.tier]: (acc[relic.tier] ?? 0) + 1 }), {});
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
  const layerFiles = Object.entries(layerGroups).flatMap(([group, definitions]) => definitions.map((definition) => layerPath(group, definition.slot, definition.id)));
  for (const file of layerFiles) {
    const info = await sharp(file).metadata();
    if (info.width !== SIZE || info.height !== SIZE || !info.hasAlpha) throw new Error(`${file} violates the ${SIZE}x${SIZE} alpha-layer contract`);
  }
  return { counts, uniqueRecipeHashes: recipeHashes.size, uniqueImageHashes: imageHashes.size, transparentLayers: layerFiles.length, dimensions: `${SIZE}x${SIZE}` };
}

async function main() {
  await Promise.all([
    rm(LAYERS, { recursive: true, force: true }),
    rm(FINAL, { recursive: true, force: true }),
    rm(METADATA, { recursive: true, force: true }),
  ]);
  await Promise.all([mkdir(FINAL, { recursive: true }), mkdir(METADATA, { recursive: true })]);
  for (const [group, definitions] of Object.entries(layerGroups)) {
    await Promise.all(definitions.map((definition) => createLayerPng(group, definition)));
  }

  const relics: Relic[] = [];
  let edition = 1;
  for (const traits of commonRecipes) relics.push(await writeRelic(edition++, "Common", "Gold Signet", traits));
  for (const traits of uncommonRecipes) relics.push(await writeRelic(edition++, "Uncommon", "Orbit Bracelet", traits));
  for (const traits of rareRecipes) relics.push(await writeRelic(edition++, "Rare", "Royal Torque", traits));
  for (let index = 0; index < epicTraits.length; index += 1) {
    relics.push(await writeRelic(edition++, "Epic", "Imperial Ovoid", epicTraits[index], path.join(OUT, "epic", `epic-0${index + 1}-${["ember-lattice", "midnight-observatory", "verdant-engine", "lunar-frost", "obsidian-eclipse"][index]}.png`)));
  }
  relics.push(await writeRelic(edition++, "Legendary", "Crown Jewel", {
    field: "sovereign-assay", aura: "solar-corona", finish: "radiant-gold", crest: "sovereign", mineral: "diamond-white-crystal-and-sapphire", edition: "one-of-one",
  }, baseByTier.Legendary));

  const verification = await verify(relics);
  await Promise.all([contactSheet(relics), layerContactSheet()]);
  const manifest = {
    schemaVersion: 1,
    collection: "Hedgents Relics — Genesis",
    seedDomain: "hedgents-genesis-v1",
    canvas: { width: SIZE, height: SIZE },
    supply: tierSupply,
    pullPriceUsdc: 35,
    redemptionTargetsUsdAtFundingSnapshot: redemptionTargetUsd,
    warning: "USD figures are design targets only. Exact atomic PAXG amounts committed by the deployed campaign are authoritative. No physical artefact delivery.",
    verification,
    relics,
  };
  await writeFile(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(OUT, "verification.json"), `${JSON.stringify(verification, null, 2)}\n`);
  console.log(JSON.stringify({ output: OUT, layers: Object.values(layerGroups).flat().length, relics: relics.length, ...verification }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
