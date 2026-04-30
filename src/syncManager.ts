// Sync layer.
//
// The SyncManager is the single channel for crossing actions between
// clients. UIController never mutates Game state directly — every
// mutation is routed through `sendAction`, and the manager then drives
// `onRemoteAction` to apply it.
//
// LocalSyncManager: instant loopback. `sendAction` immediately fires
// `onRemoteAction` with the same payload. Used in hotseat games and
// also as the "local apply" path in OnlineSyncManager (Checkpoint 3).
//
// The loopback design means UIController has a single mutation entry
// point (`onRemoteAction`) regardless of where the action originated.
// This keeps the same code path for hotseat and online play.

import type { SyncAction, Player } from "./types.js";
import type { FirebaseTransport } from "./firebaseTransport.js";
import { logDebug, logWarn } from "./logger.js";

export interface SyncManager {
  // Lifecycle
  start(): void;
  stop(): void;

  // Outbound: UIController calls this for every state-mutating action.
  sendAction(action: SyncAction): void;

  // Inbound: invoked by the manager whenever an action should be
  // applied to local Game state. UIController sets this once after
  // construction. For LocalSyncManager, this is invoked synchronously
  // from sendAction. For OnlineSyncManager, it fires both for local
  // actions (immediately) and remote actions (via Firebase).
  onRemoteAction: ((action: SyncAction) => void) | null;

  // Inbound: invoked when the connection is permanently lost.
  // No-op for LocalSyncManager.
  onConnectionLost: (() => void) | null;
}

export class LocalSyncManager implements SyncManager {
  onRemoteAction: ((action: SyncAction) => void) | null = null;
  onConnectionLost: (() => void) | null = null;

  start(): void {
    logDebug("[Sync] LocalSyncManager started");
  }

  stop(): void {
    logDebug("[Sync] LocalSyncManager stopped");
  }

  sendAction(action: SyncAction): void {
    logDebug("[Sync] action:", action);
    // Instant loopback — single mutation entry point in UIController.
    if (this.onRemoteAction) {
      this.onRemoteAction(action);
    }
  }
}

// OnlineSyncManager: routes actions through Firebase.
//
// Local actions (player === localPlayer): applied immediately to keep
// UI responsive, and pushed to the player's Firebase action stream.
// We ignore the Firebase echo of our own actions to avoid double-apply.
//
// Remote actions (player !== localPlayer): arrive via the opponent's
// Firebase stream and are applied to local Game state.
//
// Connection loss: when the opponent disconnects, fires onConnectionLost.
export class OnlineSyncManager implements SyncManager {
  onRemoteAction: ((action: SyncAction) => void) | null = null;
  onConnectionLost: (() => void) | null = null;

  private transport: FirebaseTransport;
  private localPlayer: Player;

  constructor(transport: FirebaseTransport, localPlayer: Player) {
    this.transport = transport;
    this.localPlayer = localPlayer;
  }

  start(): void {
    logDebug("[Sync] OnlineSyncManager started, localPlayer =", this.localPlayer);

    this.transport.onOpponentAction = (action: SyncAction) => {
      logDebug("[Sync] applying remote action:", action);
      if (this.onRemoteAction) this.onRemoteAction(action);
    };

    this.transport.onOpponentDisconnect = () => {
      logWarn("[Sync] opponent disconnected");
      if (this.onConnectionLost) this.onConnectionLost();
    };

    this.transport.subscribeToOpponentActions();
  }

  stop(): void {
    logDebug("[Sync] OnlineSyncManager stopped");
    this.transport.onOpponentAction = null;
    this.transport.onOpponentDisconnect = null;
  }

  sendAction(action: SyncAction): void {
    logDebug("[Sync] action:", action);

    // Sanity check: only the local player's own actions go through here.
    // (The UIController is supposed to enforce this; defense in depth.)
    if (action.player !== this.localPlayer) {
      logWarn(
        `[Sync] ignoring sendAction for player ${action.player} ` +
          `from local player ${this.localPlayer}`,
      );
      return;
    }

    // 1. Apply locally for instant UI feedback.
    if (this.onRemoteAction) this.onRemoteAction(action);

    // 2. Push to Firebase for the opponent to receive.
    void this.transport.sendAction(action);
  }
}
