// SyncManager: Online sync state machine
//
// Extracted from UIController to isolate the multiplayer synchronization logic.
// Manages: phase-ready handshakes, tactical-done tracking, sync hash comparison,
// remote action dispatching, and rollback manager lifecycle.
//
// Communicates with UIController exclusively through SyncCallbacks.
// Does NOT access DOM directly — all UI effects go through callbacks.

import type { Player } from "./types.js";
import type { Game } from "./game.js";
import type { Network, GameAction } from "./network.js";
import { RollbackManager, type ActionGen } from "./rollback.js";

/** Callbacks from SyncManager back to UIController */
export interface SyncCallbacks {
  // Phase transitions
  startSimulation(): void;
  beginTacticalPhaseAfterSync(): void;

  // Remote action execution (delegated to UIController)
  executePlace(player: Player, patternIndex: number, row: number, col: number): boolean;
  executeSelectPattern(player: Player, patternIndex: number): void;
  executeSurrender(player: Player): void;
  handleTurnAction(): void;
  markPlayerDone(player: Player): void;

  // State management
  enterSimulationPhase(): void;   // setPhase("simulation") + disable controls + hide timer
  stopAnimationAndClock(): void;  // stop animation loop + stop chess clock

  // Display refresh (points + generation + pattern buttons + grid redraw)
  refreshDisplay(): void;

  // Waiting overlay
  showWaitingOverlay(): void;
  hideWaitingOverlay(): void;
}

export class SyncManager {
  private network: Network;
  private game: Game;
  private localPlayer: Player;
  private cb: SyncCallbacks;

  //#region Rollback
  rollback: RollbackManager | null = null;
  //#endregion

  //#region Phase-Ready Handshake
  private localPhaseReadyCount: number = 0;
  private remotePhaseReadyCount: number = 0;
  private awaitingRemotePhaseReady: boolean = false;
  private phaseReadyTarget: "simulation" | "tactical" | null = null;
  //#endregion

  //#region Tactical Done
  private localTacticalDone: boolean = false;
  private remoteTacticalDone: boolean = false;
  //#endregion

  //#region Sync Hash
  private remoteSyncHash: string | null = null;
  //#endregion

  constructor(
    network: Network,
    game: Game,
    localPlayer: Player,
    callbacks: SyncCallbacks,
  ) {
    this.network = network;
    this.game = game;
    this.localPlayer = localPlayer;
    this.cb = callbacks;

    // Wire network callbacks
    network.onRemoteAction = (action) => this.handleRemoteAction(action);
    network.onRemotePhaseReady = (counter) => this.handleRemotePhaseReady(counter);
    network.onRemoteSyncHash = (hash) => this.handleRemoteSyncHash(hash);
  }

  //#region Public API (called by UIController)

  /** Called when placement phase ends — starts placement→simulation handshake */
  onPlacementDone(): void {
    this.beginPhaseReadyHandshake("simulation");
  }

  /** Called when simulation reaches tactical trigger — shows overlay + starts handshake */
  onTacticalStart(): void {
    this.cb.showWaitingOverlay();
    this.beginPhaseReadyHandshake("tactical");
  }

  /** Called when local player clicks Done or clock expires in tactical phase */
  onLocalTacticalDone(): void {
    if (this.localTacticalDone) return;
    this.localTacticalDone = true;
    console.log(`[TacticalDone] Local player done at gen=${this.game.currentGeneration}`);

    this.network.sendAction({ type: "done", player: this.localPlayer });
    this.cb.markPlayerDone(this.localPlayer);
    this.checkTacticalBothDone();
  }

  /** Record a local tactical placement and send it to remote */
  addLocalTacticalAction(action: ActionGen): void {
    this.rollback?.addAction(action);
    this.network.sendAction({
      type: "tacticalPlace",
      player: action.player,
      patternIndex: action.patternIndex,
      row: action.row,
      col: action.col,
      generation: action.generation,
    });
  }

