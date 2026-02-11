// Zone definitions and validation

import type { Player } from "./types.js";

export class Zones {
  readonly cols: number;
  readonly rows: number;
  readonly leftEnd: number;
  readonly rightStart: number;

  // Side endzones
  readonly endzoneWidth: number = 4;
  readonly endzoneLeftStart: number = 0;
  readonly endzoneLeftEnd: number;
  readonly endzoneRightStart: number;
  readonly endzoneRightEnd: number;
  readonly scoreColumnLeft: number = 3;
  readonly scoreColumnRight: number;

  // Top/bottom endzones (L-shaped scoring)
  readonly endzoneTopRows: number = 4; // rows 0-3 are endzone in corners
  readonly endzoneBottomStartRow: number;
  readonly scoreRowTop: number = 3;
  readonly scoreRowBottom: number;

  // Vertical score columns for top/bottom L-shape
  readonly scoreColumnTopLeft: number; // left side, vertical part of top L
  readonly scoreColumnTopRight: number; // right side, vertical part of top L
  readonly scoreColumnBottomLeft: number; // left side, vertical part of bottom L
  readonly scoreColumnBottomRight: number; // right side, vertical part of bottom L

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;

    // Side endzones
    this.endzoneLeftEnd = this.endzoneWidth;
    this.endzoneRightStart = cols - this.endzoneWidth;
    this.endzoneRightEnd = cols;
    this.scoreColumnRight = cols - 4;

    // Placement zones
    this.leftEnd =
      this.endzoneLeftEnd + Math.floor((cols - 2 * this.endzoneWidth) * 0.32);
    this.rightStart =
      this.endzoneLeftEnd + Math.floor((cols - 2 * this.endzoneWidth) * 0.68);

    // Top/bottom
    this.endzoneBottomStartRow = rows - this.endzoneTopRows;
    this.scoreRowBottom = rows - 4;

    // Vertical score columns: 3 columns of P1/P2 remain before neutral zone
    this.scoreColumnTopLeft = this.leftEnd - 3;
    this.scoreColumnTopRight = this.rightStart + 2;
    this.scoreColumnBottomLeft = this.scoreColumnTopLeft;
    this.scoreColumnBottomRight = this.scoreColumnTopRight;
  }

  // Check if a cell is a scoring cell
  isScoreCell(
    row: number,
    col: number,
  ): { scores: boolean; scorer: 1 | 2 | null } {
    // Side score columns (full height between top/bottom endzones)
    if (
      col === this.scoreColumnLeft &&
      row >= this.endzoneTopRows &&
      row < this.endzoneBottomStartRow
    ) {
      return { scores: true, scorer: 2 }; // Left score col → P2 scores
    }
    if (
      col === this.scoreColumnRight &&
      row >= this.endzoneTopRows &&
      row < this.endzoneBottomStartRow
    ) {
      return { scores: true, scorer: 1 }; // Right score col → P1 scores
    }

    // Top L-shape: horizontal score row (row 3, between side score columns and vertical score column)
    if (row === this.scoreRowTop) {
      if (col >= this.scoreColumnLeft && col <= this.scoreColumnTopLeft) {
        return { scores: true, scorer: 2 }; // P1's top zone → P2 scores
      }
      if (col >= this.scoreColumnTopRight && col <= this.scoreColumnRight) {
        return { scores: true, scorer: 1 }; // P2's top zone → P1 scores
      }
    }

    // Top L-shape: vertical score column (rows 0 to scoreRowTop)
    if (row >= 0 && row <= this.scoreRowTop) {
      if (col === this.scoreColumnTopLeft) {
        return { scores: true, scorer: 2 }; // P1's top vertical → P2 scores
      }
      if (col === this.scoreColumnTopRight) {
        return { scores: true, scorer: 1 }; // P2's top vertical → P1 scores
      }
    }

    // Bottom L-shape: horizontal score row
    if (row === this.scoreRowBottom) {
      if (col >= this.scoreColumnLeft && col <= this.scoreColumnBottomLeft) {
        return { scores: true, scorer: 2 };
      }
      if (col >= this.scoreColumnBottomRight && col <= this.scoreColumnRight) {
        return { scores: true, scorer: 1 };
      }
    }

    // Bottom L-shape: vertical score column (scoreRowBottom to last row)
    if (row >= this.scoreRowBottom && row < this.rows) {
      if (col === this.scoreColumnBottomLeft) {
        return { scores: true, scorer: 2 };
      }
      if (col === this.scoreColumnBottomRight) {
        return { scores: true, scorer: 1 };
      }
    }

    return { scores: false, scorer: null };
  }

  // Check if column is in a player's placement zone
  isInPlayerZone(col: number, player: Player): boolean {
    if (player === 1) {
      return col >= this.endzoneLeftEnd && col < this.leftEnd;
    } else {
      return col >= this.rightStart && col < this.endzoneRightStart;
    }
  }

  isValidPlacement(col: number, player: Player): boolean {
    if (player === 1) {
      return col < this.leftEnd;
    } else {
      return col >= this.rightStart;
    }
  }
}
