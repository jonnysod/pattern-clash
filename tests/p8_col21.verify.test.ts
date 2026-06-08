// P8 corrected: barriers at col 21 so GliderDown from P1 zone (cols 3–20) can clear them.

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
const gliderDown = PATTERNS[8]!.cells;
const block = PATTERNS[2]!.cells;
const blinker = PATTERNS[5]!.cells;

// Design: upper block at (6, 21), lower block at (27, 21)
// GliderDown diagonal formula: starts (r,c) → hits (r+N, c+N)
// For block at (6,21): N=6-r, c=21-N=15+r → c in P1 zone if r≤5
// For block at (27,21): N=27-r, c=21-N=r-6 → c in P1 zone if r≥9

const UB = { r: 6, c: 21, cells: block };
const LB = { r: 27, c: 21, cells: block };
const barriers = [UB, LB];

describe("P8 col-21 design", () => {
  it("middle free zone", () => {
    console.log("\n=== Free middle (with barriers) ===");
    for (const r of [8, 9, 10, 13, 16, 18, 20, 22]) {
      const s = run([{ r, c: 5, cells: mwss }, ...barriers], 140);
      console.log(`  MWSS(${r},5): P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("GliderDown in P1 zone clearing upper block (6,21)", () => {
    console.log("\n=== GliderDown clears upper block (6,21) ===");
    // formula: r≤5, c=15+r
    for (const r of [0,1,2,3,4,5]) {
      const gc = 15 + r;
      const mwssRow = 3; // MWSS that tries upper lane
      const cleared = run([{ r, c: gc, cells: gliderDown }, { r: mwssRow, c: 5, cells: mwss }, ...barriers], 140);
      const blocked = run([{ r: mwssRow, c: 5, cells: mwss }, ...barriers], 140);
      console.log(`  GliderDown(${r},${gc}): ${blocked}→${cleared} ${cleared > blocked ? "✅" : "❌"}`);
    }
    expect(true).toBe(true);
  });

  it("GliderDown in P1 zone clearing lower block (27,21)", () => {
    console.log("\n=== GliderDown clears lower block (27,21) ===");
    // formula: r≥9, c=r-6
    for (const r of [9,10,11,12,14,16,18,20]) {
      const gc = r - 6;
      if (gc < 3 || gc > 20) continue;
      const mwssRow = 28; // MWSS that tries lower lane
      const cleared = run([{ r, c: gc, cells: gliderDown }, { r: mwssRow, c: 5, cells: mwss }, ...barriers], 140);
      const blocked = run([{ r: mwssRow, c: 5, cells: mwss }, ...barriers], 140);
      console.log(`  GliderDown(${r},${gc}): ${blocked}→${cleared} ${cleared > blocked ? "✅" : "❌"}`);
    }
    expect(true).toBe(true);
  });

  it("3-card strategies: clear upper + score upper + score middle", () => {
    console.log("\n=== 3-card strategies ===");
    for (const [gr, gc] of [[0,15],[1,16],[2,17],[3,18],[4,19],[5,20]] as [number,number][]) {
      for (const midRow of [10, 13]) {
        const s = run([
          { r: gr, c: gc, cells: gliderDown }, // clear upper
          { r: 3, c: 5, cells: mwss },          // upper scorer
          { r: midRow, c: 5, cells: mwss },     // middle scorer
          ...barriers,
        ], 140);
        if (s > 0) console.log(`  GliderDown(${gr},${gc})+MWSS(3)+MWSS(${midRow}): P1=${s}`);
      }
    }
    // Also: 1-card baseline (best without clearing)
    for (const r of [10, 13]) {
      const s = run([{ r, c: 5, cells: mwss }, ...barriers], 140);
      console.log(`  Solo MWSS(${r}) no clear: P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("blinker in initial barriers: replace lower block with blinker — still blocks?", () => {
    console.log("\n=== Blinker barrier instead of block ===");
    const blinkerBarrier = { r: 27, c: 21, cells: blinker };
    for (const r of [24, 25, 26, 27, 28, 29]) {
      const s = run([{ r, c: 5, cells: mwss }, UB, blinkerBarrier], 140);
      console.log(`  MWSS(${r},5) vs blinker(27,21): P1=${s}`);
    }
    expect(true).toBe(true);
  });
});
