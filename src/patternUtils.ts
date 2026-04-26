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
export function getPatternForPlayer(pattern: Pattern, player: Player): Pattern {
  if (player === 1) return pattern;
  return mirrorPatternHorizontal(pattern);
}

// Compute the actual column for placement.
// Player 2 patterns are offset so they're placed left of the cursor column.
export function getPlacementCol(
  col: number,
  pattern: Pattern,
  player: Player,
): number {
  if (player === 1) return col;
  const maxC = Math.max(...pattern.cells.map(([, c]) => c));
  return col - maxC;
}

// Draw a static mini-preview of a pattern into a canvas, sized to fit
// with a small margin. Used by the buy overlay and the card hand.
export function drawPatternPreview(
  canvas: HTMLCanvasElement,
  pattern: Pattern,
  player: Player,
  options: {
    cellColor: string;
    backgroundColor?: string;
    margin?: number;
    maxCellSize?: number;
  },
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const margin = options.margin ?? 4;
  const maxCellSize = options.maxCellSize ?? 6;
  const bg = options.backgroundColor ?? "#000";

  const playerPattern = getPatternForPlayer(pattern, player);
  const rows = playerPattern.cells.map(([r]) => r);
  const cols = playerPattern.cells.map(([, c]) => c);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  const patternHeight = maxRow - minRow + 1;
  const patternWidth = maxCol - minCol + 1;

  const availW = canvas.width - 2 * margin;
  const availH = canvas.height - 2 * margin;
  const cellSize = Math.max(
    1,
    Math.min(
      maxCellSize,
      Math.floor(Math.min(availW / patternWidth, availH / patternHeight)),
    ),
  );

  const drawW = patternWidth * cellSize;
  const drawH = patternHeight * cellSize;
  const offsetX = Math.floor((canvas.width - drawW) / 2);
  const offsetY = Math.floor((canvas.height - drawH) / 2);

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = options.cellColor;
  // Use Math.max(1, ...) so 1px cells (very wide patterns like Gosper Glider
  // Gun) don't collapse to invisible 0×0 rects.
  const px = Math.max(1, cellSize - 1);
  for (const [r, c] of playerPattern.cells) {
    const x = offsetX + (c - minCol) * cellSize;
    const y = offsetY + (r - minRow) * cellSize;
    ctx.fillRect(x, y, px, px);
  }
}
