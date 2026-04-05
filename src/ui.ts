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

  //#region Tactical Done State (online: track both players independently)
  private localTacticalDone: boolean = false;
  private remoteTacticalDone: boolean = false;
  //#endregion

  //#region Phase-Ready Handshake State
  private localPhaseReadyCount: number = 0;
  private remotePhaseReadyCount: number = 0;
  private awaitingRemotePhaseReady: boolean = false;
  private phaseReadyTarget: "simulation" | "tactical" | null = null;
  // Sync hash received from remote (null = no sync data or not yet received)
  private remoteSyncHash: string | null = null;
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
      this.network.onRemotePhaseReady = (counter) =>
        this.handleRemotePhaseReady(counter);
      this.network.onRemoteSyncHash = (hash) => this.handleRemoteSyncHash(hash);
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

  //#region Waiting Overlay
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
    if (this.waitingOverlay) this.waitingOverlay.style.display = "flex";
  }

  private hideWaitingOverlay(): void {
    if (this.waitingOverlay) this.waitingOverlay.style.display = "none";
  }
  //#endregion

  private setupOnlinePlayerIndicator(): void {
    const localSide =
      this.localPlayer === 1 ? this.dom.player1Side : this.dom.player2Side;
    const remoteSide =
      this.localPlayer === 1 ? this.dom.player2Side : this.dom.player1Side;
    const localBtn =
      this.localPlayer === 1 ? this.dom.player1Btn : this.dom.player2Btn;

    remoteSide.style.opacity = "0.4";
    remoteSide.style.pointerEvents = "none";

    const badge = document.createElement("div");
    badge.textContent = this.localPlayer === 1 ? "← You" : "You →";
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
      if (!this.isLocalPlayer(player)) return;
      if (this.turns.isPlayerDone(player)) return;

      const rect = this.dom.gameCanvas.getBoundingClientRect();
      const col = Math.floor((e.clientX - rect.left) / this.cellSize);
      const row = Math.floor((e.clientY - rect.top) / this.cellSize);

      const pattern =
        player === 1 ? this.selectedPattern1 : this.selectedPattern2;
      if (!pattern) return;

      const patternIndex = PATTERNS.indexOf(pattern);

      // Online tactical phase: rollback-aware placement
      if (this.network && phase === "tactical") {
        const gen = this.game.currentGeneration;
        const success = this.executePlace(player, patternIndex, row, col);
        if (success && this.rollback) {
          this.rollback.addAction({
            player,
            patternIndex,
            row,
            col,
            generation: gen,
          });
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

      // Placement phase or local mode
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

  private isLocalPlayer(player: Player): boolean {
    if (this.localPlayer === null) return true;
    return player === this.localPlayer;
  }

  private executePlace(
    player: Player,
    patternIndex: number,
    row: number,
    col: number,
  ): boolean {
    const pattern = PATTERNS[patternIndex];
    if (!pattern) return false;

    const playerPattern = getPatternForPlayer(pattern, player);

    let placementCol = col;
    if (player === 2) {
      const maxC = Math.max(...playerPattern.cells.map(([, c]) => c));
      placementCol = col - maxC;
    }

    if (this.network) {
      const source = this.isLocalPlayer(player) ? "LOCAL" : "REMOTE";
      const hashBefore = this.game.gridHash();
      console.log(
        `[Sync] ${source} place P${player} pattern=${patternIndex} row=${row} col=${placementCol} gen=${this.game.currentGeneration} hashBefore=${hashBefore}`,
      );
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

        // Online tactical phase: handle "done" separately
        if (this.network && this.game.isTactical && actionType === "done") {
          this.onLocalTacticalDone();
          return;
        }

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

        // Online tactical phase: handle "done" separately
        if (this.network && this.game.isTactical && actionType === "done") {
          this.onLocalTacticalDone();
          return;
        }

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
  //#endregion

  //#region Phase Management

  // ── Placement Phase ──────────────────────────────────────────────

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
      console.log(
        `[Sync] Placement phase ended, gen=${this.game.currentGeneration} hash=${this.game.gridHash()} p1=${this.game.pointsPlayer1} p2=${this.game.pointsPlayer2}`,
      );
      this.beginPhaseReadyHandshake("simulation");
      return;
    }

    this.startSimulation();
  }

  // ── Simulation Phase ─────────────────────────────────────────────

  private startSimulation(): void {
    this.stopAnimation();

    if (this.network) {
      console.log(
        `[Sync] Simulation starting, gen=${this.game.currentGeneration} hash=${this.game.gridHash()}`,
      );
    }

    this.animateSimulation();
  }

  // ── Tactical Phase ───────────────────────────────────────────────

  private startTacticalPhase(): void {
    this.stopAnimation();
    this.game.setPhase("tactical");

    if (this.network) {
      console.log(
        `[Sync] Tactical phase triggered at gen=${this.game.currentGeneration} hash=${this.game.gridHash()}`,
      );
      this.showWaitingOverlay();
      this.beginPhaseReadyHandshake("tactical");
      return;
    }

    this.beginTacticalPhaseAfterSync();
  }

  private beginTacticalPhaseAfterSync(): void {
    if (this.network) {
      this.rollback = new RollbackManager(this.game);
      this.rollback.takeSnapshot();
      this.hideWaitingOverlay();

      this.localTacticalDone = false;
      this.remoteTacticalDone = false;
    }

    // Wire onPhaseEnd for tactical phase
    if (this.network) {
      this.turns.onPhaseEnd = () => {
        // Timeout or both can't afford — treat as local done
        if (!this.localTacticalDone) {
          console.log(
            `[TacticalDone] Clock expired / no budget, marking local done`,
          );
          this.onLocalTacticalDone();
        }
      };
    } else {
      this.turns.onPhaseEnd = () => this.onTacticalPhaseEnd();
    }

    this.turns.startClock(CONFIG.CHESS_CLOCK_TACTICAL_SEC);
    this.updateActivePlayerUI();
    this.animateTactical();
  }

  // ── Tactical Done Handling (online only) ─────────────────────────

  private onLocalTacticalDone(): void {
    if (this.localTacticalDone) return;
    this.localTacticalDone = true;
    console.log(
      `[TacticalDone] Local player done at gen=${this.game.currentGeneration}`,
    );

    this.network!.sendAction({ type: "done", player: this.localPlayer! });
    this.turns.markPlayerDone(this.localPlayer!);
    this.checkTacticalBothDone();
  }

  private onRemoteTacticalDone(): void {
    if (this.remoteTacticalDone) return;
    this.remoteTacticalDone = true;
    console.log(`[TacticalDone] Remote player done`);

    const remotePlayer: Player = this.localPlayer === 1 ? 2 : 1;
    this.turns.markPlayerDone(remotePlayer);
    this.checkTacticalBothDone();
  }

  private checkTacticalBothDone(): void {
    if (!this.localTacticalDone || !this.remoteTacticalDone) {
      console.log(
        `[TacticalDone] Waiting — local=${this.localTacticalDone} remote=${this.remoteTacticalDone}`,
      );
      return;
    }

    console.log(`[TacticalDone] Both done — stopping animation, starting sync`);

    this.stopAnimation();
    this.turns.stopClock();
    this.game.setPhase("simulation");
    this.disableAllControls();
    this.dom.turnTimerContainer.style.visibility = "hidden";

    this.showWaitingOverlay();

    if (this.rollback) {
      console.log(
        this.rollback.formatSyncLog("tactical→simulation", this.localPlayer!),
      );
    }

    // Send phaseReady WITH sync hash — both in one Firestore write, no race condition
    const syncHash = this.rollback
      ? this.rollback.buildSyncHash(this.game)
      : `${this.game.currentGeneration}|${this.game.gridHash()}|${this.game.pointsPlayer1}|${this.game.pointsPlayer2}|0`;

    console.log(`[SyncCheck] Sending phaseReady with syncHash: ${syncHash}`);

    this.localPhaseReadyCount++;
    this.awaitingRemotePhaseReady = true;
    this.phaseReadyTarget = "simulation";
    this.network!.sendPhaseReadyWithSync(syncHash);

    // Check if remote already sent theirs
    this.tryCompleteTacticalSync();
  }

  // Called when tactical phase ends in local mode (no network)
  private onTacticalPhaseEnd(): void {
    this.stopAnimation();
    this.game.setPhase("simulation");
    this.disableAllControls();
    this.dom.turnTimerContainer.style.visibility = "hidden";
    this.startSimulation();
  }

  // ── Phase-Ready Handshake ────────────────────────────────────────

  private beginPhaseReadyHandshake(target: "simulation" | "tactical"): void {
    this.localPhaseReadyCount++;
    this.awaitingRemotePhaseReady = true;
    this.phaseReadyTarget = target;
    this.network!.sendPhaseReady();

    console.log(
      `[PhaseReady] Sent phase ready #${this.localPhaseReadyCount} (target=${target}), awaiting remote`,
    );

    if (this.remotePhaseReadyCount >= this.localPhaseReadyCount) {
      console.log(
        `[PhaseReady] Remote already at #${this.remotePhaseReadyCount}, proceeding`,
      );
      this.awaitingRemotePhaseReady = false;
      this.onPhaseReadyComplete(target);
    }
  }

  private handleRemotePhaseReady(counter: number): void {
    console.log(
      `[PhaseReady] Remote phase ready #${counter}, local at #${this.localPhaseReadyCount}`,
    );
    this.remotePhaseReadyCount = counter;

    if (
      this.awaitingRemotePhaseReady &&
      this.remotePhaseReadyCount >= this.localPhaseReadyCount
    ) {
      console.log(
        `[PhaseReady] Both ready, proceeding (target=${this.phaseReadyTarget})`,
      );
      this.awaitingRemotePhaseReady = false;
      const target = this.phaseReadyTarget!;
      this.phaseReadyTarget = null;

      // Tactical end: don't start simulation yet, wait for syncHash comparison
      if (this.localTacticalDone && this.remoteTacticalDone) {
        this.tryCompleteTacticalSync();
        return;
      }

      this.onPhaseReadyComplete(target);
    }
  }

  private handleRemoteSyncHash(hash: string): void {
    console.log(`[SyncCheck] Received remote syncHash: ${hash}`);
    this.remoteSyncHash = hash;

    // Try to complete tactical sync if we're waiting
    this.tryCompleteTacticalSync();
  }

  private onPhaseReadyComplete(target: "simulation" | "tactical"): void {
    if (target === "simulation") {
      this.startSimulation();
    } else if (target === "tactical") {
      this.beginTacticalPhaseAfterSync();
    }
  }

  // ── Tactical End Sync (via phaseReady + syncHash) ────────────────

  private tryCompleteTacticalSync(): void {
    // Need both: phaseReady from remote AND syncHash from remote
    if (this.awaitingRemotePhaseReady) return;
    if (this.remoteSyncHash === null) return;

    const remote = RollbackManager.parseSyncHash(this.remoteSyncHash);
    const local = {
      generation: this.game.currentGeneration,
      gridHash: this.game.gridHash(),
      pointsPlayer1: this.game.pointsPlayer1,
      pointsPlayer2: this.game.pointsPlayer2,
      actionHash: this.rollback?.actionQueueHash() ?? 0,
    };

    const genMatch = local.generation === remote.generation;
    const hashMatch = local.gridHash === remote.gridHash;
    const pointsMatch =
      local.pointsPlayer1 === remote.pointsPlayer1 &&
      local.pointsPlayer2 === remote.pointsPlayer2;
    const actionMatch = local.actionHash === remote.actionHash;

    if (genMatch && hashMatch && pointsMatch) {
      console.log(
        `[SyncCheck] ✓ IN SYNC — gen=${local.generation} hash=${local.gridHash} actionMatch=${actionMatch}`,
      );
      this.completeTacticalSync();
    } else {
      console.warn(
        `[SyncCheck] ✗ DIVERGED at tactical end\n` +
          `  Local:  gen=${local.generation} hash=${local.gridHash} p=${local.pointsPlayer1}/${local.pointsPlayer2} aHash=${local.actionHash}\n` +
          `  Remote: gen=${remote.generation} hash=${remote.gridHash} p=${remote.pointsPlayer1}/${remote.pointsPlayer2} aHash=${remote.actionHash}`,
      );

      if (this.localPlayer === 1) {
        console.log(`[SyncCheck] P1 authoritative — sending grid fix`);
        this.network!.sendAction({
          type: "syncFix",
          gridData: RollbackManager.serializeGrid(this.game.grid),
          rows: this.game.rows,
          cols: this.game.cols,
          pointsPlayer1: this.game.pointsPlayer1,
          pointsPlayer2: this.game.pointsPlayer2,
          generation: this.game.currentGeneration,
        });
        this.completeTacticalSync();
      }
      // P2 waits for syncFix — handled in handleRemoteAction
    }
  }

  private handleSyncFix(data: {
    gridData: string;
    rows: number;
    cols: number;
    pointsPlayer1: number;
    pointsPlayer2: number;
    generation: number;
  }): void {
    console.log(
      `[SyncCheck] Applying sync fix from P1: gen=${data.generation} p1=${data.pointsPlayer1} p2=${data.pointsPlayer2}`,
    );

    this.game.grid = RollbackManager.deserializeGrid(
      data.gridData,
      data.rows,
      data.cols,
    );
    this.game.pointsPlayer1 = data.pointsPlayer1;
    this.game.pointsPlayer2 = data.pointsPlayer2;
    this.game.currentGeneration = data.generation;

    this.updatePointsDisplay();
    this.updateGenerationDisplay();
    this.renderer.drawGrid();

    console.log(`[SyncCheck] Fix applied, new hash=${this.game.gridHash()}`);

    this.completeTacticalSync();
  }

  private completeTacticalSync(): void {
    this.remoteSyncHash = null;
    this.phaseReadyTarget = null;
    this.hideWaitingOverlay();

    if (this.rollback) {
      this.rollback.clear();
      this.rollback = null;
    }

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

    if (this.game.scoreEvents.length > 0) {
      this.scoreEffects.feed(this.game.scoreEvents);
    }

    if (this.game.isEnded) {
      this.showWinner();
      return;
    }

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

    if (this.game.isSimulation) {
      this.stopAnimation();
      return;
    }

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

    let offsetCol = 0;
    if (player === 2) {
      const maxC = Math.max(...playerPattern.cells.map(([, c]) => c));
      offsetCol = -maxC;
    }

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

    this.dom.player1Btn.style.opacity = active === 1 ? "1" : "0.5";
    this.dom.player1Btn.style.boxShadow =
      active === 1 ? `0 0 15px ${CONFIG.COLOR_PLAYER1}` : "none";
    this.dom.player2Btn.style.opacity = active === 2 ? "1" : "0.5";
    this.dom.player2Btn.style.boxShadow =
      active === 2 ? `0 0 15px ${CONFIG.COLOR_PLAYER2}` : "none";

    this.enablePlayerPatterns(active);
    this.disablePlayerPatterns(active === 1 ? 2 : 1);
    this.updatePatternButtonStates();

    this.enablePreview(active);
    this.disablePreview(active === 1 ? 2 : 1);

    this.turns.updateButtonText();

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
    this.hideWaitingOverlay();
    this.dom.turnTimerContainer.style.visibility = "hidden";

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
    console.log(
      "[Remote]",
      action.type,
      "player" in action
        ? `P${"player" in action ? (action as any).player : ""}`
        : "",
    );

    switch (action.type) {
      case "placePattern":
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
        this.turns.onActionButton();
        break;

      case "done":
        if (this.game.isTactical && this.network) {
          this.onRemoteTacticalDone();
        } else {
          this.turns.onActionButton();
        }
        break;

      case "surrender":
        this.executeSurrender(action.player);
        break;

      case "syncFix":
        this.handleSyncFix(action);
        break;
    }
  }

  private handleRemoteTacticalPlace(action: {
    player: Player;
    patternIndex: number;
    row: number;
    col: number;
    generation: number;
  }): void {
    if (!this.rollback) {
      this.executePlace(
        action.player,
        action.patternIndex,
        action.row,
        action.col,
      );
      return;
    }

    const actionGen = {
      player: action.player,
      patternIndex: action.patternIndex,
      row: action.row,
      col: action.col,
      generation: action.generation,
    };

    // Always apply directly and add to queue for rollback
    this.executePlace(
      action.player,
      action.patternIndex,
      action.row,
      action.col,
    );
    this.rollback.addAction(actionGen);

    // Past generation: need rollback to correct the timeline
    if (action.generation < this.game.currentGeneration) {
      console.log(
        `[Rollback] Remote placement at past gen=${action.generation}, current=${this.game.currentGeneration}, rolling back`,
      );
      this.rollback.rollback();
      this.updatePointsDisplay();
      this.updatePatternButtonStates();
      this.renderer.drawGrid();
    }
  }
  //#endregion

  //#region Reset
  private resetGame(): void {
    this.turns.reset();
    this.stopAnimation();
    this.awaitingRemotePhaseReady = false;
    this.phaseReadyTarget = null;
    this.remoteSyncHash = null;
    this.localTacticalDone = false;
    this.remoteTacticalDone = false;
    this.hideWaitingOverlay();

    if (this.rollback) {
      this.rollback.clear();
      this.rollback = null;
    }

    this.dom.winnerOverlay.style.display = "none";

    if (this.network) {
      this.network.disconnect();
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

    this.previewRenderer1.drawPreview(null, 1);
    this.previewRenderer2.drawPreview(null, 2);
    this.updatePatternInfo(1, null);
    this.updatePatternInfo(2, null);
    this.dom.previewToggle1.textContent = "▶";
    this.dom.previewToggle2.textContent = "▶";

    this.startPlacementPhase();
  }
  //#endregion
}
