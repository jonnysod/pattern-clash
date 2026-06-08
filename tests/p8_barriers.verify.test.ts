// P8 barrier mechanics deep-dive.

import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { PATTERNS } from "../src/patterns.js";
import { describe, it, expect } from "vitest";

const ROWS = 36, COLS = 60;
const zones = new Zones(COLS, ROWS, { endzoneWidth: 3, lShapes: "none" });

function run(
  stamps: { r: number; c: number; cells: [number,number][] }[],
  gens: number,
): { p1: number } {
  const eng = new Engine(ROWS, COLS, zones, 9999);
  for (const s of stamps) eng.stampCells(s.r, s.c, s.cells);
  let p1 = 0;
  for (let i = 0; i < gens; i++)
    for (const e of eng.computeNextGeneration()) if (e.scorer === 1) p1 += e.points;
  for (const e of eng.forceFlushBuckets()) if (e.scorer === 1) p1 += e.points;
  return { p1 };
}

const mwss = PATTERNS[1]!.cells;
const lwss = PATTERNS[0]!.cells;
const blinker = PATTERNS[5]!.cells;
const block = PATTERNS[2]!.cells;

describe("P8 barrier clearing mechanics", () => {
  it("single blinker barrier — does spaceship clear it for a follower?", () => {
    console.log("\n=== First spaceship clears blinker, second follows ===");
    // Blinker barrier at col 25, row 7. First MWSS at (5, 3) hits it.
    // Second MWSS at (5, 3) but delayed — simulate first one alone, then add second.
    // We test different col offsets: leader at c=3, follower at c=3 (same col delayed in time).
    // Trick: place follower at larger col to give leader time.
    for (const followerCol of [3, 5, 8, 11, 14]) {
      const { p1 } = run([
        { r: 5, c: 3, cells: mwss },           // leader
        { r: 5, c: followerCol + 15, cells: mwss }, // follower (further right = arrives later)
        { r: 7, c: 25, cells: blinker },
        { r: 7, c: 31, cells: blinker },
        { r: 7, c: 37, cells: blinker },
      ], 140);
      console.log(`  Leader(5,3) + Follower(5,${followerCol+15}) + blinkers row7: P1=${p1}`);
    }
    expect(true).toBe(true);
  });

  it("single block barrier — does MWSS clear it for LWSS follower?", () => {
    console.log("\n=== MWSS clears block barrier, LWSS follows ===");
    for (const followerCol of [3, 8, 12, 15]) {
      const { p1 } = run([
        { r: 28, c: 3, cells: mwss },
        { r: 28, c: followerCol + 15, cells: lwss },
        { r: 28, c: 25, cells: block },
        { r: 28, c: 31, cells: block },
        { r: 28, c: 37, cells: block },
      ], 140);
      console.log(`  Leader MWSS(28,3) + LWSS(28,${followerCol+15}) + blocks row28: P1=${p1}`);
    }
    expect(true).toBe(true);
  });

  it("two-lane approach: clear upper lane with card1, score through it with card2", () => {
    console.log("\n=== Two-lane: upper blinkers + lower blocks, two-card attack ===");
    // Upper: blinker row 7. Lower: block row 28.
    // Strategy A: MWSS(5,3) clears blinkers, MWSS(5,18) scores upper
    // Strategy B: MWSS(28,3) clears blocks, LWSS(28,18) scores lower
    const barrierStamps = [
      { r: 7, c: 25, cells: blinker }, { r: 7, c: 31, cells: blinker }, { r: 7, c: 37, cells: blinker },
      { r: 28, c: 25, cells: block }, { r: 28, c: 31, cells: block }, { r: 28, c: 37, cells: block },
    ];
    // A: two MWSS upper
    for (const fc of [14, 16, 18]) {
      const { p1 } = run([{ r: 5, c: 3, cells: mwss }, { r: 5, c: fc, cells: mwss }, ...barrierStamps], 140);
      console.log(`  2×MWSS(5, 3+${fc}): P1=${p1}`);
    }
    // B: MWSS(28,3) + LWSS(28,fc)
    for (const fc of [14, 16, 18]) {
      const { p1 } = run([{ r: 28, c: 3, cells: mwss }, { r: 28, c: fc, cells: lwss }, ...barrierStamps], 140);
      console.log(`  MWSS(28,3)+LWSS(28,${fc}): P1=${p1}`);
    }
    expect(true).toBe(true);
  });

  it("three-card attack: clear both lanes then score a third", () => {
    console.log("\n=== Three-card: clear upper + clear lower + score ===");
    const barrierStamps = [
      { r: 7, c: 25, cells: blinker }, { r: 7, c: 31, cells: blinker }, { r: 7, c: 37, cells: blinker },
      { r: 28, c: 25, cells: block }, { r: 28, c: 31, cells: block }, { r: 28, c: 37, cells: block },
    ];
    // clearer1: MWSS(5,3), clearer2: MWSS(28,3), scorer: MWSS(5,18)
    for (const [sc, sr] of [[18, 5], [18, 10], [16, 5]]) {
      const { p1 } = run([
        { r: 5, c: 3, cells: mwss },
        { r: 28, c: 3, cells: mwss },
        { r: sr, c: sc, cells: mwss },
        ...barrierStamps,
      ], 140);
      console.log(`  Clear(5,3)+Clear(28,3)+Score(${sr},${sc}): P1=${p1}`);
    }
    // Also: clear upper + score upper + clear lower
    for (const sc of [16, 18]) {
      const { p1 } = run([
        { r: 5, c: 3, cells: mwss },    // clear upper
        { r: 5, c: sc, cells: mwss },   // score upper (follows after clear)
        { r: 28, c: 3, cells: mwss },   // clear lower (no scorer)
        ...barrierStamps,
      ], 140);
      console.log(`  ClearU(5,3)+ScoreU(5,${sc})+ClearL(28,3): P1=${p1}`);
    }
    expect(true).toBe(true);
  });

  it("no-barrier sanity: 3 MWSS scores freely", () => {
    const { p1 } = run([
      { r: 5, c: 3, cells: mwss },
      { r: 18, c: 3, cells: mwss },
      { r: 28, c: 3, cells: mwss },
    ], 140);
    console.log(`\n3×MWSS no barriers: P1=${p1}`);
    expect(true).toBe(true);
  });

  it("verify no middle gap: blinker+block combo blocks all rows", () => {
    console.log("\n=== Middle-gap check: rows 10–24 ===");
    for (const r of [12, 15, 17, 18]) {
      const { p1 } = run([
        { r, c: 5, cells: mwss },
        { r: 7, c: 25, cells: blinker }, { r: 7, c: 31, cells: blinker }, { r: 7, c: 37, cells: blinker },
        { r: 28, c: 25, cells: block }, { r: 28, c: 31, cells: block }, { r: 28, c: 37, cells: block },
      ], 140);
      console.log(`  MWSS(${r},5) + upper+lower barriers: P1=${p1}`);
    }
    expect(true).toBe(true);
  });
});
