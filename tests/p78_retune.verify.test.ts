// Verifikation für P7-Threshold 70 und P8 mit Hindernissen in der P2-Zone.

import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { PATTERNS } from "../src/patterns.js";
import { describe, it, expect } from "vitest";

const zonesL  = new Zones(50, 30, { endzoneWidth: 3, lShapes: "both" });
const zonesP8 = new Zones(60, 36, { endzoneWidth: 3, lShapes: "none" });

function score(
  zones: Zones, rows: number, cols: number,
  stamps: { r: number; c: number; cells: [number,number][] }[],
  gens: number,
): { p1: number } {
  const eng = new Engine(rows, cols, zones, 9999);
  for (const s of stamps) eng.stampCells(s.r, s.c, s.cells);
  let p1 = 0;
  for (let i = 0; i < gens; i++)
    for (const e of eng.computeNextGeneration()) if (e.scorer === 1) p1 += e.points;
  for (const e of eng.forceFlushBuckets()) if (e.scorer === 1) p1 += e.points;
  return { p1 };
}

const mwss      = PATTERNS[1]!.cells;
const lwss      = PATTERNS[0]!.cells;
const gliderDown = PATTERNS[8]!.cells;
const block     = PATTERNS[2]!.cells;
const blinker   = PATTERNS[5]!.cells;

// =============================================================================
// P7 – Threshold 70: welche MWSS-Zeilen erreichen ≥ 70?
// =============================================================================
describe("P7 threshold 70 – vollständiger Zeilen-Sweep", () => {
  it("alle MWSS-Zeilen (L-Zonen, 100 Gens)", () => {
    console.log("\n=== P7: MWSS alle Zeilen, L-Zonen, 100 Gens ===");
    for (let r = 0; r < 30; r++) {
      const { p1 } = score(zonesL, 30, 50, [{ r, c: 5, cells: mwss }], 100);
      const mark = p1 >= 70 ? "✅ PASS" : p1 >= 30 ? "  ok  " : "  --  ";
      if (p1 > 0) console.log(`  Zeile ${String(r).padStart(2)}: P1=${String(p1).padStart(3)}  ${mark}`);
    }
    expect(true).toBe(true);
  });

  it("LWSS alle Zeilen zum Vergleich", () => {
    console.log("\n=== P7: LWSS alle Zeilen ===");
    for (let r = 0; r < 30; r++) {
      const { p1 } = score(zonesL, 30, 50, [{ r, c: 5, cells: lwss }], 100);
      if (p1 >= 30) console.log(`  LWSS Zeile ${String(r).padStart(2)}: P1=${p1}${p1 >= 70 ? " ✅" : ""}`);
    }
    expect(true).toBe(true);
  });
});

