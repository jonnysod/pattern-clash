// Headless peek — the expensive core of every sim-ranking bot decision.
//
// Simulates a candidate placement forward on a grid clone, never touching
// the live game, and returns the net score (own − opponent) up to the
// horizon, or until the board stabilises (early termination), whichever
// comes first.
//
// A free function with explicit inputs on purpose: this is the synchronous
// main-thread freeze the project's perf notes keep pointing at, and the
// planned fix is running it in a web worker. Everything it needs arrives
// through the parameters — no Game, no policy state — so the worker
// migration is transport, not surgery.
//
// Guardrails: operates on a fresh Engine + cloned grid only. Never reads
// or writes the live game's grid/scorePlayer*, never emits ScoreEvents to
// any UI listener, never touches _nextCardId, never sends a SyncAction.

import { Engine } from "./engine.js";
import type { Pattern } from "./types.js";
import type { Zones } from "./zones.js";

export interface PeekEnv {
  rows: number;
  cols: number;
  zones: Zones;
  horizon: number;
}

export function peekNetScore(
  grid: boolean[][],
  pattern: Pattern,
  row: number,
  col: number,
  env: PeekEnv,
): number {
  const clone = grid.map((r) => r.slice());
  for (const [dr, dc] of pattern.cells) {
    const r = row + dr;
    const c = col + dc;
    if (r >= 0 && r < env.rows && c >= 0 && c < env.cols) {
      clone[r]![c] = true;
    }
  }

  const engine = new Engine(env.rows, env.cols, env.zones, env.horizon);
  engine.grid = clone;

  let ownScore = 0;
  let opponentScore = 0;

  while (!engine.isSimulationComplete()) {
    const events = engine.computeNextGeneration();
    for (const e of events) {
      if (e.scorer === 2) ownScore += e.points;
      else opponentScore += e.points;
    }

    if (engine.detectStablePeriod() !== 0) {
      const flushed = engine.forceFlushBuckets();
      for (const e of flushed) {
        if (e.scorer === 2) ownScore += e.points;
        else opponentScore += e.points;
      }
      break;
    }
  }

  return ownScore - opponentScore;
}
