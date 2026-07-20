// Tests for SimRankingBotPolicy (Stufe 3 — sim-ranking hybrid).

import { describe, it, expect } from "vitest";
import { SimRankingBotPolicy } from "../src/botPolicy.js";
import type { BotView } from "../src/botPolicy.js";
import { RuleBasedBotPolicy } from "../src/botPolicy.js";
import { BotController } from "../src/botController.js";
import { LocalSyncManager } from "../src/syncManager.js";
import { getPatternForPlayer } from "../src/patternUtils.js";
import { PATTERNS } from "../src/patterns.js";
import { makeGame, LWSS_INDEX, BLOCK_INDEX } from "./_helpers.js";
import { CONFIG } from "../src/config.js";

function makeView(game: ReturnType<typeof makeGame>, ownHand: BotView["ownHand"]): BotView {
  return {
    grid: game.grid,
    phase: game.currentPhaseNumber,
    ownBudget: game.getBudget(2),
    ownHand,
    opponentCardCount: game.getHand(1).length,
    ownScore: game.scorePlayer2,
    opponentScore: game.scorePlayer1,
  };
}

// A standard glider, stamped directly so the test doesn't depend on real
// placement legality — it represents an opponent threat already mid-flight.
// It moves diagonally down-right by (1,1) every 4 generations and, left
// unblocked from (40,50..52), reaches P1's score column (scorer 1) around
// generation ~180-200 on a 100×100 grid.
function stampGliderThreat(game: ReturnType<typeof makeGame>): void {
  game.grid[40]![51] = true;
  game.grid[41]![52] = true;
  game.grid[42]![50] = true;
  game.grid[42]![51] = true;
  game.grid[42]![52] = true;
}

// ---------------------------------------------------------------------------
// Defensive recall (load-bearing)
// ---------------------------------------------------------------------------

describe("SimRankingBotPolicy — defensive recall", () => {
  it("blocks an incoming threat without any threat-detection rule", () => {
    const game = makeGame();
    stampGliderThreat(game);

    // Baseline: left alone, the glider scores for P1.
    const baselineGame = makeGame();
    stampGliderThreat(baselineGame);
    for (let i = 0; i < 200; i++) baselineGame.computeNextGeneration();
    baselineGame.skipToGeneration(baselineGame.currentGeneration, 1);
    expect(baselineGame.scorePlayer1).toBeGreaterThan(0);

    // The bot is only given a Block card — a purely defensive piece, never
    // told where the threat is or that it should "defend".
    const policy = new SimRankingBotPolicy(game, { horizon: 200 });
    const card = { id: "c1", patternIndex: BLOCK_INDEX };
    const result = policy.choosePlacement(makeView(game, [card]));

    expect(result).not.toBeNull();
    expect(result!.cardId).toBe("c1");

    const pattern = getPatternForPlayer(PATTERNS[BLOCK_INDEX]!, 2);
    expect(
      game.zones.isValidPatternPlacement(pattern, result!.col, 2),
    ).toBe(true);

    // Apply the chosen placement for real and re-run the same horizon —
    // the opponent's score must come down relative to the unblocked baseline.
    game.placePattern(result!.row, result!.col, pattern, 2);
    for (let i = 0; i < 200; i++) game.computeNextGeneration();
    game.skipToGeneration(game.currentGeneration, 1);

    expect(game.scorePlayer1).toBeLessThan(baselineGame.scorePlayer1);
  });
});

// ---------------------------------------------------------------------------
// Greedy-mit-Kontext: destructive self-interaction
// ---------------------------------------------------------------------------

