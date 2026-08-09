// UI Controller — orchestrates the full game flow:
//   buy → place → simulation → (next phase or ended)
//
// All state-mutating actions are routed through SyncManager.sendAction.
// The manager loops them back to onRemoteAction (which mutates Game),
// so this controller has a single mutation entry point regardless of
// whether the game is local hotseat or online.
//
// localPlayer: "both" (hotseat) — same browser controls both players,
// pass-the-device overlays apply, and either side can click cards or
// surrender. A Player value (1 | 2) — only that player can click their
// own cards or surrender; the buy overlay opens immediately at the
// start of each buy phase (no pass-the-device).

import type { Player, SyncAction } from "./types.js";
import type { DOMRefs } from "./domRefs.js";
import type { SyncManager } from "./syncManager.js";
import type { BotController } from "./botController.js";
import { Game } from "./game.js";
import { Renderer } from "./rendering.js";
import { BuyOverlay } from "./buyOverlay.js";
import { CardHand } from "./cardHand.js";
import { ScoreEffects } from "./scoreEffects.js";
import { PATTERNS } from "./patterns.js";
import { getPatternForPlayer, getPlacementCol } from "./patternUtils.js";
import { CONFIG } from "./config.js";
import { logInfo, logWarn } from "./logger.js";

export type LocalPlayerMode = Player | "both";

export class UIController {
  private game: Game;
  private dom: DOMRefs;
  private renderer: Renderer;
  private syncManager: SyncManager;
  private localPlayer: LocalPlayerMode;
  private buyOverlay: BuyOverlay;
  private cardHand: CardHand;
  private scoreEffects: ScoreEffects;
  private cellSize: number;

  // Buy phase: who still needs to buy.
  // Hotseat: starts as [1, 2], drained sequentially (with pass-the-device).
  // Online: starts as [localPlayer], drained immediately on confirm.
  //   The other player's confirm arrives via sync.
  private pendingBuyers: Player[] = [];

  // Place phase
  private activePlacer: Player = 1;
  private selectedCardId: string | null = null;
  private hoverCol: number | null = null;
  private hoverRow: number | null = null;

  // Simulation
  private simTimerId: number | null = null;
  // Hold timer between a stability skip and the sim-end path (see
  // onStabilitySkip). Tracked so it can be cancelled if the game ends
  // during the hold — otherwise it fires onSimulationComplete() on an
  // already-ended game and re-opens the buy overlay (zombie restart).
  private skipHoldTimerId: number | null = null;

  // Post-game freerun sandbox
  private freerunTimerId: number | null = null;
  private freerunPlaying: boolean = false;

  // Registry of every addEventListener wired by this controller. Buttons like
  // surrender/restart/show-board live outside this controller's own DOM subtree
  // and outlive it across restarts — without removing each listener on cleanup,
  // every new UIController stacks another one onto the same button (e.g. N
  // surrender confirms after N games). A single registry makes "wired but never
  // removed" impossible to reintroduce: listen() records, cleanup() drains.
  private listeners: Array<[EventTarget, string, EventListener]> = [];

  private botController: BotController | null = null;

  // Restart callback (set by main.ts to return to the start overlay)
  onRestartRequested: (() => void) | null = null;

  // Fired when the game reaches an end state (regular finish, surrender,
  // or connection loss) — used by main.ts to clean up the Firebase
  // game node. Fires exactly once per game.
  onGameEnded: (() => void) | null = null;

  private gameEndedFired: boolean = false;

  constructor(
    game: Game,
    dom: DOMRefs,
    renderer: Renderer,
    syncManager: SyncManager,
    localPlayer: LocalPlayerMode,
    cellSize: number,
    botController?: BotController,
  ) {
    this.game = game;
    this.dom = dom;
    this.renderer = renderer;
    this.syncManager = syncManager;
    this.localPlayer = localPlayer;
    this.cellSize = cellSize;

    this.botController = botController ?? null;
    this.buyOverlay = new BuyOverlay(game, dom);
    this.cardHand = new CardHand(game, dom.cardHand1, dom.cardHand2);
    this.scoreEffects = new ScoreEffects(dom.gameCanvas, cellSize);

    // Online: pin the visible player to the local player from the start
    // so that buy-phase previews (and the eventual place-phase hand)
    // are always face-up for the local player. Hotseat: visible
    // follows active and gets updated in beginTurn().
    if (localPlayer !== "both") {
      this.cardHand.setVisiblePlayer(localPlayer);
    }

    this.syncManager.onRemoteAction = (action) => this.applyAction(action);
    this.syncManager.onConnectionLost = () => this.onConnectionLost();
    this.syncManager.start();

    this.wireEventHandlers();
    this.initialRender();
    this.startBuyPhase();
  }

