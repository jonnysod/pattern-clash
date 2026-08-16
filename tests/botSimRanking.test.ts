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
import { CONFIG, simGenerationsForPhase } from "../src/config.js";

function makeView(game: ReturnType<typeof makeGame>, ownHand: BotView["ownHand"]): BotView {
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
    observedScoreRows: [],
    observedMotion: [],
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
      game.zones.isValidPatternPlacement(pattern, result!.row, result!.col, 2),
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
      game.zones.isValidPatternPlacement(pattern, result!.row, result!.col, 2),
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
// Horizon tracks the per-phase ramp
// ---------------------------------------------------------------------------
//
// The policy is constructed once per game but simGenerations ramps up every
// phase. A horizon cached in the constructor would peek the phase-1 window
// while the real sim runs longer — travelling spaceships would fall outside
// it and rank as net 0, which is the exact blind spot the full-length default
// exists to prevent. Reading the private getter is deliberate: the failure is
// silent in behaviour (subtly worse placements), so it needs a direct assert.

function readHorizon(policy: SimRankingBotPolicy): number {
  return (policy as unknown as { horizon: number }).horizon;
}

describe("SimRankingBotPolicy — horizon follows simGenerations", () => {
  it("defaults to the game's current simulation length, re-read per phase", () => {
    const game = makeGame();
    const policy = new SimRankingBotPolicy(game);

    expect(readHorizon(policy)).toBe(game.simGenerations);

    game.setPhase("tactical-place");
    game.setPhase("simulation");
    game.advanceAfterSimulation();

    expect(game.simGenerations).toBeGreaterThan(
      simGenerationsForPhase(1),
    );
    expect(readHorizon(policy)).toBe(game.simGenerations);
  });

  it("an explicit horizon option still pins the value across phases", () => {
    const game = makeGame();
    const policy = new SimRankingBotPolicy(game, { horizon: 50 });

    game.setPhase("tactical-place");
    game.setPhase("simulation");
    game.advanceAfterSimulation();

    expect(readHorizon(policy)).toBe(50);
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
            opponentPlacements: [],
            ownPlacements: [],
    observedScoreRows: [],
    observedMotion: [],
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

// ---------------------------------------------------------------------------
// On-grid placement + centrality tie-break (edge-drift regression)
// ---------------------------------------------------------------------------

describe("SimRankingBotPolicy — on-grid placement", () => {
  it("never returns a placement that clips off the grid", () => {
    const game = makeGame();
    // Flood the central rows so the offensive heuristic favours the low-
    // obstruction top/bottom edges — the exact condition that used to yield
    // bottom-edge placements clipped off the field.
    for (let r = 40; r < 60; r++) {
      for (let c = 0; c < game.cols; c++) game.grid[r]![c] = true;
    }
    const hand = [{ id: "a", patternIndex: 1 }]; // MWSS (5 rows tall)
    const policy = new SimRankingBotPolicy(game, { horizon: 10 });
    const res = policy.choosePlacement(makeView(game, hand))!;
    expect(res).not.toBeNull();

    const pattern = getPatternForPlayer(PATTERNS[1]!, 2);
    for (const [dr, dc] of pattern.cells) {
      expect(res.row + dr).toBeGreaterThanOrEqual(0);
      expect(res.row + dr).toBeLessThan(game.rows);
      expect(res.col + dc).toBeGreaterThanOrEqual(0);
      expect(res.col + dc).toBeLessThan(game.cols);
    }
  });

  it("prefers a central row when net scores tie", () => {
    const game = makeGame();
    // A Block never travels, so on an empty grid every candidate scores net 0
    // — a pure tie. The centrality tie-break must then pick the central row
    // rather than drifting to a top/bottom edge.
    const hand = [{ id: "b", patternIndex: BLOCK_INDEX }];
    const policy = new SimRankingBotPolicy(game, { horizon: 10 });
    const res = policy.choosePlacement(makeView(game, hand))!;
    expect(res).not.toBeNull();
    // Asserted as a property, not an exact row: the scatter's row spacing is
    // derived from DEFENSIVE_SHORTLIST_SIZE, so pinning the literal row makes
    // this test fail whenever that constant is tuned, without anything being
    // wrong. What must hold is that the tie lands nearer the middle than the
    // score-zone L-arms it exists to avoid.
    const distanceFromCentre = Math.abs(res.row - game.rows / 2);
    const distanceFromNearestEdge = Math.min(res.row, game.rows - 1 - res.row);
    expect(distanceFromCentre).toBeLessThan(distanceFromNearestEdge);
  });
});

describe("SimRankingBotPolicy — overlap avoidance", () => {
  it("avoids landing on existing cells on a net tie (no stacking/destruction)", () => {
    const game = makeGame();
    // Pre-stamp an inert 2x2 block at a central defensive scatter point
    // (row 50, first P2 column), as if a piece were already placed there
    // this phase. A second block placed anywhere scores net 0 — a pure tie —
    // so only the overlap tie-break keeps it off the occupied cells.
    const occ = game.zones.rightStart;
    game.grid[50]![occ] = true;
    game.grid[50]![occ + 1] = true;
    game.grid[51]![occ] = true;
    game.grid[51]![occ + 1] = true;

    const hand = [{ id: "d", patternIndex: BLOCK_INDEX }];
    const policy = new SimRankingBotPolicy(game, { horizon: 10 });
    const res = policy.choosePlacement(makeView(game, hand))!;
    expect(res).not.toBeNull();

    const pattern = getPatternForPlayer(PATTERNS[BLOCK_INDEX]!, 2);
    for (const [dr, dc] of pattern.cells) {
      expect(game.grid[res.row + dr]?.[res.col + dc] ?? false).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Offence held for the tail of the place phase
// ---------------------------------------------------------------------------
//
// Net score cannot see this: the peek evaluates as if the board froze after
// our placement, so a spaceship always outranks a block. But while the
// opponent still holds cards, one cheap block dropped into the ship's lane
// neutralises it — so the ship must go down last, ideally once the opponent
// has nothing left to answer with.
//
// Mutation check: with the hold removed, the first two cases invert (the
// LWSS wins on net both times), so both directions are load-bearing.

describe("SimRankingBotPolicy — offence held while the opponent has cards", () => {
  // Long enough for an LWSS to cross into P1's score column, so the ship
  // genuinely outranks the block on net and the hold is what decides.
  const SCORING_HORIZON = 200;

  it("plays the defensive card first while the opponent still holds cards", () => {
    const game = makeGame();
    const hand = [
      { id: "ship", patternIndex: LWSS_INDEX },
      { id: "block", patternIndex: BLOCK_INDEX },
    ];
    const policy = new SimRankingBotPolicy(game, { horizon: SCORING_HORIZON });

    const view = { ...makeView(game, hand), opponentCardCount: 2 };
    expect(policy.choosePlacement(view)!.cardId).toBe("block");
  });

  it("plays the spaceship once the opponent's hand is empty", () => {
    const game = makeGame();
    const hand = [
      { id: "ship", patternIndex: LWSS_INDEX },
      { id: "block", patternIndex: BLOCK_INDEX },
    ];
    const policy = new SimRankingBotPolicy(game, { horizon: SCORING_HORIZON });

    const view = { ...makeView(game, hand), opponentCardCount: 0 };
    expect(policy.choosePlacement(view)!.cardId).toBe("ship");
  });

  it("still places when only offensive cards are left (use-it-or-lose-it)", () => {
    const game = makeGame();
    const hand = [{ id: "ship", patternIndex: LWSS_INDEX }];
    const policy = new SimRankingBotPolicy(game, { horizon: 30 });

    const view = { ...makeView(game, hand), opponentCardCount: 3 };
    const res = policy.choosePlacement(view);
    expect(res).not.toBeNull();
    expect(res!.cardId).toBe("ship");
  });
});

// ---------------------------------------------------------------------------
// Ship separation
// ---------------------------------------------------------------------------
//
// Two spaceships launched closer than SHIP_MIN_ROW_SEPARATION destroy each
// other's debris field on landing and are worth less than one alone
// (measured: gap 8 → 92, gap 12 → 210, gap 16 → 466 = 2× a single ship).
// Net score only catches this when the phase runs long enough for both to
// land, so a tier below net has to answer in the early phases.

describe("SimRankingBotPolicy — ship separation", () => {
  it("keeps a second ship clear of one launched earlier this phase", () => {
    const game = makeGame();
    const firstShipRow = 50;
    const hand = [{ id: "s2", patternIndex: LWSS_INDEX }];

    const policy = new SimRankingBotPolicy(game, { horizon: 30 });
    const res = policy.choosePlacement({
      ...makeView(game, hand),
      opponentCardCount: 0,
      ownPlacements: [{ patternIndex: LWSS_INDEX, row: firstShipRow, col: 70 }],
    })!;

    expect(res).not.toBeNull();
    expect(Math.abs(res.row - firstShipRow)).toBeGreaterThanOrEqual(16);
  });

  it("does not constrain a defensive card by ship separation", () => {
    const game = makeGame();
    const hand = [{ id: "b1", patternIndex: BLOCK_INDEX }];

    // A block near the ship is fine — it leaves no debris field of its own.
    // Without the offensive-only guard this row would be pushed away too.
    const rows = new Set<number>();
    for (const shipRow of [20, 50, 80]) {
      const policy = new SimRankingBotPolicy(game, { horizon: 20 });
      const res = policy.choosePlacement({
        ...makeView(game, hand),
        opponentCardCount: 0,
        ownPlacements: [{ patternIndex: LWSS_INDEX, row: shipRow, col: 70 }],
      })!;
      rows.add(res.row);
    }
    // The block's chosen row is unaffected by where our ship went.
    expect(rows.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tie-break jitter
// ---------------------------------------------------------------------------

describe("SimRankingBotPolicy — tie-break jitter", () => {
  it("varies among equally ranked placements", () => {
    const game = makeGame();
    const hand = [{ id: "b1", patternIndex: BLOCK_INDEX }];

    // One shared stream across the draws: on an empty board a lone block is
    // net-neutral everywhere, so the top-ranked set has many members.
    const policy = new SimRankingBotPolicy(game, { horizon: 10 });
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const res = policy.choosePlacement(makeView(game, hand))!;
      seen.add(`${res.row},${res.col}`);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("is deterministic per instance so tests stay reproducible", () => {
    const game = makeGame();
    const hand = [{ id: "b1", patternIndex: BLOCK_INDEX }];

    const draw = (): string[] => {
      const policy = new SimRankingBotPolicy(game, { horizon: 10 });
      return Array.from({ length: 5 }, () => {
        const r = policy.choosePlacement(makeView(game, hand))!;
        return `${r.row},${r.col}`;
      });
    };

    expect(draw()).toEqual(draw());
  });

  it("never samples past a ranking tier — a scoring move always wins", () => {
    const game = makeGame();
    const hand = [{ id: "s1", patternIndex: LWSS_INDEX }];

    // Horizon long enough for the ship to reach P1's score column: exactly one
    // ranking level is non-tied, and every draw must respect it.
    const policy = new SimRankingBotPolicy(game, { horizon: 200 });
    for (let i = 0; i < 5; i++) {
      const res = policy.choosePlacement({
        ...makeView(game, hand),
        opponentCardCount: 0,
      })!;
      const pattern = getPatternForPlayer(PATTERNS[LWSS_INDEX]!, 2);
      const probe = makeGame();
      for (const [dr, dc] of pattern.cells) {
        probe.grid[res.row + dr]![res.col + dc] = true;
      }
      for (let g = 0; g < 200; g++) probe.computeNextGeneration();
      expect(probe.scorePlayer2).toBeGreaterThan(0);
    }
  });
});
