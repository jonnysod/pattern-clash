// UI Controller - orchestrates turn management, pause system, and rendering

import type { Pattern, Player } from "./types.js";
import type { DOMRefs } from "./domRefs.js";
import { Game } from "./game.js";
import { Renderer, PreviewRenderer } from "./rendering.js";
import { PATTERNS } from "./patterns.js";
import { getPatternForPlayer } from "./patternUtils.js";
import { TurnManager } from "./turnManager.js";
import { PauseManager } from "./pauseManager.js";
import { CONFIG } from "./config.js";

export class UIController {
  private game: Game;
  private dom: DOMRefs;
  private renderer: Renderer;
  private previewRenderer1: PreviewRenderer;
  private previewRenderer2: PreviewRenderer;
  private cellSize: number;

  private turns: TurnManager;
  private pauses: PauseManager;

  private selectedPattern1: Pattern | null = null;
  private selectedPattern2: Pattern | null = null;
  private animationId: number | null = null;

  // Hot-seat turn restriction (disable for online multiplayer)
  private enableTurnRestriction: boolean = true;

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

    // Create sub-managers
    this.turns = new TurnManager(game, dom);
    this.pauses = new PauseManager(game, dom);

    // Wire up callbacks
    this.turns.onTurnSwitch = () => this.updateActivePlayerUI();
    this.turns.onLivePhaseStart = () => this.startLivePhase();

    this.pauses.onPauseStart = (player) => {
      this.turns.activePlayer = player;
      this.turns.stopTimer();
      this.updatePauseButtonLabels();
      this.updateActivePlayerUI();
    };
    this.pauses.onPauseEnd = (nextPlayer) => {
      this.turns.activePlayer = nextPlayer;
      this.updateActivePlayerUI();
      this.turns.startTurnTimer();
    };

    this.setupEventListeners();

