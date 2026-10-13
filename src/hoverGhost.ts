// Hover ghost: resting the mouse while placing launches a ghost copy of the
// piece that plays out on its own, while the placement preview stays put.
//
// Simulated alone on an empty board the size of the field, from the actual
// placement spot. The field edge counts — a ship crashes into the wall and
// leaves debris, which is where most of its points come from, so a ghost
// that simply vanished there would teach the wrong physics. Other pieces
// and debris don't count: the ghost gives an idea of what the piece does,
// deliberately not the outcome on the real board.

import type { Player } from "./types.js";
import { Engine } from "./engine.js";
import { Zones } from "./zones.js";
import { PATTERNS } from "./patterns.js";
import { getPatternForPlayer } from "./patternUtils.js";

// The piece's run as absolute cells per frame (frame 0 = as placed), for
// at most `generations` generations — the current phase's length, so the
// loop restarting marks where the simulation would end. Stops early once
// the board settles into a still life or period-2 oscillation (e.g. wall
// debris), since nothing new would happen.
export function ghostRun(
  patternIndex: number,
  player: Player,
  row: number,
  col: number,
  gridRows: number,
  gridCols: number,
  generations: number,
): [number, number][][] {
  const pattern = getPatternForPlayer(PATTERNS[patternIndex]!, player);
  const engine = new Engine(
    gridRows,
    gridCols,
    new Zones(gridCols, gridRows),
    Number.MAX_SAFE_INTEGER, // no natural end — the loop below decides
  );
  engine.stampCells(row, col, pattern.cells);

  const frames: [number, number][][] = [liveCells(engine.grid)];
  for (let g = 0; g < generations; g++) {
    engine.stepOnly();
    frames.push(liveCells(engine.grid));
    if (engine.detectStablePeriod() !== 0) break;
  }
  return frames;
}

function liveCells(grid: boolean[][]): [number, number][] {
  const cells: [number, number][] = [];
  grid.forEach((line, r) =>
    line.forEach((alive, c) => {
      if (alive) cells.push([r, c]);
    }),
  );
  return cells;
}
