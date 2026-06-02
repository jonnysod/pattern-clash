// Puzzle verification: find a working "Stop the MWSS" configuration.
//
// Run with: npx vitest run tests/puzzle.verify.ts
//
// This file is deliberately kept out of the main test suite (no describe
// blocks that fail CI). It serves as a design tool: run it, read the output,
// then encode the verified parameters in puzzles.ts.

import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { PATTERNS } from "../src/patterns.js";
import { mirrorPatternHorizontal } from "../src/patternUtils.js";
import { describe, it, expect } from "vitest";

// Puzzle grid dimensions
const ROWS = 30;
const COLS = 50;
const ENDZONE_WIDTH = 3;

// Zone with no L-shapes (clean straight score columns)
const zones = new Zones(COLS, ROWS, { endzoneWidth: ENDZONE_WIDTH, lShapes: "none" });

// MWSS (index 1) mirrored — flies left toward P1's endzone
const mwss = PATTERNS[1]!;
const mwssMirrored = mirrorPatternHorizontal(mwss);

// Helper: fresh engine with mirrored MWSS stamped at a given position
function makeEngine(startRow: number, startCol: number): Engine {
  const eng = new Engine(ROWS, COLS, zones, 200);
  eng.stampCells(startRow, startCol, mwssMirrored.cells);
  return eng;
}

// Helper: run engine for N generations, return P2's score (opponent)
function runAndScore(eng: Engine, gens: number): number {
  let p2Score = 0;
  for (let i = 0; i < gens; i++) {
    const events = eng.computeNextGeneration();
    for (const e of events) {
      if (e.scorer === 2) p2Score += e.points;
    }
  }
  return p2Score;
}

describe("Puzzle verification — MWSS setup", () => {
  it("reports zone layout", () => {
    console.log("Zone layout (50×30, endzoneWidth=3, lShapes=none):");
    console.log(`  scoreColumnLeft  = ${zones.scoreColumnLeft}  (P2 scores here)`);
    console.log(`  scoreColumnRight = ${zones.scoreColumnRight} (P1 scores here)`);
    console.log(`  P1 zone: cols ${zones.endzoneLeftEnd}–${zones.leftEnd - 1}`);
    console.log(`  neutral: cols ${zones.leftEnd}–${zones.rightStart - 1}`);
    console.log(`  P2 zone: cols ${zones.rightStart}–${zones.endzoneRightStart - 1}`);
    expect(true).toBe(true);
  });

  it("MWSS mirrored cells", () => {
    console.log("Mirrored MWSS cells:", JSON.stringify(mwssMirrored.cells));
    console.log(`  width: cols 0–${Math.max(...mwssMirrored.cells.map(([, c]) => c))}`);
    console.log(`  height: rows 0–${Math.max(...mwssMirrored.cells.map(([r]) => r))}`);
    expect(true).toBe(true);
  });

  it("baseline: MWSS scores without intervention", () => {
    // MWSS starts in P2 zone, flies left, should reach left score column
    const startRow = 12;
    const startCol = 38; // P2 zone (33–46)
    const eng = makeEngine(startRow, startCol);
    const score = runAndScore(eng, 120);
    console.log(`\nBaseline (no intervention): P2 scored ${score} in 120 gens`);
    console.log(`  (MWSS stamped at row ${startRow}, col ${startCol})`);
    expect(score).toBeGreaterThan(0); // must fail without intervention
  });

  it("finds generation at which MWSS first scores", () => {
    const startRow = 12;
    const startCol = 38;
    const eng = makeEngine(startRow, startCol);
    let p2Score = 0;
    let firstScoreGen = -1;
    for (let i = 0; i < 150; i++) {
      const events = eng.computeNextGeneration();
      for (const e of events) {
        if (e.scorer === 2) {
          p2Score += e.points;
          if (firstScoreGen === -1) firstScoreGen = i + 1;
        }
      }
    }
    console.log(`\nFirst P2 score at generation ${firstScoreGen}, total: ${p2Score}`);
    expect(firstScoreGen).toBeGreaterThan(0);
  });

  it("tests Block placements to find a working solution", () => {
    const startRow = 12;
    const startCol = 38;
    const block = PATTERNS[2]!; // Block: [[0,0],[0,1],[1,0],[1,1]]

    // Try various Block positions in the P1 zone / neutral zone
    const candidates = [
      { row: 11, col: 8 },
      { row: 12, col: 8 },
      { row: 11, col: 10 },
      { row: 12, col: 10 },
      { row: 11, col: 12 },
      { row: 12, col: 12 },
      { row: 11, col: 14 },
      { row: 12, col: 14 },
      { row: 11, col: 16 },
      { row: 12, col: 16 },
      { row: 11, col: 18 },
      { row: 12, col: 18 },
      { row: 11, col: 20 },
      { row: 12, col: 20 },
      { row: 11, col: 22 },
      { row: 12, col: 22 },
      { row: 11, col: 24 },
      { row: 12, col: 24 },
    ];

    const results: { row: number; col: number; p2Score: number }[] = [];
    for (const { row, col } of candidates) {
      const eng = makeEngine(startRow, startCol);
      eng.stampCells(row, col, block.cells);
      const p2Score = runAndScore(eng, 120);
      results.push({ row, col, p2Score });
    }

    console.log("\nBlock placement candidates (Block at row/col, P2 score after 120 gens):");
    for (const r of results) {
      const status = r.p2Score === 0 ? "✅ STOPS MWSS" : `❌ P2 scores ${r.p2Score}`;
      console.log(`  Block at (${r.row}, ${r.col}): ${status}`);
    }

    const working = results.filter((r) => r.p2Score === 0);
    console.log(`\nWorking Block positions: ${working.length}`);
    if (working.length > 0) {
      console.log("First working position:", working[0]);
    }

    // We just report — the test itself doesn't assert a specific position
    // because we're discovering it here.
    expect(results.length).toBeGreaterThan(0);
  });
});
