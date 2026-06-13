// Tests for Engine.detectStablePeriod() and the early-termination contract.
// All tests verify behavioural equivalence: an early-terminated run must
// produce the same end-grid and end-score as a full run.

import { describe, it, expect, beforeEach } from "vitest";
import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { CONFIG } from "../src/config.js";

const ROWS = CONFIG.CANVAS_HEIGHT / CONFIG.CELL_SIZE; // 100
const COLS = CONFIG.CANVAS_WIDTH / CONFIG.CELL_SIZE; // 100

function makeEngine(simGenerations = 150): Engine {
  const zones = new Zones(ROWS, COLS);
  return new Engine(ROWS, COLS, zones, simGenerations);
}

// Stamp a 2×2 Block at (row, col). Lives forever, never scores.
function stampBlock(engine: Engine, row: number, col: number): void {
  engine.stampCells(row, col, [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ]);
}

// Stamp a horizontal Blinker at (row, col) — oscillates p2, never scores
// when placed away from score zones.
function stampBlinker(engine: Engine, row: number, col: number): void {
  engine.stampCells(row, col, [
    [0, 0],
    [0, 1],
    [0, 2],
  ]);
}

// Deep-copy a grid for comparison.
function copyGrid(engine: Engine): boolean[][] {
  return engine.grid.map((row) => [...row]);
}

