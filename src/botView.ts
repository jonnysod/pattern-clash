// The contract between the bot's observation layer and its decision layer.
//
// BotView is a deliberately redacted projection of game state. It exposes
// only what a human player could see on screen: own hand (full), opponent
// card count (never contents), public grid. BotController builds it (the
// observation side); policies consume it and decide — BotView itself stays
// a pure data projection with no simulation of its own.

import type { Card } from "./types.js";

// A placement made during the current place phase — the opponent's (which
// the bot has witnessed) or one of the bot's own.
//
// Fair by the game's own standard: a placement is public. The online
// protocol puts patternIndex on the wire in the `placement` action (only
// `buyConfirm` withholds it), so a remote human client learns exactly this,
// at exactly this moment. What stays hidden is the *hand* — cards not yet
// played — which is what the anti-sniffing model protects.
export interface WitnessedPlacement {
  patternIndex: number;
  row: number;
  col: number;
}

export interface BotView {
  grid: boolean[][];
  phase: number;
  ownBudget: number;
  ownHand: Card[];
  opponentCardCount: number; // count only — contents are never exposed
  // The opponent's remaining budget, and what they spent in this buy phase.
  //
  // Both are public by the game's own standard: each player's budget is on
  // screen for the whole match, and `remainingBudget` rides in the buyConfirm
  // action precisely so the other client can display it. Withholding them from
  // the bot did not protect anything — it just left it blind to two numbers a
  // human reads off the status bar.
  //
  // What they buy is the bound in maxIncomingShips(): the count says how many
  // cards, the spend says how expensive they were, and cheap cards cannot fly.
  // The hand itself stays hidden, so the anti-sniffing model is untouched.
  //
  // opponentSpentThisPhase is null when no reference point was taken for this
  // phase; callers must treat that as "unknown", never as "nothing".
  opponentBudget: number;
  opponentSpentThisPhase: number | null;
  ownScore: number;
  opponentScore: number;
  // Placements made by the opponent during the *current* place phase, in
  // order. Scoped to this phase on purpose: no simulation runs during a
  // place phase, so a piece is still exactly where it was put and the
  // trajectory projection below is exact.
  opponentPlacements: WitnessedPlacement[];
  // The bot's own placements during the *current* place phase, in order.
  //
  // Needed because two spaceships launched too close together destroy each
  // other's debris field when they land (see SHIP_MIN_ROW_SEPARATION), and
  // the grid alone cannot answer "did I launch a ship on that row *this
  // phase*" — old debris in our own zone looks the same. Cleared per phase
  // alongside opponentPlacements.
  ownPlacements: WitnessedPlacement[];
  // Rows where the opponent actually scored during the previous simulation
  // phase, heaviest first. This is the bot's threat signal for anything it
  // did not witness being placed — above all the stationary debris a crashed
  // spaceship leaves behind, which keeps scoring forever without ever moving.
  //
  // Observation rather than a forward simulation of the current board, by
  // design: it is exactly what a human sees while watching the "+N" floaters
  // in the sim phase, and it is fact rather than extrapolation of a board
  // both players are about to reshape with new placements. The trade is
  // accepted knowingly — a piece already in flight that has not scored yet
  // is invisible here until the phase in which it first lands.
  //
  // Empty in phase 1: there is no previous simulation, and the board is empty.
  observedScoreRows: number[];
  // Things that were seen *travelling* towards us during the previous
  // simulation phase, with the velocity measured from two observed frames.
  //
  // This is the third and last threat class, and it is disjoint from the other
  // two: a piece placed this phase has not moved yet (no simulation runs
  // during a place phase), and a piece still in flight has not scored yet, so
  // neither of the other signals can see it. Left uncovered it is expensive —
  // a spaceship launched from the back of the opponent's zone needs 184
  // generations to arrive, so it crosses a phase boundary in silence and then
  // lands for ~275 points.
  //
  // Measured rather than looked up: the frame diff yields the velocity
  // directly, so this also covers movers that were never witnessed as a
  // placement, such as the glider stream a gun emits.
  observedMotion: MovingThreat[];
}

// A moving object observed on the board, in cells per generation. colsPerGen
// is positive when it is travelling towards us (increasing columns).
export interface MovingThreat {
  row: number; // centroid row in the most recent observed frame
  col: number; // centroid column in the most recent observed frame
  colsPerGen: number;
  rowsPerGen: number;
}

export interface BuyBundle {
  patternIndex: number;
  count: number;
}

// Stufe 3: the placement decision is joint — given the full remaining hand
// (via view.ownHand), the policy picks both *which* card and *where* to
// place it. Stufe 2's "given a card, choose a position" is gone; policies
// that still want a fixed-card variant (DummyBotPolicy, RuleBasedBotPolicy)
// keep an extra two-arg method for tests/reuse but no longer surface it
// through this interface.
export interface BotPolicy {
  chooseBuy(view: BotView): BuyBundle[];
  choosePlacement(
    view: BotView,
  ): { cardId: string; row: number; col: number } | null;
}
