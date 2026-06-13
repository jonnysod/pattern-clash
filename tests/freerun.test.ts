// Tests for the post-game freerun sandbox:
// - stepOnly() produces no ScoreEvents and does not mutate score counters
// - detectStablePeriod() works correctly after stepOnly() ticks
// - Score counters remain invariant across an entire freerun sequence

import { describe, it, expect } from "vitest";
import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { CONFIG } from "../src/config.js";

const ROWS = CONFIG.CANVAS_HEIGHT / CONFIG.CELL_SIZE;
const COLS = CONFIG.CANVAS_WIDTH / CONFIG.CELL_SIZE;

function makeEngine(): Engine {
  const zones = new Zones(ROWS, COLS);
  return new Engine(ROWS, COLS, zones, 150);
}

function stampBlock(engine: Engine, row: number, col: number): void {
  engine.stampCells(row, col, [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ]);
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. stepOnly() produces no ScoreEvents — even when a cell is born in a score zone
// ──────────────────────────────────────────────────────────────────────────────
describe("stepOnly — no score pipeline", () => {
  it("scoreEvents is empty after stepOnly()", () => {
    const engine = makeEngine();
    // Place a 3-cell row that produces a birth in the left score column (col 3)
    // on the next tick.
    engine.stampCells(10, 2, [
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    engine.stepOnly();
    expect(engine.scoreEvents).toEqual([]);
  });

  it("stepOnly() increments currentGeneration", () => {
    const engine = makeEngine();
    expect(engine.currentGeneration).toBe(0);
    engine.stepOnly();
    expect(engine.currentGeneration).toBe(1);
    engine.stepOnly();
    expect(engine.currentGeneration).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. Score counter invariance — counters must not change during a freerun sequence
// ──────────────────────────────────────────────────────────────────────────────
describe("stepOnly — score counter invariance", () => {
  it("scoreEvents stays empty over many stepOnly() ticks even with score-zone activity", () => {
    const engine = makeEngine();
    // Place a blinker that straddles the left score column (col 3) so cells
    // are born there on every odd tick.
    engine.stampCells(50, 2, [
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    let totalEvents = 0;
    for (let i = 0; i < 30; i++) {
      engine.stepOnly();
      totalEvents += engine.scoreEvents.length;
    }
    expect(totalEvents).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. detectStablePeriod() works after stepOnly() ticks (history updated correctly)
// ──────────────────────────────────────────────────────────────────────────────
describe("stepOnly — stability detection still works", () => {
  it("detects period-1 (still life) after stepOnly() ticks on an empty grid", () => {
    const engine = makeEngine();
    engine.stepOnly();
    expect(engine.detectStablePeriod()).toBe(1);
  });

  it("detects period-1 after Block reaches stability via stepOnly()", () => {
    const engine = makeEngine();
    stampBlock(engine, 50, 50);
    engine.stepOnly();
    expect(engine.detectStablePeriod()).toBe(1);
  });

  it("detects period-2 for a Blinker running via stepOnly()", () => {
    const engine = makeEngine();
    engine.stampCells(50, 50, [
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    engine.stepOnly();
    engine.stepOnly();
    expect(engine.detectStablePeriod()).toBe(2);
  });

  it("does NOT detect stability while a Glider moves via stepOnly()", () => {
    const engine = makeEngine();
    engine.stampCells(10, 10, [
      [0, 1],
      [1, 2],
      [2, 0],
      [2, 1],
      [2, 2],
    ]);
    let stableEver = false;
    for (let i = 0; i < 20; i++) {
      engine.stepOnly();
      if (engine.detectStablePeriod() !== 0) {
        stableEver = true;
        break;
      }
    }
    expect(stableEver).toBe(false);
  });

  it("auto-pause logic: freerun loop stops when detectStablePeriod fires", () => {
    // Simulate the freerun loop contract: tick via stepOnly(), check stability,
    // stop when period > 0. Verify the loop terminates within a small bound.
    const engine = makeEngine();
    stampBlock(engine, 50, 50); // stable after 1 tick
    let ticks = 0;
    let stopped = false;
    for (let i = 0; i < 100; i++) {
      engine.stepOnly();
      ticks++;
      const period = engine.detectStablePeriod();
      if (period === 1 || period === 2) {
        stopped = true;
        break;
      }
    }
    expect(stopped).toBe(true);
    expect(ticks).toBeLessThanOrEqual(5);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. Mixed sequence: computeNextGeneration() then stepOnly() — score frozen
// ──────────────────────────────────────────────────────────────────────────────
describe("stepOnly — score frozen in freerun after scored sim", () => {
  it("score does not change during stepOnly() ticks after a scored run", () => {
    const engine = makeEngine();
    // Run a few normal ticks that might produce score, then switch to stepOnly.
    engine.stampCells(10, 2, [
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    let scoreAfterSim = 0;
    for (let i = 0; i < 20; i++) {
      const events = engine.computeNextGeneration();
      for (const e of events) scoreAfterSim += e.points;
    }
    // From here the freerun starts — stepOnly only.
    let scoreInFreerun = 0;
    for (let i = 0; i < 50; i++) {
      engine.stepOnly();
      scoreInFreerun += engine.scoreEvents.length;
    }
    expect(scoreInFreerun).toBe(0);
  });
});
