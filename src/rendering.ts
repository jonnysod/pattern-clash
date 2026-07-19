// Canvas rendering logic

import type { Pattern, Player, ZoneRect } from "./types.js";
import { Zones } from "./zones.js";
import { CONFIG } from "./config.js";

// Minimal interface Renderer needs from its data source.
// Both Game and the puzzle harness satisfy this structurally.
export interface RenderSource {
  readonly rows: number;
  readonly cols: number;
  readonly grid: boolean[][];
  readonly zones: Zones;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private cellSize: number;
  private source: RenderSource;

  // Cached zone rectangles (computed once)
  private zoneRects: ZoneRect[];

  constructor(canvas: HTMLCanvasElement, cellSize: number, source: RenderSource) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.cellSize = cellSize;
    this.source = source;
    this.zoneRects = source.zones.getRenderRects();
  }

  drawGrid(): void {
    const cs = this.cellSize;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw all zone backgrounds from data
    for (const rect of this.zoneRects) {
      ctx.fillStyle = rect.color;
      ctx.fillRect(rect.x * cs, rect.y * cs, rect.w * cs, rect.h * cs);
    }

    // Draw living cells
    ctx.fillStyle = CONFIG.COLOR_CELL;
    for (let row = 0; row < this.source.rows; row++) {
      for (let col = 0; col < this.source.cols; col++) {
        if (this.source.grid[row]![col]) {
          ctx.fillRect(col * cs, row * cs, cs - 1, cs - 1);
        }
      }
    }

    // Grid lines
    this.drawGridLines();

    // Zone separator lines (thicker)
    this.drawZoneBorders();
  }

  private drawGridLines(): void {
    const cs = this.cellSize;
    const ctx = this.ctx;

    ctx.strokeStyle = CONFIG.COLOR_GRID_LINE;
    ctx.lineWidth = 1;

    for (let i = 0; i <= this.source.rows; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * cs);
      ctx.lineTo(this.canvas.width, i * cs);
      ctx.stroke();
    }
    for (let i = 0; i <= this.source.cols; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cs, 0);
      ctx.lineTo(i * cs, this.canvas.height);
      ctx.stroke();
    }
  }

  private drawZoneBorders(): void {
    const cs = this.cellSize;
    const ctx = this.ctx;
    const zones = this.source.zones;

    ctx.strokeStyle = CONFIG.COLOR_ZONE_BORDER;
    ctx.lineWidth = 3;

    // Left border
    ctx.beginPath();
    ctx.moveTo(zones.leftEnd * cs, 0);
    ctx.lineTo(zones.leftEnd * cs, this.canvas.height);
    ctx.stroke();

    // Right border
    ctx.beginPath();
    ctx.moveTo(zones.rightStart * cs, 0);
    ctx.lineTo(zones.rightStart * cs, this.canvas.height);
    ctx.stroke();

    ctx.lineWidth = 1;
  }

  // Draw a ghost preview of a pattern over the current grid.
  // Green = valid placement, red = invalid (wrong zone).
  drawPlacementPreview(
    pattern: Pattern,
    startRow: number,
    startCol: number,
    player: Player,
    valid: boolean,
  ): void {
    this.drawGrid();
    const cs = this.cellSize;
    this.ctx.fillStyle = valid
      ? "rgba(0, 255, 0, 0.4)"
      : "rgba(255, 0, 0, 0.4)";
    for (const [rowOffset, colOffset] of pattern.cells) {
      const row = startRow + rowOffset;
      const col = startCol + colOffset;
      if (
        row >= 0 &&
        row < this.source.rows &&
        col >= 0 &&
        col < this.source.cols
      ) {
        this.ctx.fillRect(col * cs, row * cs, cs - 1, cs - 1);
      }
    }
  }
}