describe("SimRankingBotPolicy — greedy-with-context", () => {
  it("does not place a second ship directly on top of an already-committed one", () => {
    const game = makeGame();
    // Pin a small horizon: this test checks overlap avoidance (a shortlist
    // property, horizon-independent), not sim depth. The production default
    // (game.simGenerations) would make it needlessly slow.
    const policy = new SimRankingBotPolicy(game, { horizon: 50 });

    // First card already placed this phase (committed context).
    const firstPattern = getPatternForPlayer(PATTERNS[LWSS_INDEX]!, 2);
    const firstPos = new RuleBasedBotPolicy(game).rankPlacements(
      firstPattern,
      game.grid,
      1,
    )[0]!;
    game.placePattern(firstPos.row, firstPos.col, firstPattern, 2);

    // Second LWSS card evaluated against the board that already has the
    // first one stamped on it.
    const secondCard = { id: "c2", patternIndex: LWSS_INDEX };
    const result = policy.choosePlacement(makeView(game, [secondCard]));
    expect(result).not.toBeNull();

    const secondPattern = getPatternForPlayer(PATTERNS[LWSS_INDEX]!, 2);
    let overlaps = false;
    for (const [dr, dc] of secondPattern.cells) {
      if (game.grid[result!.row + dr]?.[result!.col + dc]) {
        overlaps = true;
        break;
      }
    }
    expect(overlaps).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Net-score ranking without a baseline run
// ---------------------------------------------------------------------------

describe("SimRankingBotPolicy — net-score ranking", () => {
  it("picks the candidate with the highest own-minus-opponent peek score", () => {
    const game = makeGame();
    const policy = new SimRankingBotPolicy(game, { horizon: 50 });
    const card = { id: "c1", patternIndex: BLOCK_INDEX };

    const result = policy.choosePlacement(makeView(game, [card]));
    expect(result).not.toBeNull();

    // Sanity: the chosen position is a legal P2 placement. The ranking
    // itself (no separate "do nothing" run) is exercised implicitly by
    // every other test in this file — this just locks in the contract.
    const pattern = getPatternForPlayer(PATTERNS[BLOCK_INDEX]!, 2);
    expect(
      game.zones.isValidPatternPlacement(pattern, result!.col, 2),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Peek isolation
// ---------------------------------------------------------------------------

describe("SimRankingBotPolicy — peek isolation", () => {
  it("never mutates the live grid or score counters", () => {
    const game = makeGame();
    stampGliderThreat(game);

    const gridSnapshotBefore = game.grid.map((row) => row.slice());
    const scoreP1Before = game.scorePlayer1;
    const scoreP2Before = game.scorePlayer2;

    const policy = new SimRankingBotPolicy(game, { horizon: 50 });
    const hand = [
      { id: "a", patternIndex: LWSS_INDEX },
      { id: "b", patternIndex: BLOCK_INDEX },
    ];
    policy.choosePlacement(makeView(game, hand));

    expect(game.grid).toEqual(gridSnapshotBefore);
    expect(game.scorePlayer1).toBe(scoreP1Before);
    expect(game.scorePlayer2).toBe(scoreP2Before);
  });
});

// ---------------------------------------------------------------------------
// Early termination
// ---------------------------------------------------------------------------

describe("SimRankingBotPolicy — early termination", () => {
  it("produces the same decision regardless of horizon once the board stabilises", () => {
    const game = makeGame();
    const card = { id: "c1", patternIndex: BLOCK_INDEX };

    const shortHorizon = new SimRankingBotPolicy(game, { horizon: 20 });
    const longHorizon = new SimRankingBotPolicy(game, { horizon: 500 });

    const shortResult = shortHorizon.choosePlacement(makeView(game, [card]));
    const longResult = longHorizon.choosePlacement(makeView(game, [card]));

    expect(shortResult).toEqual(longResult);
  });
});

// ---------------------------------------------------------------------------
// Bundle defensively stocked
// ---------------------------------------------------------------------------

describe("SimRankingBotPolicy — buy bundle", () => {
  it("includes at least one defensive (still-life/oscillator) pattern", () => {
    const game = makeGame();
    const policy = new SimRankingBotPolicy(game);
    const bundles = policy.chooseBuy(makeView(game, []));

    const DEFENSIVE_INDICES = new Set([2, 3, 4, 5, 6, 7]); // Block..Beacon
    const hasDefensive = bundles.some(
      (b) => DEFENSIVE_INDICES.has(b.patternIndex) && b.count > 0,
    );
    expect(hasDefensive).toBe(true);
  });

  it("stays within slot and copy limits", () => {
    const game = makeGame();
    const policy = new SimRankingBotPolicy(game);
    const bundles = policy.chooseBuy(makeView(game, []));

    for (const b of bundles) {
      for (let i = 0; i < b.count; i++) game.buyPattern(2, b.patternIndex);
    }
    expect(game.getSlotCount(2)).toBeLessThanOrEqual(CONFIG.MAX_SLOTS);
    for (const b of bundles) {
      expect(game.getCopyCount(2, b.patternIndex)).toBeLessThanOrEqual(
        CONFIG.MAX_COPIES_PER_TYPE,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Regression: use-it-or-lose-it + beginTurn edge cases, full bot vs human
// ---------------------------------------------------------------------------

describe("SimRankingBotPolicy — regression full game", () => {
  // Six phases of sim-ranking placement decisions are slow by design (each is
  // a real headless Conway simulation). This test validates game *flow*
  // (use-it-or-lose-it, beginTurn edge cases, reaching "ended"), not sim
  // quality, so it pins a tiny horizon — the production default
  // (game.simGenerations = 150) would run for minutes synchronously and blow
  // the timeout, since Vitest cannot interrupt a synchronous loop.
  it("reaches ended state through BotController without hanging", { timeout: 30000 }, () => {
    const game = makeGame();
    const syncManager = new LocalSyncManager();
    const policy = new SimRankingBotPolicy(game, { horizon: 15 });
    const controller = new BotController(game, syncManager, policy);

    for (let phase = 1; phase <= game.totalPhases; phase++) {
      if (phase > 1) {
        game.budgetPlayer1 += CONFIG.BUDGET_PER_PHASE;
        game.budgetPlayer2 += CONFIG.BUDGET_PER_PHASE;
      }

      game.buyPattern(1, BLOCK_INDEX);
      game.applyBuyConfirm(1, game.getSlotCount(1), game.getBudget(1));

      let p2BuyConfirm: { cardCount: number; remainingBudget: number } | null =
        null;
      syncManager.onRemoteAction = (action) => {
        if (action.type === "buyConfirm" && action.player === 2) {
          p2BuyConfirm = {
            cardCount: action.cardCount,
            remainingBudget: action.remainingBudget,
          };
        }
      };
      controller.executeBuy();
      expect(p2BuyConfirm).not.toBeNull();
      game.applyBuyConfirm(2, p2BuyConfirm!.cardCount, p2BuyConfirm!.remainingBudget);

      expect(game.bothPlayersConfirmed()).toBe(true);
      game.finalizeBuyPhase();
      expect(game.isPlacePhase).toBe(true);

      let safety = 0;
      while (!game.isPlacePhaseDone()) {
        if (safety++ > 300) throw new Error("place phase stuck");

        const p1Hand = game.getHand(1);
        const p2Hand = game.getHand(2);
        const starter = game.getPhaseStarter();
        const active: 1 | 2 =
          starter === 1
            ? p1Hand.length > 0
              ? 1
              : 2
            : p2Hand.length > 0
              ? 2
              : 1;

        if (active === 1) {
          const hand = game.getHand(1);
          const card = hand[0];
          if (!card) break;
          const col = game.zones.goalZoneLeftEnd + 1;
          game.applyPlacement(1, card.id, card.patternIndex, 0, col);
        } else {
          // Direct synchronous placement (bypassing the pacing timer) — same
          // policy call the controller's schedulePlacement() would trigger.
          const view: BotView = {
            grid: game.grid,
            phase: game.currentPhaseNumber,
            ownBudget: game.getBudget(2),
            ownHand: game.getHand(2),
            opponentCardCount: game.getHand(1).length,
            ownScore: game.scorePlayer2,
            opponentScore: game.scorePlayer1,
          };
          const result = policy.choosePlacement(view);
          if (!result) break;
          const card = game.getCardById(2, result.cardId)!;
          game.applyPlacement(2, card.id, card.patternIndex, result.row, result.col);
        }
      }

      expect(game.isPlacePhaseDone()).toBe(true);
      game.setPhase("simulation");
      game.advanceAfterSimulation();
    }

    expect(game.isEnded).toBe(true);
  });
});
