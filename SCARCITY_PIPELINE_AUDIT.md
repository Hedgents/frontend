# Periodic-table data-pipeline audit

**Audit date:** 2026-08-09  
**Scope:** all 118 periodic elements; Hedgents tracks every conventional metal, all six metalloids, and Selenium as an explicit minor-material commodity exception.  
**Canonical implementation:** `lib/scarcity/pipeline-audit.ts`

## Result

- 118/118 periodic cells were evaluated.
- 99 cells are intentionally tracked by the Hedgents material registry.
- 50 tracked cells have reproducible bundled USGS annual observations.
- 18 tracked cells have a named official commercial, compound, group, or application reference but still need timestamped ingestion adapters.
- 31 tracked cells have no open commodity market and use an objective IAEA scientific-event reference only. They cannot receive a fabricated commodity price or scarcity score.
- 19 nonmetal cells are explicitly outside the Hedgents metal/material scope rather than disappearing because a source mapping happens to be absent.
- 7 cells currently have an active real-time or weekly market-pulse overlay.
- 99/99 tracked cells are enrolled in the daily online detector. Every cell has a named reference-page monitor and event namespace; one metal per day also receives a bounded scientific-publication discovery pass.
- The official USGS annual release is discovered automatically through ScienceBase. A checksum change downloads the new CSV, preserves the raw artifact, runs exact-field parsing and coverage gates, and publishes the reviewed-format observation batch into the existing immutable state/signal pipeline.
- New page, policy, and scientific records are content-addressed and quarantined. They cannot enter a reviewed signal or market candidate until an administrator approves the evidence.
- 0 structural audit failures remain.

Germanium and Boron were the two catalog defects found in the metalloid set. Germanium now maps to the USGS annual refined-germanium-metal price row. Boron now maps to commercial borates on a B2O3 basis. Both are `reference-only` until a timestamped adapter, exact field freeze, invalidation policy, evidence capture, and review step are implemented.

The audit also found that the USGS generator hashed a UTF-8-decoded string instead of the raw official CSV bytes. The bundled SHA-256 was corrected to `582a0aa231aea53d8a97dc8d1cd3dfa5f885cf3760353e3d029d7f0ae4fbaaf5`; all 50 records and 111 derived observations reproduced identically.

## Status meanings

- `bundled-annual` — reproducible annual observation exists in the bundled USGS dataset and the next official USGS release is checksum-monitored for automatic import.
- `reference-only` — the primary reference and exact commercial relationship are defined and its official page/event namespace is monitored. An approved event is valid only for a frozen event market; it does not become a physical scarcity observation without an exact-field adapter.
- `scientific-only` — an objective scientific publication namespace is monitored; no commodity claim or scarcity score is valid.
- `out-of-scope` — intentionally excluded because it is outside the metal, metalloid, and explicit minor-material scope.

## One-by-one audit

