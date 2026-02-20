// Canvas rendering logic

import type { Pattern, Player } from "./types.js";
import { Game } from "./game.js";
import { getPatternForPlayer } from "./patternUtils.js";

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private cellSize: number;
  private game: Game;

  constructor(canvas: HTMLCanvasElement, cellSize: number, game: Game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.cellSize = cellSize;
    this.game = game;
  }

  drawGrid(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw endzone backgrounds (full canvas)
    this.ctx.fillStyle = "#1a1a1a";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw zone backgrounds
    // Left zone (Player 1) - Dark cyan
    this.ctx.fillStyle = "#003333";
    this.ctx.fillRect(
      this.game.zones.endzoneLeftEnd * this.cellSize,
      0,
      (this.game.zones.leftEnd - this.game.zones.endzoneLeftEnd) *
        this.cellSize,
      this.canvas.height,
    );

    // Neutral zone - Black
    this.ctx.fillStyle = "#000000";
    this.ctx.fillRect(
      this.game.zones.leftEnd * this.cellSize,
      0,
      (this.game.zones.rightStart - this.game.zones.leftEnd) * this.cellSize,
      this.canvas.height,
    );

    // Right zone (Player 2) - Dark magenta
    this.ctx.fillStyle = "#330033";
    this.ctx.fillRect(
      this.game.zones.rightStart * this.cellSize,
      0,
      (this.game.zones.endzoneRightStart - this.game.zones.rightStart) *
        this.cellSize,
      this.canvas.height,
    );

    // Top/bottom L-shaped endzones - overlay cyan/magenta with gray
    this.ctx.fillStyle = "#1a1a1a";

    // Left side - top L endzone (from endzoneLeftEnd to scoreColumnTopLeft)
    this.ctx.fillRect(
      this.game.zones.endzoneLeftEnd * this.cellSize,
      0,
      (this.game.zones.scoreColumnTopLeft - this.game.zones.endzoneLeftEnd) *
        this.cellSize,
      this.game.zones.endzoneTopRows * this.cellSize,
    );
    // Left side - bottom L endzone
    this.ctx.fillRect(
      this.game.zones.endzoneLeftEnd * this.cellSize,
      this.game.zones.endzoneBottomStartRow * this.cellSize,
      (this.game.zones.scoreColumnBottomLeft - this.game.zones.endzoneLeftEnd) *
        this.cellSize,
      this.game.zones.endzoneTopRows * this.cellSize,
    );
    // Right side - top L endzone (from scoreColumnTopRight+1 to endzoneRightStart)
    this.ctx.fillRect(
      (this.game.zones.scoreColumnTopRight + 1) * this.cellSize,
      0,
      (this.game.zones.endzoneRightStart -
        this.game.zones.scoreColumnTopRight -
        1) *
        this.cellSize,
      this.game.zones.endzoneTopRows * this.cellSize,
    );
    // Right side - bottom L endzone
    this.ctx.fillRect(
      (this.game.zones.scoreColumnBottomRight + 1) * this.cellSize,
      this.game.zones.endzoneBottomStartRow * this.cellSize,
      (this.game.zones.endzoneRightStart -
        this.game.zones.scoreColumnBottomRight -
        1) *
        this.cellSize,
      this.game.zones.endzoneTopRows * this.cellSize,
    );

    // Score zones (gelb #443300) - Side columns and L-shapes

    this.ctx.fillStyle = "#443300";

    // Side score columns (between top and bottom endzones)
    this.ctx.fillRect(
      this.game.zones.scoreColumnLeft * this.cellSize,
      this.game.zones.endzoneTopRows * this.cellSize,
      this.cellSize,
      (this.game.zones.endzoneBottomStartRow -
        this.game.zones.endzoneTopRows) *
        this.cellSize,
    );
    this.ctx.fillRect(
      this.game.zones.scoreColumnRight * this.cellSize,
      this.game.zones.endzoneTopRows * this.cellSize,
      this.cellSize,
      (this.game.zones.endzoneBottomStartRow -
        this.game.zones.endzoneTopRows) *
        this.cellSize,
    );

    // Left top L: vertical part (col scoreColumnTopLeft, row 0 to scoreRowTop)
    this.ctx.fillRect(
      this.game.zones.scoreColumnTopLeft * this.cellSize,
      0,
      this.cellSize,
      this.game.zones.scoreRowTop * this.cellSize,
    );
    // Left top L: horizontal part (row scoreRowTop, col scoreColumnLeft to scoreColumnTopLeft)
    this.ctx.fillRect(
      this.game.zones.scoreColumnLeft * this.cellSize,
      this.game.zones.scoreRowTop * this.cellSize,
      (this.game.zones.scoreColumnTopLeft -
        this.game.zones.scoreColumnLeft +
        1) *
        this.cellSize,
      this.cellSize,
    );

    // Left bottom L: horizontal part (row scoreRowBottom)
    this.ctx.fillRect(
      this.game.zones.scoreColumnLeft * this.cellSize,
      this.game.zones.scoreRowBottom * this.cellSize,
      (this.game.zones.scoreColumnBottomLeft -
        this.game.zones.scoreColumnLeft +
        1) *
        this.cellSize,
      this.cellSize,
    );
    // Left bottom L: vertical part (col scoreColumnBottomLeft, scoreRowBottom+1 to end)
    this.ctx.fillRect(
      this.game.zones.scoreColumnBottomLeft * this.cellSize,
      (this.game.zones.scoreRowBottom + 1) * this.cellSize,
      this.cellSize,
      (this.game.rows - this.game.zones.scoreRowBottom - 1) * this.cellSize,
    );

    // Right top L: vertical part (col scoreColumnTopRight, row 0 to scoreRowTop)
    this.ctx.fillRect(
      this.game.zones.scoreColumnTopRight * this.cellSize,
      0,
      this.cellSize,
      this.game.zones.scoreRowTop * this.cellSize,
    );
    // Right top L: horizontal part (row scoreRowTop, col scoreColumnTopRight to scoreColumnRight)
    this.ctx.fillRect(
      this.game.zones.scoreColumnTopRight * this.cellSize,
      this.game.zones.scoreRowTop * this.cellSize,
      (this.game.zones.scoreColumnRight -
        this.game.zones.scoreColumnTopRight +
        1) *
        this.cellSize,
      this.cellSize,
    );

    // Right bottom L: horizontal part (row scoreRowBottom)
    this.ctx.fillRect(
      this.game.zones.scoreColumnBottomRight * this.cellSize,
      this.game.zones.scoreRowBottom * this.cellSize,
      (this.game.zones.scoreColumnRight -
        this.game.zones.scoreColumnBottomRight +
        1) *
        this.cellSize,
      this.cellSize,
    );
    // Right bottom L: vertical part (col scoreColumnBottomRight, scoreRowBottom+1 to end)
    this.ctx.fillRect(
      this.game.zones.scoreColumnBottomRight * this.cellSize,
      (this.game.zones.scoreRowBottom + 1) * this.cellSize,
      this.cellSize,
      (this.game.rows - this.game.zones.scoreRowBottom - 1) * this.cellSize,
    );

    // Draw living cells (all green)
    for (let row = 0; row < this.game.rows; row++) {
      for (let col = 0; col < this.game.cols; col++) {
        if (this.game.grid[row]![col]) {
          this.ctx.fillStyle = "#00ff00";
          this.ctx.fillRect(
            col * this.cellSize,
            row * this.cellSize,
            this.cellSize - 1,
            this.cellSize - 1,
          );
        }
      }
    }

    // Grid lines
    this.ctx.strokeStyle = "#222";
    for (let i = 0; i <= this.game.rows; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, i * this.cellSize);
      this.ctx.lineTo(this.canvas.width, i * this.cellSize);
      this.ctx.stroke();
    }
    for (let i = 0; i <= this.game.cols; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(i * this.cellSize, 0);
      this.ctx.lineTo(i * this.cellSize, this.canvas.height);
      this.ctx.stroke();
    }

    // Trennlinien zwischen Zonen (dicker und heller)
    this.ctx.strokeStyle = "#666";
    this.ctx.lineWidth = 3;

    // Linke Trennlinie
    this.ctx.beginPath();
    this.ctx.moveTo(this.game.zones.leftEnd * this.cellSize, 0);
    this.ctx.lineTo(
      this.game.zones.leftEnd * this.cellSize,
      this.canvas.height,
    );
    this.ctx.stroke();

    // Rechte Trennlinie
    this.ctx.beginPath();
    this.ctx.moveTo(this.game.zones.rightStart * this.cellSize, 0);
    this.ctx.lineTo(
      this.game.zones.rightStart * this.cellSize,
      this.canvas.height,
    );
    this.ctx.stroke();

    this.ctx.lineWidth = 1; // Reset line width
  }

  flashInvalidPlacement(col: number, row: number): void {
    // Kurzes rotes Flash als Feedback
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
    // Stop any running animation
    this.stopAnimation();
    this.currentGeneration = 0;

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (!pattern) {
      this.baseGrid = null;
      this.currentGrid = null;
      this.drawEmptyGrid();
      return;
    }

    // Use pattern-defined values
    this.gridSize = pattern.previewGridSize;
    this.maxGenerations = pattern.previewGenerations;

    // Apply player-specific transformation
    const playerPattern = getPatternForPlayer(pattern, player);

    // Calculate pattern bounds for centering
    const rows = playerPattern.cells.map(([r]) => r);
    const cols = playerPattern.cells.map(([, c]) => c);
    const minRow = Math.min(...rows);
    const maxRow = Math.max(...rows);
    const minCol = Math.min(...cols);
    const maxCol = Math.max(...cols);

    const patternHeight = maxRow - minRow + 1;
    const patternWidth = maxCol - minCol + 1;

    // Calculate cell size to fill canvas exactly
    this.cellSize = this.canvas.width / this.gridSize;

    // Create base grid
    this.baseGrid = Array(this.gridSize)
      .fill(null)
      .map(() => Array(this.gridSize).fill(false));

    // Center pattern in grid
    const offsetRow = Math.floor((this.gridSize - patternHeight) / 2) - minRow;
    const offsetCol = Math.floor((this.gridSize - patternWidth) / 2) - minCol;

    // Place pattern in grid
    for (const [row, col] of playerPattern.cells) {
      const gridRow = row + offsetRow;
      const gridCol = col + offsetCol;
      if (
        gridRow >= 0 &&
        gridRow < this.gridSize &&
        gridCol >= 0 &&
        gridCol < this.gridSize
      ) {
        this.baseGrid[gridRow]![gridCol] = true;
      }
    }

    // Copy to current grid
    this.currentGrid = this.baseGrid.map((row) => [...row]);

    // Draw initial state
    this.drawGrid();
  }

  private drawEmptyGrid(): void {
    const cellSize = 10;
    const size = Math.floor(
      Math.min(this.canvas.width, this.canvas.height) / cellSize,
    );

    this.ctx.strokeStyle = "#222";
    for (let i = 0; i <= size; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, i * cellSize);
      this.ctx.lineTo(size * cellSize, i * cellSize);
      this.ctx.stroke();
    }
    for (let i = 0; i <= size; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(i * cellSize, 0);
      this.ctx.lineTo(i * cellSize, size * cellSize);
      this.ctx.stroke();
    }
  }

  private drawGrid(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Fill canvas completely (no padding)
    const offsetX = 0;
    const offsetY = 0;

    // Draw grid lines
    this.ctx.strokeStyle = "#222";
    for (let i = 0; i <= this.gridSize; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(offsetX, offsetY + i * this.cellSize);
      this.ctx.lineTo(
        offsetX + this.gridSize * this.cellSize,
        offsetY + i * this.cellSize,
      );
      this.ctx.stroke();
    }
    for (let i = 0; i <= this.gridSize; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(offsetX + i * this.cellSize, offsetY);
      this.ctx.lineTo(
        offsetX + i * this.cellSize,
        offsetY + this.gridSize * this.cellSize,
      );
      this.ctx.stroke();
    }

    // Draw cells
    if (this.currentGrid) {
      this.ctx.fillStyle = "#00ff00";
      for (let row = 0; row < this.gridSize; row++) {
        for (let col = 0; col < this.gridSize; col++) {
          if (this.currentGrid[row]?.[col]) {
            this.ctx.fillRect(
              offsetX + col * this.cellSize,
              offsetY + row * this.cellSize,
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

    const newGrid: boolean[][] = Array(this.gridSize)
      .fill(null)
      .map(() => Array(this.gridSize).fill(false));

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

        // Wrapping with modulo
        const newRow = (row + dr + this.gridSize) % this.gridSize;
        const newCol = (col + dc + this.gridSize) % this.gridSize;

        if (this.currentGrid![newRow]![newCol]) {
          count++;
        }
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
        // Reset to base pattern
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
