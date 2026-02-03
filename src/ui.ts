// UI event handlers and interactions

import type { Pattern, Player } from "./types.js";
import { Game } from "./game.js";
import { Renderer, PreviewRenderer } from "./rendering.js";
import { PATTERNS } from "./patterns.js";
import { rotatePattern, getPatternForPlayer } from "./patternUtils.js";

export class UIController {
  private game: Game;
  private renderer: Renderer;
  private previewRenderer1: PreviewRenderer;
  private previewRenderer2: PreviewRenderer;
  private cellSize: number;

  private currentPlayer: Player = 1;
  private selectedPattern: Pattern | null = null;
  private currentRotation: number = 0;
  private animationId: number | null = null;

  constructor(
    game: Game,
    renderer: Renderer,
    previewRenderer1: PreviewRenderer,
    previewRenderer2: PreviewRenderer,
    cellSize: number,
  ) {
    this.game = game;
    this.renderer = renderer;
    this.previewRenderer1 = previewRenderer1;
    this.previewRenderer2 = previewRenderer2;
    this.cellSize = cellSize;

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.setupCanvasClick();
    this.setupControlButtons();
    this.setupPlayerButtons();
    this.setupPatternButtons();
    this.setupRotationButtons();
  }

  private setupCanvasClick(): void {
    const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
    canvas.addEventListener("click", (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const col = Math.floor(x / this.cellSize);
      const row = Math.floor(y / this.cellSize);

      if (this.selectedPattern) {
        // Place rotated and player-specific pattern
        const playerPattern = getPatternForPlayer(
          this.selectedPattern,
          this.currentPlayer,
        );
        const rotated = rotatePattern(playerPattern, this.currentRotation);
        const success = this.game.placePattern(
          row,
          col,
          rotated,
          this.currentPlayer,
        );

        if (!success) {
          this.renderer.flashInvalidPlacement(col, row);
        }
      } else {
        // Toggle single cell (with zone validation)
        const success = this.game.toggleCell(row, col, this.currentPlayer);
        if (!success) {
          this.renderer.flashInvalidPlacement(col, row);
        }
      }
      this.renderer.drawGrid();
    });
  }

  private setupControlButtons(): void {
    document.getElementById("startBtn")!.addEventListener("click", () => {
      this.game.isRunning = true;
      this.animate();
    });

    document.getElementById("pauseBtn")!.addEventListener("click", () => {
      this.game.isRunning = false;
      if (this.animationId !== null) {
        cancelAnimationFrame(this.animationId);
      }
    });

    document.getElementById("resetBtn")!.addEventListener("click", () => {
      this.game.isRunning = false;
      if (this.animationId !== null) {
        cancelAnimationFrame(this.animationId);
      }
      this.game.reset();
      this.renderer.drawGrid();
    });
  }

  private setupPlayerButtons(): void {
    const player1Btn = document.getElementById("player1Btn")!;
    const player2Btn = document.getElementById("player2Btn")!;

    player1Btn.addEventListener("click", () => {
      this.currentPlayer = 1;
      player1Btn.style.fontWeight = "bold";
      player1Btn.style.opacity = "1";
      player2Btn.style.fontWeight = "normal";
      player2Btn.style.opacity = "0.6";
    });

    player2Btn.addEventListener("click", () => {
      this.currentPlayer = 2;
      player2Btn.style.fontWeight = "bold";
      player2Btn.style.opacity = "1";
      player1Btn.style.fontWeight = "normal";
      player1Btn.style.opacity = "0.6";
    });
  }

  private setupPatternButtons(): void {
    const player1Btn = document.getElementById("player1Btn")!;
    const player2Btn = document.getElementById("player2Btn")!;

    // Pattern selection handlers für Spieler 1
    document.querySelectorAll(".player1-pattern").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.currentPlayer = 1;
        player1Btn.style.fontWeight = "bold";
        player1Btn.style.opacity = "1";
        player2Btn.style.fontWeight = "normal";
        player2Btn.style.opacity = "0.6";

        const patternIndex = parseInt(btn.getAttribute("data-pattern")!);
        if (this.selectedPattern === PATTERNS[patternIndex]) {
          this.selectedPattern = null;
          this.currentRotation = 0;
        } else {
          this.selectedPattern = PATTERNS[patternIndex]!;
          this.currentRotation = 0;
        }
        this.previewRenderer1.drawPreview(this.selectedPattern, 1);
      });
    });

    // Pattern selection handlers für Spieler 2
    document.querySelectorAll(".player2-pattern").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.currentPlayer = 2;
        player2Btn.style.fontWeight = "bold";
        player2Btn.style.opacity = "1";
        player1Btn.style.fontWeight = "normal";
        player1Btn.style.opacity = "0.6";

        const patternIndex = parseInt(btn.getAttribute("data-pattern")!);
        if (this.selectedPattern === PATTERNS[patternIndex]) {
          this.selectedPattern = null;
          this.currentRotation = 0;
        } else {
          this.selectedPattern = PATTERNS[patternIndex]!;
          this.currentRotation = 0;
        }
        this.previewRenderer2.drawPreview(this.selectedPattern, 2);
      });
    });
  }

  private setupRotationButtons(): void {
    // Rotation button handlers für Spieler 1
    document.getElementById("rotateLeft1")!.addEventListener("click", () => {
      if (!this.selectedPattern || this.currentPlayer !== 1) return;
      this.currentRotation = (this.currentRotation - 90 + 360) % 360;
      const playerPattern = getPatternForPlayer(this.selectedPattern, 1);
      const rotated = rotatePattern(playerPattern, this.currentRotation);
      this.previewRenderer1.drawPreview(rotated, 1);
    });

    document.getElementById("rotateRight1")!.addEventListener("click", () => {
      if (!this.selectedPattern || this.currentPlayer !== 1) return;
      this.currentRotation = (this.currentRotation + 90) % 360;
      const playerPattern = getPatternForPlayer(this.selectedPattern, 1);
      const rotated = rotatePattern(playerPattern, this.currentRotation);
      this.previewRenderer1.drawPreview(rotated, 1);
    });

    // Rotation button handlers für Spieler 2
    document.getElementById("rotateLeft2")!.addEventListener("click", () => {
      if (!this.selectedPattern || this.currentPlayer !== 2) return;
      this.currentRotation = (this.currentRotation - 90 + 360) % 360;
      const playerPattern = getPatternForPlayer(this.selectedPattern, 2);
      const rotated = rotatePattern(playerPattern, this.currentRotation);
      this.previewRenderer2.drawPreview(rotated, 2);
    });

    document.getElementById("rotateRight2")!.addEventListener("click", () => {
      if (!this.selectedPattern || this.currentPlayer !== 2) return;
      this.currentRotation = (this.currentRotation + 90) % 360;
      const playerPattern = getPatternForPlayer(this.selectedPattern, 2);
      const rotated = rotatePattern(playerPattern, this.currentRotation);
      this.previewRenderer2.drawPreview(rotated, 2);
    });
  }

  private animate = (): void => {
    if (!this.game.isRunning) return;

    this.game.computeNextGeneration();
    this.renderer.drawGrid();

    setTimeout(() => {
      this.animationId = requestAnimationFrame(this.animate);
    }, 100); // 100ms between generations = ~10 FPS
  };
}