| Z | Symbol | Element | Classification | Pipeline | Current data path | Active pulse |
|---:|:---:|---|---|---|---|:---:|
| 1 | H | Hydrogen | reactive-nonmetal | out-of-scope | outside Hedgents material scope | no |
| 2 | He | Helium | noble-gas | out-of-scope | outside Hedgents material scope | no |
| 3 | Li | Lithium | alkali-metal | bundled-annual | USGS annual: reserve life, supply growth, producer concentration | yes |
| 4 | Be | Beryllium | alkaline-earth-metal | bundled-annual | USGS annual: supply growth, producer concentration | no |
| 5 | B | Boron | metalloid | reference-only | commercial borates on B2O3 basis, annual | no |
| 6 | C | Carbon | reactive-nonmetal | out-of-scope | outside Hedgents material scope | no |
| 7 | N | Nitrogen | reactive-nonmetal | out-of-scope | outside Hedgents material scope | no |
| 8 | O | Oxygen | reactive-nonmetal | out-of-scope | outside Hedgents material scope | no |
| 9 | F | Fluorine | halogen | out-of-scope | outside Hedgents material scope | no |
| 10 | Ne | Neon | noble-gas | out-of-scope | outside Hedgents material scope | no |
| 11 | Na | Sodium | alkali-metal | reference-only | soda ash (sodium carbonate), monthly | no |
| 12 | Mg | Magnesium | alkaline-earth-metal | bundled-annual | USGS annual: supply growth, producer concentration | no |
| 13 | Al | Aluminium | post-transition-metal | bundled-annual | USGS annual: supply growth, producer concentration | no |
| 14 | Si | Silicon | metalloid | bundled-annual | USGS annual: supply growth, producer concentration | no |
| 15 | P | Phosphorus | reactive-nonmetal | out-of-scope | outside Hedgents material scope | no |
| 16 | S | Sulfur | reactive-nonmetal | out-of-scope | outside Hedgents material scope | no |
| 17 | Cl | Chlorine | halogen | out-of-scope | outside Hedgents material scope | no |
| 18 | Ar | Argon | noble-gas | out-of-scope | outside Hedgents material scope | no |
| 19 | K | Potassium | alkali-metal | reference-only | potash on K2O-equivalent basis, annual | no |
| 20 | Ca | Calcium | alkaline-earth-metal | reference-only | NOAA coral bleaching stress application signal, daily | no |
| 21 | Sc | Scandium | transition-metal | reference-only | frozen scandium oxide/metal grade, annual | no |
| 22 | Ti | Titanium | transition-metal | bundled-annual | USGS ilmenite: supply growth, producer concentration | no |
| 23 | V | Vanadium | transition-metal | bundled-annual | USGS annual: reserve life, supply growth, producer concentration | no |
| 24 | Cr | Chromium | transition-metal | bundled-annual | USGS chromite: supply growth, producer concentration | no |
| 25 | Mn | Manganese | transition-metal | bundled-annual | USGS annual: reserve life, supply growth, producer concentration | no |
| 26 | Fe | Iron | transition-metal | bundled-annual | USGS iron content: reserve life, supply growth, producer concentration | no |
| 27 | Co | Cobalt | transition-metal | bundled-annual | USGS annual plus CFTC weekly pulse | yes |
| 28 | Ni | Nickel | transition-metal | bundled-annual | USGS annual: supply growth, producer concentration | no |
| 29 | Cu | Copper | transition-metal | bundled-annual | USGS annual plus CFTC weekly pulse | yes |
| 30 | Zn | Zinc | transition-metal | bundled-annual | USGS annual: reserve life, supply growth, producer concentration | no |
| 31 | Ga | Gallium | post-transition-metal | bundled-annual | USGS annual: supply growth, producer concentration | no |
| 32 | Ge | Germanium | metalloid | reference-only | refined germanium-metal price, annual | no |
| 33 | As | Arsenic | metalloid | bundled-annual | USGS arsenic trioxide: supply growth, producer concentration | no |
| 34 | Se | Selenium | reactive-nonmetal | bundled-annual | USGS refinery selenium: supply growth, producer concentration | no |
| 35 | Br | Bromine | halogen | out-of-scope | outside Hedgents material scope | no |
| 36 | Kr | Krypton | noble-gas | out-of-scope | outside Hedgents material scope | no |
| 37 | Rb | Rubidium | alkali-metal | reference-only | frozen rubidium compound grade, annual | no |
| 38 | Sr | Strontium | alkaline-earth-metal | bundled-annual | USGS celestite: supply growth, producer concentration | no |
| 39 | Y | Yttrium | transition-metal | reference-only | yttrium-bearing rare-earth products, annual | no |
| 40 | Zr | Zirconium | transition-metal | bundled-annual | USGS zircon concentrates: supply growth, producer concentration | no |
| 41 | Nb | Niobium | transition-metal | bundled-annual | USGS annual: supply growth, producer concentration | no |
| 42 | Mo | Molybdenum | transition-metal | bundled-annual | USGS annual: reserve life, supply growth, producer concentration | no |
| 43 | Tc | Technetium | transition-metal | scientific-only | IAEA evaluated-nuclide publication event | no |
| 44 | Ru | Ruthenium | transition-metal | reference-only | specifically labeled PGM row, annual | no |
| 45 | Rh | Rhodium | transition-metal | reference-only | specifically labeled rhodium price row, annual | no |
| 46 | Pd | Palladium | transition-metal | bundled-annual | USGS annual plus Pyth/CFTC pulse | yes |
| 47 | Ag | Silver | transition-metal | bundled-annual | USGS annual plus Pyth/CFTC pulse | yes |
| 48 | Cd | Cadmium | transition-metal | bundled-annual | USGS refined cadmium: supply growth, producer concentration | no |
| 49 | In | Indium | post-transition-metal | bundled-annual | USGS refined indium: supply growth, producer concentration | no |
| 50 | Sn | Tin | post-transition-metal | bundled-annual | USGS annual: supply growth, producer concentration | no |
| 51 | Sb | Antimony | metalloid | bundled-annual | USGS annual: supply growth, producer concentration | no |
| 52 | Te | Tellurium | metalloid | bundled-annual | USGS refinery tellurium: supply growth, producer concentration | no |
| 53 | I | Iodine | halogen | out-of-scope | outside Hedgents material scope | no |
| 54 | Xe | Xenon | noble-gas | out-of-scope | outside Hedgents material scope | no |
| 55 | Cs | Caesium | alkali-metal | reference-only | frozen cesium compound/formate grade, annual | no |
| 56 | Ba | Barium | alkaline-earth-metal | reference-only | barite (barium sulfate), annual | no |
| 57 | La | Lanthanum | lanthanide | bundled-annual | USGS rare-earth group context, annual | no |
| 58 | Ce | Cerium | lanthanide | bundled-annual | USGS rare-earth group context, annual | no |
| 59 | Pr | Praseodymium | lanthanide | bundled-annual | USGS rare-earth group context, annual | no |
| 60 | Nd | Neodymium | lanthanide | bundled-annual | USGS rare-earth group context, annual | no |
| 61 | Pm | Promethium | lanthanide | scientific-only | IAEA evaluated-nuclide publication event | no |
| 62 | Sm | Samarium | lanthanide | bundled-annual | USGS rare-earth group context, annual | no |
| 63 | Eu | Europium | lanthanide | bundled-annual | USGS rare-earth group context, annual | no |
| 64 | Gd | Gadolinium | lanthanide | bundled-annual | USGS rare-earth group context, annual | no |
| 65 | Tb | Terbium | lanthanide | bundled-annual | USGS rare-earth group context, annual | no |
| 66 | Dy | Dysprosium | lanthanide | bundled-annual | USGS rare-earth group context, annual | no |
| 67 | Ho | Holmium | lanthanide | bundled-annual | USGS rare-earth group context, annual | no |
| 68 | Er | Erbium | lanthanide | bundled-annual | USGS rare-earth group context, annual | no |
| 69 | Tm | Thulium | lanthanide | bundled-annual | USGS rare-earth group context, annual | no |
| 70 | Yb | Ytterbium | lanthanide | bundled-annual | USGS rare-earth group context, annual | no |
| 71 | Lu | Lutetium | lanthanide | bundled-annual | USGS rare-earth group context, annual | no |
| 72 | Hf | Hafnium | transition-metal | reference-only | frozen zircon-derived hafnium product, annual | no |
| 73 | Ta | Tantalum | transition-metal | bundled-annual | USGS annual: supply growth, producer concentration | no |
| 74 | W | Tungsten | transition-metal | bundled-annual | USGS annual: supply growth, producer concentration | no |
| 75 | Re | Rhenium | transition-metal | bundled-annual | USGS annual: supply growth, producer concentration | no |
| 76 | Os | Osmium | transition-metal | reference-only | specifically labeled PGM row, annual | no |
| 77 | Ir | Iridium | transition-metal | reference-only | specifically labeled PGM row, annual | no |
| 78 | Pt | Platinum | transition-metal | bundled-annual | USGS annual plus Pyth/CFTC pulse | yes |
| 79 | Au | Gold | transition-metal | bundled-annual | USGS annual plus Pyth/CFTC pulse | yes |
| 80 | Hg | Mercury | transition-metal | bundled-annual | USGS annual: supply growth, producer concentration | no |
| 81 | Tl | Thallium | post-transition-metal | reference-only | frozen thallium metal/compound form, annual | no |
| 82 | Pb | Lead | post-transition-metal | bundled-annual | USGS annual: reserve life, supply growth, producer concentration | no |
| 83 | Bi | Bismuth | post-transition-metal | bundled-annual | USGS refined bismuth: supply growth, producer concentration | no |
| 84 | Po | Polonium | post-transition-metal | scientific-only | IAEA evaluated-nuclide publication event | no |
| 85 | At | Astatine | halogen | out-of-scope | outside Hedgents material scope | no |
| 86 | Rn | Radon | noble-gas | out-of-scope | outside Hedgents material scope | no |
| 87 | Fr | Francium | alkali-metal | scientific-only | IAEA evaluated-nuclide publication event | no |
| 88 | Ra | Radium | alkaline-earth-metal | scientific-only | IAEA evaluated-nuclide publication event | no |
| 89 | Ac | Actinium | actinide | scientific-only | IAEA evaluated-nuclide publication event | no |
| 90 | Th | Thorium | actinide | reference-only | thorium/monazite official row, annual | no |
| 91 | Pa | Protactinium | actinide | scientific-only | IAEA evaluated-nuclide publication event | no |
| 92 | U | Uranium | actinide | reference-only | EIA U3O8-equivalent data, quarterly | no |
| 93 | Np | Neptunium | actinide | scientific-only | IAEA evaluated-nuclide publication event | no |
| 94 | Pu | Plutonium | actinide | scientific-only | IAEA evaluated-nuclide publication event | no |
| 95 | Am | Americium | actinide | scientific-only | IAEA evaluated-nuclide publication event | no |
| 96 | Cm | Curium | actinide | scientific-only | IAEA evaluated-nuclide publication event | no |
| 97 | Bk | Berkelium | actinide | scientific-only | IAEA evaluated-nuclide publication event | no |
| 98 | Cf | Californium | actinide | scientific-only | IAEA evaluated-nuclide publication event | no |
| 99 | Es | Einsteinium | actinide | scientific-only | IAEA evaluated-nuclide publication event | no |
| 100 | Fm | Fermium | actinide | scientific-only | IAEA evaluated-nuclide publication event | no |
| 101 | Md | Mendelevium | actinide | scientific-only | IAEA evaluated-nuclide publication event | no |
| 102 | No | Nobelium | actinide | scientific-only | IAEA evaluated-nuclide publication event | no |
| 103 | Lr | Lawrencium | actinide | scientific-only | IAEA evaluated-nuclide publication event | no |
| 104 | Rf | Rutherfordium | transition-metal | scientific-only | IAEA evaluated-nuclide publication event | no |
| 105 | Db | Dubnium | transition-metal | scientific-only | IAEA evaluated-nuclide publication event | no |
| 106 | Sg | Seaborgium | transition-metal | scientific-only | IAEA evaluated-nuclide publication event | no |
| 107 | Bh | Bohrium | transition-metal | scientific-only | IAEA evaluated-nuclide publication event | no |
| 108 | Hs | Hassium | transition-metal | scientific-only | IAEA evaluated-nuclide publication event | no |
| 109 | Mt | Meitnerium | transition-metal | scientific-only | IAEA evaluated-nuclide publication event | no |
| 110 | Ds | Darmstadtium | transition-metal | scientific-only | IAEA evaluated-nuclide publication event | no |
| 111 | Rg | Roentgenium | transition-metal | scientific-only | IAEA evaluated-nuclide publication event | no |
| 112 | Cn | Copernicium | transition-metal | scientific-only | IAEA evaluated-nuclide publication event | no |
| 113 | Nh | Nihonium | post-transition-metal | scientific-only | IAEA evaluated-nuclide publication event | no |
| 114 | Fl | Flerovium | post-transition-metal | scientific-only | IAEA evaluated-nuclide publication event | no |
| 115 | Mc | Moscovium | post-transition-metal | scientific-only | IAEA evaluated-nuclide publication event | no |
| 116 | Lv | Livermorium | post-transition-metal | scientific-only | IAEA evaluated-nuclide publication event | no |
| 117 | Ts | Tennessine | halogen | out-of-scope | outside Hedgents material scope | no |
| 118 | Og | Oganesson | noble-gas | out-of-scope | outside Hedgents material scope | no |

## Pipeline priority after this audit

1. **Closed:** daily source scheduling, health/failure monitoring, content-addressed evidence capture, deduplication, quarantine, operator review, event-candidate compilation, and admin publication into an immutable canonical market specification now run end to end.
2. **Closed:** official USGS ScienceBase release discovery, raw-byte checksum comparison, generalized annual parser, coverage gates, immutable publication, state recomputation, and numerical-signal recomputation are connected.
3. **Next data-depth work:** build exact-field numerical adapters for the 18 `reference-only` cells, starting with Germanium, Boron, Uranium, Sodium, and the PGM rows. Page/event monitoring is already active for them.
4. Keep the 31 scientific-only cells event-driven until demand justifies deeper ingestion; never manufacture commodity values for them.
5. Add independent confirmation and higher-frequency physical data only where free, authoritative sources can be frozen and reproduced.
