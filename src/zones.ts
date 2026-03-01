// Zone layout definitions and validation

import type { Player, ZoneRect } from "./types.js";
import { CONFIG } from "./config.js";

export class Zones {
  // Main zone boundaries (column indices)
  readonly endzoneLeftEnd: number; // First col AFTER left endzone
  readonly leftEnd: number; // First col of neutral zone
  readonly rightStart: number; // First col of player 2 zone
  readonly endzoneRightStart: number; // First col of right endzone

  // Score columns (main vertical score lines)
  readonly scoreColumnLeft: number;
  readonly scoreColumnRight: number;

  // L-shape score extensions
  readonly scoreColumnTopLeft: number;
  readonly scoreColumnBottomLeft: number;
  readonly scoreColumnTopRight: number;
  readonly scoreColumnBottomRight: number;

  // L-shape row boundaries
  readonly scoreRowTop: number;
  readonly scoreRowBottom: number;
  readonly endzoneTopRows: number;
  readonly endzoneBottomStartRow: number;

  readonly rows: number;

  constructor(cols: number, rows: number) {
    this.rows = rows;

    // Compute symmetric zone layout
    const endzoneWidth = 4;
    const playableWidth = cols - endzoneWidth * 2;
    const zoneWidth = Math.floor(playableWidth / 3);

    this.endzoneLeftEnd = endzoneWidth;
    this.leftEnd = endzoneWidth + zoneWidth;
    this.rightStart = cols - endzoneWidth - zoneWidth;
    this.endzoneRightStart = cols - endzoneWidth;

    // Score columns: last col of left endzone, first col of right endzone
    this.scoreColumnLeft = endzoneWidth - 1;
    this.scoreColumnRight = cols - endzoneWidth;

    // L-shape dimensions: height = endzoneWidth, horizontal arm ends endzoneWidth before neutral zone
    this.endzoneTopRows = endzoneWidth;
    this.endzoneBottomStartRow = rows - endzoneWidth;
    this.scoreRowTop = endzoneWidth - 1;
    this.scoreRowBottom = rows - endzoneWidth;

    // Horizontal L-arms extend to endzoneWidth columns before neutral zone
    this.scoreColumnTopLeft = this.leftEnd - endzoneWidth;
    this.scoreColumnBottomLeft = this.leftEnd - endzoneWidth;
    this.scoreColumnTopRight = this.rightStart + endzoneWidth;
    this.scoreColumnBottomRight = this.rightStart + endzoneWidth;
  }

  // Check if a column is valid for a player to place patterns
  isValidPlacement(col: number, player: Player): boolean {
    if (player === 1) {
      return col >= this.endzoneLeftEnd && col < this.leftEnd;
    } else {
      return col >= this.rightStart && col < this.endzoneRightStart;
    }
  }

  // Check if a cell is in a score zone and who scores
  isScoreCell(
    row: number,
    col: number,
  ): { scores: boolean; scorer: Player | null } {
    // Left score boundary: Player 2 scores when cells reach here
    if (this.isLeftScoreZone(row, col)) {
      return { scores: true, scorer: 2 };
    }
    // Right score boundary: Player 1 scores when cells reach here
    if (this.isRightScoreZone(row, col)) {
      return { scores: true, scorer: 1 };
    }
    return { scores: false, scorer: null };
  }

  private isLeftScoreZone(row: number, col: number): boolean {
    // Main side column (between L-shapes)
    if (
      col === this.scoreColumnLeft &&
      row >= this.endzoneTopRows &&
      row < this.endzoneBottomStartRow
    ) {
      return true;
    }
    // Top L: vertical part
    if (col === this.scoreColumnTopLeft && row < this.scoreRowTop) {
      return true;
    }
    // Top L: horizontal part
    if (
      row === this.scoreRowTop &&
      col >= this.scoreColumnLeft &&
      col <= this.scoreColumnTopLeft
    ) {
      return true;
    }
    // Bottom L: horizontal part
    if (
      row === this.scoreRowBottom &&
      col >= this.scoreColumnLeft &&
      col <= this.scoreColumnBottomLeft
    ) {
      return true;
    }
    // Bottom L: vertical part
    if (
      col === this.scoreColumnBottomLeft &&
      row > this.scoreRowBottom
    ) {
      return true;
    }
    return false;
  }

  private isRightScoreZone(row: number, col: number): boolean {
    // Main side column
    if (
      col === this.scoreColumnRight &&
      row >= this.endzoneTopRows &&
      row < this.endzoneBottomStartRow
    ) {
      return true;
    }
    // Top L: vertical part
    if (col === this.scoreColumnTopRight && row < this.scoreRowTop) {
      return true;
    }
    // Top L: horizontal part
    if (
      row === this.scoreRowTop &&
      col >= this.scoreColumnTopRight &&
      col <= this.scoreColumnRight
    ) {
      return true;
    }
    // Bottom L: horizontal part
    if (
      row === this.scoreRowBottom &&
      col >= this.scoreColumnBottomRight &&
      col <= this.scoreColumnRight
    ) {
      return true;
    }
    // Bottom L: vertical part
    if (
      col === this.scoreColumnBottomRight &&
      row > this.scoreRowBottom
    ) {
      return true;
    }
    return false;
  }

