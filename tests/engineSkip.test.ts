// Tests for Engine.skipToGeneration() — the consolidated stability-skip path
// that replaces the parity-loop-plus-manual-flush duplicated in ui.ts and
// puzzleRunner.ts. Two invariants must hold for every scenario below:
//
// 1. Behavioural equivalence (pre-existing contract, see stability.test.ts):
//    a skip run must produce a bitidentical end-grid and identical score
//    totals to a full run.
// 2. Display invariant (new): the sum of every ScoreEvent returned by
//    skipToGeneration() must equal the actual score credited — no event may
//    be dropped, and none may be double-counted.

import { describe, it, expect } from "vitest";
import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { CONFIG } from "../src/config.js";
import type { ScoreEvent } from "../src/types.js";

const ROWS = CONFIG.CANVAS_HEIGHT / CONFIG.CELL_SIZE; // 100
const COLS = CONFIG.CANVAS_WIDTH / CONFIG.CELL_SIZE; // 100

function sumPoints(events: ScoreEvent[]): number {
  return events.reduce((sum, e) => sum + e.points, 0);
}

// Board: an L-tromino at (49,2),(49,3),(50,2) births exactly one cell at
// (50,3) — inside the P2 score column (col 3) — on tick 1, then settles
// into a permanent 2×2 Block (no further hits, ever). A Blinker far away at
// (10,10)-(10,12) keeps the grid non-trivially oscillating so
// detectStablePeriod only fires as period-2, at generation 3, with the
// score bucket from tick 1 still pending (silenceCounter=2 < SILENCE_LIMIT=3).
//
// This reproduces the exact bug class: a bucket still short of its flush
// threshold at the moment stability is detected.
function buildPendingBucketBoard(simGenerations: number): Engine {
  const zones = new Zones(COLS, ROWS);
  const engine = new Engine(ROWS, COLS, zones, simGenerations);
  engine.stampCells(49, 2, [
    [0, 0],
    [0, 1],
    [1, 0],
  ]);
  engine.stampCells(10, 10, [
    [0, 0],
    [0, 1],
    [0, 2],
  ]);
  return engine;
}

// Detect period-2 by ticking until detectStablePeriod() fires, asserting it
// happens at generation 3 with a pending (not-yet-flushed) bucket.
function tickUntilStable(engine: Engine): {
  events: ScoreEvent[];
  period: 1 | 2;
} {
  const events: ScoreEvent[] = [];
  let period: 0 | 1 | 2 = 0;
  while (period === 0) {
    events.push(...engine.computeNextGeneration());
    period = engine.detectStablePeriod();
  }
  return { events, period };
}

function runFullReference(simGenerations: number): {
  events: ScoreEvent[];
  gridHash: number;
} {
  const engine = buildPendingBucketBoard(simGenerations);
  const events: ScoreEvent[] = [];
  for (let i = 0; i < simGenerations; i++) {
    events.push(...engine.computeNextGeneration());
  }
  return { events, gridHash: engine.gridHash() };
}

describe("Engine.skipToGeneration — equivalence with pending bucket", () => {
  it("even target (parity tick runs): matches full run, bucket flushes during the parity tick", () => {
    const T = 150;
    const full = runFullReference(T);

    const skip = buildPendingBucketBoard(T);
    const { events: preSkipEvents, period } = tickUntilStable(skip);
    expect(skip.currentGeneration).toBe(3);
    expect(period).toBe(2);

    // Regression guard for the bug: the bucket must still be pending here —
    // if this ever becomes 0, the board no longer exercises the bug and the
    // test below would pass vacuously.
    expect(sumPoints(preSkipEvents)).toBe(0);

    const skipEvents = skip.skipToGeneration(T, period);

    expect(skip.currentGeneration).toBe(T);
    expect(skip.gridHash()).toBe(full.gridHash);
    expect(sumPoints(skipEvents)).toBe(sumPoints(full.events));
    expect(sumPoints(preSkipEvents) + sumPoints(skipEvents)).toBe(
      sumPoints(full.events),
    );

    // Parity-tick-event-capture: the flush must have happened inside the
    // parity loop (extra = (150-3) % 2 = 1), not via a trailing force-flush
    // on an empty map — i.e. skipToGeneration must actually have collected
    // an event, not returned zero.
    expect(skipEvents.length).toBeGreaterThan(0);
  });

  it("odd target (no parity tick): still-pending bucket is caught by the trailing force-flush", () => {
    const T = 151;
    const full = runFullReference(T);

    const skip = buildPendingBucketBoard(T);
    const { period } = tickUntilStable(skip);
    expect(skip.currentGeneration).toBe(3);
    expect(period).toBe(2);

    const extra = (T - skip.currentGeneration) % period;
    expect(extra).toBe(0); // no parity ticks in this case

    const skipEvents = skip.skipToGeneration(T, period);

    expect(skip.currentGeneration).toBe(T);
    expect(skip.gridHash()).toBe(full.gridHash);
    expect(sumPoints(skipEvents)).toBe(sumPoints(full.events));
    expect(skipEvents.length).toBeGreaterThan(0);
  });
});

