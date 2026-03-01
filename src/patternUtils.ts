// Pattern rotation and player-specific transformations

import type { Pattern, Player } from "./types.js";

// Mirror pattern horizontally (flip columns)
export function mirrorPatternHorizontal(pattern: Pattern): Pattern {
  if (pattern.cells.length === 0) return pattern;

  const maxCol = Math.max(...pattern.cells.map(([, c]) => c));
  const mirroredCells: [number, number][] = pattern.cells.map(([r, c]) => [
    r,
    maxCol - c,
  ]);

  return { ...pattern, cells: mirroredCells };
}

// Rotate pattern 90° clockwise
export function rotatePattern(pattern: Pattern): Pattern {
  if (pattern.cells.length === 0) return pattern;

  // [row, col] → [col, maxRow - row]
  const maxRow = Math.max(...pattern.cells.map(([r]) => r));
  const rotatedCells: [number, number][] = pattern.cells.map(([r, c]) => [
    c,
    maxRow - r,
  ]);

  return { ...pattern, cells: rotatedCells };
}

// Get pattern transformed for a specific player.
// Player 1: original (patterns face right by default).
// Player 2: horizontally mirrored (patterns face left).
export function getPatternForPlayer(
  pattern: Pattern,
  player: Player,
): Pattern {
  if (player === 1) return pattern;
  return mirrorPatternHorizontal(pattern);
}
