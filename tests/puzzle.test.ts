// Puzzle unit tests.
//
// All tests are headless (no DOM) — they exercise the Engine and puzzle
// data directly without involving PuzzleRunner.

import { describe, it, expect } from "vitest";
import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { PATTERNS } from "../src/patterns.js";
import { mirrorPatternHorizontal } from "../src/patternUtils.js";
import { PUZZLES, PUZZLE_ZONE_CONFIG } from "../src/puzzles.js";

// ---------------------------------------------------------------------------
// Puzzle data validation
// ---------------------------------------------------------------------------

describe("PUZZLES data", () => {
  it("contains at least one puzzle", () => {
    expect(PUZZLES.length).toBeGreaterThan(0);
  });

  it("every puzzle has required fields", () => {
    for (const puzzle of PUZZLES) {
      expect(puzzle.id).toBeTruthy();
      expect(puzzle.title).toBeTruthy();
      expect(puzzle.objective).toBeTruthy();
      expect(puzzle.gridRows).toBeGreaterThan(0);
      expect(puzzle.gridCols).toBeGreaterThan(0);
      expect(puzzle.playerSide).toBeOneOf([1, 2]);
      expect(puzzle.timeline.length).toBeGreaterThan(0);
      expect(puzzle.criteria).toBeDefined();
    }
  });

  it("every puzzle timeline has at least one simulate entry", () => {
    for (const puzzle of PUZZLES) {
      const hasSimulate = puzzle.timeline.some((e) => e.kind === "simulate");
      expect(hasSimulate).toBe(true);
    }
  });

  it("stop-the-mwss puzzle has the expected structure", () => {
    const puzzle = PUZZLES.find((p) => p.id === "stop-the-mwss");
    expect(puzzle).toBeDefined();
    expect(puzzle!.gridRows).toBe(30);
    expect(puzzle!.gridCols).toBe(50);
    expect(puzzle!.playerSide).toBe(1);
    expect(puzzle!.initialPlacements).toHaveLength(1);
    expect(puzzle!.criteria.maxOpponentScore).toBe(0);
    // placementRegion must cover the P1 zone
    expect(puzzle!.placementRegion).toBeDefined();
    expect(puzzle!.placementRegion!.x).toBeGreaterThanOrEqual(0);
    expect(puzzle!.placementRegion!.w).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Engine-level scenario tests for "stop-the-mwss"
// ---------------------------------------------------------------------------

const ROWS = 30;
const COLS = 50;
const zones = new Zones(COLS, ROWS, PUZZLE_ZONE_CONFIG);
const mwss = PATTERNS[1]!;
const mwssMirrored = mirrorPatternHorizontal(mwss);
const block = PATTERNS[2]!; // Block: 2×2 still life

// Run an engine for N generations and return { p1, p2 } scores.
function runEngine(eng: Engine, gens: number): { p1: number; p2: number } {
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < gens; i++) {
    for (const e of eng.computeNextGeneration()) {
      if (e.scorer === 1) p1 += e.points;
      else p2 += e.points;
    }
  }
  return { p1, p2 };
}

// Build an engine with the puzzle's initial MWSS placement.
function makePuzzleEngine(): Engine {
  const eng = new Engine(ROWS, COLS, zones, 9999);
  eng.stampCells(12, 38, mwssMirrored.cells);
  return eng;
}

describe("stop-the-mwss — engine scenarios", () => {
  it("MWSS scores for P2 without any intervention (100 gens)", () => {
    const eng = makePuzzleEngine();
    const { p2 } = runEngine(eng, 100);
    expect(p2).toBeGreaterThan(0);
  });

  it("Block at (12, 10) in P1 zone prevents P2 from scoring (100 gens)", () => {
    const eng = makePuzzleEngine();
    eng.stampCells(12, 10, block.cells);
    const { p2 } = runEngine(eng, 100);
    expect(p2).toBe(0);
  });

  it("Block inside the puzzle placementRegion stops MWSS", () => {
    const puzzle = PUZZLES.find((p) => p.id === "stop-the-mwss")!;
    const region = puzzle.placementRegion!;

    // Place a Block at the mid-row of the placement region, near the MWSS path.
    const col = region.x + Math.floor(region.w / 2); // centre of the allowed zone
    const eng = makePuzzleEngine();
    eng.stampCells(12, col, block.cells);
    const { p2 } = runEngine(eng, 100);
    expect(p2).toBe(0);
  });

  it("puzzle timeline: 20 sim + place + 80 sim totals 100 simulation gens", () => {
    const puzzle = PUZZLES.find((p) => p.id === "stop-the-mwss")!;
    let totalSim = 0;
    for (const entry of puzzle.timeline) {
      if (entry.kind === "simulate") totalSim += entry.generations;
    }
    expect(totalSim).toBe(100);
  });
});