describe("Engine.skipToGeneration — no double credit at simGenerations boundary", () => {
  it("a parity tick landing exactly on simGenerations does not double-flush", () => {
    // simGenerations = 4 = the generation the single parity tick lands on.
    // computeNextGeneration()'s own end-of-sim force-flush is eligible on
    // that same tick — the pending bucket must be credited exactly once.
    const T = 4;
    const full = runFullReference(T);

    const skip = buildPendingBucketBoard(T);
    const { period } = tickUntilStable(skip);
    expect(skip.currentGeneration).toBe(3);
    expect(period).toBe(2);

    const extra = (T - skip.currentGeneration) % period;
    expect(extra).toBe(1); // exactly one parity tick, landing on gen 4 = simGenerations

    const skipEvents = skip.skipToGeneration(T, period);

    expect(skip.currentGeneration).toBe(T);
    expect(skip.gridHash()).toBe(full.gridHash);
    expect(sumPoints(skipEvents)).toBe(sumPoints(full.events));
    expect(sumPoints(skipEvents)).toBe(CONFIG.SCORE_POINTS); // exactly one credited hit, not two

    // A second, explicit flush call afterward must find nothing left.
    expect(skip.forceFlushBuckets()).toEqual([]);
  });
});

describe("Engine.skipToGeneration — puzzle segment (no natural sim end)", () => {
  // PuzzleRunner builds its Engine with simGenerations=9999 ("no natural sim
  // end — the harness drives generation counts") and drives segments via its
  // own simGenTarget, well short of 9999. Unlike the main-game path, the
  // internal end-of-sim force-flush never fires here — skipToGeneration's own
  // trailing forceFlushBuckets() is the only thing standing between a
  // pending bucket and a lost point. This is the scenario behind the
  // puzzle-criteria false-positive bug: p1Score/p2Score must match whatever a
  // full-tick segment would have produced.
  const PUZZLE_SIM_GENERATIONS = 9999;
  const SEGMENT_TARGET = 20;

  it("segment ending via stability skip credits the same score as a full-tick segment", () => {
    const fullEngine = buildPendingBucketBoard(PUZZLE_SIM_GENERATIONS);
    const fullEvents: ScoreEvent[] = [];
    for (let i = 0; i < SEGMENT_TARGET; i++) {
      fullEvents.push(...fullEngine.computeNextGeneration());
    }
    // Segment ends mid-simulation, not at simGenerations — mirrors a puzzle
    // timeline segment boundary. Nothing is pending-but-unflushed here only
    // because we ticked all the way through; a real puzzle segment ending
    // early via skip must reach the same total.
    const fullFlush = fullEngine.forceFlushBuckets();
    const fullTotal = sumPoints(fullEvents) + sumPoints(fullFlush);

    const skipEngine = buildPendingBucketBoard(PUZZLE_SIM_GENERATIONS);
    const { events: preSkipEvents, period } = tickUntilStable(skipEngine);
    expect(skipEngine.currentGeneration).toBe(3);

    const skipEvents = skipEngine.skipToGeneration(SEGMENT_TARGET, period);

    expect(skipEngine.currentGeneration).toBe(SEGMENT_TARGET);
    expect(skipEngine.gridHash()).toBe(fullEngine.gridHash());
    expect(sumPoints(preSkipEvents) + sumPoints(skipEvents)).toBe(fullTotal);
  });
});
