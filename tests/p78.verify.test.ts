// Verification tests for P7 (Score Through the L) and P8 (Clear the Path).
// Design tool — never fails CI. Read console output to calibrate thresholds.

import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { PATTERNS } from "../src/patterns.js";
import { describe, it, expect } from "vitest";

// ── P7 grid: 50×30, L-zones ──────────────────────────────────────────────────
const p7Zones = new Zones(50, 30, { endzoneWidth: 3, lShapes: "both" });

// ── P8 grid: 60×36, no-L ─────────────────────────────────────────────────────
const p8Zones = new Zones(60, 36, { endzoneWidth: 3, lShapes: "none" });

function score(
  zones: Zones, rows: number, cols: number,
  stamps: { r: number; c: number; cells: [number,number][]; mirror?: boolean }[],
  gens: number,
): { p1: number; p2: number } {
  const eng = new Engine(rows, cols, zones, 9999);
  for (const s of stamps) {
    const cells: [number,number][] = s.mirror
      ? (() => { const mx = Math.max(...s.cells.map(([,c]) => c)); return s.cells.map(([r,c]) => [r, mx-c] as [number,number]); })()
      : s.cells;
    eng.stampCells(s.r, s.c, cells);
  }
  let p1 = 0, p2 = 0;
  for (let i = 0; i < gens; i++)
    for (const e of eng.computeNextGeneration())
      e.scorer === 1 ? (p1 += e.points) : (p2 += e.points);
  for (const e of eng.forceFlushBuckets())
    e.scorer === 1 ? (p1 += e.points) : (p2 += e.points);
  return { p1, p2 };
}

const mwss = PATTERNS[1]!.cells;   // index 1
const lwss = PATTERNS[0]!.cells;   // index 0
const gliderUp = PATTERNS[9]!.cells; // index 9
const blinker = PATTERNS[5]!.cells; // index 5

// =============================================================================
// P7 — Score Through the L
// =============================================================================
describe("P7 verification — scoring with MWSS/LWSS through L-zones (100 gens)", () => {
  it("P7 zone layout", () => {
    const z = p7Zones;
    console.log(`\nP7 zones (50×30, L):`);
    console.log(`  P1 zone: cols ${z.endzoneLeftEnd}–${z.leftEnd-1}`);
    console.log(`  scoreRight=${z.scoreColumnRight}, topL arm: row ${z.scoreRowTop} cols ${z.scoreColumnTopRight}–${z.scoreColumnRight}`);
    console.log(`  bottomL arm: row ${z.scoreRowBottom} cols ${z.scoreColumnBottomRight}–${z.scoreColumnRight}`);
    expect(true).toBe(true);
  });

  it("MWSS from various rows — find high-scoring positions", () => {
    console.log("\n=== P7: MWSS scores by row (col 5, 100 gens) ===");
    for (const r of [0,1,2,3,4,5,10,13,23,24,25,26]) {
      const { p1 } = score(p7Zones, 30, 50, [{ r, c: 5, cells: mwss }], 100);
      if (p1 > 0) console.log(`  MWSS at (${r},5): P1=${p1}`);
    }
    expect(true).toBe(true);
  });

  it("LWSS from various rows", () => {
    console.log("\n=== P7: LWSS scores by row (col 5, 100 gens) ===");
    for (const r of [0,1,2,3,4,5,10,13,23,24,25,26,27]) {
      const { p1 } = score(p7Zones, 30, 50, [{ r, c: 5, cells: lwss }], 100);
      if (p1 > 0) console.log(`  LWSS at (${r},5): P1=${p1}`);
    }
    expect(true).toBe(true);
  });

  it("GliderUp from P1 zone", () => {
    console.log("\n=== P7: GliderUp scores (col 14, 100 gens) ===");
    for (const r of [20,21,22,23,24,25,26,27]) {
      const { p1 } = score(p7Zones, 30, 50, [{ r, c: 14, cells: gliderUp }], 100);
      console.log(`  GliderUp at (${r},14): P1=${p1}`);
    }
    expect(true).toBe(true);
  });

  it("Blinker (decoy) does not score", () => {
    const { p1 } = score(p7Zones, 30, 50, [{ r: 10, c: 10, cells: blinker }], 100);
    console.log(`\nBlinker at (10,10): P1=${p1}`);
    expect(p1).toBe(0);
    expect(true).toBe(true);
  });
});

