// Canvas rendering logic

import type { Pattern, Player, ZoneRect } from "./types.js";
import { Game } from "./game.js";
import { getPatternForPlayer } from "./patternUtils.js";
import { CONFIG } from "./config.js";

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private cellSize: number;
  private game: Game;

  // Cached zone rectangles (computed once)
  private zoneRects: ZoneRect[];

  constructor(canvas: HTMLCanvasElement, cellSize: number, game: Game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.cellSize = cellSize;
    this.game = game;
    this.zoneRects = game.zones.getRenderRects();
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
    for (let row = 0; row < this.game.rows; row++) {
      for (let col = 0; col < this.game.cols; col++) {
        if (this.game.grid[row]![col]) {
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

    for (let i = 0; i <= this.game.rows; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * cs);
      ctx.lineTo(this.canvas.width, i * cs);
      ctx.stroke();
    }
    for (let i = 0; i <= this.game.cols; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cs, 0);
      ctx.lineTo(i * cs, this.canvas.height);
      ctx.stroke();
    }
  }

  private drawZoneBorders(): void {
    const cs = this.cellSize;
    const ctx = this.ctx;
    const zones = this.game.zones;

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

  flashInvalidPlacement(col: number, row: number): void {
    this.ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
    this.ctx.fillRect(
      col * this.cellSize,
      row * this.cellSize,
      this.cellSize * 3,
      this.cellSize * 3,
    );
    setTimeout(() => this.drawGrid(), 100);
  }
}

export class PreviewRenderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private baseGrid: boolean[][] | null = null;
  private currentGrid: boolean[][] | null = null;
  private gridSize: number = 0;
  private cellSize: number = 0;
  private isPlaying: boolean = false;
  private animationIntervalId: number | null = null;
  private currentGeneration: number = 0;
  private maxGenerations: number = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

  drawPreview(pattern: Pattern | null, player: Player): void {
    this.stopAnimation();
    this.currentGeneration = 0;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (!pattern) {
      this.baseGrid = null;
      this.currentGrid = null;
      this.drawEmptyGrid();
      return;
    }

    this.gridSize = pattern.previewGridSize;
    this.maxGenerations = pattern.previewGenerations;

    const playerPattern = getPatternForPlayer(pattern, player);

    // Calculate bounds for centering
    const rows = playerPattern.cells.map(([r]) => r);
    const cols = playerPattern.cells.map(([, c]) => c);
    const minRow = Math.min(...rows);
    const maxRow = Math.max(...rows);
    const minCol = Math.min(...cols);
    const maxCol = Math.max(...cols);

    const patternHeight = maxRow - minRow + 1;
    const patternWidth = maxCol - minCol + 1;

    this.cellSize = this.canvas.width / this.gridSize;

    // Create base grid and center pattern
    this.baseGrid = this.createGrid(this.gridSize);
    const offsetRow = Math.floor((this.gridSize - patternHeight) / 2) - minRow;
    const offsetCol = Math.floor((this.gridSize - patternWidth) / 2) - minCol;

    for (const [row, col] of playerPattern.cells) {
      const r = row + offsetRow;
      const c = col + offsetCol;
      if (r >= 0 && r < this.gridSize && c >= 0 && c < this.gridSize) {
        this.baseGrid[r]![c] = true;
      }
    }

    this.currentGrid = this.baseGrid.map((row) => [...row]);
    this.drawGrid();
  }

  private createGrid(size: number): boolean[][] {
    return Array(size)
      .fill(null)
      .map(() => Array(size).fill(false));
  }

  private drawEmptyGrid(): void {
    const cellSize = 10;
    const size = Math.floor(
      Math.min(this.canvas.width, this.canvas.height) / cellSize,
    );

    this.ctx.strokeStyle = CONFIG.COLOR_GRID_LINE;
    for (let i = 0; i <= size; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, i * cellSize);
      this.ctx.lineTo(size * cellSize, i * cellSize);
      this.ctx.stroke();

      this.ctx.beginPath();
      this.ctx.moveTo(i * cellSize, 0);
      this.ctx.lineTo(i * cellSize, size * cellSize);
      this.ctx.stroke();
    }
  }

  private drawGrid(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Grid lines
    this.ctx.strokeStyle = CONFIG.COLOR_GRID_LINE;
    for (let i = 0; i <= this.gridSize; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, i * this.cellSize);
      this.ctx.lineTo(this.gridSize * this.cellSize, i * this.cellSize);
      this.ctx.stroke();

      this.ctx.beginPath();
      this.ctx.moveTo(i * this.cellSize, 0);
      this.ctx.lineTo(i * this.cellSize, this.gridSize * this.cellSize);
      this.ctx.stroke();
    }

    // Cells
    if (this.currentGrid) {
      this.ctx.fillStyle = CONFIG.COLOR_CELL;
      for (let row = 0; row < this.gridSize; row++) {
        for (let col = 0; col < this.gridSize; col++) {
          if (this.currentGrid[row]?.[col]) {
            this.ctx.fillRect(
              col * this.cellSize,
              row * this.cellSize,
              this.cellSize - 1,
              this.cellSize - 1,
            );
          }
        }
      }
    }
  }

  private computeNextGeneration(): void {
    if (!this.currentGrid) return;

    const newGrid = this.createGrid(this.gridSize);
    for (let row = 0; row < this.gridSize; row++) {
      for (let col = 0; col < this.gridSize; col++) {
        const neighbors = this.countNeighborsWrapping(row, col);
        const isAlive = this.currentGrid[row]![col];

        if (isAlive && (neighbors === 2 || neighbors === 3)) {
          newGrid[row]![col] = true;
        } else if (!isAlive && neighbors === 3) {
          newGrid[row]![col] = true;
        }
      }
    }
    this.currentGrid = newGrid;
  }

  private countNeighborsWrapping(row: number, col: number): number {
    let count = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = (row + dr + this.gridSize) % this.gridSize;
        const c = (col + dc + this.gridSize) % this.gridSize;
        if (this.currentGrid![r]![c]) count++;
      }
    }
    return count;
  }

  play(): void {
    if (this.isPlaying || !this.currentGrid) return;
    this.isPlaying = true;

    this.animationIntervalId = window.setInterval(() => {
      this.currentGeneration++;
      if (this.currentGeneration >= this.maxGenerations) {
        this.currentGeneration = 0;
        this.currentGrid = this.baseGrid!.map((row) => [...row]);
      } else {
        this.computeNextGeneration();
      }
      this.drawGrid();
    }, 80);
  }

  pause(): void {
    this.isPlaying = false;
    if (this.animationIntervalId !== null) {
      clearInterval(this.animationIntervalId);
      this.animationIntervalId = null;
    }
  }

  stopAnimation(): void {
    this.pause();
  }

  togglePlayPause(): boolean {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
    return this.isPlaying;
  }
}
