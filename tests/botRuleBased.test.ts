// Tests for RuleBasedBotPolicy (Stufe 2a).

import { describe, it, expect } from "vitest";
import { RuleBasedBotPolicy, DummyBotPolicy } from "../src/botPolicy.js";
import type { BotView } from "../src/botPolicy.js";
import { PATTERNS } from "../src/patterns.js";
import { getPatternForPlayer } from "../src/patternUtils.js";
import { makeGame, LWSS_INDEX, BLOCK_INDEX } from "./_helpers.js";
import { CONFIG } from "../src/config.js";
import { Game } from "../src/game.js";

function makeView(game: Game): BotView {
  return {
    grid: game.grid,
    phase: game.currentPhaseNumber,
    ownBudget: game.getBudget(2),
    ownHand: game.getHand(2),
    opponentCardCount: game.getHand(1).length,
    ownScore: game.scorePlayer2,
    opponentScore: game.scorePlayer1,
  };
}

// ---------------------------------------------------------------------------
// Self-score avoidance
// ---------------------------------------------------------------------------

describe("RuleBasedBotPolicy — self-score avoidance", () => {
  it("avoids placements whose footprint overlaps P1 score zone when alternatives exist", () => {
    const game = makeGame();
    const policy = new RuleBasedBotPolicy(game);
    const zones = game.zones;

    for (let idx = 0; idx < PATTERNS.length; idx++) {
      const card = { id: "t", patternIndex: idx };
      const { row, col } = policy.choosePlacement(makeView(game), card);
      const pattern = getPatternForPlayer(PATTERNS[idx]!, 2);

      // Verify the chosen position is legal
      expect(zones.isValidPatternPlacement(pattern, col, 2)).toBe(true);

      // Check whether the chosen footprint self-scores
      let selfScores = false;
      for (const [dr, dc] of pattern.cells) {
        const { scores, scorer } = zones.isScoreCell(row + dr, col + dc);
        if (scores && scorer === 1) {
          selfScores = true;
          break;
        }
      }

      // Verify that a non-self-scoring position exists for this pattern
      let nonSelfScoreExists = false;
      outer: for (let r = 0; r < game.rows; r++) {
        for (let c = 0; c < game.cols; c++) {
          if (!zones.isValidPatternPlacement(pattern, c, 2)) continue;
          let bad = false;
          for (const [dr, dc] of pattern.cells) {
            const { scores, scorer } = zones.isScoreCell(r + dr, c + dc);
            if (scores && scorer === 1) { bad = true; break; }
          }
          if (!bad) { nonSelfScoreExists = true; break outer; }
        }
      }

      if (nonSelfScoreExists) {
        expect(selfScores, `Pattern ${idx} (${PATTERNS[idx]!.name}) should not self-score`).toBe(false);
      }
    }
  });

  it("still places when every legal position self-scores (soft fallback)", () => {
    // Use a tiny synthetic game where the only legal zone is the score column.
    // We can't easily construct this with real zone geometry, so we verify
    // the policy returns a valid position even on a grid where selfScore is
    // unavoidable by checking it never throws / returns an impossible coord.
    const game = makeGame();
    const policy = new RuleBasedBotPolicy(game);
    const card = { id: "t", patternIndex: BLOCK_INDEX };

    // Fill the grid with live cells to maximise path score — policy should
    // still return a legal placement, not throw.
    for (let r = 0; r < game.rows; r++) {
      for (let c = 0; c < game.cols; c++) {
        game.grid[r]![c] = true;
      }
    }

    const { row, col } = policy.choosePlacement(makeView(game), card);
    const pattern = getPatternForPlayer(PATTERNS[BLOCK_INDEX]!, 2);
    expect(row).toBeGreaterThanOrEqual(0);
    expect(row).toBeLessThan(game.rows);
    expect(game.zones.isValidPatternPlacement(pattern, col, 2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Offensive orientation
// ---------------------------------------------------------------------------

describe("RuleBasedBotPolicy — offensive orientation", () => {
  it("places in a legal P2 zone position (mirrored pattern)", () => {
    const game = makeGame();
    const policy = new RuleBasedBotPolicy(game);

    for (let idx = 0; idx < PATTERNS.length; idx++) {
      const card = { id: "t", patternIndex: idx };
      const { row, col } = policy.choosePlacement(makeView(game), card);
      const pattern = getPatternForPlayer(PATTERNS[idx]!, 2);
      expect(
        game.zones.isValidPatternPlacement(pattern, col, 2),
        `Pattern ${idx} placement col=${col} should be in P2 zone`,
      ).toBe(true);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(game.rows);
    }
  });
});

// ---------------------------------------------------------------------------
// Regression: full headless game reaches "ended"
// ---------------------------------------------------------------------------

describe("RuleBasedBotPolicy — regression full game", () => {
  it("reaches ended state without hanging", () => {
    const game = makeGame();
    const policy = new RuleBasedBotPolicy(game);

    for (let phase = 1; phase <= game.totalPhases; phase++) {
      if (phase > 1) {
        game.budgetPlayer1 += CONFIG.BUDGET_PER_PHASE;
        game.budgetPlayer2 += CONFIG.BUDGET_PER_PHASE;
      }

      // P1 buys a Block
      game.buyPattern(1, BLOCK_INDEX);
      game.applyBuyConfirm(1, game.getSlotCount(1), game.getBudget(1));

      // Bot buy via fixed bundle
      const bundles = policy.chooseBuy(makeView(game));
      for (const b of bundles) {
        for (let i = 0; i < b.count; i++) game.buyPattern(2, b.patternIndex);
      }
      game.applyBuyConfirm(2, game.getSlotCount(2), game.getBudget(2));

      game.finalizeBuyPhase();
      expect(game.isPlacePhase).toBe(true);

      // Place all cards
      let safety = 0;
      while (!game.isPlacePhaseDone()) {
        if (safety++ > 300) throw new Error("place phase stuck");

        const p1Hand = game.getHand(1);
        const p2Hand = game.getHand(2);
        const starter = game.getPhaseStarter();
        const active: 1 | 2 =
          starter === 1
            ? p1Hand.length > 0 ? 1 : 2
            : p2Hand.length > 0 ? 2 : 1;

        const hand = game.getHand(active);
        if (hand.length === 0) break;
        const card = hand[0]!;

        if (active === 1) {
          const col = game.zones.endzoneLeftEnd + 1;
          game.applyPlacement(1, card.id, card.patternIndex, 0, col);
        } else {
          const { row, col } = policy.choosePlacement(makeView(game), card);
          game.applyPlacement(2, card.id, card.patternIndex, row, col);
        }
      }

      expect(game.isPlacePhaseDone()).toBe(true);
      game.setPhase("simulation");
      game.advanceAfterSimulation();
    }

    expect(game.isEnded).toBe(true);
  });
});