// =============================================================================
// P8 — Clear the Path
// =============================================================================
describe("P8 verification — 60×36 grid layout + barrier placement", () => {
  it("P8 zone layout", () => {
    const z = p8Zones;
    console.log(`\nP8 zones (60×36, no-L):`);
    console.log(`  P1 zone: cols ${z.endzoneLeftEnd}–${z.leftEnd-1}`);
    console.log(`  neutral: cols ${z.leftEnd}–${z.rightStart-1}`);
    console.log(`  P2 zone: cols ${z.rightStart}–${z.endzoneRightStart-1}`);
    console.log(`  scoreRight=${z.scoreColumnRight}`);
    expect(true).toBe(true);
  });

  it("MWSS without barriers — baseline score", () => {
    console.log("\n=== P8: MWSS no barriers (120 gens) ===");
    for (const r of [5, 10, 18, 25, 30]) {
      const { p1 } = score(p8Zones, 36, 60, [{ r, c: 5, cells: mwss }], 120);
      console.log(`  MWSS at (${r},5): P1=${p1}`);
    }
    expect(true).toBe(true);
  });

  it("Find barrier positions — 3 blinkers across neutral zone (rows ~6-10)", () => {
    // Blinker at cols 24, 30, 36 — do they block MWSS at row 5?
    console.log("\n=== P8: Upper blinker barrier effect on MWSS ===");
    const p8Cols = 60, p8Rows = 36;
    const barrierCols = [24, 30, 36];
    for (const bRow of [6, 7, 8, 9, 10]) {
      const stamps = [
        { r: 5, c: 5, cells: mwss },
        ...barrierCols.map(bc => ({ r: bRow, c: bc, cells: blinker })),
      ];
      const { p1 } = score(p8Zones, p8Rows, p8Cols, stamps, 120);
      console.log(`  MWSS(5,5) + 3×Blinker at row ${bRow}: P1=${p1}`);
    }
    expect(true).toBe(true);
  });

  it("Find barrier positions — 3 blocks across neutral zone (rows ~24-28)", () => {
    console.log("\n=== P8: Lower block barrier effect on MWSS ===");
    const block = PATTERNS[2]!.cells;
    const barrierCols = [24, 30, 36];
    for (const bRow of [24, 25, 26, 27, 28]) {
      const stamps = [
        { r: 28, c: 5, cells: mwss },
        ...barrierCols.map(bc => ({ r: bRow, c: bc, cells: block })),
      ];
      const { p1 } = score(p8Zones, 36, 60, stamps, 120);
      console.log(`  MWSS(28,5) + 3×Block at row ${bRow}: P1=${p1}`);
    }
    expect(true).toBe(true);
  });

  it("LWSS destroys blinker barrier — check clearing works", () => {
    console.log("\n=== P8: LWSS clears blinker, then MWSS scores ===");
    const barrierCols = [24, 30, 36];
    // LWSS at row 5, col 5 — hits blinker barrier at row 7
    // then MWSS at row 5, col 8 — follows through cleared path
    for (const bRow of [7, 8]) {
      const stamps = [
        { r: 5, c: 5, cells: lwss },    // clears blinker barrier
        { r: 5, c: 10, cells: mwss },   // follows through
        ...barrierCols.map(bc => ({ r: bRow, c: bc, cells: blinker })),
      ];
      const { p1 } = score(p8Zones, 36, 60, stamps, 120);
      console.log(`  LWSS+MWSS(row 5) + 3×Blinker row ${bRow}: P1=${p1}`);
    }
    expect(true).toBe(true);
  });

  it("MWSS destroys block barrier — check clearing works", () => {
    console.log("\n=== P8: MWSS clears blocks, then LWSS scores ===");
    const block = PATTERNS[2]!.cells;
    const barrierCols = [24, 30, 36];
    for (const bRow of [26, 27]) {
      const stamps = [
        { r: 27, c: 5, cells: mwss },   // clears block barrier
        { r: 27, c: 10, cells: lwss },  // follows through
        ...barrierCols.map(bc => ({ r: bRow, c: bc, cells: block })),
      ];
      const { p1 } = score(p8Zones, 36, 60, stamps, 120);
      console.log(`  MWSS+LWSS(row 27) + 3×Block row ${bRow}: P1=${p1}`);
    }
    expect(true).toBe(true);
  });
});
