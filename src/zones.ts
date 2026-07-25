// Zone layout definitions and validation

import type { Pattern, Player, ZoneRect } from "./types.js";
import { CONFIG } from "./config.js";

// Optional configuration for zone layout.
// Defaults reproduce the main-game layout (goalZoneWidth=4, lShapes="both").
// Puzzles can use smaller goal zones and simpler score zones.
//
// lShapes: "both"  – L-shaped score zones at top and bottom (default)
//          "none"  – straight full-height score columns only
//          "top" | "bottom" – single L-shape on one side (reserved, not yet used)
export interface ZonesConfig {
  goalZoneWidth?: number;
  lShapes?: "both" | "none";
}

export class Zones {
  // Main zone boundaries (column indices)
  readonly goalZoneLeftEnd: number; // First col AFTER left goal zone
  readonly leftEnd: number; // First col of neutral zone
  readonly rightStart: number; // First col of player 2 zone
  readonly goalZoneRightStart: number; // First col of right goal zone

  // Score columns (main vertical score lines)
  readonly scoreColumnLeft: number;
  readonly scoreColumnRight: number;

  // L-shape score extensions (only meaningful when lShapes !== "none")
  readonly scoreColumnTopLeft: number;
  readonly scoreColumnBottomLeft: number;
  readonly scoreColumnTopRight: number;
  readonly scoreColumnBottomRight: number;

  // L-shape row boundaries
  readonly scoreRowTop: number;
  readonly scoreRowBottom: number;
  readonly goalZoneTopRows: number;
  readonly goalZoneBottomStartRow: number;

  readonly rows: number;
  readonly cols: number;
  readonly lShapes: ZonesConfig["lShapes"];

  constructor(cols: number, rows: number, config?: ZonesConfig) {
    this.rows = rows;
    this.cols = cols;
    this.lShapes = config?.lShapes ?? "both";

    const goalZoneWidth = config?.goalZoneWidth ?? 4;

    // Compute symmetric zone layout
    const playableWidth = cols - goalZoneWidth * 2;
    const zoneWidth = Math.floor(playableWidth / 3);

    this.goalZoneLeftEnd = goalZoneWidth;
    this.leftEnd = goalZoneWidth + zoneWidth;
    this.rightStart = cols - goalZoneWidth - zoneWidth;
    this.goalZoneRightStart = cols - goalZoneWidth;

    // Score columns: last col of left goal zone, first col of right goal zone
    this.scoreColumnLeft = goalZoneWidth - 1;
    this.scoreColumnRight = cols - goalZoneWidth;

    // L-shape dimensions: height = goalZoneWidth, horizontal arm ends goalZoneWidth before neutral zone
    this.goalZoneTopRows = goalZoneWidth;
    this.goalZoneBottomStartRow = rows - goalZoneWidth;
    this.scoreRowTop = goalZoneWidth - 1;
    this.scoreRowBottom = rows - goalZoneWidth;

    // Horizontal L-arms extend to goalZoneWidth columns before neutral zone
    this.scoreColumnTopLeft = this.leftEnd - goalZoneWidth;
    this.scoreColumnBottomLeft = this.leftEnd - goalZoneWidth;
    this.scoreColumnTopRight = this.rightStart + goalZoneWidth;
    this.scoreColumnBottomRight = this.rightStart + goalZoneWidth;
  }