// =============================================================================
// P8 – Hindernisse in der P2-Zone (cols 39–56 bei 60×36)
// =============================================================================
describe("P8 – Hindernisse in P2-Zone", () => {
  // P2-Zone: cols 39–56, scoreColumn = 57
  it("P8 Zone-Layout zur Referenz", () => {
    const z = zonesP8;
    console.log(`\nP8 Zonen: P1=${z.endzoneLeftEnd}–${z.leftEnd-1}, neutral=${z.leftEnd}–${z.rightStart-1}, P2=${z.rightStart}–${z.endzoneRightStart-1}, score=${z.scoreColumnRight}`);
    expect(true).toBe(true);
  });

  it("GliderDown aus P1-Zone trifft Block in P2-Zone (Sweep)", () => {
    console.log("\n=== GliderDown(r,c) P1-Zone → Block in P2-Zone ===");
    // Formel: GliderDown(r,c) trifft (r+N, c+N). Block bei (R,C): N=R-r, c=C-N=C-R+r.
    // P1-Zone c ≤ 20. Block-Kandidaten in P2-Zone (col 39–50):
    const blockTargets: [number,number][] = [
      [20,40],[22,42],[25,42],[28,45],[15,39],[18,42],
    ];
    for (const [br, bc] of blockTargets) {
      // GliderDown-Start: c = bc-br+r, wähle r=0
      const gc = bc - br; // r=0
      if (gc < 3 || gc > 20) {
        console.log(`  Block(${br},${bc}): Start-Col ${gc} außerhalb P1-Zone`);
        continue;
      }
      const mwssRow = br - 2; // MWSS 2 Zeilen über dem Block
      if (mwssRow < 0) continue;
      const withClear = score(zonesP8, 36, 60, [
        { r: 0, c: gc, cells: gliderDown },
        { r: mwssRow, c: 5, cells: mwss },
        { r: br, c: bc, cells: block },
      ], 160).p1;
      const blocked = score(zonesP8, 36, 60, [
        { r: mwssRow, c: 5, cells: mwss },
        { r: br, c: bc, cells: block },
      ], 160).p1;
      const ok = withClear > blocked;
      console.log(`  Block(${br},${bc}) ← GliderDown(0,${gc})+MWSS(${mwssRow},5): ${blocked}→${withClear} ${ok ? "✅" : "❌"}`);
    }
    expect(true).toBe(true);
  });

  it("Mehrere Blöcke in P2-Zone – MWSS ohne Räumen blockiert?", () => {
    console.log("\n=== 3 Blöcke in P2-Zone, verschiedene Zeilen ===");
    // 3 Blöcke streuen über P2-Zone: oben, mitte, unten
    const obstacle3 = [
      { r: 5,  c: 42, cells: block },
      { r: 18, c: 42, cells: block },
      { r: 29, c: 42, cells: block },
    ];
    for (const r of [3, 5, 10, 16, 18, 24, 27, 29]) {
      const { p1 } = score(zonesP8, 36, 60, [{ r, c: 5, cells: mwss }, ...obstacle3], 160);
      console.log(`  MWSS(${r},5) + 3 Blöcke: P1=${p1}`);
    }
    expect(true).toBe(true);
  });

  it("Räumen-Test: GliderDown löscht Block(5,42), MWSS(3,5) fährt durch", () => {
    console.log("\n=== GliderDown räumt Block(5,42) ===");
    // c = 42-5+r = 37+r → bei r=0: c=37 (neutral, zu weit). r müsste negativ sein.
    // Andere Formel prüfen: GliderDown legt größeren Startabstand zurück.
    for (const [gr, gc] of [[0,14],[0,16],[0,18],[1,15],[2,16],[3,17]] as [number,number][]) {
      const withClear = score(zonesP8, 36, 60, [
        { r: gr, c: gc, cells: gliderDown },
        { r: 3, c: 5, cells: mwss },
        { r: 5, c: 42, cells: block },
      ], 160).p1;
      const blocked = score(zonesP8, 36, 60, [
        { r: 3, c: 5, cells: mwss },
        { r: 5, c: 42, cells: block },
      ], 160).p1;
      if (withClear > blocked || withClear > 0)
        console.log(`  GliderDown(${gr},${gc})+MWSS(3,5)+Block(5,42): ${blocked}→${withClear} ${withClear > blocked ? "✅" : "❌"}`);
    }
    expect(true).toBe(true);
  });

  it("Freie Mitte + mehrere Blöcke in P2-Zone: 3 MWSS Strategie", () => {
    console.log("\n=== 3 Blöcke P2-Zone, 3×MWSS ohne Räumen ===");
    const obs = [
      { r: 4,  c: 42, cells: block },
      { r: 16, c: 42, cells: block },
      { r: 28, c: 42, cells: block },
    ];
    // Freie Zeilen: 8–12, 20–24 (zwischen den Blöcken)
    for (const [r1,r2,r3] of [[8,12,20],[9,15,21],[10,16,22]] as [number,number,number][]) {
      const { p1 } = score(zonesP8, 36, 60, [
        { r: r1, c: 5, cells: mwss },
        { r: r2, c: 5, cells: mwss },
        { r: r3, c: 5, cells: mwss },
        ...obs,
      ], 160);
      console.log(`  3×MWSS(${r1},${r2},${r3}) + 3 Blöcke: P1=${p1}`);
    }
    // 1 MWSS frei (baseline)
    const { p1: solo } = score(zonesP8, 36, 60, [{ r: 10, c: 5, cells: mwss }, ...obs], 160);
    console.log(`  Solo MWSS(10) frei: P1=${solo}`);
    expect(true).toBe(true);
  });
});