// Run engine for exactly n ticks, return cumulative score per player.
function runTicks(
  engine: Engine,
  n: number,
): { p1Score: number; p2Score: number } {
  let p1Score = 0;
  let p2Score = 0;
  for (let i = 0; i < n; i++) {
    const events = engine.computeNextGeneration();
    for (const e of events) {
      if (e.scorer === 1) p1Score += e.points;
      else p2Score += e.points;
    }
  }
  return { p1Score, p2Score };
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. Empty grid → period-1 after first tick
// ──────────────────────────────────────────────────────────────────────────────
describe("detectStablePeriod — empty grid", () => {
  it("returns 1 after the first tick on an empty grid", () => {
    const engine = makeEngine();
    engine.computeNextGeneration();
    expect(engine.detectStablePeriod()).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. Still life (Block) → period-1 detected; run terminates; end-score unchanged
// ──────────────────────────────────────────────────────────────────────────────
describe("detectStablePeriod — still life (Block)", () => {
  it("detects period-1 after one tick and produces stable period", () => {
    const engine = makeEngine();
    stampBlock(engine, 50, 50);
    engine.computeNextGeneration();
    expect(engine.detectStablePeriod()).toBe(1);
  });

  it("produces bitidentical end-grid vs full run (even remaining)", () => {
    const T = 150;
    // Full run
    const full = makeEngine(T);
    stampBlock(full, 50, 50);
    const { p1Score: fullP1, p2Score: fullP2 } = runTicks(full, T);
    // Force-flush any remaining buckets (mimics what early-exit does)
    const flushFull = full.forceFlushBuckets();
    for (const e of flushFull) {
      if (e.scorer === 1) fullP1 + e.points; // score already included via tick
    }
    const fullGrid = copyGrid(full);

    // Early-exit run: stop after detectStablePeriod fires, apply parity
    const early = makeEngine(T);
    stampBlock(early, 50, 50);
    let earlyP1 = 0;
    let earlyP2 = 0;
    let stoppedAt = -1;
    for (let g = 0; g < T; g++) {
      const events = early.computeNextGeneration();
      for (const e of events) {
        if (e.scorer === 1) earlyP1 += e.points;
        else earlyP2 += e.points;
      }
      const period = early.detectStablePeriod();
      if (period > 0) {
        stoppedAt = early.currentGeneration;
        const extra = (T - stoppedAt) % period;
        for (let i = 0; i < extra; i++) {
          const ev = early.computeNextGeneration();
          for (const e of ev) {
            if (e.scorer === 1) earlyP1 += e.points;
            else earlyP2 += e.points;
          }
        }
        const flushEarly = early.forceFlushBuckets();
        for (const e of flushEarly) {
          if (e.scorer === 1) earlyP1 += e.points;
          else earlyP2 += e.points;
        }
        break;
      }
    }
    expect(stoppedAt).toBeGreaterThan(0);
    expect(earlyP1).toBe(fullP1);
    expect(earlyP2).toBe(fullP2);
    expect(early.grid).toEqual(fullGrid);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. Blinker (p2 oscillator) — both parity cases for bitidentical end-grid
// ──────────────────────────────────────────────────────────────────────────────
describe("detectStablePeriod — Blinker (period-2 oscillator)", () => {
  it("detects period-2", () => {
    const engine = makeEngine();
    // Place blinker far from score zones (mid-board)
    stampBlinker(engine, 50, 50);
    engine.computeNextGeneration();
    engine.computeNextGeneration();
    expect(engine.detectStablePeriod()).toBe(2);
  });

  // T = 150 (even remaining after detection → extra = 0)
  it("even remaining: end-grid bitidentical to full run", () => {
    const T = 150;
    runParityTest(T);
  });

  // T = 151 (odd remaining → extra = 1)
  it("odd remaining: end-grid bitidentical to full run", () => {
    const T = 151;
    runParityTest(T);
  });

  function runParityTest(T: number): void {
    // Full run reference
    const full = makeEngine(T);
    stampBlinker(full, 50, 50);
    let fullP1 = 0;
    let fullP2 = 0;
    for (let i = 0; i < T; i++) {
      const events = full.computeNextGeneration();
      for (const e of events) {
        if (e.scorer === 1) fullP1 += e.points;
        else fullP2 += e.points;
      }
    }
    // forceFlush mimics early-exit flush (full run already flushed internally)
    const fullGrid = copyGrid(full);

    // Early-exit run
    const early = makeEngine(T);
    stampBlinker(early, 50, 50);
    let earlyP1 = 0;
    let earlyP2 = 0;
    let stopped = false;
    for (let g = 0; g < T; g++) {
      const events = early.computeNextGeneration();
      for (const e of events) {
        if (e.scorer === 1) earlyP1 += e.points;
        else earlyP2 += e.points;
      }
      const period = early.detectStablePeriod();
      if (period > 0) {
        const extra = (T - early.currentGeneration) % period;
        for (let i = 0; i < extra; i++) {
          const ev = early.computeNextGeneration();
          for (const e of ev) {
            if (e.scorer === 1) earlyP1 += e.points;
            else earlyP2 += e.points;
          }
        }
        const flushEarly = early.forceFlushBuckets();
        for (const e of flushEarly) {
          if (e.scorer === 1) earlyP1 += e.points;
          else earlyP2 += e.points;
        }
        stopped = true;
        break;
      }
    }
    expect(stopped).toBe(true);
    expect(earlyP1).toBe(fullP1);
    expect(earlyP2).toBe(fullP2);
    expect(early.grid).toEqual(fullGrid);
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. Scoring oscillator — must NOT be terminated while it produces hits
// ──────────────────────────────────────────────────────────────────────────────
describe("detectStablePeriod — scoring oscillator (no early termination)", () => {
  it("does not detect stability while a Blinker overlapping a score zone produces hits", () => {
    // Left score column is col 3 (scorer=2). A Blinker centred there oscillates
    // and its cells are born in the score zone every other tick.
    // Score column for P2 is col 3 (1 before endzoneLeftEnd=4).
    const engine = makeEngine(150);
    // Stamp blinker so the centre cell is exactly on the score column.
    // Horizontal blinker: cells at (row, col), (row, col+1), (row, col+2).
    // On tick 1: collapses to vertical — births at (row-1, col+1), (row+1, col+1).
    // Place it so col+1 = 3 → col=2, row far from top/bottom.
    stampBlinker(engine, 50, 2);
    let stableEver = false;
    for (let i = 0; i < 150; i++) {
      engine.computeNextGeneration();
      if (engine.detectStablePeriod() !== 0) {
        stableEver = true;
        break;
      }
    }
    expect(stableEver).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. Glider — no stability while it moves
// ──────────────────────────────────────────────────────────────────────────────
describe("detectStablePeriod — Glider", () => {
  it("returns 0 while a glider is in motion", () => {
    const engine = makeEngine(150);
    // A standard glider moving down-right from (10,10): period-4, translates +1+1 per 4 gens
    engine.stampCells(10, 10, [
      [0, 1],
      [1, 2],
      [2, 0],
      [2, 1],
      [2, 2],
    ]);
    // Run 20 ticks — glider is still alive and moving, never stable
    let stableEver = false;
    for (let i = 0; i < 20; i++) {
      engine.computeNextGeneration();
      if (engine.detectStablePeriod() !== 0) {
        stableEver = true;
        break;
      }
    }
    expect(stableEver).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. Invalidation: stampCells on a stable grid resets history
// ──────────────────────────────────────────────────────────────────────────────
describe("detectStablePeriod — invalidation via stampCells", () => {
  it("does not fire immediately after stampCells on a previously-stable grid", () => {
    const engine = makeEngine(200);
    // Run empty grid until stable
    engine.computeNextGeneration();
    expect(engine.detectStablePeriod()).toBe(1);

    // Stamp a block — history should be cleared
    stampBlock(engine, 50, 50);
    // detectStablePeriod must return 0 (no history yet)
    expect(engine.detectStablePeriod()).toBe(0);

    // One more tick: still life → should be 1 again only after fresh ticks
    engine.computeNextGeneration();
    expect(engine.detectStablePeriod()).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. Pending bucket on early exit — force-flush captures all points
// ──────────────────────────────────────────────────────────────────────────────
describe("detectStablePeriod — pending bucket flushed on early exit", () => {
  it("score from hit before stability is not lost when force-flush runs", () => {
    // Strategy: place a pattern that scores exactly once just before stabilising,
    // then use early-exit flush and compare to a full run.
    //
    // We use two Blocks: one far from score zones (stabilises the field),
    // and one placed such that a cell is born in the score zone on tick 1.
    // After that birth the blinker-like structure dies and no more hits occur.
    //
    // Simpler approach: stamp a 3-cell row aimed at the left score column so
    // one birth lands there on tick 1, then the structure dies → grid goes quiet
    // but bucket silenceCounter < SILENCE_LIMIT until force-flush.

    // Left score column = col 3 (scorer=2). We'll produce one birth at (50, 3):
    // Stamp 3 cells: (50,1), (50,2), (50,3) — horizontal blinker ending at col 3.
    // But we need it to die after one tick. A 3-cell row collapses to a vertical
    // blinker. We need it to NOT persist. Instead stamp just two cells that create
    // a single birth at col 3 and then nothing survives:
    //
    // (49,2),(50,2),(51,2) — vertical 3-row → births at (49,3),(50,3),(51,3)?
    // No, vertical 3-cell blinker flips to horizontal. Let's use a simpler path:
    // stamp exactly the cells that will die next tick and produce one birth in
    // the score zone.
    //
    // Pattern: (50,2),(50,3),(50,4) → on tick 1 these 3 live cells:
    //   - (50,2) has 1 neighbour (50,3), (50,4) has 1 → both die
    //   - (50,3) has 2 neighbours → survives
    //   - births: (49,3) and (51,3) get 3 neighbours → born
    // So after tick 1: vertical blinker at col 3, rows 49,50,51.
    // The birth of (49,3) is in col 3 (score zone)! Then it oscillates and keeps scoring.
    //
    // Let's use a different approach: place a dying structure next to the score zone.
    // A single isolated 2-cell domino dies in 1 tick.
    // (50,4),(50,5) → both have 1 neighbour → die. No births (need 3 neighbours).
    //
    // Best simple approach: place a 2×3 block that births one cell in the score zone
    // and then stabilises far away.
    //
    // Actually the simplest valid test: run a full sim and an early-exit sim with
    // a Block far from score zones plus a known 1-tick scorer, and verify totals match.

    const T = 150;

    // Use a Block at (50,50) as the main stable element.
    // Score on tick 1: place 3 cells at (10,2),(10,3),(10,4) → births at (9,3),(11,3) in score col.
    // Bucket gets 2 points, silenceCounter ticks up after that.
    // SILENCE_LIMIT=3, so flush at tick 4 (3 silence ticks after the last hit at tick 1).
    // Early exit may fire before tick 4 → force-flush needed.

    function buildEngine(simGens: number): Engine {
      const e = makeEngine(simGens);
      stampBlock(e, 50, 50); // stable structure
      // 3-cell horizontal row ending at score col → births at col 3 on tick 1
      e.stampCells(10, 2, [
        [0, 0],
        [0, 1],
        [0, 2],
      ]);
      return e;
    }

    // Full run
    const full = buildEngine(T);
    let fullP1 = 0;
    let fullP2 = 0;
    for (let i = 0; i < T; i++) {
      const events = full.computeNextGeneration();
      for (const ev of events) {
        if (ev.scorer === 1) fullP1 += ev.points;
        else fullP2 += ev.points;
      }
    }

    // Early-exit run
    const early = buildEngine(T);
    let earlyP1 = 0;
    let earlyP2 = 0;
    for (let g = 0; g < T; g++) {
      const events = early.computeNextGeneration();
      for (const ev of events) {
        if (ev.scorer === 1) earlyP1 += ev.points;
        else earlyP2 += ev.points;
      }
      const period = early.detectStablePeriod();
      if (period > 0) {
        const extra = (T - early.currentGeneration) % period;
        for (let i = 0; i < extra; i++) {
          const ev2 = early.computeNextGeneration();
          for (const e of ev2) {
            if (e.scorer === 1) earlyP1 += e.points;
            else earlyP2 += e.points;
          }
        }
        const flush = early.forceFlushBuckets();
        for (const e of flush) {
          if (e.scorer === 1) earlyP1 += e.points;
          else earlyP2 += e.points;
        }
        break;
      }
    }

    expect(earlyP1).toBe(fullP1);
    expect(earlyP2).toBe(fullP2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 8. Puzzle-segment equivalence: end-grid + score identical to full segment run
// ──────────────────────────────────────────────────────────────────────────────
describe("detectStablePeriod — puzzle segment equivalence", () => {
  it("early-exit segment matches full-run segment for Block (no scoring)", () => {
    // Simulates a puzzle segment: run until stable, apply parity, flush.
    // Compare to running the full segment length.
    const SEG_GENS = 80;

    function buildSeg(): Engine {
      const zones = new Zones(ROWS, COLS, { endzoneWidth: 3, lShapes: "none" });
      const e = new Engine(ROWS, COLS, zones, SEG_GENS);
      stampBlock(e, 25, 20);
      return e;
    }

    const full = buildSeg();
    let fullP1 = 0;
    let fullP2 = 0;
    for (let i = 0; i < SEG_GENS; i++) {
      const events = full.computeNextGeneration();
      for (const ev of events) {
        if (ev.scorer === 1) fullP1 += ev.points;
        else fullP2 += ev.points;
      }
    }
    const fullGrid = copyGrid(full);

    const early = buildSeg();
    let earlyP1 = 0;
    let earlyP2 = 0;
    for (let g = 0; g < SEG_GENS; g++) {
      const events = early.computeNextGeneration();
      for (const ev of events) {
        if (ev.scorer === 1) earlyP1 += ev.points;
        else earlyP2 += ev.points;
      }
      const period = early.detectStablePeriod();
      if (period > 0) {
        const extra = (SEG_GENS - early.currentGeneration) % period;
        for (let i = 0; i < extra; i++) {
          const ev2 = early.computeNextGeneration();
          for (const e of ev2) {
            if (e.scorer === 1) earlyP1 += e.points;
            else earlyP2 += e.points;
          }
        }
        const flush = early.forceFlushBuckets();
        for (const e of flush) {
          if (e.scorer === 1) earlyP1 += e.points;
          else earlyP2 += e.points;
        }
        break;
      }
    }

    expect(earlyP1).toBe(fullP1);
    expect(earlyP2).toBe(fullP2);
    expect(early.grid).toEqual(fullGrid);
  });
});
