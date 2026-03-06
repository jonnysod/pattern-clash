// UI Controller - orchestrates chess clock turns, simulation, and tactical phases

import type { Pattern, Player } from "./types.js";
import type { DOMRefs } from "./domRefs.js";
import { Game } from "./game.js";
import { Renderer, PreviewRenderer } from "./rendering.js";
import { PATTERNS } from "./patterns.js";
import { getPatternForPlayer } from "./patternUtils.js";
import { TurnManager } from "./turnManager.js";
import { ScoreEffects } from "./scoreEffects.js";
import { CONFIG } from "./config.js";

export class UIController {
  private game: Game;
  private dom: DOMRefs;
  private renderer: Renderer;
  private previewRenderer1: PreviewRenderer;
  private previewRenderer2: PreviewRenderer;
  private cellSize: number;

  private turns: TurnManager;
  private scoreEffects: ScoreEffects;

  private selectedPattern1: Pattern | null = null;
  private selectedPattern2: Pattern | null = null;
  private animationId: number | null = null;

  constructor(
    game: Game,
    dom: DOMRefs,
    renderer: Renderer,
    previewRenderer1: PreviewRenderer,
    previewRenderer2: PreviewRenderer,
    cellSize: number,
  ) {
    this.game = game;
    this.dom = dom;
    this.renderer = renderer;
    this.previewRenderer1 = previewRenderer1;
    this.previewRenderer2 = previewRenderer2;
    this.cellSize = cellSize;

    this.turns = new TurnManager(game, dom);
    this.scoreEffects = new ScoreEffects(dom.gameCanvas, cellSize);

    // Wire callbacks
    this.turns.onTurnSwitch = () => this.updateActivePlayerUI();
    this.turns.onPhaseEnd = () => this.onPlacementPhaseEnd();

    this.setupEventListeners();

    // Initialize displays
    this.updatePointsDisplay();
    this.updateGenerationDisplay();

    // Wait for start button
    this.disableAllControls();
    this.dom.startGameBtn.addEventListener("click", () => {
      this.dom.startOverlay.style.display = "none";
    this.startPlacementPhase();
    });
  }

  //#region Event Setup
  private setupEventListeners(): void {
    this.setupCanvasClick();
    this.setupCanvasHover();
    this.setupSurrenderButtons();
    this.setupPatternButtons();
    this.setupActionButtons();
    this.setupRestartButton();
    this.setupPreviewToggleButtons();
  }

  private setupCanvasClick(): void {
    this.dom.gameCanvas.addEventListener("click", (e) => {
      const phase = this.game.phase;

      // Only allow placement in placement or tactical phase
      if (phase !== "placement" && phase !== "tactical") return;

      const player = this.turns.activePlayer;

      // Only active player can place
      if (this.turns.isPlayerDone(player)) return;

      const rect = this.dom.gameCanvas.getBoundingClientRect();
      const col = Math.floor((e.clientX - rect.left) / this.cellSize);
      const row = Math.floor((e.clientY - rect.top) / this.cellSize);

      const pattern =
        player === 1 ? this.selectedPattern1 : this.selectedPattern2;
      if (!pattern) return;

      const playerPattern = getPatternForPlayer(pattern, player);

      // Validate using mouse position (symmetric for both players)
      if (!this.game.zones.isValidPlacement(col, player)) {
        this.renderer.flashInvalidPlacement(col, row);
        this.renderer.drawGrid();
        return;
      }

      // P2: offset so pattern is placed left of cursor
      let placementCol = col;
      if (player === 2) {
        const maxC = Math.max(...playerPattern.cells.map(([, c]) => c));
        placementCol = col - maxC;
      }

      const success = this.game.placePattern(
        row,
        placementCol,
        playerPattern,
        player,
        true,
      );

      if (success) {
        this.updatePointsDisplay();
        this.turns.notifyPlacement();
        this.updatePatternButtonStates();
      } else {
        this.renderer.flashInvalidPlacement(col, row);
      }

      this.renderer.drawGrid();
    });
  }

