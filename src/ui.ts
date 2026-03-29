// UI Controller - orchestrates chess clock turns, simulation, and tactical phases

import type { Pattern, Player } from "./types.js";
import type { DOMRefs } from "./domRefs.js";
import { Game } from "./game.js";
import { Renderer, PreviewRenderer } from "./rendering.js";
import { PATTERNS } from "./patterns.js";
import { getPatternForPlayer } from "./patternUtils.js";
import { TurnManager } from "./turnManager.js";
import { ScoreEffects } from "./scoreEffects.js";
import { Network, type GameAction } from "./network.js";
import { RollbackManager } from "./rollback.js";
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
  private network: Network | null;

  private selectedPattern1: Pattern | null = null;
  private selectedPattern2: Pattern | null = null;
  private animationId: number | null = null;

  // Which player is this client? In local mode, null (both).
  private localPlayer: Player | null = null;

  //#region Rollback State (online tactical phase)
  private rollback: RollbackManager | null = null;
  //#endregion

  //#region Phase-Ready Handshake State (online: wait for both before simulation)
  private localPhaseReadyCount: number = 0;
  private remotePhaseReadyCount: number = 0;
  private awaitingRemotePhaseReady: boolean = false;
  //#endregion

  //#region Sync Check State (online: verify grids match at phase boundaries)
  private awaitingSyncCheck: boolean = false;
  private localSyncData: { generation: number; gridHash: number; pointsPlayer1: number; pointsPlayer2: number; actionHash: number } | null = null;
  private remoteSyncData: { generation: number; gridHash: number; pointsPlayer1: number; pointsPlayer2: number; actionHash: number } | null = null;
  //#endregion

  //#region Waiting Overlay
  private waitingOverlay: HTMLDivElement | null = null;
  //#endregion

  constructor(
    game: Game,
    dom: DOMRefs,
    renderer: Renderer,
    previewRenderer1: PreviewRenderer,
    previewRenderer2: PreviewRenderer,
    cellSize: number,
    network: Network | null = null,
  ) {
    this.game = game;
    this.dom = dom;
    this.renderer = renderer;
    this.previewRenderer1 = previewRenderer1;
    this.previewRenderer2 = previewRenderer2;
    this.cellSize = cellSize;
    this.network = network;
    this.localPlayer = network?.localPlayer ?? null;

    this.turns = new TurnManager(game, dom);
    this.scoreEffects = new ScoreEffects(dom.gameCanvas, cellSize);

    // Wire callbacks
    this.turns.onTurnSwitch = () => this.updateActivePlayerUI();
    this.turns.onPhaseEnd = () => this.onPlacementPhaseEnd();

    // Wire network callbacks
    if (this.network) {
      this.network.onRemoteAction = (action) => this.handleRemoteAction(action);
      this.network.onRemotePhaseReady = (counter) => this.handleRemotePhaseReady(counter);
      this.createWaitingOverlay();
    }

    this.setupEventListeners();

    // Initialize displays
    this.updatePointsDisplay();
    this.updateGenerationDisplay();

    // Online mode: dim opponent side and add "You" badge
    if (this.localPlayer) {
      this.setupOnlinePlayerIndicator();
    }

    // Start game immediately (lobby handles the waiting)
    this.disableAllControls();
    this.startPlacementPhase();
  }

  //#region Waiting Overlay (shown during sync checks)
  private createWaitingOverlay(): void {
    this.waitingOverlay = document.createElement("div");
    this.waitingOverlay.style.cssText = `
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.6);
      z-index: 500;
      justify-content: center;
      align-items: center;
    `;
    const inner = document.createElement("div");
    inner.style.cssText = `
      background-color: #2a2a2a;
      padding: 30px 50px;
      border-radius: 10px;
      text-align: center;
    `;
    inner.innerHTML = `
      <p style="font-size: 20px; color: #ffaa00; margin: 0;">Waiting for opponent...</p>
      <p style="font-size: 14px; color: #888; margin-top: 10px;">Synchronizing game state</p>
    `;
    this.waitingOverlay.appendChild(inner);
    document.body.appendChild(this.waitingOverlay);
  }

  private showWaitingOverlay(): void {
    if (this.waitingOverlay) {
      this.waitingOverlay.style.display = "flex";
    }
  }

  private hideWaitingOverlay(): void {
    if (this.waitingOverlay) {
      this.waitingOverlay.style.display = "none";
    }
  }
  //#endregion

  private setupOnlinePlayerIndicator(): void {
    const localSide =
      this.localPlayer === 1 ? this.dom.player1Side : this.dom.player2Side;
    const remoteSide =
      this.localPlayer === 1 ? this.dom.player2Side : this.dom.player1Side;
    const localBtn =
      this.localPlayer === 1 ? this.dom.player1Btn : this.dom.player2Btn;

    // Dim opponent side
    remoteSide.style.opacity = "0.4";
    remoteSide.style.pointerEvents = "none";

    // Add "You" badge above local player button
    const badge = document.createElement("div");
    badge.textContent = "← You";
    if (this.localPlayer === 2) {
      badge.textContent = "You →";
    }
    const color =
      this.localPlayer === 1 ? CONFIG.COLOR_PLAYER1 : CONFIG.COLOR_PLAYER2;
    badge.style.cssText = `
      color: ${color};
      font-size: 14px;
      font-weight: bold;
      text-align: center;
      margin-bottom: -10px;
    `;
    localSide.insertBefore(badge, localBtn);
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
      if (phase !== "placement" && phase !== "tactical") return;

      const player = this.turns.activePlayer;

      // Online: only local player can click
      if (!this.isLocalPlayer(player)) return;

      if (this.turns.isPlayerDone(player)) return;

      const rect = this.dom.gameCanvas.getBoundingClientRect();
      const col = Math.floor((e.clientX - rect.left) / this.cellSize);
      const row = Math.floor((e.clientY - rect.top) / this.cellSize);

      const pattern =
        player === 1 ? this.selectedPattern1 : this.selectedPattern2;
      if (!pattern) return;

      const patternIndex = PATTERNS.indexOf(pattern);

      // Online tactical phase: use rollback-aware placement
      if (this.network && phase === "tactical") {
        const gen = this.game.currentGeneration;
        const success = this.executePlace(player, patternIndex, row, col);
        if (success && this.rollback) {
          // Record in rollback queue
          this.rollback.addAction({ player, patternIndex, row, col, generation: gen });
          // Send to remote with generation tag
          this.network.sendAction({
            type: "tacticalPlace",
            player,
            patternIndex,
            row,
            col,
            generation: gen,
          });
        }
        return;
      }

      // Placement phase or local mode: execute and send immediately
      this.executePlace(player, patternIndex, row, col);

      if (this.network) {
        this.network.sendAction({
          type: "placePattern",
          player,
          patternIndex,
          row,
          col,
        });
      }
    });
  }

  // Check if a player is controlled by this client
  private isLocalPlayer(player: Player): boolean {
    if (this.localPlayer === null) return true; // local mode: both
    return player === this.localPlayer;
  }

  // Execute a pattern placement (used by both local clicks and remote actions)
  // Returns true if placement was successful.
  private executePlace(
    player: Player,
    patternIndex: number,
    row: number,
    col: number,
  ): boolean {
    const pattern = PATTERNS[patternIndex];
    if (!pattern) return false;

    const playerPattern = getPatternForPlayer(pattern, player);

    // P2: offset so pattern is placed left of cursor
    let placementCol = col;
    if (player === 2) {
      const maxC = Math.max(...playerPattern.cells.map(([, c]) => c));
      placementCol = col - maxC;
    }

    // Debug: log placement with hash
    if (this.network) {
      const source = this.isLocalPlayer(player) ? "LOCAL" : "REMOTE";
      const hashBefore = this.game.gridHash();
      console.log(`[Sync] ${source} place P${player} pattern=${patternIndex} row=${row} col=${placementCol} gen=${this.game.currentGeneration} hashBefore=${hashBefore}`);
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
    return success;
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
      if (!this.isLocalPlayer(1)) return;
      if (confirm("Surrender? Your opponent wins!")) {
        this.executeSurrender(1);
        if (this.network) {
          this.network.sendAction({ type: "surrender", player: 1 });
        }
      }
    });

    this.dom.surrender2Btn.addEventListener("click", () => {
      if (!this.isLocalPlayer(2)) return;
      if (confirm("Surrender? Your opponent wins!")) {
        this.executeSurrender(2);
        if (this.network) {
          this.network.sendAction({ type: "surrender", player: 2 });
        }
      }
    });
  }

  private executeSurrender(player: Player): void {
    this.game.surrender(player);
    this.turns.stopClock();
    this.stopAnimation();
    this.showWinner();
  }

  private setupPatternButtons(): void {
    for (const btn of this.dom.player1Patterns) {
      btn.addEventListener("click", () => {
        if (!this.isLocalPlayer(1)) return;
        const idx = parseInt(btn.getAttribute("data-pattern")!);
        this.executeSelectPattern(1, idx);
        if (this.network) {
          this.network.sendAction({
            type: "selectPattern",
            player: 1,
            patternIndex: idx,
          });
        }
      });
    }

    for (const btn of this.dom.player2Patterns) {
      btn.addEventListener("click", () => {
        if (!this.isLocalPlayer(2)) return;
        const idx = parseInt(btn.getAttribute("data-pattern")!);
        this.executeSelectPattern(2, idx);
        if (this.network) {
          this.network.sendAction({
            type: "selectPattern",
            player: 2,
            patternIndex: idx,
          });
        }
      });
    }
  }

  private executeSelectPattern(player: Player, patternIndex: number): void {
    const pattern = PATTERNS[patternIndex]!;
    if (player === 1) {
      this.selectedPattern1 = pattern;
      this.previewRenderer1.drawPreview(pattern, 1);
      this.updatePatternInfo(1, pattern);
      this.dom.previewToggle1.textContent = "▶";
    } else {
      this.selectedPattern2 = pattern;
      this.previewRenderer2.drawPreview(pattern, 2);
      this.updatePatternInfo(2, pattern);
      this.dom.previewToggle2.textContent = "▶";
    }
  }

  private setupActionButtons(): void {
    this.dom.ready1Btn.addEventListener("click", () => {
      if (!this.isLocalPlayer(1)) return;
      if (this.turns.activePlayer === 1) {
        const actionType = this.turns.hasPlaced() ? "pass" : "done";
        this.turns.onActionButton();
        if (this.network) {
          this.network.sendAction({
            type: actionType,
            player: 1,
          } as GameAction);
        }
      }
    });

    this.dom.ready2Btn.addEventListener("click", () => {
      if (!this.isLocalPlayer(2)) return;
      if (this.turns.activePlayer === 2) {
        const actionType = this.turns.hasPlaced() ? "pass" : "done";
        this.turns.onActionButton();
        if (this.network) {
          this.network.sendAction({
            type: actionType,
            player: 2,
          } as GameAction);
        }
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

    if (this.network) {
      console.log(`[Sync] Placement phase ended, gen=${this.game.currentGeneration} hash=${this.game.gridHash()} p1=${this.game.pointsPlayer1} p2=${this.game.pointsPlayer2}`);
      this.beginSyncCheckAndPhaseReady("placement→simulation");
      return;
    }

    this.startSimulation();
  }

  private startSimulation(): void {
    this.stopAnimation();

    if (this.network) {
      console.log(`[Sync] Simulation starting, gen=${this.game.currentGeneration} hash=${this.game.gridHash()}`);
    }

    this.animateSimulation();
  }

  private startTacticalPhase(): void {
    this.stopAnimation();
    this.game.setPhase("tactical");

    // Online: sync check before starting the tactical phase
    if (this.network) {
      console.log(`[Sync] Tactical phase triggered at gen=${this.game.currentGeneration} hash=${this.game.gridHash()}`);
      this.showWaitingOverlay();
      this.beginSyncCheckAndPhaseReady("simulation→tactical");
      return;
    }

    // Local mode: start immediately
    this.beginTacticalPhaseAfterSync();
  }

  // Called after sync check completes (or directly in local mode)
  private beginTacticalPhaseAfterSync(): void {
    // Initialize rollback manager for online mode
    if (this.network) {
      this.rollback = new RollbackManager(this.game);
      this.rollback.takeSnapshot();
      this.hideWaitingOverlay();
    }

    this.turns.onPhaseEnd = () => this.onTacticalPhaseEnd();
    this.turns.startClock(CONFIG.CHESS_CLOCK_TACTICAL_SEC);
    this.updateActivePlayerUI();

    // Start slow animation alongside placement
    this.animateTactical();
  }

  private onTacticalPhaseEnd(): void {
    this.stopAnimation();
    this.game.setPhase("simulation");
    this.disableAllControls();
    this.dom.turnTimerContainer.style.visibility = "hidden";

    if (this.network) {
      // Log sync status before the check
      if (this.rollback) {
        console.log(this.rollback.formatSyncLog("tactical→simulation", this.localPlayer!));
      }

      // Clean up rollback state
      if (this.rollback) {
        this.rollback.clear();
        this.rollback = null;
      }

      this.beginSyncCheckAndPhaseReady("tactical→simulation");
      return;
    }

    this.startSimulation();
  }

  //#region Sync Check + Phase Ready (combined handshake)
  // Sends a syncCheck action with local state AND phaseReady signal.
  // Both must arrive before simulation continues.
  private beginSyncCheckAndPhaseReady(transitionLabel: string): void {
    this.showWaitingOverlay();

    const actionHash = this.rollback?.actionQueueHash() ?? 0;

    // Store local sync data
    this.localSyncData = {
      generation: this.game.currentGeneration,
      gridHash: this.game.gridHash(),
      pointsPlayer1: this.game.pointsPlayer1,
      pointsPlayer2: this.game.pointsPlayer2,
      actionHash,
    };
    this.remoteSyncData = null;
    this.awaitingSyncCheck = true;

    console.log(`[SyncCheck] Sending sync check for "${transitionLabel}": gen=${this.localSyncData.generation} hash=${this.localSyncData.gridHash} p1=${this.localSyncData.pointsPlayer1} p2=${this.localSyncData.pointsPlayer2} actionHash=${actionHash}`);

    // Send syncCheck action
    this.network!.sendAction({
      type: "syncCheck",
      player: this.localPlayer!,
      generation: this.localSyncData.generation,
      gridHash: this.localSyncData.gridHash,
      pointsPlayer1: this.localSyncData.pointsPlayer1,
      pointsPlayer2: this.localSyncData.pointsPlayer2,
      actionHash,
    });

    // Also send phaseReady
    this.localPhaseReadyCount++;
    this.awaitingRemotePhaseReady = true;
    this.network!.sendPhaseReady();

    // Check if remote already sent both
    this.tryCompleteSyncHandshake(transitionLabel);
  }

  // Called when remote syncCheck arrives
  private handleRemoteSyncCheck(data: {
    generation: number;
    gridHash: number;
    pointsPlayer1: number;
    pointsPlayer2: number;
    actionHash: number;
  }, transitionLabel: string): void {
    console.log(`[SyncCheck] Received remote sync: gen=${data.generation} hash=${data.gridHash} p1=${data.pointsPlayer1} p2=${data.pointsPlayer2} actionHash=${data.actionHash}`);

    this.remoteSyncData = data;
    this.tryCompleteSyncHandshake(transitionLabel);
  }

  // Try to complete the combined sync check + phase ready handshake
  private tryCompleteSyncHandshake(transitionLabel: string): void {
    // Need both syncCheck and phaseReady from remote
    if (!this.awaitingSyncCheck || !this.remoteSyncData || !this.localSyncData) return;
    if (this.awaitingRemotePhaseReady && this.remotePhaseReadyCount < this.localPhaseReadyCount) return;

    // Both sync checks received — compare
    const local = this.localSyncData;
    const remote = this.remoteSyncData;

    const genMatch = local.generation === remote.generation;
    const hashMatch = local.gridHash === remote.gridHash;
    const pointsMatch = local.pointsPlayer1 === remote.pointsPlayer1 && local.pointsPlayer2 === remote.pointsPlayer2;
    const actionMatch = local.actionHash === remote.actionHash;

    if (genMatch && hashMatch && pointsMatch) {
      console.log(`[SyncCheck] ✓ IN SYNC — gen=${local.generation} hash=${local.gridHash} actionMatch=${actionMatch}`);
    } else {
      console.warn(
        `[SyncCheck] ✗ DIVERGED at "${transitionLabel}"\n` +
        `  Local:  gen=${local.generation} hash=${local.gridHash} p=${local.pointsPlayer1}/${local.pointsPlayer2} aHash=${local.actionHash}\n` +
        `  Remote: gen=${remote.generation} hash=${remote.gridHash} p=${remote.pointsPlayer1}/${remote.pointsPlayer2} aHash=${remote.actionHash}`,
      );

      // P1 is authoritative: P1 sends its grid state, P2 will receive and apply
      if (this.localPlayer === 1) {
        console.log(`[SyncCheck] P1 authoritative — sending grid fix`);
        this.network!.sendAction({
          type: "syncFix",
          grid: this.game.grid,
          pointsPlayer1: this.game.pointsPlayer1,
          pointsPlayer2: this.game.pointsPlayer2,
          generation: this.game.currentGeneration,
        });
      }
      // P2 waits for syncFix (handled in handleRemoteAction)
      if (this.localPlayer === 2) {
        console.log(`[SyncCheck] P2 waiting for authoritative grid fix from P1`);
        // Don't proceed yet — syncFix handler will call completeTransition
        return;
      }
    }

    // Clean up and proceed
    this.completeTransition(transitionLabel);
  }

  // Called after sync is verified (or after syncFix applied)
  private completeTransition(transitionLabel: string): void {
    this.awaitingSyncCheck = false;
    this.awaitingRemotePhaseReady = false;
    this.localSyncData = null;
    this.remoteSyncData = null;
    this.hideWaitingOverlay();

    if (transitionLabel === "simulation→tactical") {
      this.beginTacticalPhaseAfterSync();
    } else {
      // placement→simulation or tactical→simulation
      this.startSimulation();
    }
  }

  // Apply authoritative grid from P1 (P2 only)
  private handleSyncFix(data: {
    grid: boolean[][];
    pointsPlayer1: number;
    pointsPlayer2: number;
    generation: number;
  }): void {
    console.log(`[SyncCheck] Applying sync fix from P1: gen=${data.generation} p1=${data.pointsPlayer1} p2=${data.pointsPlayer2}`);

    this.game.grid = data.grid.map((row: boolean[]) => [...row]);
    this.game.pointsPlayer1 = data.pointsPlayer1;
    this.game.pointsPlayer2 = data.pointsPlayer2;
    this.game.currentGeneration = data.generation;

    this.updatePointsDisplay();
    this.updateGenerationDisplay();
    this.renderer.drawGrid();

    console.log(`[SyncCheck] Fix applied, new hash=${this.game.gridHash()}`);

    // Now we can proceed — determine transition from context
    // The syncFix always comes during an active sync handshake
    if (this.awaitingSyncCheck) {
      // Determine transition label from game state
      const label = this.game.isTactical ? "simulation→tactical" : "tactical→simulation";
      this.completeTransition(label);
    }
  }

  // Called when remote player's phaseReady counter updates
  private handleRemotePhaseReady(counter: number): void {
    console.log(`[PhaseReady] Remote phase ready #${counter}, local at #${this.localPhaseReadyCount}`);
    this.remotePhaseReadyCount = counter;

    // If we're in a sync handshake, try to complete it
    if (this.awaitingSyncCheck) {
      // We need to know the transition label — infer from game state
      const label = this.game.isSimulation
        ? (this.game.currentGeneration === 0 ? "placement→simulation" : "tactical→simulation")
        : "simulation→tactical";
      this.tryCompleteSyncHandshake(label);
      return;
    }

    // Legacy path (shouldn't happen with new flow, but keep as safety)
    if (this.awaitingRemotePhaseReady && this.remotePhaseReadyCount >= this.localPhaseReadyCount) {
      console.log(`[PhaseReady] Both ready, starting simulation`);
      this.awaitingRemotePhaseReady = false;
      this.startSimulation();
    }
  }
  //#endregion
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

    // If phase switched back to simulation, hand off
    if (this.game.isSimulation) {
      this.stopAnimation();

      // Clean up rollback state (will be logged in onTacticalPhaseEnd)
      // Note: this path is reached when TurnManager ends the phase
      return;
    }

    // Apply any queued actions for the current generation
    // (from future-tagged remote placements that arrived early)
    if (this.rollback) {
      const pendingActions = this.rollback.getActionsForGeneration(this.game.currentGeneration);
      for (const action of pendingActions) {
        // Only apply remote actions that haven't been applied yet
        // (local actions were already applied immediately on click)
        if (!this.isLocalPlayer(action.player)) {
          this.rollback.applyPlacement(action);
        }
      }
    }

    // Compute next generation
    this.game.computeNextGeneration();
    this.renderer.drawGrid();
    this.updatePointsDisplay();
    this.updateGenerationDisplay();

    if (this.game.scoreEvents.length > 0) {
      this.scoreEffects.feed(this.game.scoreEvents);
    }

    if (this.game.isEnded) {
      this.turns.stopClock();
      this.showWinner();
      return;
    }

    this.scheduleNextTacticalFrame();
  }

  // Schedule the next tactical animation frame at the slow FPS rate
  private scheduleNextTacticalFrame(): void {
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
    this.awaitingRemotePhaseReady = false;
    this.awaitingSyncCheck = false;
    this.hideWaitingOverlay();
    this.dom.turnTimerContainer.style.visibility = "hidden";

    // Clean up rollback state
    if (this.rollback) {
      this.rollback.clear();
      this.rollback = null;
    }

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

  //#region Network
  private handleRemoteAction(action: GameAction): void {
    console.log("[Remote]", action.type, "player" in action ? `P${action.player}` : "");

    switch (action.type) {
      case "placePattern":
        // Used during placement phase only
        this.executePlace(
          action.player,
          action.patternIndex,
          action.row,
          action.col,
        );
        break;

      case "tacticalPlace":
        this.handleRemoteTacticalPlace(action);
        break;

      case "selectPattern":
        this.executeSelectPattern(action.player, action.patternIndex);
        break;

      case "pass":
      case "done":
        this.turns.onActionButton();
        break;

      case "surrender":
        this.executeSurrender(action.player);
        break;

      case "syncCheck":
        this.handleRemoteSyncCheck(
          {
            generation: action.generation,
            gridHash: action.gridHash,
            pointsPlayer1: action.pointsPlayer1,
            pointsPlayer2: action.pointsPlayer2,
            actionHash: action.actionHash,
          },
          "remote",
        );
        break;

      case "syncFix":
        this.handleSyncFix(action);
        break;
    }
  }

  // Handle a remote placement during the tactical phase (rollback-aware)
  private handleRemoteTacticalPlace(action: {
    player: Player;
    patternIndex: number;
    row: number;
    col: number;
    generation: number;
  }): void {
    if (!this.rollback) {
      // Fallback: no rollback manager (shouldn't happen), apply directly
      this.executePlace(action.player, action.patternIndex, action.row, action.col);
      return;
    }

    const actionGen = {
      player: action.player,
      patternIndex: action.patternIndex,
      row: action.row,
      col: action.col,
      generation: action.generation,
    };

    // Always add to the queue
    this.rollback.addAction(actionGen);

    if (action.generation === this.game.currentGeneration) {
      // Same generation: apply directly, no rollback needed
      console.log(`[Rollback] Remote placement at current gen=${action.generation}, applying directly`);
      this.rollback.applyPlacement(actionGen);
    } else if (action.generation < this.game.currentGeneration) {
      // Past generation: need rollback + resimulation
      console.log(`[Rollback] Remote placement at past gen=${action.generation}, current=${this.game.currentGeneration}, rolling back`);
      this.rollback.rollback();
      this.updatePointsDisplay();
      this.updatePatternButtonStates();
      this.renderer.drawGrid();
    } else {
      // Future generation: already in queue, will be applied when we reach that generation
      console.log(`[Rollback] Remote placement at future gen=${action.generation}, current=${this.game.currentGeneration}, queued`);
    }
  }
  //#endregion

  //#region Reset
  private resetGame(): void {
    this.turns.reset();
    this.stopAnimation();
    this.awaitingRemotePhaseReady = false;
    this.awaitingSyncCheck = false;
    this.localSyncData = null;
    this.remoteSyncData = null;
    this.hideWaitingOverlay();

    // Clean up rollback state
    if (this.rollback) {
      this.rollback.clear();
      this.rollback = null;
    }

    this.dom.winnerOverlay.style.display = "none";

    // In online mode: go back to lobby
    if (this.network) {
      this.network.disconnect();
      // Show lobby by reloading (simplest approach)
      window.location.reload();
      return;
    }

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

    // Restart placement phase
    this.startPlacementPhase();
  }
  //#endregion
}
