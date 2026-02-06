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

  private selectedPattern1: Pattern | null = null;
  private selectedPattern2: Pattern | null = null;
  private currentRotation: number = 0;
  private animationId: number | null = null;

  // Turn-based system
  private activePlayer: Player = 1;
  private player1Ready: boolean = false;
  private player2Ready: boolean = false;

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

    // Initialize UI
    this.updateBudgetDisplay();
    this.updateGenerationDisplay();
    this.updateActivePlayerUI();
  }

  private setupEventListeners(): void {
    this.setupCanvasClick();
    this.setupCanvasHover();
    this.setupControlButtons();
    this.setupPatternButtons();
    this.setupRotationButtons();
    this.setupReadyButtons();
    this.setupRestartButton();
  }

  private setupCanvasClick(): void {
    const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
    canvas.addEventListener("click", (e) => {
      // Only allow placement if game is not running and it's the player's turn
      if (this.game.isRunning) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const col = Math.floor(x / this.cellSize);
      const row = Math.floor(y / this.cellSize);

      const selectedPattern =
        this.activePlayer === 1 ? this.selectedPattern1 : this.selectedPattern2;

      if (selectedPattern) {
        // Place rotated and player-specific pattern
        const playerPattern = getPatternForPlayer(
          selectedPattern,
          this.activePlayer,
        );
        const rotated = rotatePattern(playerPattern, this.currentRotation);
        const success = this.game.placePattern(
          row,
          col,
          rotated,
          this.activePlayer,
        );

        if (success) {
          this.updateBudgetDisplay();
          this.switchTurn();
        } else {
          this.renderer.flashInvalidPlacement(col, row);
        }
      } else {
        // Toggle single cell (with zone validation)
        const success = this.game.toggleCell(row, col, this.activePlayer);
        if (!success) {
          this.renderer.flashInvalidPlacement(col, row);
        }
      }
      this.renderer.drawGrid();
    });
  }

  private setupCanvasHover(): void {
    const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;

    canvas.addEventListener("mousemove", (e) => {
      if (this.game.isRunning) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const col = Math.floor(x / this.cellSize);
      const row = Math.floor(y / this.cellSize);

      this.drawHoverPreview(row, col);
    });

    canvas.addEventListener("mouseleave", () => {
      // Redraw without preview when mouse leaves
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

  private setupPatternButtons(): void {
    const player1Btn = document.getElementById("player1Btn")!;
    const player2Btn = document.getElementById("player2Btn")!;

    // Pattern selection handlers für Spieler 1
    document.querySelectorAll(".player1-pattern").forEach((btn) => {
      btn.addEventListener("click", () => {
        player1Btn.style.fontWeight = "bold";
        player1Btn.style.opacity = "1";
        player2Btn.style.fontWeight = "normal";
        player2Btn.style.opacity = "0.6";

        const patternIndex = parseInt(btn.getAttribute("data-pattern")!);
        if (this.selectedPattern1 === PATTERNS[patternIndex]) {
          this.selectedPattern1 = null;
          this.currentRotation = 0;
        } else {
          this.selectedPattern1 = PATTERNS[patternIndex]!;
          this.currentRotation = 0;
        }
        this.previewRenderer1.drawPreview(this.selectedPattern1, 1);
        this.updatePatternInfo(1, this.selectedPattern1);
      });
    });

    // Pattern selection handlers für Spieler 2
    document.querySelectorAll(".player2-pattern").forEach((btn) => {
      btn.addEventListener("click", () => {
        player2Btn.style.opacity = "1";
        player1Btn.style.fontWeight = "normal";
        player1Btn.style.opacity = "0.6";

        const patternIndex = parseInt(btn.getAttribute("data-pattern")!);
        if (this.selectedPattern2 === PATTERNS[patternIndex]) {
          this.selectedPattern2 = null;
          this.currentRotation = 0;
        } else {
          this.selectedPattern2 = PATTERNS[patternIndex]!;
          this.currentRotation = 0;
        }
        this.previewRenderer2.drawPreview(this.selectedPattern2, 2);
        this.updatePatternInfo(2, this.selectedPattern2);
      });
    });
  }

  private setupRotationButtons(): void {
    // Rotation button handlers für Spieler 1
    document.getElementById("rotateLeft1")!.addEventListener("click", () => {
      if (!this.selectedPattern1 || this.activePlayer !== 1) return;
      this.currentRotation = (this.currentRotation - 90 + 360) % 360;
      const playerPattern = getPatternForPlayer(this.selectedPattern1, 1);
      const rotated = rotatePattern(playerPattern, this.currentRotation);
      this.previewRenderer1.drawPreview(rotated, 1);
    });

    document.getElementById("rotateRight1")!.addEventListener("click", () => {
      if (!this.selectedPattern1 || this.activePlayer !== 1) return;
      this.currentRotation = (this.currentRotation + 90) % 360;
      const playerPattern = getPatternForPlayer(this.selectedPattern1, 1);
      const rotated = rotatePattern(playerPattern, this.currentRotation);
      this.previewRenderer1.drawPreview(rotated, 1);
    });

    // Rotation button handlers für Spieler 2
    document.getElementById("rotateLeft2")!.addEventListener("click", () => {
      if (!this.selectedPattern2 || this.activePlayer !== 2) return;
      this.currentRotation = (this.currentRotation - 90 + 360) % 360;
      const playerPattern = getPatternForPlayer(this.selectedPattern2, 2);
      const rotated = rotatePattern(playerPattern, this.currentRotation);
      this.previewRenderer2.drawPreview(rotated, 2);
    });

    document.getElementById("rotateRight2")!.addEventListener("click", () => {
      if (!this.selectedPattern2 || this.activePlayer !== 2) return;
      this.currentRotation = (this.currentRotation + 90) % 360;
      const playerPattern = getPatternForPlayer(this.selectedPattern2, 2);
      const rotated = rotatePattern(playerPattern, this.currentRotation);
      this.previewRenderer2.drawPreview(rotated, 2);
    });
  }

  private setupReadyButtons(): void {
    document.getElementById("ready1Btn")!.addEventListener("click", () => {
      if (this.game.isRunning) return;

      this.player1Ready = true;
      const btn = document.getElementById("ready1Btn")! as HTMLButtonElement;
      btn.disabled = true;
      document.getElementById("ready1Btn")!.style.opacity = "0.5";

      this.switchTurn();
    });

    document.getElementById("ready2Btn")!.addEventListener("click", () => {
      if (this.game.isRunning) return;

      this.player2Ready = true;
      const btn = document.getElementById("ready2Btn")! as HTMLButtonElement;
      btn.disabled = true;
      document.getElementById("ready2Btn")!.style.opacity = "0.5";

      this.switchTurn();
    });
  }

  private setupRestartButton(): void {
    document.getElementById("restartBtn")!.addEventListener("click", () => {
      // Hide winner overlay
      document.getElementById("winnerOverlay")!.style.display = "none";

      // Reset game
      this.game.reset();
      this.renderer.drawGrid();

      // Reset UI state
      this.activePlayer = 1;
      this.player1Ready = false;
      this.player2Ready = false;
      this.selectedPattern1 = null;
      this.selectedPattern2 = null;

      // Re-enable controls
      this.enablePlayerControls(1);
      this.updateActivePlayerUI();

      // Update displays
      this.updateScoreDisplay();
      this.updateBudgetDisplay();
      this.updateGenerationDisplay();

      // Re-enable ready buttons
      const ready1 = document.getElementById("ready1Btn")! as HTMLButtonElement;
      const ready2 = document.getElementById("ready2Btn")! as HTMLButtonElement;
      ready1.disabled = false;
      ready1.style.opacity = "1";
      ready2.disabled = false;
      ready2.style.opacity = "1";

      // Clear previews
      this.previewRenderer1.drawPreview(null, 1);
      this.previewRenderer2.drawPreview(null, 2);

      // Clear pattern info
      this.updatePatternInfo(1, null);
      this.updatePatternInfo(2, null);
    });
  }

  private animate = (): void => {
    if (!this.game.isRunning) return;

    this.game.computeNextGeneration();
    this.renderer.drawGrid();

    // Update score display
    this.updateScoreDisplay();
    this.updateGenerationDisplay();

    // Check if game ended
    if (!this.game.isRunning) {
      this.showWinner();
      return;
    }

    setTimeout(() => {
      this.animationId = requestAnimationFrame(this.animate);
    }, 100); // 100ms between generations = ~10 FPS
  };

  private updateScoreDisplay(): void {
    document.getElementById("score1")!.textContent =
      this.game.scorePlayer1.toString();
    document.getElementById("score2")!.textContent =
      this.game.scorePlayer2.toString();
  }

  private updateBudgetDisplay(): void {
    document.getElementById("budget1")!.textContent =
      this.game.budgetPlayer1.toString();
    document.getElementById("budget2")!.textContent =
      this.game.budgetPlayer2.toString();
  }

  private updateGenerationDisplay(): void {
    document.getElementById("generationCounter")!.textContent =
      this.game.currentGeneration.toString();
    document.getElementById("maxGenerations")!.textContent =
      this.game.maxGenerations.toString();
  }

  private drawHoverPreview(row: number, col: number): void {
    // Redraw grid first
    this.renderer.drawGrid();

    // Get selected pattern for active player
    const selectedPattern =
      this.activePlayer === 1 ? this.selectedPattern1 : this.selectedPattern2;

    if (!selectedPattern) return;

    // Apply player-specific transformation and rotation
    const playerPattern = getPatternForPlayer(
      selectedPattern,
      this.activePlayer,
    );
    const rotated = rotatePattern(playerPattern, this.currentRotation);

    // Check if placement is valid
    const isValid = this.game.zones.isValidPlacement(col, this.activePlayer);

    // Draw preview with transparency
    const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = isValid ? "rgba(0, 255, 0, 0.3)" : "rgba(255, 0, 0, 0.3)"; // Green if valid, red if not

    for (const [rowOffset, colOffset] of rotated.cells) {
      const previewRow = row + rowOffset;
      const previewCol = col + colOffset;

      if (
        previewRow >= 0 &&
        previewRow < this.game.rows &&
        previewCol >= 0 &&
        previewCol < this.game.cols
      ) {
        ctx.fillRect(
          previewCol * this.cellSize,
          previewRow * this.cellSize,
          this.cellSize - 1,
          this.cellSize - 1,
        );
      }
    }
  }

  private updatePatternInfo(player: Player, pattern: Pattern | null): void {
    const nameElement = document.getElementById(
      player === 1 ? "patternName1" : "patternName2",
    )!;
    const costElement = document.getElementById(
      player === 1 ? "patternCost1" : "patternCost2",
    )!;

    if (pattern) {
      nameElement.textContent = pattern.name;
      costElement.textContent = `Cost: ${pattern.cells.length}`;
    } else {
      nameElement.textContent = "-";
      costElement.textContent = "Cost: -";
    }
  }

  private showWinner(): void {
    const result = this.game.getWinner();
    const overlay = document.getElementById("winnerOverlay")!;
    const title = document.getElementById("winnerTitle")!;
    const score = document.getElementById("winnerScore")!;

    if (result.winner === 1) {
      title.textContent = "Player 1 Wins!";
      title.style.color = "#44dddd";
    } else if (result.winner === 2) {
      title.textContent = "Player 2 Wins!";
      title.style.color = "#dd44dd";
    } else {
      title.textContent = "It's a Tie!";
      title.style.color = "#ffaa00";
    }

    score.textContent = `Score: ${result.player1Score} - ${result.player2Score}`;
    overlay.style.display = "flex";
  }

  private switchTurn(): void {
    // Switch to other player
    if (this.activePlayer === 1) {
      // Check if Player 2 has budget left
      if (this.game.budgetPlayer2 > 0 && !this.player2Ready) {
        this.activePlayer = 2;
      }
    } else {
      // Check if Player 1 has budget left
      if (this.game.budgetPlayer1 > 0 && !this.player1Ready) {
        this.activePlayer = 1;
      }
    }

    this.updateActivePlayerUI();
    this.checkGameStart();
  }

  private updateActivePlayerUI(): void {
    const player1Btn = document.getElementById("player1Btn")!;
    const player2Btn = document.getElementById("player2Btn")!;

    if (this.activePlayer === 1) {
      // Player 1 is active
      player1Btn.style.opacity = "1";
      player1Btn.style.boxShadow = "0 0 15px #44dddd";
      player2Btn.style.opacity = "0.5";
      player2Btn.style.boxShadow = "none";

      this.enablePlayerControls(1);
      this.disablePlayerControls(2);
    } else {
      // Player 2 is active
      player1Btn.style.opacity = "0.5";
      player1Btn.style.boxShadow = "none";
      player2Btn.style.opacity = "1";
      player2Btn.style.boxShadow = "0 0 15px #dd44dd";

      this.enablePlayerControls(2);
      this.disablePlayerControls(1);
    }
  }

  private enablePlayerControls(player: Player): void {
    const patterns =
      player === 1
        ? document.querySelectorAll(".player1-pattern")
        : document.querySelectorAll(".player2-pattern");
    const rotateLeft = document.getElementById(
      player === 1 ? "rotateLeft1" : "rotateLeft2",
    )! as HTMLButtonElement;
    const rotateRight = document.getElementById(
      player === 1 ? "rotateRight1" : "rotateRight2",
    )! as HTMLButtonElement;

    patterns.forEach((btn) => {
      (btn as HTMLButtonElement).disabled = false;
      (btn as HTMLButtonElement).style.opacity = "1";
    });
    rotateLeft.disabled = false;
    rotateRight.disabled = false;

    // Enable ready button if not already clicked
    const readyBtn = document.getElementById(
      player === 1 ? "ready1Btn" : "ready2Btn",
    )! as HTMLButtonElement;
    const isReady = player === 1 ? this.player1Ready : this.player2Ready;

    if (!isReady) {
      readyBtn.disabled = false;
      readyBtn.style.opacity = "1";
    }
  }

  private disablePlayerControls(player: Player): void {
    const patterns =
      player === 1
        ? document.querySelectorAll(".player1-pattern")
        : document.querySelectorAll(".player2-pattern");
    const rotateLeft = document.getElementById(
      player === 1 ? "rotateLeft1" : "rotateLeft2",
    )! as HTMLButtonElement;
    const rotateRight = document.getElementById(
      player === 1 ? "rotateRight1" : "rotateRight2",
    )! as HTMLButtonElement;

    patterns.forEach((btn) => {
      (btn as HTMLButtonElement).disabled = true;
      (btn as HTMLButtonElement).style.opacity = "0.3";
    });
    rotateLeft.disabled = true;
    rotateRight.disabled = true;

    // Disable player button (NEU)
    const playerBtn = document.getElementById(
      player === 1 ? "player1Btn" : "player2Btn",
    )! as HTMLButtonElement;
    playerBtn.disabled = true;

    // Disable ready button (NEU)
    const readyBtn = document.getElementById(
      player === 1 ? "ready1Btn" : "ready2Btn",
    )! as HTMLButtonElement;
    readyBtn.disabled = true;
  }

  private checkGameStart(): void {
    // Start game if both players are ready or out of budget
    const p1Done = this.player1Ready || this.game.budgetPlayer1 === 0;
    const p2Done = this.player2Ready || this.game.budgetPlayer2 === 0;

    if (p1Done && p2Done) {
      this.game.isRunning = true;
      this.animate();
      this.disablePlayerControls(1);
      this.disablePlayerControls(2);

      // Remove player button glow (NEU)
      document.getElementById("player1Btn")!.style.boxShadow = "none";
      document.getElementById("player2Btn")!.style.boxShadow = "none";
      document.getElementById("player1Btn")!.style.opacity = "0.5";
      document.getElementById("player2Btn")!.style.opacity = "0.5";
    }
  }
}
