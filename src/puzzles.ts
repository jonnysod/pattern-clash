// Puzzle definitions.
//
// Each puzzle is verified by the engine (see tests/puzzle.verify.test.ts).
// Add new puzzles here — the selection screen lists them automatically.

import type { PuzzleDefinition } from "./types.js";

// Pattern indices (from patterns.ts)
const MWSS_INDEX = 1;
const BLOCK_INDEX = 2;
const BLINKER_INDEX = 5;
const GLIDER_DOWN_INDEX = 8;
const GLIDER_UP_INDEX = 9;

// Puzzle grid: 50 cols × 30 rows, endzone 3 cols, no L-shapes.
// Verified parameters (see tests/puzzle.verify.test.ts):
//   - MWSS mirrored at (12, 38) reaches left score column at gen ~85
//     without intervention: P2 scores.
//   - A Block placed in P1 zone (cols 3–16, rows 11–12) before the
//     resolution simulate stops the MWSS: P2 score stays at 0.
const PUZZLE_ROWS = 30;
const PUZZLE_COLS = 50;

export const PUZZLE_ZONE_CONFIG = {
  endzoneWidth: 3,
  lShapes: "none" as const,
};

export const PUZZLES: PuzzleDefinition[] = [
  {
    id: "stop-the-mwss",
    title: "Stop the Spaceship",
    objective:
      "A spaceship is heading for your endzone. Place a pattern to stop it before it scores!",
    hint: "A solid, stable pattern makes the best wall.",
    gridRows: PUZZLE_ROWS,
    gridCols: PUZZLE_COLS,
    playerSide: 1,

    // Mirrored MWSS in the opponent's zone, flying left toward P1's endzone.
    initialPlacements: [
      { patternIndex: MWSS_INDEX, row: 12, col: 38, mirror: true },
    ],

    // Timeline:
    //   1. Watch the spaceship approach for 20 generations.
    //   2. Place one card from the hand to block its path.
    //   3. Simulate 80 more generations to see the result.
    //
    // P1 zone (cols 3–16) is where the player may place.
    // MWSS reaches P1 zone around gen 50 — plenty of time after placement.
    timeline: [
      { kind: "simulate", generations: 20 },
      {
        kind: "place",
        pool: [BLOCK_INDEX, BLINKER_INDEX, GLIDER_UP_INDEX, GLIDER_DOWN_INDEX],
        maxCards: 1,
      },
      { kind: "simulate", generations: 80 },
    ],

    criteria: { maxOpponentScore: 0 },

    // Player may only place within their own zone (cols 3–16, all rows).
    // P1 zone: endzoneLeftEnd=3, leftEnd=17 → x=3, w=14
    placementRegion: { x: 3, y: 0, w: 14, h: PUZZLE_ROWS, color: "" },
  },
];
