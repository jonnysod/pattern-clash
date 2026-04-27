// Shared test helpers.

import { Game } from "../src/game.js";
import { CONFIG } from "../src/config.js";

export const TEST_ROWS = CONFIG.CANVAS_HEIGHT / CONFIG.CELL_SIZE;
export const TEST_COLS = CONFIG.CANVAS_WIDTH / CONFIG.CELL_SIZE;

export function makeGame(): Game {
  return new Game(TEST_ROWS, TEST_COLS);
}

// Find a cheap pattern (cells.length === price). Block costs 4.
export const BLOCK_INDEX = 2; // PATTERNS[2] = Block (4 cells)
export const BLINKER_INDEX = 5; // PATTERNS[5] = Blinker (3 cells)
export const LWSS_INDEX = 0; // PATTERNS[0] = LWSS (9 cells)
