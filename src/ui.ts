// UI Controller — orchestrates the full game flow:
//   buy → place → simulation → (next phase or ended)

import type { Player } from "./types.js";
import type { DOMRefs } from "./domRefs.js";
import { Game } from "./game.js";
import { Renderer } from "./rendering.js";
import { BuyOverlay } from "./buyOverlay.js";
import { CardHand } from "./cardHand.js";
import { ScoreEffects } from "./scoreEffects.js";
import { PATTERNS } from "./patterns.js";
import { getPatternForPlayer, getPlacementCol } from "./patternUtils.js";
import { CONFIG } from "./config.js";
import { logInfo } from "./logger.js";

export class UIController {
  private game: Game;
  private dom: DOMRefs;
  private renderer: Renderer;
  private buyOverlay: BuyOverlay;
  private cardHand: CardHand;
  private scoreEffects: ScoreEffects;
  private cellSize: number;

  // Buy phase: who still needs to buy (hotseat)
  private pendingBuyers: Player[] = [];

  // Place phase
  private activePlacer: Player = 1;
  private selectedCardId: string | null = null;
  private hoverCol: number | null = null;
  private hoverRow: number | null = null;

  // Simulation
  private simTimerId: number | null = null;

  // Event handler references (for removeEventListener)
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private mouseLeaveHandler: (() => void) | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;

  // Restart callback (set by main.ts to return to the start overlay)
  onRestartRequested: (() => void) | null = null;

  constructor(game: Game, dom: DOMRefs, renderer: Renderer, cellSize: number) {
    this.game = game;
    this.dom = dom;
    this.renderer = renderer;
    this.cellSize = cellSize;

    this.buyOverlay = new BuyOverlay(game, dom);
    this.cardHand = new CardHand(game, dom.cardHand1, dom.cardHand2);
    this.scoreEffects = new ScoreEffects(dom.gameCanvas, cellSize);

    this.wireEventHandlers();
    this.initialRender();
    this.startBuyPhase();
  }

  //#region Wiring
  private wireEventHandlers(): void {
    this.buyOverlay.onConfirm = (player) => this.onBuyConfirmed(player);
    this.cardHand.onCardSelect = (cardId) => this.onCardSelect(cardId);

    this.dom.switchOverlayReadyBtn.addEventListener("click", () => {
      this.onSwitchReady();
    });

    this.dom.surrender1Btn.addEventListener("click", () =>
      this.handleSurrender(1),
    );
    this.dom.surrender2Btn.addEventListener("click", () =>
      this.handleSurrender(2),
    );

    // Winner overlay buttons
    this.dom.showBoardBtn.addEventListener("click", () => {
      this.dom.winnerOverlay.style.display = "none";
    });
    this.dom.restartBtn.addEventListener("click", () => {
      this.dom.winnerOverlay.style.display = "none";
      this.cleanup();
      if (this.onRestartRequested) this.onRestartRequested();
    });

    // Canvas mouse tracking for ghost preview + placement click
    this.mouseMoveHandler = (e) => this.onCanvasMouseMove(e);
    this.mouseLeaveHandler = () => this.onCanvasMouseLeave();
    this.clickHandler = (e) => this.onCanvasClick(e);
    this.dom.gameCanvas.addEventListener("mousemove", this.mouseMoveHandler);
    this.dom.gameCanvas.addEventListener("mouseleave", this.mouseLeaveHandler);
    this.dom.gameCanvas.addEventListener("click", this.clickHandler);
  }

  private cleanup(): void {
    this.stopSimulation();
    if (this.mouseMoveHandler) {
      this.dom.gameCanvas.removeEventListener(
        "mousemove",
        this.mouseMoveHandler,
      );
    }
    if (this.mouseLeaveHandler) {
      this.dom.gameCanvas.removeEventListener(
        "mouseleave",
        this.mouseLeaveHandler,
      );
    }
    if (this.clickHandler) {
      this.dom.gameCanvas.removeEventListener("click", this.clickHandler);
    }
    this.cardHand.clear();
    this.scoreEffects.clear();
  }
  //#endregion

  //#region Initial Render
  private initialRender(): void {
    this.renderer.drawGrid();
    this.updateStatusBar();
    this.updateBudgetScoreDisplay();
    this.dom.totalPhases.textContent = String(this.game.totalPhases);
    this.dom.maxGenerations.textContent = String(this.game.simGenerations);
    this.updateActivePlayerIndicator(null);
  }
  //#endregion

  //#region Buy Phase
  private startBuyPhase(): void {
    // Award budget for the new phase (phase 1 already has BUDGET_PER_PHASE
    // from construction/reset; phases 2–5 add BUDGET_PER_PHASE to leftover).
    if (this.game.currentPhaseNumber > 1) {
      this.game.budgetPlayer1 += CONFIG.BUDGET_PER_PHASE;
      this.game.budgetPlayer2 += CONFIG.BUDGET_PER_PHASE;
    }

    this.pendingBuyers = [1, 2];
    this.updateBudgetScoreDisplay();
    this.updateStatusBar();
    this.updateActivePlayerIndicator(null);
    this.cardHand.clear();
    logInfo(
      `[Game] Buy phase ${this.game.currentPhaseNumber}/${this.game.totalPhases} started`,
    );
    this.promptNextBuyer();
  }

