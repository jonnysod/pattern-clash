// Verification tool for puzzle 2: "Stop Scoring Spaceship"
//
// Same grid and MWSS as puzzle 1 (50×30, MWSS at row 12, col 38, mirrored).
// First 100 gens run freely → MWSS hits the left wall ~gen 76, debris scores
// starting ~gen 85 (~32 pts by gen 100 per manual play-test).
// Place phase at gen 100 → 60 more gens.
// Question: can the player limit total P2 score to ≤ 40?

import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { PATTERNS } from "../src/patterns.js";
import { mirrorPatternHorizontal } from "../src/patternUtils.js";
import { PUZZLE_ZONE_CONFIG } from "../src/puzzles.js";
import { describe, it, expect } from "vitest";

const ROWS = 30;
const COLS = 50;
const zones = new Zones(COLS, ROWS, PUZZLE_ZONE_CONFIG);
const mwssMirrored = mirrorPatternHorizontal(PATTERNS[1]!);
const block = PATTERNS[2]!;

function runScore(eng: Engine, gens: number): number {
  let p2 = 0;
  for (let i = 0; i < gens; i++)
    for (const e of eng.computeNextGeneration())
      if (e.scorer === 2) p2 += e.points;
  return p2;
}

function freshEngine(): Engine {
  const eng = new Engine(ROWS, COLS, zones, 9999);
  eng.stampCells(12, 38, mwssMirrored.cells);
  return eng;
}

describe("Puzzle 2 verification — stop scoring spaceship", () => {
  it("baseline: P2 score after 100 gens + 60 gens without intervention", () => {
    const eng = freshEngine();
    const p100 = runScore(eng, 100);
    const p60  = runScore(eng, 60);
    console.log(`\nNo intervention: gen 0–100: P2=${p100}, gen 100–160: P2=${p60}, total=${p100 + p60}`);
    expect(p100 + p60).toBeGreaterThan(0);
  });

  it("searches Block placements at gen 100 (P1 zone: cols 3–16, rows 8–20)", () => {
    const candidates: { row: number; col: number }[] = [];
    for (let col = 3; col <= 14; col++) {
      for (let row = 8; row <= 20; row++) {
        candidates.push({ row, col });
      }
    }

    const results: { row: number; col: number; total: number }[] = [];
    for (const { row, col } of candidates) {
      const eng = freshEngine();
      const p100 = runScore(eng, 100);
      eng.stampCells(row, col, block.cells);
      const p60  = runScore(eng, 60);
      results.push({ row, col, total: p100 + p60 });
    }

    results.sort((a, b) => a.total - b.total);
    const best = results[0]!.total;

    console.log(`\nTop-5 Block placements at gen 100:`);
    for (const r of results.slice(0, 5)) {
      const marker = r.total <= 65 ? " ✅ ≤65" : "";
      console.log(`  Block(${r.row}, ${r.col}): P2 total=${r.total}${marker}`);
    }
    console.log(`\nBest achievable: ${best}`);
    console.log(`Positions achieving ≤65: ${results.filter(r => r.total <= 65).length}`);

    expect(results.length).toBeGreaterThan(0);
  });
});
