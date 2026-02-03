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

    // Draw endzone backgrounds
    this.ctx.fillStyle = "#1a1a1a"; // Dark gray for endzones

    // Left endzone (Player 2 scores here)
    this.ctx.fillRect(
      0,
      0,
      this.game.zones.endzoneLeftEnd * this.cellSize,
      this.canvas.height,
    );

    // Right endzone (Player 1 scores here)
    this.ctx.fillRect(
      this.game.zones.endzoneRightStart * this.cellSize,
      0,
      this.game.zones.endzoneWidth * this.cellSize,
      this.canvas.height,
    );

    // Draw zone backgrounds
    // Left zone (Player 1) - Blueish
    this.ctx.fillStyle = "#001a33";
    this.ctx.fillRect(
      this.game.zones.endzoneLeftEnd * this.cellSize, // starts after endzone
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

    // Right zone (Player 2) - Reddish
    this.ctx.fillStyle = "#330000";
    this.ctx.fillRect(
      this.game.zones.rightStart * this.cellSize,
      0,
      (this.game.zones.endzoneRightStart - this.game.zones.rightStart) *
        this.cellSize, // ends before endzone
      this.canvas.height,
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
  private cellSize: number;
  private rows: number;
  private cols: number;

  constructor(canvas: HTMLCanvasElement, cellSize: number) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.cellSize = cellSize;
    this.rows = canvas.height / cellSize;
    this.cols = canvas.width / cellSize;
  }

  drawPreview(pattern: Pattern | null, player: Player): void {
    // Clear preview
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw grid lines
    this.ctx.strokeStyle = "#222";
    for (let i = 0; i <= this.rows; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, i * this.cellSize);
      this.ctx.lineTo(this.canvas.width, i * this.cellSize);
      this.ctx.stroke();
    }
    for (let i = 0; i <= this.cols; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(i * this.cellSize, 0);
      this.ctx.lineTo(i * this.cellSize, this.canvas.height);
      this.ctx.stroke();
    }

    if (!pattern) {
      return;
    }

    // Wende Spieler-spezifische Transformation an
    const playerPattern = getPatternForPlayer(pattern, player);

    // Calculate pattern bounds for centering
    const rows = playerPattern.cells.map(([r]) => r);
    const cols = playerPattern.cells.map(([, c]) => c);
    const patternHeight = Math.max(...rows) - Math.min(...rows) + 1;
    const patternWidth = Math.max(...cols) - Math.min(...cols) + 1;

    // Center the pattern
    const offsetRow =
      Math.floor((this.rows - patternHeight) / 2) - Math.min(...rows);
    const offsetCol =
      Math.floor((this.cols - patternWidth) / 2) - Math.min(...cols);

    // Draw pattern cells - IMMER GRÜN
    this.ctx.fillStyle = "#00ff00";
    for (const [row, col] of playerPattern.cells) {
      const drawRow = row + offsetRow;
      const drawCol = col + offsetCol;
      this.ctx.fillRect(
        drawCol * this.cellSize,
        drawRow * this.cellSize,
        this.cellSize - 1,
        this.cellSize - 1,
      );
    }
  }
}
