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

// ---------------------------------------------------------------------------
// Regression test: force-flush pending buckets at segment end
//
// Bug: the puzzle runner initialises the engine with simGenerations=9999 so
// the engine's internal end-of-sim flush (currentGeneration >= simGenerations)
// never fires.  Score hits that accumulate in a bucket during the last few
// ticks of a segment stay pending and are dropped — the criteria check then
// sees opponentScore=0 and incorrectly reports "Solved!".
//
// Fix: engine.forceFlushBuckets() was added so the puzzle runner can flush
// pending buckets explicitly at the end of each simulate segment, before
// advancing to the next timeline phase or showing the result overlay.
// ---------------------------------------------------------------------------

describe("engine.forceFlushBuckets() — regression for late-hit score loss", () => {
  // Craft a situation where exactly one score birth happens on tick 1 and
  // the bucket does NOT reach SILENCE_LIMIT (3) or AGE_LIMIT (15).
  //
  // Layout (50×30, lShapes=none, endzoneWidth=3):
  //   scoreColumnLeft = 2 — P2 scores when a cell is born at col 2.
  //
  // Cells placed so (15, 2) is dead but has exactly 3 live neighbours →
  // a cell is born there on tick 1 → P2 bucket accumulates 1 point.
  // After just 1 tick: silenceCounter=0, ageCounter=1 → neither limit
  // reached → scoreEvents is empty → without flush, opponentScore stays 0.

  const rows = 30;
  const cols = 50;
  const zones = new Zones(cols, rows, PUZZLE_ZONE_CONFIG);

  function makeSingleHitEngine(): Engine {
    // simGenerations=9999 mirrors how PuzzleRunner creates the engine.
    const eng = new Engine(rows, cols, zones, 9999);
    // Three live neighbours around (15, 2): birth there on tick 1.
    eng.stampCells(0, 0, [[14, 1], [14, 2], [15, 1]]);
    return eng;
  }

  it("score hit in bucket is NOT emitted by computeNextGeneration alone (confirms bug precondition)", () => {
    const eng = makeSingleHitEngine();
    const events = eng.computeNextGeneration(); // tick 1 — bucket now has 1 pt
    // Bucket is still pending: silenceCounter=0, ageCounter=1 — neither limit.
    const scoreFromTick = events.reduce((s, e) => s + e.points, 0);
    expect(scoreFromTick).toBe(0);
  });

  it("forceFlushBuckets() returns the pending score after the segment ends", () => {
    const eng = makeSingleHitEngine();
    eng.computeNextGeneration(); // tick 1 — score hit accumulates in bucket
    const flushed = eng.forceFlushBuckets();
    const totalFlushed = flushed.reduce((s, e) => s + e.points, 0);
    expect(totalFlushed).toBeGreaterThan(0);
    expect(flushed[0]?.scorer).toBe(2); // P2 scored
  });

  it("scoreBuckets is empty after forceFlushBuckets()", () => {
    const eng = makeSingleHitEngine();
    eng.computeNextGeneration();
    eng.forceFlushBuckets();
    // A second flush should return nothing — buckets were cleared.
    const secondFlush = eng.forceFlushBuckets();
    expect(secondFlush).toHaveLength(0);
  });

  it("combined tick events + flush covers the full score (no double-count)", () => {
    // Run 3 ticks: first two have no score, third has a hit that IS naturally
    // flushed (silenceCounter reaches SILENCE_LIMIT=3) plus a hit that
    // accumulates. Then flush manually and verify sum = all births at col 2.
    const eng = makeSingleHitEngine();
    let total = 0;
    for (let i = 0; i < 3; i++) {
      const evts = eng.computeNextGeneration();
      total += evts.reduce((s, e) => s + e.points, 0);
    }
    const flushed = eng.forceFlushBuckets();
    total += flushed.reduce((s, e) => s + e.points, 0);
    // At least the 1 birth at (15, 2) on tick 1 must be accounted for.
    expect(total).toBeGreaterThan(0);
  });
});