  private promptNextBuyer(): void {
    const next = this.pendingBuyers[0];
    if (next === undefined) {
      this.onAllBuysConfirmed();
      return;
    }

    if (this.pendingBuyers.length === 2) {
      this.showBuyOverlay(next);
    } else {
      this.showSwitchOverlay(next);
    }
  }

  private showSwitchOverlay(nextPlayer: Player): void {
    const color =
      nextPlayer === 1 ? CONFIG.COLOR_PLAYER1 : CONFIG.COLOR_PLAYER2;
    this.dom.switchOverlayTitle.textContent = `Pass the device to Player ${nextPlayer}`;
    this.dom.switchOverlayTitle.style.color = color;
    this.dom.switchOverlay.style.display = "flex";
  }

  private onSwitchReady(): void {
    this.dom.switchOverlay.style.display = "none";
    const next = this.pendingBuyers[0];
    if (next !== undefined) {
      this.showBuyOverlay(next);
    }
  }

  private showBuyOverlay(player: Player): void {
    this.buyOverlay.show(player);
  }

  private onBuyConfirmed(player: Player): void {
    this.game.confirmBuy(player);
    this.buyOverlay.hide();
    this.pendingBuyers = this.pendingBuyers.filter((p) => p !== player);
    this.updateBudgetScoreDisplay();
    this.promptNextBuyer();
  }

  private onAllBuysConfirmed(): void {
    this.game.finalizeBuyPhase();
    this.startPlacePhase();
  }
  //#endregion

  //#region Place Phase
  private startPlacePhase(): void {
    this.activePlacer = this.game.getPhaseStarter();
    this.hoverCol = null;
    this.hoverRow = null;
    logInfo(
      `[Game] Place phase ${this.game.currentPhaseNumber} started. ` +
        `Player ${this.activePlacer} goes first.`,
    );
    this.beginTurn();
  }

  // Called at the start of place phase and after each placement.
  // Handles all edge cases in one place:
  // - Both hands empty → end place phase
  // - Active player has no cards → switch to other (guaranteed non-empty
  //   because of the check above)
  // - Otherwise → set up the active player's turn
  private beginTurn(): void {
    if (this.game.isPlacePhaseDone()) {
      this.onPlacePhaseDone();
      return;
    }
    if (this.game.getHand(this.activePlacer).length === 0) {
      this.activePlacer = this.activePlacer === 1 ? 2 : 1;
    }
    this.cardHand.setActivePlayer(this.activePlacer);
    this.autoSelectFirstCard();
    this.updateActivePlayerIndicator(this.activePlacer);
    this.refreshHoverPreview();
  }

  // Simple swap; beginTurn() handles the empty-hand case.
  private advanceTurn(): void {
    this.activePlacer = this.activePlacer === 1 ? 2 : 1;
  }

  private onCardSelect(cardId: string | null): void {
    this.selectedCardId = cardId;
    this.cardHand.setSelectedCard(cardId);
    // Redraw to clear / update preview based on current hover
    this.refreshHoverPreview();
  }

  private onCanvasMouseMove(e: MouseEvent): void {
    if (!this.game.isPlacePhase) return;

    const rect = this.dom.gameCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this.hoverCol = Math.floor(x / this.cellSize);
    this.hoverRow = Math.floor(y / this.cellSize);
    this.refreshHoverPreview();
  }

  private onCanvasMouseLeave(): void {
    if (!this.game.isPlacePhase) return;
    this.hoverCol = null;
    this.hoverRow = null;
    this.renderer.drawGrid();
  }

  private refreshHoverPreview(): void {
    if (!this.game.isPlacePhase) return;
    if (
      this.selectedCardId === null ||
      this.hoverCol === null ||
      this.hoverRow === null
    ) {
      this.renderer.drawGrid();
      return;
    }

    const card = this.game.getCardById(this.activePlacer, this.selectedCardId);
    if (!card) {
      this.renderer.drawGrid();
      return;
    }

    const basePattern = PATTERNS[card.patternIndex];
    if (!basePattern) {
      this.renderer.drawGrid();
      return;
    }

    const pattern = getPatternForPlayer(basePattern, this.activePlacer);
    const placementCol = getPlacementCol(
      this.hoverCol,
      pattern,
      this.activePlacer,
    );
    // Nachher
    const valid = this.game.zones.isValidPatternPlacement(
      pattern,
      placementCol,
      this.activePlacer,
    );
    this.renderer.drawPlacementPreview(
      pattern,
      this.hoverRow,
      placementCol,
      this.activePlacer,
      valid,
    );
  }

  private onCanvasClick(e: MouseEvent): void {
    if (!this.game.isPlacePhase) return;
    if (this.selectedCardId === null) return;

    const rect = this.dom.gameCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);

    const card = this.game.getCardById(this.activePlacer, this.selectedCardId);
    if (!card) return;

    const basePattern = PATTERNS[card.patternIndex];
    if (!basePattern) return;