  /** Whether rollback manager is active (tactical phase in progress) */
  get hasRollback(): boolean {
    return this.rollback !== null;
  }

  /** Clean up all sync state (called on game end or reset) */
  reset(): void {
    this.awaitingRemotePhaseReady = false;
    this.phaseReadyTarget = null;
    this.remoteSyncHash = null;
    this.localTacticalDone = false;
    this.remoteTacticalDone = false;

    if (this.rollback) {
      this.rollback.clear();
      this.rollback = null;
    }
  }

  //#endregion

  //#region Phase-Ready Handshake

  private beginPhaseReadyHandshake(target: "simulation" | "tactical"): void {
    this.localPhaseReadyCount++;
    this.awaitingRemotePhaseReady = true;
    this.phaseReadyTarget = target;
    this.network.sendPhaseReady();

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

  private onPhaseReadyComplete(target: "simulation" | "tactical"): void {
    if (target === "simulation") {
      this.cb.startSimulation();
    } else {
      this.initTacticalPhase();
      this.cb.beginTacticalPhaseAfterSync();
    }
  }

  //#endregion

  //#region Tactical Phase Init

  private initTacticalPhase(): void {
    this.rollback = new RollbackManager(this.game);
    this.rollback.takeSnapshot();
    this.localTacticalDone = false;
    this.remoteTacticalDone = false;
    this.cb.hideWaitingOverlay();
  }

  //#endregion

  //#region Tactical Done

  private handleRemoteTacticalDone(): void {
    if (this.remoteTacticalDone) return;
    this.remoteTacticalDone = true;
    console.log(`[TacticalDone] Remote player done`);

    const remotePlayer: Player = this.localPlayer === 1 ? 2 : 1;
    this.cb.markPlayerDone(remotePlayer);
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

    this.cb.stopAnimationAndClock();
    this.cb.enterSimulationPhase();
    this.cb.showWaitingOverlay();

    if (this.rollback) {
      console.log(
        this.rollback.formatSyncLog("tactical→simulation", this.localPlayer),
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
    this.network.sendPhaseReadyWithSync(syncHash);

    // Check if remote already sent theirs
    this.tryCompleteTacticalSync();
  }

  //#endregion

  //#region Sync Hash Comparison

  private handleRemoteSyncHash(hash: string): void {
    console.log(`[SyncCheck] Received remote syncHash: ${hash}`);
    this.remoteSyncHash = hash;
    this.tryCompleteTacticalSync();
  }

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
        this.network.sendAction({
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

    this.cb.refreshDisplay();

    console.log(`[SyncCheck] Fix applied, new hash=${this.game.gridHash()}`);

    this.completeTacticalSync();
  }

  private completeTacticalSync(): void {
    this.remoteSyncHash = null;
    this.phaseReadyTarget = null;
    this.cb.hideWaitingOverlay();

    if (this.rollback) {
      this.rollback.clear();
      this.rollback = null;
    }

    this.cb.startSimulation();
  }

  //#endregion

  //#region Remote Action Dispatching

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
        this.cb.executePlace(
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
        this.cb.executeSelectPattern(action.player, action.patternIndex);
        break;

      case "pass":
        this.cb.handleTurnAction();
        break;

      case "done":
        if (this.game.isTactical) {
          this.handleRemoteTacticalDone();
        } else {
          this.cb.handleTurnAction();
        }
        break;

      case "surrender":
        this.cb.executeSurrender(action.player);
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
      this.cb.executePlace(
        action.player,
        action.patternIndex,
        action.row,
        action.col,
      );
      return;
    }

    const actionGen: ActionGen = {
      player: action.player,
      patternIndex: action.patternIndex,
      row: action.row,
      col: action.col,
      generation: action.generation,
    };

    // Always apply directly and add to queue for rollback
    this.cb.executePlace(
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
      this.cb.refreshDisplay();
    }
  }

  //#endregion
}