  private isHotseat(): boolean {
    return this.localPlayer === "both";
  }

  private isLocalPlayer(player: Player): boolean {
    return this.localPlayer === "both" || this.localPlayer === player;
  }

  //#region Wiring
  // Register a DOM listener and record it so cleanup() can remove it. The
  // single source of truth for "what did we wire" — never call
  // addEventListener directly for a listener that must survive to cleanup.
  private listen(
    target: EventTarget,
    event: string,
    handler: EventListener,
  ): void {
    target.addEventListener(event, handler);
    this.listeners.push([target, event, handler]);
  }

  private wireEventHandlers(): void {
    this.buyOverlay.onConfirm = (player) => this.onBuyConfirmed(player);
    this.cardHand.onCardSelect = (cardId) => this.onCardSelect(cardId);

    this.listen(this.dom.switchOverlayReadyBtn, "click", () =>
      this.onSwitchReady(),
    );

    this.listen(this.dom.surrender1Btn, "click", () => this.handleSurrender(1));
    this.listen(this.dom.surrender2Btn, "click", () => this.handleSurrender(2));

    // Winner overlay buttons
    this.listen(this.dom.showBoardBtn, "click", () => {
      this.dom.winnerOverlay.style.display = "none";
      this.enterFreerun();
    });
    this.listen(this.dom.restartBtn, "click", () => {
      this.stopFreerun();
      this.dom.freerunBar.style.display = "none";
      this.dom.winnerOverlay.style.display = "none";
      this.cleanup();
      if (this.onRestartRequested) this.onRestartRequested();
    });
    this.listen(this.dom.freerunPlayBtn, "click", () => this.toggleFreerun());

    // Canvas mouse tracking for ghost preview + placement click
    this.listen(this.dom.gameCanvas, "mousemove", (e) =>
      this.onCanvasMouseMove(e as MouseEvent),
    );
    this.listen(this.dom.gameCanvas, "mouseleave", () =>
      this.onCanvasMouseLeave(),
    );
    this.listen(this.dom.gameCanvas, "click", (e) =>
      this.onCanvasClick(e as MouseEvent),
    );
  }

  private cleanup(): void {
    this.stopSimulation();
    this.stopFreerun();
    this.botController?.stop();
    this.syncManager.stop();
    this.syncManager.onRemoteAction = null;
    for (const [target, event, handler] of this.listeners) {
      target.removeEventListener(event, handler);
    }
    this.listeners = [];
    this.buyOverlay.destroy();
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

    // Hotseat: both players buy on this client (sequentially).
    // Online: only the local player buys here; the opponent buys on
    // their own client and arrives via sync.
    if (this.isHotseat()) {
      this.pendingBuyers = [1, 2];
    } else if (this.localPlayer !== "both") {
      this.pendingBuyers = [this.localPlayer];
    }

    // simGenerations ramps per phase, so the status bar's max has to be
    // refreshed here — initialRender() only ever sees the phase-1 value.
    this.dom.maxGenerations.textContent = String(this.game.simGenerations);

    this.updateBudgetScoreDisplay();
    this.updateStatusBar();
    this.updateActivePlayerIndicator(null);
    this.cardHand.clear();
    logInfo(
      `[Game] Buy phase ${this.game.currentPhaseNumber}/${this.game.totalPhases} started ` +
        `(${this.game.simGenerations} generations)`,
    );
    this.promptNextBuyer();
  }

