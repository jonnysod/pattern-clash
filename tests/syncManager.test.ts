// Tests for LocalSyncManager (loopback).

import { describe, it, expect } from "vitest";
import { LocalSyncManager } from "../src/syncManager.js";
import type { SyncAction } from "../src/types.js";

describe("LocalSyncManager", () => {
  it("invokes onRemoteAction synchronously when sendAction is called", () => {
    const sync = new LocalSyncManager();
    const received: SyncAction[] = [];
    sync.onRemoteAction = (action) => received.push(action);

    const action: SyncAction = { type: "buyConfirm", player: 1, cardCount: 3, remainingBudget: 50 };
    sync.sendAction(action);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(action);
  });

  it("does nothing when onRemoteAction is unset", () => {
    const sync = new LocalSyncManager();
    expect(() =>
      sync.sendAction({ type: "buyConfirm", player: 1, cardCount: 0 , remainingBudget: 90}),
    ).not.toThrow();
  });

  it("forwards each action through, in send order", () => {
    const sync = new LocalSyncManager();
    const received: SyncAction[] = [];
    sync.onRemoteAction = (a) => received.push(a);

    const actions: SyncAction[] = [
      { type: "buyConfirm", player: 1, cardCount: 2, remainingBudget: 80 },
      { type: "buyConfirm", player: 2, cardCount: 1, remainingBudget: 87 },
      {
        type: "placement",
        player: 1,
        cardId: "c1",
        patternIndex: 5,
        row: 20,
        col: 10,
      },
      { type: "surrender", player: 2 },
    ];
    for (const a of actions) sync.sendAction(a);

    expect(received).toEqual(actions);
  });
});
