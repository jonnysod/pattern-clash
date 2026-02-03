// Pattern rotation and transformation utilities

import type { Pattern, Player } from "./types.js";

export function rotatePattern(pattern: Pattern, degrees: number): Pattern {
  const rotations = degrees / 90;
  let cells = pattern.cells;

  for (let i = 0; i < rotations; i++) {
    // Rotate 90° clockwise: (row, col) -> (col, -row)
    cells = cells.map(([row, col]) => [col, -row]);
  }

  return {
    name: pattern.name,
    cells: cells,
  };
}

export function mirrorPatternHorizontally(pattern: Pattern): Pattern {
  // Spiegele Pattern horizontal für Spieler 2
  return {
    name: pattern.name,
    cells: pattern.cells.map(([row, col]) => [row, -col]),
  };
}

export function getPatternForPlayer(pattern: Pattern, player: Player): Pattern {
  if (player === 2) {
    // Spieler 2: Spiegele Patterns horizontal (wandern nach links)
    return mirrorPatternHorizontally(pattern);
  }
  return pattern;
}
