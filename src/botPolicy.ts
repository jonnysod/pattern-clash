// Bot policy interface and V1 dummy implementation.
//
// BotPolicy is the single extension point for bot intelligence.
// Stufe 2/3 swap the implementation here — the BotController integration
// stays unchanged.
//
// BotView is a deliberately redacted projection of game state.
// It exposes only what a human player could see on screen:
// own hand (full), opponent card count (never contents), public grid.

import type { Card } from "./types.js";
import type { Game } from "./game.js";
import { PATTERNS } from "./patterns.js";
import { getPatternForPlayer } from "./patternUtils.js";

export interface BotView {
  grid: boolean[][];
  phase: number;
  ownBudget: number;
  ownHand: Card[];
  opponentCardCount: number; // count only — contents are never exposed
  ownScore: number;
  opponentScore: number;
}

export interface BuyBundle {
  patternIndex: number;
  count: number;
}

export interface BotPolicy {
  chooseBuy(view: BotView): BuyBundle[];
  choosePlacement(view: BotView, card: Card): { row: number; col: number };
}

// Fixed bundle bought every phase regardless of budget leftovers.
// Stufe 2 will replace this with budget-aware selection.
const DUMMY_BUNDLE: BuyBundle[] = [{ patternIndex: 0, count: 3 }]; // 3x LWSS

export class DummyBotPolicy implements BotPolicy {
  private game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  chooseBuy(_view: BotView): BuyBundle[] {
    return DUMMY_BUNDLE;
  }

  choosePlacement(_view: BotView, card: Card): { row: number; col: number } {
    const basePattern = PATTERNS[card.patternIndex];
    if (!basePattern) return { row: 0, col: this.game.zones.rightStart };

    const pattern = getPatternForPlayer(basePattern, 2);
    const zones = this.game.zones;

    // Try up to 50 random positions.
    for (let attempt = 0; attempt < 50; attempt++) {
      const row = Math.floor(Math.random() * this.game.rows);
      const col = Math.floor(Math.random() * this.game.cols);
      if (zones.isValidPatternPlacement(pattern, col, 2)) {
        return { row, col };
      }
    }

    // Zone-scan fallback — guaranteed to find a legal position.
    for (let row = 0; row < this.game.rows; row++) {
      for (let col = 0; col < this.game.cols; col++) {
        if (zones.isValidPatternPlacement(pattern, col, 2)) {
          return { row, col };
        }
      }
    }

    return { row: 0, col: zones.rightStart };
  }
}