  private promptNextBuyer(): void {
    const next = this.pendingBuyers[0];
    if (next === undefined) {
      this.onLocalBuysDone();
      return;
    }

    // Hotseat: show switch overlay before second buyer.
    // Online: only one buyer in pendingBuyers, no switch needed.
    if (this.isHotseat() && this.pendingBuyers.length === 1) {
      this.showSwitchOverlay(next);
    } else {
      this.showBuyOverlay(next);
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
    // Snapshot cardCount and remainingBudget BEFORE sending. The remote
    // client uses remainingBudget to update the opponent's displayed
    // budget — without it, they'd never see the opponent's spend, since
    // buyPattern() calls only run on the buyer's own client.
    const cardCount = this.game.getSlotCount(player);
    const remainingBudget = this.game.getBudget(player);
    this.buyOverlay.hide();
    this.pendingBuyers = this.pendingBuyers.filter((p) => p !== player);
    // sendAction loops back to applyAction → game.applyBuyConfirm
    this.syncManager.sendAction({
      type: "buyConfirm",
      player,
      cardCount,
      remainingBudget,
    });
    this.updateBudgetScoreDisplay();
    this.promptNextBuyer();
  }

  // All local buys submitted. In hotseat, this means both players confirmed.
  // In online, we may still be waiting for the opponent's confirm.
  //
  // applyAction already handles the "both confirmed" transition for us
  // (so an online remote confirm flips us to place phase). This method
  // just shows the waiting indicator if we're still in buy phase.
  private onLocalBuysDone(): void {
    if (!this.game.isBuyPhase) {
      // applyAction already finalized — nothing to do.
      return;
    }
    // Still in buy phase → opponent hasn't confirmed yet (online only).
    this.showWaitingForOpponent();
  }

  // Online: after local confirm, show "Waiting for opponent..." in the
  // opponent's card hand slot. Show the local player's purchased cards
  // (from the inventory, since the hand isn't built yet) in their slot,
  // so they can see what they bought while waiting.
  private showWaitingForOpponent(): void {
    if (this.localPlayer === "both") return;
    const opponent: Player = this.localPlayer === 1 ? 2 : 1;
    this.cardHand.setWaiting(opponent, true);
    this.cardHand.setPreview(this.localPlayer, true);
  }

  private hideWaitingForOpponent(): void {
    this.cardHand.clearAllWaiting();
    this.cardHand.clearAllPreview();
  }
  //#endregion

  //#region Place Phase
  private startPlacePhase(): void {
    // Hide any "waiting for opponent" overlay from the buy phase
    this.hideWaitingForOpponent();

    this.activePlacer = this.game.getPhaseStarter();
    this.hoverCol = null;
    this.hoverRow = null;
    // Last phase's placements have since been simulated — they are no longer
    // where they were put, so projecting them would aim at ghosts.
    this.botController?.clearOpponentPlacements();
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
    // Hotseat: visible follows active (cards swap on turn change).
    // Online: visible stays pinned to local player.
    if (this.localPlayer === "both") {
      this.cardHand.setActivePlayer(this.activePlacer);
    } else {
      this.cardHand.setActiveAndVisible(this.activePlacer, this.localPlayer);
    }
    if (this.isLocalPlayer(this.activePlacer)) {
      this.autoSelectFirstCard();
    } else {
      this.selectedCardId = null;
      this.cardHand.setSelectedCard(null);
    }
    this.updateActivePlayerIndicator(this.activePlacer);
    this.refreshHoverPreview();

    if (this.botController && this.activePlacer === 2) {
      this.botController.schedulePlacement();
    }
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
    const valid = this.game.zones.isValidPatternPlacement(
      pattern,
      this.hoverRow,
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
    // Online: only the local player can click during their own turn.
    if (!this.isLocalPlayer(this.activePlacer)) return;
    if (this.selectedCardId === null) return;

    const rect = this.dom.gameCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);

    const card = this.game.getCardById(this.activePlacer, this.selectedCardId);
    if (!card) return;

    // Local hand: real cards always have a real patternIndex.
    // (Placeholders only exist for the *remote* player's hand in online
    // play, and we never click on those.)
    const patternIndex = card.patternIndex;
    const basePattern = PATTERNS[patternIndex];
    if (!basePattern) return;

    const pattern = getPatternForPlayer(basePattern, this.activePlacer);
    const placementCol = getPlacementCol(col, pattern, this.activePlacer);

    // Pre-validate without mutating: if invalid, swallow the click silently.
    if (
      !this.game.zones.isValidPatternPlacement(
        pattern,
        row,
        placementCol,
        this.activePlacer,
      )
    ) {
      return;
    }

    // Send action; loopback applies it to Game.
    this.syncManager.sendAction({
      type: "placement",
      player: this.activePlacer,
      cardId: card.id,
      patternIndex,
      row,
      col: placementCol,
    });
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
  private static readonly STABILITY_SKIP_HOLD_MS = 500;

  private startSimulation(): void {
    this.stopSimulation();
    this.botController?.beginSimulationRecording();
    const tickMs = Math.floor(1000 / CONFIG.FPS_FAST);
    const tick = () => {
      if (!this.game.isSimulation) return;
      this.game.computeNextGeneration();
      this.scoreEffects.feed(this.game.scoreEvents);
      this.botController?.recordScoreEvents(this.game.scoreEvents);
      this.botController?.recordSimulationFrame(
        this.game.grid,
        this.game.currentGeneration,
      );
      this.updateBudgetScoreDisplay();
      this.updateStatusBar();
      this.renderer.drawGrid();

      if (this.game.isSimulationComplete()) {
        this.stopSimulation();
        this.onSimulationComplete();
        return;
      }

      // Early-termination: stable grid with no scoring activity.
      const period = this.game.detectStablePeriod();
      if (period === 1 || period === 2) {
        this.stopSimulation();
        this.onStabilitySkip(period);
        return;
      }

      this.simTimerId = window.setTimeout(tick, tickMs);
    };
    this.simTimerId = window.setTimeout(tick, tickMs);
  }

  // Called when the engine detects a stable period with no pending score hits.
  // Delegates to Game.skipToGeneration() (parity ticks + trailing force-flush,
  // credited and returned as one batch), feeds every event to scoreEffects so
  // displayed floaters stay in sync with the score counter, then takes the
  // normal sim-end path.
  private onStabilitySkip(period: 1 | 2): void {
    const target = this.game.simGenerations;
    const current = this.game.currentGeneration;
    const events = this.game.skipToGeneration(target, period);
    if (events.length > 0) {
      this.scoreEffects.feed(events);
    }
    // Same invariant as the floaters: every path that produces events has to
    // report them, or the bot goes blind to whatever scored during the skip.
    this.botController?.recordScoreEvents(events);
    this.updateBudgetScoreDisplay();
    this.updateStatusBar();

    logInfo(
      `[Game] Stability skip at gen ${current} (period ${period}). ` +
        `Score: P1=${this.game.scorePlayer1} P2=${this.game.scorePlayer2}`,
    );

    // Brief UX signal so the skip is perceptible.
    this.dom.simSkipHint.style.display = "inline";

    // After the hold, hide the hint and take the normal sim-end path.
    // If the game ended during the hold (surrender / disconnect), bail:
    // advanceAfterSimulation() out of an ended game would re-open the buy
    // overlay over the winner overlay. stopSimulation() also clears this
    // timer, so the guard is belt-and-suspenders for any path that ends
    // the game without going through stopSimulation().
    this.skipHoldTimerId = window.setTimeout(() => {
      this.skipHoldTimerId = null;
      if (this.game.isEnded) return;
      this.dom.simSkipHint.style.display = "none";
      this.onSimulationComplete();
    }, UIController.STABILITY_SKIP_HOLD_MS);
  }

  private stopSimulation(): void {
    if (this.simTimerId !== null) {
      clearTimeout(this.simTimerId);
      this.simTimerId = null;
    }
    if (this.skipHoldTimerId !== null) {
      clearTimeout(this.skipHoldTimerId);
      this.skipHoldTimerId = null;
    }
  }
  //#endregion

  //#region Freerun (post-game sandbox)
  private static readonly FREERUN_STABLE_HOLD_MS = 500;

  // Called by "Show Board" — reveals the frozen end-board and arms the freerun UI.
  private enterFreerun(): void {
    this.dom.freerunBar.style.display = "block";
    this.setFreerunPaused();
  }

  private toggleFreerun(): void {
    if (this.freerunPlaying) {
      this.stopFreerun();
    } else {
      this.startFreerun();
    }
  }

  private startFreerun(): void {
    if (this.freerunPlaying) return;
    this.freerunPlaying = true;
    this.dom.freerunPlayBtn.textContent = "⏸ Pause";
    this.dom.freerunStatus.textContent = "Running…";
    const tickMs = Math.floor(1000 / CONFIG.FPS_FAST);
    const tick = () => {
      if (!this.freerunPlaying) return;
      // Score-free tick — no hit-detection, no buckets, no ScoreEvents.
      this.game.stepOnly();
      this.renderer.drawGrid();
      this.updateStatusBar();

      const period = this.game.detectStablePeriod();
      if (period === 1 || period === 2) {
        // Auto-pause on stability.
        this.stopFreerun();
        this.dom.freerunStatus.textContent = "⚡ Stable";
        window.setTimeout(
          () => {
            if (!this.freerunPlaying) {
              this.dom.freerunStatus.textContent =
                "Paused — press Play to continue";
            }
          },
          UIController.FREERUN_STABLE_HOLD_MS,
        );
        return;
      }

      this.freerunTimerId = window.setTimeout(tick, tickMs);
    };
    this.freerunTimerId = window.setTimeout(tick, tickMs);
  }

  private stopFreerun(): void {
    this.freerunPlaying = false;
    if (this.freerunTimerId !== null) {
      clearTimeout(this.freerunTimerId);
      this.freerunTimerId = null;
    }
    this.setFreerunPaused();
  }

  private setFreerunPaused(): void {
    this.dom.freerunPlayBtn.textContent = "▶ Play";
    this.dom.freerunStatus.textContent = "Paused — inspect the final board";
  }
  //#endregion

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
    // Online: only allow surrendering as the local player
    if (!this.isLocalPlayer(player)) return;
    const confirmed = window.confirm(`Player ${player}: surrender?`);
    if (!confirmed) return;
    this.syncManager.sendAction({ type: "surrender", player });
  }
  //#endregion

  //#region Connection Loss (online only)
  private onConnectionLost(): void {
    if (this.game.isEnded) return;
    logWarn("[Game] Opponent disconnected — ending game");
    // Treat as opponent's surrender so local player wins.
    const opponent: Player = this.localPlayer === 1 ? 2 : 1;
    this.game.applySurrender(opponent);
    this.buyOverlay.hide();
    this.dom.switchOverlay.style.display = "none";
    this.stopSimulation();
    this.dom.winnerTitle.textContent = "Opponent disconnected";
    this.dom.winnerTitle.style.color = "#ffaa00";
    this.dom.winnerScore.textContent = `Score: ${this.game.scorePlayer1} — ${this.game.scorePlayer2}`;
    this.dom.winnerOverlay.style.display = "flex";
    this.fireGameEnded();
  }
  //#endregion

  //#region Sync — apply actions
  // Single mutation entry point. Called by SyncManager.onRemoteAction
  // for every action, regardless of origin (local loopback or remote
  // network). Applies the action to Game and updates UI as needed.
  private applyAction(action: SyncAction): void {
    switch (action.type) {
      case "buyConfirm":
        this.game.applyBuyConfirm(
          action.player,
          action.cardCount,
          action.remainingBudget,
        );
        // Refresh display so the opponent's updated budget shows up
        // immediately on remote confirms (in addition to the local-confirm
        // refresh already done by onBuyConfirmed).
        this.updateBudgetScoreDisplay();
        // If this was the last confirm needed, advance to place phase.
        // Hotseat: bothPlayersConfirmed becomes true after the second
        // local buyer confirms — pendingBuyers is also empty, so the
        // hotseat path through onLocalBuysDone is fine. We still call
        // it here for correctness in case of timing edge cases.
        // Online: the remote confirm arrives via this code path, so
        // this is the canonical place to detect "both done" remotely.
        if (this.game.bothPlayersConfirmed() && this.game.isBuyPhase) {
          this.game.finalizeBuyPhase();
          this.startPlacePhase();
        } else if (
          this.botController &&
          action.player === 1 &&
          !this.game.isBuyConfirmed(2)
        ) {
          // Human just confirmed; bot hasn't yet. executeBuy() synchronously
          // sends buyConfirm(P2), which re-enters applyAction and finalizes.
          this.botController.executeBuy();
        }
        break;

      case "placement": {
        const ok = this.game.applyPlacement(
          action.player,
          action.cardId,
          action.patternIndex,
          action.row,
          action.col,
        );
        if (!ok) {
          logWarn("[Sync] placement action rejected:", action);
          return;
        }
        // Let the bot witness the placement before its next turn begins —
        // beginTurn() below can schedule that turn immediately.
        this.botController?.recordOpponentPlacement(
          action.player,
          action.patternIndex,
          action.row,
          action.col,
        );
        // Local UI follow-up: clear selection, advance turn.
        if (action.player === this.activePlacer) {
          this.selectedCardId = null;
        }
        this.advanceTurn();
        this.beginTurn();
        break;
      }

      case "surrender":
        this.game.applySurrender(action.player);
        this.buyOverlay.hide();
        this.dom.switchOverlay.style.display = "none";
        this.stopSimulation();
        logInfo(`[Game] Player ${action.player} surrendered.`);
        this.showWinnerOverlay();
        break;
    }
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
    this.fireGameEnded();
  }

  private fireGameEnded(): void {
    if (this.gameEndedFired) return;
    this.gameEndedFired = true;
    if (this.onGameEnded) this.onGameEnded();
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
