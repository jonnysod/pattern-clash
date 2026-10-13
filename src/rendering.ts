// Canvas rendering logic

import type { Player, ZoneRect } from "./types.js";
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

  // `grid` overrides the source's live grid — used to show a rewound frame
  // (see frameHistory.ts) without touching the engine.
  drawGrid(grid: boolean[][] = this.source.grid): void {
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
        if (grid[row]![col]) {
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
  // `cells` are offsets from (startRow, startCol). `flying` is the current
  // frame of the hover ghost in absolute cells, drawn fainter and
  // underneath, so the preview of where the piece goes stays readable.
  //
  // In the placer's colour, like the highlight a placed piece gets — so a
  // move reads as one colour from preview to placement until it fades to
  // the uniform green of live cells. Invalid is grey: "not here" rather
  // than an error, and it can't be mistaken for either player's colour
  // (red sat too close to P2's magenta).
  drawPlacementPreview(
    cells: [number, number][],
    startRow: number,
    startCol: number,
    player: Player,
    valid: boolean,
    flying: [number, number][] = [],
  ): void {
    this.drawGrid();
    const color = player === 1 ? CONFIG.COLOR_PLAYER1 : CONFIG.COLOR_PLAYER2;
    this.ctx.save();
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = 0.35;
    this.forEachPreviewCell(flying, 0, 0, (x, y, size) =>
      this.ctx.fillRect(x, y, size, size),
    );
    if (valid) {
      this.ctx.globalAlpha = 0.8;
      this.forEachPreviewCell(cells, startRow, startCol, (x, y, size) =>
        this.ctx.fillRect(x, y, size, size),
      );
    } else {
      this.ctx.fillStyle = "#999999";
      this.ctx.globalAlpha = 0.45;
      this.forEachPreviewCell(cells, startRow, startCol, (x, y, size) =>
        this.ctx.fillRect(x, y, size, size),
      );
    }
    this.ctx.restore();
  }

  // Calls `draw` with the pixel box of every on-grid cell.
  private forEachPreviewCell(
    cells: [number, number][],
    startRow: number,
    startCol: number,
    draw: (x: number, y: number, size: number) => void,
  ): void {
    const cs = this.cellSize;
    for (const [rowOffset, colOffset] of cells) {
      const row = startRow + rowOffset;
      const col = startCol + colOffset;
      if (
        row >= 0 &&
        row < this.source.rows &&
        col >= 0 &&
        col < this.source.cols
      ) {
        draw(col * cs, row * cs, cs - 1);
      }
    }
  }
}
