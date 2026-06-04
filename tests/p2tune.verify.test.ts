// P2 tuning verification: MWSS start col 18, initial sim 60 gens.
// Run: npx vitest run tests/p2tune.verify.test.ts

import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { PATTERNS } from "../src/patterns.js";
import { mirrorPatternHorizontal } from "../src/patternUtils.js";
import { describe, it, expect } from "vitest";

const ROWS = 30, COLS = 50, EZ = 3;
const zones = new Zones(COLS, ROWS, { endzoneWidth: EZ, lShapes: "none" });
const mwssMirrored = mirrorPatternHorizontal(PATTERNS[1]!);
const block = PATTERNS[2]!;

function run(
  startCol: number,
  simBefore: number,
  simAfter: number,
  blockRow?: number,
  blockCol?: number,
): { p2: number; firstScoreGen: number } {
  const eng = new Engine(ROWS, COLS, zones, 9999);
  eng.stampCells(12, startCol, mwssMirrored.cells);
  let p2 = 0, firstScoreGen = -1;
  for (let g = 0; g < simBefore; g++) {
    for (const e of eng.computeNextGeneration())
      if (e.scorer === 2) { p2 += e.points; if (firstScoreGen < 0) firstScoreGen = g + 1; }
  }
  if (blockRow !== undefined) eng.stampCells(blockRow, blockCol!, block.cells);
  for (let g = 0; g < simAfter; g++) {
    for (const e of eng.computeNextGeneration())
      if (e.scorer === 2) { p2 += e.points; if (firstScoreGen < 0) firstScoreGen = simBefore + g + 1; }
  }
  for (const e of eng.forceFlushBuckets()) if (e.scorer === 2) p2 += e.points;
  return { p2, firstScoreGen };
}

describe("P2 tuning — MWSS col 18, 60 initial gens", () => {
  it("1. Nichtstun scheitert (P2 > 100 over 120 gens)", () => {
    const { p2, firstScoreGen } = run(18, 60, 60);
    console.log(`\nBaseline (col 18, 60+60): P2=${p2}, first score gen=${firstScoreGen}`);
    const orig = run(38, 100, 60);
    console.log(`Original  (col 38, 100+60): P2=${orig.p2}, first score gen=${orig.firstScoreGen}`);
    expect(p2).toBeGreaterThan(100);
  });

  it("2. Exhaustive search — best block still passes threshold 100", () => {
    const results: { row: number; col: number; p2: number }[] = [];
    for (let br = 0; br < ROWS; br++)
      for (let bc = 3; bc <= 16; bc++)
        results.push({ row: br, col: bc, p2: run(18, 60, 60, br, bc).p2 });

    results.sort((a, b) => a.p2 - b.p2);
    const best = results[0]!;
    const passing = results.filter(r => r.p2 <= 100);
    console.log(`\nBest block: (${best.row}, ${best.col}) → P2=${best.p2}`);
    console.log(`Passing positions (≤100): ${passing.length}`);
    console.log("Sample passing:", passing.slice(0, 8).map(r => `(${r.row},${r.col})=${r.p2}`).join("  "));

    expect(best.p2).toBeLessThanOrEqual(100);
    expect(passing.length).toBeGreaterThan(0);
  });
});
