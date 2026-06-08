// P8 final design: two single-block barriers + free middle, glider-clearing mechanic.

import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { PATTERNS } from "../src/patterns.js";
import { describe, it, expect } from "vitest";

const ROWS = 36, COLS = 60;
const zones = new Zones(COLS, ROWS, { endzoneWidth: 3, lShapes: "none" });

function run(stamps: { r: number; c: number; cells: [number,number][] }[], gens: number): number {
  const eng = new Engine(ROWS, COLS, zones, 9999);
  for (const s of stamps) eng.stampCells(s.r, s.c, s.cells);
  let p1 = 0;
  for (let i = 0; i < gens; i++)
    for (const e of eng.computeNextGeneration()) if (e.scorer === 1) p1 += e.points;
  for (const e of eng.forceFlushBuckets()) if (e.scorer === 1) p1 += e.points;
  return p1;
}

const mwss = PATTERNS[1]!.cells;
const lwss = PATTERNS[0]!.cells;
const gliderDown = PATTERNS[8]!.cells;
const gliderUp   = PATTERNS[9]!.cells;
const block      = PATTERNS[2]!.cells;
const blinker    = PATTERNS[5]!.cells;

// Design:
//   Upper block at (6, 28) — blocks MWSS lane rows ~4–8
//   Lower block at (25, 28) — blocks MWSS lane rows ~23–27
//   Free middle: rows ~10–21 (MWSS rows 10–17 safely clear)
const UPPER_BLOCK = { r: 6, c: 28, cells: block };
const LOWER_BLOCK = { r: 25, c: 28, cells: block };
const barriers = [UPPER_BLOCK, LOWER_BLOCK];

describe("P8 final design", () => {
  it("zone layout (60×36 no-L)", () => {
    const z = zones;
    console.log(`\nP8 zones (60×36, no-L):`);
    console.log(`  P1 zone: cols ${z.endzoneLeftEnd}–${z.leftEnd-1}`);
    console.log(`  scoreRight=${z.scoreColumnRight}`);
    expect(true).toBe(true);
  });

  it("free middle lane scores without clearing", () => {
    console.log("\n=== Middle lane (rows 10-20, no clearing) ===");
    for (const r of [10, 13, 16, 18, 20]) {
      const s = run([{ r, c: 5, cells: mwss }, ...barriers], 140);
      console.log(`  MWSS(${r},5): P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("blocked lanes score 0 without clearing", () => {
    console.log("\n=== Blocked lanes (without clearing) ===");
    for (const r of [3, 4, 5, 23, 24, 25, 26]) {
      const s = run([{ r, c: 5, cells: mwss }, ...barriers], 140);
      console.log(`  MWSS(${r},5): P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("GliderDown positions that clear upper block (6,28)", () => {
    console.log("\n=== GliderDown clearing upper block (6,28) — P1 zone cols 3–20 ===");
    const mwssRow = 3; // MWSS that would use the cleared upper lane
    for (const [gr, gc] of [
      [0,21],[0,22],[0,23],[1,22],[1,23],[2,23],[2,24],[3,24],[3,25],
    ] as [number,number][]) {
      const cleared = run([
        { r: gr, c: gc, cells: gliderDown },
        { r: mwssRow, c: 5, cells: mwss },
        ...barriers,
      ], 140);
      const blocked = run([{ r: mwssRow, c: 5, cells: mwss }, ...barriers], 140);
      const inP1 = gc >= 3 && gc <= 20;
      const label = cleared > blocked ? "✅ CLEARS" : "❌";
      console.log(`  GliderDown(${gr},${gc}) [P1=${inP1}]: ${label} (${blocked}→${cleared})`);
    }
    expect(true).toBe(true);
  });

  it("GliderUp positions that clear lower block (25,28)", () => {
    console.log("\n=== GliderUp clearing lower block (25,28) ===");
    const mwssRow = 28;
    for (const [gr, gc] of [
      [30,21],[30,22],[31,22],[31,23],[32,23],[32,24],[33,24],[33,25],[34,25],
    ] as [number,number][]) {
      const cleared = run([
        { r: gr, c: gc, cells: gliderUp },
        { r: mwssRow, c: 5, cells: mwss },
        ...barriers,
      ], 140);
      const blocked = run([{ r: mwssRow, c: 5, cells: mwss }, ...barriers], 140);
      const label = cleared > blocked ? "✅ CLEARS" : "❌";
      console.log(`  GliderUp(${gr},${gc}): ${label} (${blocked}→${cleared})`);
    }
    expect(true).toBe(true);
  });

  it("3-card solutions: clearer+scorer+scorer (≥2 lanes)", () => {
    console.log("\n=== 3-card strategies ===");
    // Known good GliderDown for upper block — need one that's in P1 zone
    // Try different combos
    const middleRows = [10, 13, 16];
    for (const [gr, gc] of [[0,22],[1,23],[2,24]] as [number,number][]) {
      for (const mr of middleRows) {
        const s = run([
          { r: gr, c: gc, cells: gliderDown }, // clear upper
          { r: 3, c: 5, cells: mwss },          // score upper (cleared lane)
          { r: mr, c: 5, cells: mwss },          // score middle
          ...barriers,
        ], 140);
        console.log(`  GliderDown(${gr},${gc})+MWSS(3,5)+MWSS(${mr},5): P1=${s}`);
      }
    }
    // 2×MWSS middle (no clearing)
    for (const [r1, r2] of [[10,17],[10,18],[11,18]] as [number,number][]) {
      const s = run([
        { r: r1, c: 5, cells: mwss }, { r: r2, c: 5, cells: mwss },
        ...barriers,
      ], 140);
      console.log(`  2×MWSS(${r1},${r2}) no clearing: P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("Blinker decoy does not score", () => {
    const s = run([{ r: 13, c: 10, cells: blinker }, ...barriers], 140);
    console.log(`\nBlinker decoy: P1=${s}`);
    expect(s).toBe(0);
    expect(true).toBe(true);
  });
});
