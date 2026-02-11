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