  // Generate all zone rectangles for data-driven rendering
  getRenderRects(): ZoneRect[] {
    const rects: ZoneRect[] = [];

    // 1. Full background
    rects.push({
      x: 0,
      y: 0,
      w: this.endzoneRightStart + (this.endzoneRightStart - this.rightStart),
      h: this.rows,
      color: CONFIG.COLOR_ZONE_ENDZONE,
    });

    // 2. Player zones
    rects.push({
      x: this.endzoneLeftEnd,
      y: 0,
      w: this.leftEnd - this.endzoneLeftEnd,
      h: this.rows,
      color: CONFIG.COLOR_ZONE_PLAYER1,
    });
    rects.push({
      x: this.leftEnd,
      y: 0,
      w: this.rightStart - this.leftEnd,
      h: this.rows,
      color: CONFIG.COLOR_ZONE_NEUTRAL,
    });
    rects.push({
      x: this.rightStart,
      y: 0,
      w: this.endzoneRightStart - this.rightStart,
      h: this.rows,
      color: CONFIG.COLOR_ZONE_PLAYER2,
    });

    // 3. L-shaped endzone overlays (gray, mask corners of player zones)
    // Left top L
    rects.push({
      x: this.endzoneLeftEnd,
      y: 0,
      w: this.scoreColumnTopLeft - this.endzoneLeftEnd,
      h: this.endzoneTopRows,
      color: CONFIG.COLOR_ZONE_ENDZONE,
    });
    // Left bottom L
    rects.push({
      x: this.endzoneLeftEnd,
      y: this.endzoneBottomStartRow,
      w: this.scoreColumnBottomLeft - this.endzoneLeftEnd,
      h: this.rows - this.endzoneBottomStartRow,
      color: CONFIG.COLOR_ZONE_ENDZONE,
    });
    // Right top L
    rects.push({
      x: this.scoreColumnTopRight + 1,
      y: 0,
      w: this.endzoneRightStart - this.scoreColumnTopRight - 1,
      h: this.endzoneTopRows,
      color: CONFIG.COLOR_ZONE_ENDZONE,
    });
    // Right bottom L
    rects.push({
      x: this.scoreColumnBottomRight + 1,
      y: this.endzoneBottomStartRow,
      w: this.endzoneRightStart - this.scoreColumnBottomRight - 1,
      h: this.rows - this.endzoneBottomStartRow,
      color: CONFIG.COLOR_ZONE_ENDZONE,
    });

    // 4. Score zones (yellow)
    // Side columns (between top and bottom L-shapes)
    const midHeight = this.endzoneBottomStartRow - this.endzoneTopRows;
    rects.push({
      x: this.scoreColumnLeft,
      y: this.endzoneTopRows,
      w: 1,
      h: midHeight,
      color: CONFIG.COLOR_ZONE_SCORE,
    });
    rects.push({
      x: this.scoreColumnRight,
      y: this.endzoneTopRows,
      w: 1,
      h: midHeight,
      color: CONFIG.COLOR_ZONE_SCORE,
    });

    // Left top L score
    rects.push({
      x: this.scoreColumnTopLeft,
      y: 0,
      w: 1,
      h: this.scoreRowTop,
      color: CONFIG.COLOR_ZONE_SCORE,
    });
    rects.push({
      x: this.scoreColumnLeft,
      y: this.scoreRowTop,
      w: this.scoreColumnTopLeft - this.scoreColumnLeft + 1,
      h: 1,
      color: CONFIG.COLOR_ZONE_SCORE,
    });

    // Left bottom L score
    rects.push({
      x: this.scoreColumnLeft,
      y: this.scoreRowBottom,
      w: this.scoreColumnBottomLeft - this.scoreColumnLeft + 1,
      h: 1,
      color: CONFIG.COLOR_ZONE_SCORE,
    });
    rects.push({
      x: this.scoreColumnBottomLeft,
      y: this.scoreRowBottom + 1,
      w: 1,
      h: this.rows - this.scoreRowBottom - 1,
      color: CONFIG.COLOR_ZONE_SCORE,
    });

    // Right top L score
    rects.push({
      x: this.scoreColumnTopRight,
      y: 0,
      w: 1,
      h: this.scoreRowTop,
      color: CONFIG.COLOR_ZONE_SCORE,
    });
    rects.push({
      x: this.scoreColumnTopRight,
      y: this.scoreRowTop,
      w: this.scoreColumnRight - this.scoreColumnTopRight + 1,
      h: 1,
      color: CONFIG.COLOR_ZONE_SCORE,
    });

    // Right bottom L score
    rects.push({
      x: this.scoreColumnBottomRight,
      y: this.scoreRowBottom,
      w: this.scoreColumnRight - this.scoreColumnBottomRight + 1,
      h: 1,
      color: CONFIG.COLOR_ZONE_SCORE,
    });
    rects.push({
      x: this.scoreColumnBottomRight,
      y: this.scoreRowBottom + 1,
      w: 1,
      h: this.rows - this.scoreRowBottom - 1,
      color: CONFIG.COLOR_ZONE_SCORE,
    });

    return rects;
  }
}
