// Tests for the bot difficulty ladder (botDifficulty.ts) and the epsilon
// placement handicap in SimRankingBotPolicy.

import { describe, it, expect } from "vitest";
import { BOT_DIFFICULTIES, createBotPolicy } from "../src/botDifficulty.js";
import {
  DummyBotPolicy,
  RuleBasedBotPolicy,
  SimRankingBotPolicy,
  BALANCED_PROFILE,
} from "../src/botPolicy.js";
import type { BotView } from "../src/botPolicy.js";
import type { Card } from "../src/types.js";
import { makeGame, BLOCK_INDEX } from "./_helpers.js";
import { getPatternForPlayer } from "../src/patternUtils.js";
import { PATTERNS } from "../src/patterns.js";

function makeView(
  game: ReturnType<typeof makeGame>,
  ownHand: BotView["ownHand"],
): BotView {
  return {
    grid: game.grid,
    phase: game.currentPhaseNumber,
    ownBudget: game.getBudget(2),
    ownHand,
    opponentCardCount: game.getHand(1).length,
    ownScore: game.scorePlayer2,
    opponentScore: game.scorePlayer1,
    opponentPlacements: [],
    ownPlacements: [],
    opponentBudget: 0,
    opponentSpentThisPhase: null,
    observedScoreRows: [],
    observedMotion: [],
  };
}

describe("difficulty ladder", () => {
  it("defines four levels with unique names, in order", () => {
    expect(BOT_DIFFICULTIES.map((d) => d.level)).toEqual([1, 2, 3, 4]);
    expect(new Set(BOT_DIFFICULTIES.map((d) => d.name)).size).toBe(4);
  });

  it("degrades only level 3; the top level runs undialled", () => {
    const byLevel = new Map(BOT_DIFFICULTIES.map((d) => [d.level, d]));
    expect(byLevel.get(1)!.horizon).toBeUndefined();
    expect(byLevel.get(2)!.horizon).toBeUndefined();
    expect(byLevel.get(4)!.horizon).toBeUndefined();
    expect(byLevel.get(4)!.epsilon).toBeUndefined();

    const advanced = byLevel.get(3)!;
    // Deliberately below the ~126 generations an orthogonal ship needs to
    // cross to the score column — the whole point of the handicap.
    expect(advanced.horizon).toBeLessThan(126);
    expect(advanced.horizon).toBeGreaterThan(0);
    expect(advanced.epsilon).toBeGreaterThan(0);
    expect(advanced.epsilon).toBeLessThan(1);
  });

  it("maps each level to the intended policy class", () => {
    const game = makeGame();
    expect(createBotPolicy(1, game)).toBeInstanceOf(DummyBotPolicy);
    expect(createBotPolicy(2, game)).toBeInstanceOf(RuleBasedBotPolicy);
    expect(createBotPolicy(3, game)).toBeInstanceOf(SimRankingBotPolicy);
    expect(createBotPolicy(4, game)).toBeInstanceOf(SimRankingBotPolicy);
  });
});

describe("RuleBasedBotPolicy as a joint BotPolicy (level 2)", () => {
  it("plays the first card in hand at a legal position", () => {
    const game = makeGame();
    const policy = new RuleBasedBotPolicy(game);
    const card: Card = { id: "c1", patternIndex: BLOCK_INDEX };
    const result = policy.choosePlacement(makeView(game, [card]));

    expect(result).not.toBeNull();
    expect(result!.cardId).toBe("c1");
    const pattern = getPatternForPlayer(PATTERNS[BLOCK_INDEX]!, 2);
    expect(
      game.zones.isValidPatternPlacement(pattern, result!.row, result!.col, 2),
    ).toBe(true);
  });

  it("returns null on an empty hand", () => {
    const game = makeGame();
    const policy = new RuleBasedBotPolicy(game);
    expect(policy.choosePlacement(makeView(game, []))).toBeNull();
  });
});

describe("epsilon placement handicap", () => {
  // On an empty board a Block is net-neutral everywhere, so the ranking
  // decides purely by the tie-break tiers — the best group is the most
  // central scatter row, the second-best group the rows one step out. That
  // makes the group boundary exact and the test deterministic.
  const pinnedOptions = {
    horizon: 5,
    profile: BALANCED_PROFILE,
    leadDefenceThreshold: Infinity,
  };
  const blockCard: Card = { id: "c1", patternIndex: BLOCK_INDEX };

  function placeWith(epsilon: number): { row: number; col: number } {
    const game = makeGame();
    const policy = new SimRankingBotPolicy(game, {
      ...pinnedOptions,
      epsilon,
      rng: () => 0,
    });
    const result = policy.choosePlacement(makeView(game, [blockCard]));
    expect(result).not.toBeNull();
    return result!;
  }

  it("epsilon 0 picks from the best tie group (most central row)", () => {
    const game = makeGame();
    const midRow = game.rows / 2;
    expect(placeWith(0).row).toBe(midRow);
  });

  it("a triggered epsilon plays from a strictly worse tie group", () => {
    const game = makeGame();
    const midRow = game.rows / 2;
    const best = placeWith(0);
    const lapse = placeWith(1);
    expect(Math.abs(lapse.row - midRow)).toBeGreaterThan(
      Math.abs(best.row - midRow),
    );
    // Still a legal placement — the handicap samples ranked candidates, it
    // never invents positions.
    const pattern = getPatternForPlayer(PATTERNS[BLOCK_INDEX]!, 2);
    expect(
      game.zones.isValidPatternPlacement(pattern, lapse.row, lapse.col, 2),
    ).toBe(true);
  });
});
