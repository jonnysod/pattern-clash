// BotController — drives the bot's buy and place decisions.
//
// Sits above the unmodified LocalSyncManager: bot actions are sent through
// syncManager.sendAction like any human action, so the same applyAction
// code path handles them.
//
// Two entry points (called by UIController):
//   executeBuy()        — synchronous; called after human's buyConfirm
//   schedulePlacement() — async with pacing delay; called from beginTurn()

import type { SyncManager } from "./syncManager.js";
import type { Game } from "./game.js";
import type { BotPolicy, BotView } from "./botPolicy.js";

const BOT_PLACEMENT_DELAY_MS = 600;

export class BotController {
  private game: Game;
  private syncManager: SyncManager;
  private policy: BotPolicy;
  private pendingTimer: number | null = null;

  constructor(game: Game, syncManager: SyncManager, policy: BotPolicy) {
    this.game = game;
    this.syncManager = syncManager;
    this.policy = policy;
  }

  // Run the bot's buy phase: execute purchases then send buyConfirm.
  // Called synchronously from UIController after the human's buyConfirm
  // is applied. The sendAction loopback re-enters applyAction, where
  // bothPlayersConfirmed() becomes true and the place phase starts.
  executeBuy(): void {
    const view = this.buildView();
    const bundles = this.policy.chooseBuy(view);
    for (const bundle of bundles) {
      for (let i = 0; i < bundle.count; i++) {
        // buyPattern enforces budget/slot/copy limits — illegal buys are
        // silently skipped, so the bundle is advisory, not a guarantee.
        this.game.buyPattern(2, bundle.patternIndex);
      }
    }
    const cardCount = this.game.getSlotCount(2);
    const remainingBudget = this.game.getBudget(2);
    this.syncManager.sendAction({
      type: "buyConfirm",
      player: 2,
      cardCount,
      remainingBudget,
    });
  }

  // Schedule a placement action with a pacing delay so the alternation
  // is visible to the human player. Called from beginTurn() when P2 is active.
  schedulePlacement(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
    }
    this.pendingTimer = window.setTimeout(() => {
      this.pendingTimer = null;
      this.executePlacement();
    }, BOT_PLACEMENT_DELAY_MS);
  }

  stop(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  private executePlacement(): void {
    const hand = this.game.getHand(2);
    const card = hand[0];
    if (!card) return;

    const view = this.buildView();
    const { row, col } = this.policy.choosePlacement(view, card);

    this.syncManager.sendAction({
      type: "placement",
      player: 2,
      cardId: card.id,
      patternIndex: card.patternIndex,
      row,
      col,
    });
  }

  // Construct a redacted view of game state for the policy.
  // Critical: only opponentCardCount (a number) is exposed — never the
  // opponent's hand array, which would leak patternIndex values.
  private buildView(): BotView {
    return {
      grid: this.game.grid,
      phase: this.game.currentPhaseNumber,
      ownBudget: this.game.getBudget(2),
      ownHand: this.game.getHand(2),
      opponentCardCount: this.game.getHand(1).length,
      ownScore: this.game.scorePlayer2,
      opponentScore: this.game.scorePlayer1,
    };
  }
}
