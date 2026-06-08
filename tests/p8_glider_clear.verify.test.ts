// P8 glider-clearing approach: can a Glider destroy a Block to let an MWSS through?
// Also tests "two-lane avoid-the-barrier" as fallback design.

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
const gliderDown = PATTERNS[8]!.cells;   // SE
const gliderUp = PATTERNS[9]!.cells;     // NE
const block = PATTERNS[2]!.cells;

describe("P8 glider-clearing approach", () => {
  it("GliderDown clears single block — does MWSS get through? (sweep positions)", () => {
    console.log("\n=== GliderDown clears Block at (13,28), MWSS at row 13 follows ===");
    // Block at (13, 28) is directly in MWSS row 13 path.
    // GliderDown (SE) needs to arrive at block from above-left.
    for (const [gr, gc] of [
      [6, 20], [7, 21], [8, 22], [9, 23], [10, 24], [5, 20], [5, 22], [6, 22],
    ] as [number,number][]) {
      const withClear = run([
        { r: gr, c: gc, cells: gliderDown },
        { r: 13, c: 5, cells: mwss },
        { r: 13, c: 28, cells: block },
      ], 140);
      const blocked = run([{ r: 13, c: 5, cells: mwss }, { r: 13, c: 28, cells: block }], 140);
      if (withClear > blocked) {
        console.log(`  ✅ GliderDown(${gr},${gc}) HELPS: ${blocked} → ${withClear}`);
      } else {
        console.log(`  ❌ GliderDown(${gr},${gc}): ${withClear} (blocked=${blocked})`);
      }
    }
    expect(true).toBe(true);
  });

  it("GliderUp clears single block — MWSS follows", () => {
    console.log("\n=== GliderUp clears Block at (13,28) from below ===");
    for (const [gr, gc] of [
      [18, 20], [19, 21], [20, 22], [21, 23], [22, 24], [20, 20], [18, 22],
    ] as [number,number][]) {
      const withClear = run([
        { r: gr, c: gc, cells: gliderUp },
        { r: 13, c: 5, cells: mwss },
        { r: 13, c: 28, cells: block },
      ], 140);
      const blocked = run([{ r: 13, c: 5, cells: mwss }, { r: 13, c: 28, cells: block }], 140);
      if (withClear > blocked) console.log(`  ✅ GliderUp(${gr},${gc}): ${blocked} → ${withClear}`);
      else console.log(`  ❌ GliderUp(${gr},${gc}): ${withClear}`);
    }
    expect(true).toBe(true);
  });

  it("FALLBACK DESIGN: two-lane avoid-barriers, properly spaced rows", () => {
    console.log("\n=== Fallback: upper blinker + lower block, 3 MWSS properly spaced ===");
    const blinker = PATTERNS[5]!.cells;
    const blinkers = [25, 31, 37].map(c => ({ r: 7, c, cells: blinker }));
    const blocks = [25, 31, 37].map(c => ({ r: 28, c, cells: block }));
    const barriers = [...blinkers, ...blocks];

    // Rows that avoid both barriers: rows 10-24 (between 7+4=11 and 28-1=27)
    // Need 5-row separation (MWSS height=5): rows 11, 17, 23 for example
    for (const [r1, r2, r3] of [
      [11, 17, 23], [10, 16, 22], [12, 18, 24], [11, 18, 24],
    ] as [number,number,number][]) {
      const s = run([
        { r: r1, c: 5, cells: mwss },
        { r: r2, c: 5, cells: mwss },
        { r: r3, c: 5, cells: mwss },
        ...barriers,
      ], 140);
      console.log(`  3×MWSS rows (${r1},${r2},${r3}): P1=${s}`);
    }
    // Single MWSS in safe zone — should score
    for (const r of [12, 15, 18]) {
      const s = run([{ r, c: 5, cells: mwss }, ...barriers], 140);
      console.log(`  solo MWSS(${r}): P1=${s}`);
    }
    // Single blocked MWSS — must score 0
    for (const r of [5, 28]) {
      const s = run([{ r, c: 5, cells: mwss }, ...barriers], 140);
      console.log(`  solo MWSS(${r}) blocked: P1=${s}`);
    }
    expect(true).toBe(true);
  });
});