  // Check if the entire pattern fits within the player's zone.
  // startCol is the column of the cell with col-offset 0.
  isValidPatternPlacement(
    pattern: Pattern,
    startRow: number,
    startCol: number,
    player: Player,
  ): boolean {
    const minColOffset = Math.min(...pattern.cells.map(([, c]) => c));
    const maxColOffset = Math.max(...pattern.cells.map(([, c]) => c));
    const leftCol = startCol + minColOffset;
    const rightCol = startCol + maxColOffset;

    // The whole pattern must fit vertically on the grid — otherwise
    // stampCells() would silently clip the off-grid cells. Placements in
    // the top/bottom rows (e.g. the score-zone L-arms) stay valid as long
    // as no cell falls outside the field.
    const minRowOffset = Math.min(...pattern.cells.map(([r]) => r));
    const maxRowOffset = Math.max(...pattern.cells.map(([r]) => r));
    const topRow = startRow + minRowOffset;
    const botRow = startRow + maxRowOffset;
    if (topRow < 0 || botRow >= this.rows) return false;

    if (player === 1) {
      return leftCol >= this.goalZoneLeftEnd && rightCol < this.leftEnd;
    } else {
      return leftCol >= this.rightStart && rightCol < this.goalZoneRightStart;
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
    if (this.lShapes === "none") {
      return col === this.scoreColumnLeft;
    }

    // lShapes === "both" (default)
    // Main side column (between L-shapes)
    if (
      col === this.scoreColumnLeft &&
      row >= this.goalZoneTopRows &&
      row < this.goalZoneBottomStartRow
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
    if (col === this.scoreColumnBottomLeft && row > this.scoreRowBottom) {
      return true;
    }
    return false;
  }

  private isRightScoreZone(row: number, col: number): boolean {
    if (this.lShapes === "none") {
      return col === this.scoreColumnRight;
    }

    // lShapes === "both" (default)
    // Main side column
    if (
      col === this.scoreColumnRight &&
      row >= this.goalZoneTopRows &&
      row < this.goalZoneBottomStartRow
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
    if (col === this.scoreColumnBottomRight && row > this.scoreRowBottom) {
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
      w: this.cols,
      h: this.rows,
      color: CONFIG.COLOR_ZONE_GOALZONE,
    });

    // 2. Player zones
    rects.push({
      x: this.goalZoneLeftEnd,
      y: 0,
      w: this.leftEnd - this.goalZoneLeftEnd,
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
      w: this.goalZoneRightStart - this.rightStart,
      h: this.rows,
      color: CONFIG.COLOR_ZONE_PLAYER2,
    });

    if (this.lShapes === "none") {
      // Simple full-height score columns only
      rects.push({
        x: this.scoreColumnLeft,
        y: 0,
        w: 1,
        h: this.rows,
        color: CONFIG.COLOR_ZONE_SCORE,
      });
      rects.push({
        x: this.scoreColumnRight,
        y: 0,
        w: 1,
        h: this.rows,
        color: CONFIG.COLOR_ZONE_SCORE,
      });
      return rects;
    }

    // lShapes === "both": L-shaped goal zone overlays and score zones
    // 3. L-shaped goal zone overlays (gray, mask corners of player zones)
    // Left top L
    rects.push({
      x: this.goalZoneLeftEnd,
      y: 0,
      w: this.scoreColumnTopLeft - this.goalZoneLeftEnd,
      h: this.goalZoneTopRows,
      color: CONFIG.COLOR_ZONE_GOALZONE,
    });
    // Left bottom L
    rects.push({
      x: this.goalZoneLeftEnd,
      y: this.goalZoneBottomStartRow,
      w: this.scoreColumnBottomLeft - this.goalZoneLeftEnd,
      h: this.rows - this.goalZoneBottomStartRow,
      color: CONFIG.COLOR_ZONE_GOALZONE,
    });
    // Right top L
    rects.push({
      x: this.scoreColumnTopRight + 1,
      y: 0,
      w: this.goalZoneRightStart - this.scoreColumnTopRight - 1,
      h: this.goalZoneTopRows,
      color: CONFIG.COLOR_ZONE_GOALZONE,
    });
    // Right bottom L
    rects.push({
      x: this.scoreColumnBottomRight + 1,
      y: this.goalZoneBottomStartRow,
      w: this.goalZoneRightStart - this.scoreColumnBottomRight - 1,
      h: this.rows - this.goalZoneBottomStartRow,
      color: CONFIG.COLOR_ZONE_GOALZONE,
    });

    // 4. Score zones (yellow)
    // Side columns (between top and bottom L-shapes)
    const midHeight = this.goalZoneBottomStartRow - this.goalZoneTopRows;
    rects.push({
      x: this.scoreColumnLeft,
      y: this.goalZoneTopRows,
      w: 1,
      h: midHeight,
      color: CONFIG.COLOR_ZONE_SCORE,
    });
    rects.push({
      x: this.scoreColumnRight,
      y: this.goalZoneTopRows,
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
