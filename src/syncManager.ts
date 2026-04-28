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

import type { SyncAction } from "./types.js";
import { logDebug } from "./logger.js";

export interface SyncManager {
  // Lifecycle
  start(): void;
  stop(): void;

  // Outbound: UIController calls this for every state-mutating action.
  sendAction(action: SyncAction): void;

  // Inbound: invoked by the manager whenever an action should be
  // applied to local Game state. UIController sets this once after
  // construction. For LocalSyncManager, this is invoked synchronously
  // from sendAction. For OnlineSyncManager (later), it fires both for
  // local and remote actions.
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