    // Initialize displays
    this.updatePointsDisplay();
    this.updateGenerationDisplay();
    this.updateActivePlayerUI();
  }

  //#region Event Setup
  private setupEventListeners(): void {
    this.setupCanvasClick();
    this.setupCanvasHover();
    this.setupSurrenderButtons();
    this.setupPatternButtons();
    this.setupReadyButtons();
    this.setupRestartButton();
    this.setupPreviewToggleButtons();
  }

  private setupCanvasClick(): void {
    this.dom.gameCanvas.addEventListener("click", (e) => {
      const phase = this.game.phase;

      // Only allow clicks in placement or live/paused phases
      if (phase === "ended" || phase === "pauseDecision") return;

      // In live phase: check turn restriction
      if (
        this.game.isSimulationRunning &&
        this.enableTurnRestriction &&
        !this.isActivePlayerClick()
      ) {
        return;
      }

      // During pause: only pausing player can place
      if (
        this.game.isPaused &&
        this.game.pausingPlayer !== this.turns.activePlayer
      ) {
        return;
      }

      const rect = this.dom.gameCanvas.getBoundingClientRect();
      const col = Math.floor((e.clientX - rect.left) / this.cellSize);
      const row = Math.floor((e.clientY - rect.top) / this.cellSize);

      const player = this.turns.activePlayer;
      const pattern = player === 1 ? this.selectedPattern1 : this.selectedPattern2;

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

      const success = this.game.placePattern(row, placementCol, playerPattern, player, true);

      if (success) {
        this.updatePointsDisplay();

        if (this.game.isSimulationRunning) {
          if (!this.game.isPaused) {
            this.turns.switchTurnLivePhase();
          }
          // During pause: don't switch, just let them keep placing
        } else {
          this.turns.switchTurnPlacement();
        }
      } else {
        this.renderer.flashInvalidPlacement(col, row);
      }

      this.renderer.drawGrid();
    });
  }

  private isActivePlayerClick(): boolean {
    if (!this.enableTurnRestriction) return true;
    return true; // In hot-seat, active player is always the one clicking
  }

  private setupCanvasHover(): void {
    this.dom.gameCanvas.addEventListener("mousemove", (e) => {
      if (this.game.phase === "ended") return;
      // Don't show hover during pure simulation (non-live)
      if (this.game.isSimulationRunning && !this.game.isLive && !this.game.isPaused) return;

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
        this.showWinner();
      }
    });

    this.dom.surrender2Btn.addEventListener("click", () => {
      if (confirm("Surrender? Your opponent wins!")) {
        this.game.surrender(2);
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

  private setupReadyButtons(): void {
    this.dom.ready1Btn.addEventListener("click", () => {
      if (this.game.isSimulationRunning) {
        this.pauses.startPause(1);
      } else if (this.game.isPlacement) {
        this.turns.markReady(1);
      }
    });

    this.dom.ready2Btn.addEventListener("click", () => {
      if (this.game.isSimulationRunning) {
        this.pauses.startPause(2);
      } else if (this.game.isPlacement) {
        this.turns.markReady(2);
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

  //#region Animation Loop
  private animate = (): void => {
    if (this.game.isEnded) {
      this.showWinner();
      return;
    }

    if (!this.game.isSimulationRunning) return;

    if (this.game.isPaused || this.game.isPauseDecision) {
      // Keep loop alive but don't advance
      this.animationId = requestAnimationFrame(this.animate);
      return;
    }

    this.game.computeNextGeneration();
    this.renderer.drawGrid();
    this.updatePointsDisplay();
    this.updateGenerationDisplay();

    if (this.game.isEnded) {
      this.showWinner();
      return;
    }

    setTimeout(() => {
      this.animationId = requestAnimationFrame(this.animate);
    }, CONFIG.ANIMATION_INTERVAL_MS);
  };
  //#endregion

  //#region Live Phase
  private startLivePhase(): void {
    this.game.setPhase("live");
    this.dom.turnTimerContainer.style.visibility = "visible";

    this.animate();

    this.enablePlayerControls(1);
    this.enablePlayerControls(2);
    this.updatePauseButtonLabels();

    this.turns.startLiveTurnCycle();
    this.updateActivePlayerUI();
  }
  //#endregion

  //#region UI Updates
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
    const nameEl = player === 1 ? this.dom.patternName1 : this.dom.patternName2;
    const costEl = player === 1 ? this.dom.patternCost1 : this.dom.patternCost2;

    if (pattern) {
      nameEl.textContent = pattern.name;
      costEl.textContent = `Cost: ${pattern.cells.length}`;
    } else {
      nameEl.textContent = "-";
      costEl.textContent = "Cost: -";
    }
  }

  private drawHoverPreview(row: number, col: number): void {
    this.renderer.drawGrid();

    const player = this.turns.activePlayer;
    const pattern = player === 1 ? this.selectedPattern1 : this.selectedPattern2;
    if (!pattern) return;

    const playerPattern = getPatternForPlayer(pattern, player);

    // P2: offset so pattern appears left of cursor (mouse = top-right corner)
    let offsetCol = 0;
    if (player === 2) {
      const maxC = Math.max(...playerPattern.cells.map(([, c]) => c));
      offsetCol = -maxC;
    }

    // Validate against mouse position (both players: mouse must be in their zone)
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

  private updateActivePlayerUI(): void {
    const active = this.turns.activePlayer;

    // Player header glow
    this.dom.player1Btn.style.opacity = active === 1 ? "1" : "0.5";
    this.dom.player1Btn.style.boxShadow =
      active === 1 ? `0 0 15px ${CONFIG.COLOR_PLAYER1}` : "none";
    this.dom.player2Btn.style.opacity = active === 2 ? "1" : "0.5";
    this.dom.player2Btn.style.boxShadow =
      active === 2 ? `0 0 15px ${CONFIG.COLOR_PLAYER2}` : "none";

    // Enable/disable controls
    this.enablePlayerControls(active);
    this.disablePlayerControls(active === 1 ? 2 : 1);
    this.enablePreview(active);
    this.disablePreview(active === 1 ? 2 : 1);

    this.updatePatternButtonStates();

    // Update pause buttons in live phase
    if (this.game.isSimulationRunning) {
      this.updatePauseButtonLabels();

      if (this.game.isPaused || this.game.isPauseDecision) {
        this.dom.ready1Btn.disabled = true;
        this.dom.ready1Btn.style.opacity = "0.3";
        this.dom.ready2Btn.disabled = true;
        this.dom.ready2Btn.style.opacity = "0.3";
      } else {
        const p1ok = active === 1 && this.game.pausesPlayer1 > 0;
        const p2ok = active === 2 && this.game.pausesPlayer2 > 0;
        this.dom.ready1Btn.disabled = !p1ok;
        this.dom.ready1Btn.style.opacity = p1ok ? "1" : "0.3";
        this.dom.ready2Btn.disabled = !p2ok;
        this.dom.ready2Btn.style.opacity = p2ok ? "1" : "0.3";
      }
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

  private updatePauseButtonLabels(): void {
    if (this.game.isSimulationRunning) {
      this.dom.ready1Btn.textContent = `Pause ${this.game.pausesPlayer1}/${CONFIG.MAX_PAUSES_PER_PLAYER}`;
      this.dom.ready2Btn.textContent = `Pause ${this.game.pausesPlayer2}/${CONFIG.MAX_PAUSES_PER_PLAYER}`;
    }
  }
  //#endregion

  //#region Player Controls Enable/Disable
  private enablePlayerControls(player: Player): void {
    const patterns =
      player === 1 ? this.dom.player1Patterns : this.dom.player2Patterns;
    for (const btn of patterns) {
      btn.disabled = false;
      btn.style.opacity = "1";
    }

    const readyBtn = player === 1 ? this.dom.ready1Btn : this.dom.ready2Btn;
    if (this.game.isSimulationRunning) {
      const pausesLeft = this.game.getPauses(player);
      readyBtn.disabled = pausesLeft <= 0;
      readyBtn.style.opacity = pausesLeft > 0 ? "1" : "0.3";
    } else {
      const isReady =
        player === 1 ? this.turns.player1Ready : this.turns.player2Ready;
      if (!isReady) {
        readyBtn.disabled = false;
        readyBtn.style.opacity = "1";
      }
    }

    const surrenderBtn =
      player === 1 ? this.dom.surrender1Btn : this.dom.surrender2Btn;
    surrenderBtn.disabled = false;
    surrenderBtn.style.opacity = "1";
  }

  private disablePlayerControls(player: Player): void {
    const patterns =
      player === 1 ? this.dom.player1Patterns : this.dom.player2Patterns;
    for (const btn of patterns) {
      btn.disabled = true;
      btn.style.opacity = "0.3";
    }

    const playerBtn = player === 1 ? this.dom.player1Btn : this.dom.player2Btn;
    playerBtn.disabled = true;

    const readyBtn = player === 1 ? this.dom.ready1Btn : this.dom.ready2Btn;
    readyBtn.disabled = true;
    readyBtn.style.opacity = "0.3";

    const surrenderBtn =
      player === 1 ? this.dom.surrender1Btn : this.dom.surrender2Btn;
    surrenderBtn.disabled = true;
    surrenderBtn.style.opacity = "0.3";
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
    this.turns.stopTimer();
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
      this.dom.winnerTitle.style.color = CONFIG.COLOR_PAUSE;
      this.dom.restartBtn.style.backgroundColor = CONFIG.COLOR_PAUSE;
    }

    this.dom.winnerScore.textContent = `Score: ${result.player1Score} - ${result.player2Score}`;
    this.dom.winnerOverlay.style.display = "flex";
  }
  //#endregion

  //#region Reset
  private resetGame(): void {
    this.turns.reset();
    this.pauses.reset();

    this.dom.winnerOverlay.style.display = "none";

    this.game.reset();
    this.renderer.drawGrid();

    this.selectedPattern1 = null;
    this.selectedPattern2 = null;

    this.enablePlayerControls(1);
    this.updateActivePlayerUI();

    this.updatePointsDisplay();
    this.updateGenerationDisplay();

    // Reset ready buttons
    this.dom.ready1Btn.disabled = false;
    this.dom.ready1Btn.style.opacity = "1";
    this.dom.ready1Btn.textContent = "Ready!";
    this.dom.ready2Btn.disabled = false;
    this.dom.ready2Btn.style.opacity = "1";
    this.dom.ready2Btn.textContent = "Ready!";

    // Clear previews
    this.previewRenderer1.drawPreview(null, 1);
    this.previewRenderer2.drawPreview(null, 2);
    this.updatePatternInfo(1, null);
    this.updatePatternInfo(2, null);

    this.dom.previewToggle1.textContent = "▶";
    this.dom.previewToggle2.textContent = "▶";
  }
  //#endregion
}