  private setupCanvasHover(): void {
    this.dom.gameCanvas.addEventListener("mousemove", (e) => {
      const phase = this.game.phase;
      if (phase !== "placement" && phase !== "tactical") return;

      const rect = this.dom.gameCanvas.getBoundingClientRect();
      const col = Math.floor((e.clientX - rect.left) / this.cellSize);
      const row = Math.floor((e.clientY - rect.top) / this.cellSize);

      this.drawHoverPreview(row, col);
    });

    this.dom.gameCanvas.addEventListener("mouseleave", () => {
      this.renderer.drawGrid();
    });
  }

  private setupSurrenderButtons(): void {
    this.dom.surrender1Btn.addEventListener("click", () => {
      if (confirm("Surrender? Your opponent wins!")) {
        this.game.surrender(1);
        this.turns.stopClock();
        this.stopAnimation();
        this.showWinner();
      }
    });

    this.dom.surrender2Btn.addEventListener("click", () => {
      if (confirm("Surrender? Your opponent wins!")) {
        this.game.surrender(2);
        this.turns.stopClock();
        this.stopAnimation();
        this.showWinner();
      }
    });
  }

  private setupPatternButtons(): void {
    for (const btn of this.dom.player1Patterns) {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-pattern")!);
        this.selectedPattern1 = PATTERNS[idx]!;
        this.previewRenderer1.drawPreview(this.selectedPattern1, 1);
        this.updatePatternInfo(1, this.selectedPattern1);
        this.dom.previewToggle1.textContent = "▶";
      });
    }

    for (const btn of this.dom.player2Patterns) {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-pattern")!);
        this.selectedPattern2 = PATTERNS[idx]!;
        this.previewRenderer2.drawPreview(this.selectedPattern2, 2);
        this.updatePatternInfo(2, this.selectedPattern2);
        this.dom.previewToggle2.textContent = "▶";
      });
    }
  }

  private setupActionButtons(): void {
    this.dom.ready1Btn.addEventListener("click", () => {
      if (this.turns.activePlayer === 1) {
        this.turns.onActionButton();
      }
    });

    this.dom.ready2Btn.addEventListener("click", () => {
      if (this.turns.activePlayer === 2) {
        this.turns.onActionButton();
      }
    });
  }

  private setupRestartButton(): void {
    this.dom.restartBtn.addEventListener("click", () => {
      this.resetGame();
    });

    this.dom.showBoardBtn.addEventListener("click", () => {
      this.dom.winnerOverlay.style.display = "none";
    });
  }

  private setupPreviewToggleButtons(): void {
    this.dom.previewToggle1.addEventListener("click", () => {
      const playing = this.previewRenderer1.togglePlayPause();
      this.dom.previewToggle1.textContent = playing ? "⏸" : "▶";
    });

    this.dom.previewToggle2.addEventListener("click", () => {
      const playing = this.previewRenderer2.togglePlayPause();
      this.dom.previewToggle2.textContent = playing ? "⏸" : "▶";
    });
  }
  //#endregion

  //#region Phase Management
  private startPlacementPhase(): void {
    this.turns.onPhaseEnd = () => this.onPlacementPhaseEnd();
    this.turns.startClock(CONFIG.CHESS_CLOCK_PLACEMENT_SEC);
    this.updateActivePlayerUI();
  }

  private onPlacementPhaseEnd(): void {
    this.game.setPhase("simulation");
    this.disableAllControls();
    this.dom.turnTimerContainer.style.visibility = "hidden";
    this.startSimulation();
  }

  private startSimulation(): void {
    this.animateSimulation();
  }

  private startTacticalPhase(): void {
    this.game.setPhase("tactical");

    this.turns.onPhaseEnd = () => this.onTacticalPhaseEnd();
    this.turns.startClock(CONFIG.CHESS_CLOCK_TACTICAL_SEC);
    this.updateActivePlayerUI();
  }

  private onTacticalPhaseEnd(): void {
    this.game.setPhase("simulation");
    this.disableAllControls();
    this.dom.turnTimerContainer.style.visibility = "hidden";
    this.startSimulation();
  }
  //#endregion

  //#region Animation
  private animateSimulation(): void {
    if (this.game.isEnded) {
      this.showWinner();
      return;
    }

    this.game.computeNextGeneration();
    this.renderer.drawGrid();
    this.updatePointsDisplay();
    this.updateGenerationDisplay();

    // Show floating score effects
    if (this.game.scoreEvents.length > 0) {
      this.scoreEffects.feed(this.game.scoreEvents);
    }

    if (this.game.isEnded) {
      this.showWinner();
      return;
    }

    // Check for tactical phase trigger
    if (this.game.shouldTriggerTactical()) {
      this.startTacticalPhase();
      // Start slow animation alongside placement
      this.animateTactical();
      return;
    }

    const delay = 1000 / CONFIG.FPS_FAST;
    this.animationId = window.setTimeout(() => {
      requestAnimationFrame(() => this.animateSimulation());
    }, delay);
  }

  private animateTactical(): void {
    if (this.game.isEnded) {
      this.turns.stopClock();
      this.showWinner();
      return;
    }

    // If phase switched back to simulation, hand off to fast animation
    if (this.game.isSimulation) {
      this.startSimulation();
      return;
    }

    this.game.computeNextGeneration();
    this.renderer.drawGrid();
    this.updatePointsDisplay();
    this.updateGenerationDisplay();

    // Show floating score effects
    if (this.game.scoreEvents.length > 0) {
      this.scoreEffects.feed(this.game.scoreEvents);
    }

    if (this.game.isEnded) {
      this.turns.stopClock();
      this.showWinner();
      return;
    }

    const delay = 1000 / CONFIG.FPS_SLOW;
    this.animationId = window.setTimeout(() => {
      requestAnimationFrame(() => this.animateTactical());
    }, delay);
  }

  private stopAnimation(): void {
    if (this.animationId !== null) {
      clearTimeout(this.animationId);
      this.animationId = null;
    }
  }
  //#endregion

  //#region Hover Preview
  private drawHoverPreview(row: number, col: number): void {
    this.renderer.drawGrid();

    const player = this.turns.activePlayer;
    const pattern =
      player === 1 ? this.selectedPattern1 : this.selectedPattern2;
    if (!pattern) return;

    const playerPattern = getPatternForPlayer(pattern, player);

    // P2: offset so pattern appears left of cursor
    let offsetCol = 0;
    if (player === 2) {
      const maxC = Math.max(...playerPattern.cells.map(([, c]) => c));
      offsetCol = -maxC;
    }

    // Validate against mouse position
    const isValid = this.game.zones.isValidPlacement(col, player);

    const ctx = this.dom.gameCanvas.getContext("2d")!;
    ctx.fillStyle = isValid ? "rgba(0, 255, 0, 0.3)" : "rgba(255, 0, 0, 0.3)";

    for (const [rowOff, colOff] of playerPattern.cells) {
      const r = row + rowOff;
      const c = col + colOff + offsetCol;
      if (r >= 0 && r < this.game.rows && c >= 0 && c < this.game.cols) {
        ctx.fillRect(
          c * this.cellSize,
          r * this.cellSize,
          this.cellSize - 1,
          this.cellSize - 1,
        );
      }
    }
  }
  //#endregion

  //#region UI State Updates
  private updateActivePlayerUI(): void {
    const active = this.turns.activePlayer;

    // Player header glow
    this.dom.player1Btn.style.opacity = active === 1 ? "1" : "0.5";
    this.dom.player1Btn.style.boxShadow =
      active === 1 ? `0 0 15px ${CONFIG.COLOR_PLAYER1}` : "none";
    this.dom.player2Btn.style.opacity = active === 2 ? "1" : "0.5";
    this.dom.player2Btn.style.boxShadow =
      active === 2 ? `0 0 15px ${CONFIG.COLOR_PLAYER2}` : "none";

    // Pattern buttons
    this.enablePlayerPatterns(active);
    this.disablePlayerPatterns(active === 1 ? 2 : 1);
    this.updatePatternButtonStates();

    // Preview
    this.enablePreview(active);
    this.disablePreview(active === 1 ? 2 : 1);

    // Action buttons (Pass/Done)
    this.turns.updateButtonText();

    // Surrender buttons - both always active during placement/tactical
    this.dom.surrender1Btn.disabled = false;
    this.dom.surrender1Btn.style.opacity = "1";
    this.dom.surrender2Btn.disabled = false;
    this.dom.surrender2Btn.style.opacity = "1";
  }

  private updatePointsDisplay(): void {
    this.dom.points1.textContent = this.game.pointsPlayer1.toString();
    this.dom.points2.textContent = this.game.pointsPlayer2.toString();
  }

  private updateGenerationDisplay(): void {
    this.dom.generationCounter.textContent =
      this.game.currentGeneration.toString();
    this.dom.maxGenerations.textContent = this.game.maxGenerations.toString();
  }

  private updatePatternInfo(player: Player, pattern: Pattern | null): void {
    const nameEl =
      player === 1 ? this.dom.patternName1 : this.dom.patternName2;
    const costEl =
      player === 1 ? this.dom.patternCost1 : this.dom.patternCost2;

    if (pattern) {
      nameEl.textContent = pattern.name;
      costEl.textContent = `Cost: ${pattern.cells.length}`;
    } else {
      nameEl.textContent = "-";
      costEl.textContent = "Cost: -";
    }
  }

  private updatePatternButtonStates(): void {
    const active = this.turns.activePlayer;

    for (const btn of this.dom.player1Patterns) {
      const idx = parseInt(btn.getAttribute("data-pattern")!);
      const cost = PATTERNS[idx]!.cells.length;
      const canAfford = this.game.pointsPlayer1 >= cost;
      const isActive = active === 1;
      btn.disabled = !isActive || !canAfford;
      btn.style.opacity = !isActive ? "0.3" : canAfford ? "1" : "0.3";
    }

    for (const btn of this.dom.player2Patterns) {
      const idx = parseInt(btn.getAttribute("data-pattern")!);
      const cost = PATTERNS[idx]!.cells.length;
      const canAfford = this.game.pointsPlayer2 >= cost;
      const isActive = active === 2;
      btn.disabled = !isActive || !canAfford;
      btn.style.opacity = !isActive ? "0.3" : canAfford ? "1" : "0.3";
    }

    // Deselect if too expensive
    if (
      this.selectedPattern1 &&
      this.game.pointsPlayer1 < this.selectedPattern1.cells.length
    ) {
      this.selectedPattern1 = null;
      this.previewRenderer1.drawPreview(null, 1);
      this.updatePatternInfo(1, null);
    }
    if (
      this.selectedPattern2 &&
      this.game.pointsPlayer2 < this.selectedPattern2.cells.length
    ) {
      this.selectedPattern2 = null;
      this.previewRenderer2.drawPreview(null, 2);
      this.updatePatternInfo(2, null);
    }
  }
  //#endregion

  //#region Enable/Disable Controls
  private enablePlayerPatterns(player: Player): void {
    const patterns =
      player === 1 ? this.dom.player1Patterns : this.dom.player2Patterns;
    for (const btn of patterns) {
      btn.disabled = false;
      btn.style.opacity = "1";
    }
  }

  private disablePlayerPatterns(player: Player): void {
    const patterns =
      player === 1 ? this.dom.player1Patterns : this.dom.player2Patterns;
    for (const btn of patterns) {
      btn.disabled = true;
      btn.style.opacity = "0.3";
    }
  }

  private disableAllControls(): void {
    this.disablePlayerPatterns(1);
    this.disablePlayerPatterns(2);

    this.dom.ready1Btn.disabled = true;
    this.dom.ready1Btn.style.opacity = "0.3";
    this.dom.ready1Btn.textContent = "—";
    this.dom.ready2Btn.disabled = true;
    this.dom.ready2Btn.style.opacity = "0.3";
    this.dom.ready2Btn.textContent = "—";

    this.dom.player1Btn.style.boxShadow = "none";
    this.dom.player1Btn.style.opacity = "0.5";
    this.dom.player2Btn.style.boxShadow = "none";
    this.dom.player2Btn.style.opacity = "0.5";
  }

  private enablePreview(player: Player): void {
    const canvas =
      player === 1 ? this.dom.previewCanvas1 : this.dom.previewCanvas2;
    const toggle =
      player === 1 ? this.dom.previewToggle1 : this.dom.previewToggle2;

    canvas.style.opacity = "1";
    toggle.style.opacity = "1";
    toggle.disabled = false;
    toggle.textContent = "▶";
  }

  private disablePreview(player: Player): void {
    const canvas =
      player === 1 ? this.dom.previewCanvas1 : this.dom.previewCanvas2;
    const toggle =
      player === 1 ? this.dom.previewToggle1 : this.dom.previewToggle2;
    const prevRenderer =
      player === 1 ? this.previewRenderer1 : this.previewRenderer2;
    const pattern =
      player === 1 ? this.selectedPattern1 : this.selectedPattern2;

    prevRenderer.drawPreview(pattern, player);

    canvas.style.opacity = "0.3";
    toggle.style.opacity = "0.3";
    toggle.disabled = true;
    toggle.textContent = "▶";
  }
  //#endregion

  //#region Game End
  private showWinner(): void {
    this.turns.stopClock();
    this.stopAnimation();
    this.dom.turnTimerContainer.style.visibility = "hidden";

    const result = this.game.getWinner();

    if (result.winner === 1) {
      this.dom.winnerTitle.textContent = "Player 1 Wins!";
      this.dom.winnerTitle.style.color = CONFIG.COLOR_PLAYER1;
      this.dom.restartBtn.style.backgroundColor = CONFIG.COLOR_PLAYER1;
    } else if (result.winner === 2) {
      this.dom.winnerTitle.textContent = "Player 2 Wins!";
      this.dom.winnerTitle.style.color = CONFIG.COLOR_PLAYER2;
      this.dom.restartBtn.style.backgroundColor = CONFIG.COLOR_PLAYER2;
    } else {
      this.dom.winnerTitle.textContent = "It's a Tie!";
      this.dom.winnerTitle.style.color = CONFIG.COLOR_TACTICAL;
      this.dom.restartBtn.style.backgroundColor = CONFIG.COLOR_TACTICAL;
    }

    this.dom.winnerScore.textContent = `Score: ${result.player1Score} - ${result.player2Score}`;
    this.dom.winnerOverlay.style.display = "flex";
  }
  //#endregion

  //#region Reset
  private resetGame(): void {
    this.turns.reset();
    this.stopAnimation();

    this.dom.winnerOverlay.style.display = "none";

    this.game.reset();
    this.renderer.drawGrid();
    this.scoreEffects.clear();

    this.selectedPattern1 = null;
    this.selectedPattern2 = null;

    this.updatePointsDisplay();
    this.updateGenerationDisplay();

    // Clear previews
    this.previewRenderer1.drawPreview(null, 1);
    this.previewRenderer2.drawPreview(null, 2);
    this.updatePatternInfo(1, null);
    this.updatePatternInfo(2, null);
    this.dom.previewToggle1.textContent = "▶";
    this.dom.previewToggle2.textContent = "▶";

    // Show start overlay again
    this.dom.startOverlay.style.display = "flex";
    this.disableAllControls();
  }
  //#endregion
}