    const pattern = getPatternForPlayer(basePattern, this.activePlacer);
    const placementCol = getPlacementCol(col, pattern, this.activePlacer);

    const placed = this.game.placePattern(
      row,
      placementCol,
      pattern,
      this.activePlacer,
    );
    if (!placed) return; // Invalid placement, silent failure

    // Remove card from hand
    this.game.removeCardById(this.activePlacer, card.id);
    this.selectedCardId = null;
    this.advanceTurn();
    this.beginTurn();
  }

  // Auto-select first card in active player's hand. Called when a turn
  // starts so the player doesn't have to click their card first.
  private autoSelectFirstCard(): void {
    const hand = this.game.getHand(this.activePlacer);
    const firstCard = hand[0];
    this.selectedCardId = firstCard ? firstCard.id : null;
    this.cardHand.setSelectedCard(this.selectedCardId);
  }

  private onPlacePhaseDone(): void {
    logInfo(
      `[Game] Place phase done. Starting simulation for ${this.game.simGenerations} generations.`,
    );
    this.game.setPhase("simulation");
    this.updateActivePlayerIndicator(null);
    this.cardHand.clear();
    this.startSimulation();
  }
  //#endregion

  //#region Simulation
  private startSimulation(): void {
    this.stopSimulation();
    const tickMs = Math.floor(1000 / CONFIG.FPS_FAST);
    const tick = () => {
      if (!this.game.isSimulation) return;
      this.game.computeNextGeneration();
      this.scoreEffects.feed(this.game.scoreEvents);
      this.updateBudgetScoreDisplay();
      this.updateStatusBar();
      this.renderer.drawGrid();

      if (this.game.isSimulationComplete()) {
        this.stopSimulation();
        this.onSimulationComplete();
        return;
      }
      this.simTimerId = window.setTimeout(tick, tickMs);
    };
    this.simTimerId = window.setTimeout(tick, tickMs);
  }

  private stopSimulation(): void {
    if (this.simTimerId !== null) {
      clearTimeout(this.simTimerId);
      this.simTimerId = null;
    }
  }

  private onSimulationComplete(): void {
    logInfo(
      `[Game] Simulation of phase ${this.game.currentPhaseNumber} complete. ` +
        `Score: P1=${this.game.scorePlayer1} P2=${this.game.scorePlayer2}`,
    );
    const wasLastPhase = this.game.currentPhaseNumber >= this.game.totalPhases;

    this.game.advanceAfterSimulation();

    if (wasLastPhase) {
      this.showWinnerOverlay();
    } else {
      this.updateStatusBar();
      this.startBuyPhase();
    }
  }
  //#endregion

  //#region Surrender
  private handleSurrender(player: Player): void {
    if (this.game.isEnded) return;
    const confirmed = window.confirm(`Player ${player}: surrender?`);
    if (!confirmed) return;
    this.game.surrender(player);
    this.buyOverlay.hide();
    this.dom.switchOverlay.style.display = "none";
    this.stopSimulation();
    logInfo(`[Game] Player ${player} surrendered.`);
    this.showWinnerOverlay();
  }
  //#endregion

  //#region Winner Overlay
  private showWinnerOverlay(): void {
    const result = this.game.getWinner();
    const { winner, player1Score, player2Score } = result;

    if (winner === null) {
      this.dom.winnerTitle.textContent = "Draw!";
      this.dom.winnerTitle.style.color = "#ffaa00";
    } else {
      const color = winner === 1 ? CONFIG.COLOR_PLAYER1 : CONFIG.COLOR_PLAYER2;
      this.dom.winnerTitle.textContent = `Player ${winner} Wins!`;
      this.dom.winnerTitle.style.color = color;
    }

    const surrenderNote =
      this.game.surrenderedPlayer !== null
        ? ` (Player ${this.game.surrenderedPlayer} surrendered)`
        : "";
    this.dom.winnerScore.textContent = `Score: ${player1Score} — ${player2Score}${surrenderNote}`;

    this.dom.winnerOverlay.style.display = "flex";
  }
  //#endregion

  //#region Display Helpers
  private updateStatusBar(): void {
    this.dom.phaseCounter.textContent = String(this.game.currentPhaseNumber);
    this.dom.generationCounter.textContent = String(
      this.game.currentGeneration,
    );
  }

  private updateBudgetScoreDisplay(): void {
    this.dom.budget1.textContent = String(this.game.budgetPlayer1);
    this.dom.budget2.textContent = String(this.game.budgetPlayer2);
    this.dom.score1.textContent = String(this.game.scorePlayer1);
    this.dom.score2.textContent = String(this.game.scorePlayer2);
  }

  // Highlight the active player's side during the place phase.
  // Pass null outside of place phase to clear.
  private updateActivePlayerIndicator(active: Player | null): void {
    const setSide = (side: HTMLDivElement, isActive: boolean) => {
      side.style.outline = isActive ? "3px solid #00ff00" : "none";
      side.style.outlineOffset = "4px";
    };
    setSide(this.dom.player1Side, active === 1);
    setSide(this.dom.player2Side, active === 2);
  }
  //#endregion
}
