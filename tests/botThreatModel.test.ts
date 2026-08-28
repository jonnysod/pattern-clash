// Tests for the threat-aware defensive placement (Fix 3b).
//
// Two halves:
//   1. The movement profiles in PATTERNS are correct — verified against the
//      simulation itself, not against hand-derived numbers.
//   2. The bot aims its defensive candidates at projected trajectories, and
//      still falls back to the uniform scatter when there is nothing to aim at.

import { describe, it, expect } from "vitest";
import { SimRankingBotPolicy } from "../src/botPolicy.js";
import type { BotView, WitnessedPlacement } from "../src/botPolicy.js";
import { BotController } from "../src/botController.js";
import { LocalSyncManager } from "../src/syncManager.js";
import { PATTERNS } from "../src/patterns.js";
import { getPatternForPlayer } from "../src/patternUtils.js";
import { BALANCED_PROFILE } from "../src/botPolicy.js";
import { makeGame, BLOCK_INDEX, LWSS_INDEX } from "./_helpers.js";

const MWSS_INDEX = 1;
const GLIDER_DOWN_INDEX = 8;
const GLIDER_UP_INDEX = 9;
const GUN_UP_INDEX = 11;
const GUN_DOWN_INDEX = 12;

function makeView(
  game: ReturnType<typeof makeGame>,
  ownHand: BotView["ownHand"],
  opponentPlacements: WitnessedPlacement[] = [],
  observedScoreRows: number[] = [],
): BotView {
  return {
    grid: game.grid,
    phase: game.currentPhaseNumber,
    ownBudget: game.getBudget(2),
    ownHand,
    opponentCardCount: game.getHand(1).length,
    ownScore: game.scorePlayer2,
    opponentScore: game.scorePlayer1,
    opponentPlacements,
    ownPlacements: [],
    opponentBudget: 0,
    opponentSpentThisPhase: null,
    observedScoreRows,
    observedMotion: [],
  };
}

// Place a P1 pattern, run it forward, and report the live-cell centroid.
// This is the ground truth the movement profiles are checked against.
function centroidAfter(
  patternIndex: number,
  row: number,
  col: number,
  gens: number,
): { row: number; col: number; cells: number } {
  const game = makeGame();
  const pattern = getPatternForPlayer(PATTERNS[patternIndex]!, 1);
  game.placePattern(row, col, pattern, 1);
  for (let i = 0; i < gens; i++) {
    game.currentGeneration = i;
    game.computeNextGeneration();
  }
  let n = 0;
  let sumRow = 0;
  let sumCol = 0;
  for (let r = 0; r < game.rows; r++) {
    for (let c = 0; c < game.cols; c++) {
      if (game.grid[r]![c]) {
        n++;
        sumRow += r;
        sumCol += c;
      }
    }
  }
  return {
    row: n === 0 ? -1 : Math.round(sumRow / n),
    col: n === 0 ? -1 : Math.round(sumCol / n),
    cells: n,
  };
}

// ---------------------------------------------------------------------------
// Movement profiles match the simulation
// ---------------------------------------------------------------------------

describe("Pattern movement profiles — verified against simulation", () => {
  it("orthogonal spaceships hold their row and advance at c/2", () => {
    for (const idx of [LWSS_INDEX, MWSS_INDEX]) {
      const profile = PATTERNS[idx]!.movement;
      expect(profile.kind).toBe("orthogonal");

      const a = centroidAfter(idx, 40, 20, 60);
      const b = centroidAfter(idx, 40, 20, 120);

      // Row preserved exactly — this is what makes "block in the same row" work.
      expect(b.row).toBe(a.row);

      const colsAdvanced = b.col - a.col;
      expect(colsAdvanced / 60).toBeCloseTo(profile.colsPerGen, 2);
      expect(profile.rowPerCol).toBe(0);
    }
  });

  it("gliders drift exactly one row per column travelled, at c/4", () => {
    for (const idx of [GLIDER_DOWN_INDEX, GLIDER_UP_INDEX]) {
      const profile = PATTERNS[idx]!.movement;
      expect(profile.kind).toBe("diagonal");

      // Start centred so neither direction reaches an edge within the window.
      const a = centroidAfter(idx, 50, 20, 60);
      const b = centroidAfter(idx, 50, 20, 120);

      const colsAdvanced = b.col - a.col;
      const rowsDrifted = b.row - a.row;

      expect(colsAdvanced / 60).toBeCloseTo(profile.colsPerGen, 2);
      expect(rowsDrifted / colsAdvanced).toBeCloseTo(profile.rowPerCol, 2);
    }
  });

  it("glider guns are stationary emitters whose stream matches rowPerCol", () => {
    for (const idx of [GUN_UP_INDEX, GUN_DOWN_INDEX]) {
      const profile = PATTERNS[idx]!.movement;
      expect(profile.kind).toBe("emitter");

      // The leading (rightmost) cell is the head of the emitted stream.
      const game = makeGame();
      const pattern = getPatternForPlayer(PATTERNS[idx]!, 1);
      game.placePattern(30, 10, pattern, 1);
      const samples: { row: number; col: number }[] = [];
      for (let i = 0; i < 200; i++) {
        game.currentGeneration = i;
        game.computeNextGeneration();
        if (i !== 99 && i !== 159) continue;
        let bestRow = -1;
        let bestCol = -1;
        for (let r = 0; r < game.rows; r++) {
          for (let c = 0; c < game.cols; c++) {
            if (game.grid[r]![c] && c > bestCol) {
              bestCol = c;
              bestRow = r;
            }
          }
        }
        samples.push({ row: bestRow, col: bestCol });
      }
      const [a, b] = samples as [
        { row: number; col: number },
        { row: number; col: number },
      ];
      const drift = (b.row - a.row) / (b.col - a.col);
      expect(drift).toBeCloseTo(profile.rowPerCol, 1);
    }
  });

  it("still lifes and oscillators are marked static", () => {
    for (const idx of [2, 3, 4, 5, 6, 7]) {
      expect(PATTERNS[idx]!.movement.kind).toBe("static");
      expect(PATTERNS[idx]!.movement.colsPerGen).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Threat-aimed defensive candidates
// ---------------------------------------------------------------------------

// The bot is P2. Its own zone is the right-hand one; a P1 threat travels
// towards increasing columns.
// Tie-break jitter draws from the policy's own seeded stream, so two calls on
// one instance can legitimately pick different members of an equal-ranked set.
// The tests below compare *decisions*, not draws, so each call gets a fresh
// instance — same seed, same stream position, differences attributable only to
// the view.
function decideFresh(
  game: ReturnType<typeof makeGame>,
  view: BotView,
): { cardId: string; row: number; col: number } | null {
  return new SimRankingBotPolicy(game, { horizon: 20 }).choosePlacement(view);
}

describe("SimRankingBotPolicy — threat-aimed defence", () => {
  it("answers an orthogonal ship in the row it was placed in", () => {
    const game = makeGame();
    const threatRow = 30;
    // Small horizon: this checks candidate aiming, not sim depth.
    const policy = new SimRankingBotPolicy(game, { horizon: 20 });

    const result = policy.choosePlacement(
      makeView(game, [{ id: "d1", patternIndex: BLOCK_INDEX }], [
        { patternIndex: MWSS_INDEX, row: threatRow, col: 10 },
      ]),
    );

    expect(result).not.toBeNull();
    // The ship holds its row, so the block belongs at that row (± the
    // source-offset/band tolerance the generator allows).
    const mwssHeight =
      Math.max(...PATTERNS[MWSS_INDEX]!.cells.map((c) => c[0])) + 1;
    const expectedRow = threatRow + Math.floor(mwssHeight / 2);
    expect(Math.abs(result!.row - expectedRow)).toBeLessThanOrEqual(3);
  });

  it("answers a glider at its projected row, not its placement row", () => {
    const game = makeGame();
    const policy = new SimRankingBotPolicy(game, { horizon: 20 });
    const threat: WitnessedPlacement = {
      patternIndex: GLIDER_DOWN_INDEX,
      row: 10,
      col: 20,
    };

    const result = policy.choosePlacement(
      makeView(game, [{ id: "d1", patternIndex: BLOCK_INDEX }], [threat]),
    );
    expect(result).not.toBeNull();

    // Drift is +1 row per column, so the intercept row rises with the column
    // the bot chose. Placement row (10) is nowhere near it.
    const gliderHeight =
      Math.max(...PATTERNS[GLIDER_DOWN_INDEX]!.cells.map((c) => c[0])) + 1;
    const projected =
      threat.row +
      Math.floor(gliderHeight / 2) +
      (result!.col - threat.col);
    expect(Math.abs(result!.row - projected)).toBeLessThanOrEqual(3);
    expect(result!.row).toBeGreaterThan(threat.row + 20);
  });

  it("ignores a defensive placement — an opponent's own block is no threat", () => {
    const game = makeGame();
    const withStatic = decideFresh(
      game,
      makeView(game, [{ id: "d1", patternIndex: BLOCK_INDEX }], [
        { patternIndex: BLOCK_INDEX, row: 30, col: 10 },
      ]),
    );
    const withNothing = decideFresh(
      game,
      makeView(game, [{ id: "d1", patternIndex: BLOCK_INDEX }], []),
    );

    // A static piece contributes no candidates, so the decision is identical
    // to having witnessed nothing at all.
    expect(withStatic).toEqual(withNothing);

    // Contrast, so the assertion above cannot pass vacuously: a *moving*
    // piece at the same spot must change the decision.
    const withThreat = decideFresh(
      game,
      makeView(game, [{ id: "d1", patternIndex: BLOCK_INDEX }], [
        { patternIndex: MWSS_INDEX, row: 30, col: 10 },
      ]),
    );
    expect(withThreat).not.toEqual(withNothing);
  });

  it("ignores a glider whose diagonal leaves the grid before arriving", () => {
    const game = makeGame();

    // Travelling up from row 5: it hits the top edge long before reaching
    // P2's zone, so it never becomes a threat and must not attract a card.
    const doomed = decideFresh(
      game,
      makeView(game, [{ id: "d1", patternIndex: BLOCK_INDEX }], [
        { patternIndex: GLIDER_UP_INDEX, row: 5, col: 10 },
      ]),
    );
    const withNothing = decideFresh(
      game,
      makeView(game, [{ id: "d1", patternIndex: BLOCK_INDEX }], []),
    );

    expect(doomed).toEqual(withNothing);

    // Contrast: the same glider launched from mid-field stays on the grid all
    // the way over and must be answered.
    const arriving = decideFresh(
      game,
      makeView(game, [{ id: "d1", patternIndex: BLOCK_INDEX }], [
        { patternIndex: GLIDER_UP_INDEX, row: 80, col: 10 },
      ]),
    );
    expect(arriving).not.toEqual(withNothing);
  });

  it("does not aim at a threat already past the candidate column", () => {
    const game = makeGame();

    // Placed beyond P2's zone entirely — nothing in the zone is on its path.
    const behind = decideFresh(
      game,
      makeView(game, [{ id: "d1", patternIndex: BLOCK_INDEX }], [
        { patternIndex: MWSS_INDEX, row: 30, col: game.cols - 2 },
      ]),
    );
    const withNothing = decideFresh(
      game,
      makeView(game, [{ id: "d1", patternIndex: BLOCK_INDEX }], []),
    );

    expect(behind).toEqual(withNothing);
  });

  it("still produces legal candidates when no threat was witnessed", () => {
    const game = makeGame();
    const policy = new SimRankingBotPolicy(game, { horizon: 20 });

    const result = policy.choosePlacement(
      makeView(game, [{ id: "d1", patternIndex: BLOCK_INDEX }], []),
    );

    expect(result).not.toBeNull();
    const pattern = getPatternForPlayer(PATTERNS[BLOCK_INDEX]!, 2);
    expect(
      game.zones.isValidPatternPlacement(pattern, result!.row, result!.col, 2),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Score-source detection (stationary threats)
// ---------------------------------------------------------------------------

// Build the board a spaceship leaves behind after crashing into the far wall:
// a stationary oscillator that keeps birthing cells into P1's score column.
// Nothing about it moves, so no motion-based test could ever find it — the
// only signal is that it scores.
// Returns both halves of what the bot gets after such a phase: the board the
// debris sits on, and the score rows a watching player would have seen — the
// latter recorded from the real simulation exactly as BotController does.
function debrisPhase(seedRow: number = 40): {
  board: boolean[][];
  observedRows: number[];
} {
  const seed = makeGame();
  seed.placePattern(seedRow, 28, getPatternForPlayer(PATTERNS[MWSS_INDEX]!, 1), 1);
  const pointsByRow = new Map<number, number>();
  for (let i = 0; i < 150; i++) {
    seed.currentGeneration = i;
    seed.computeNextGeneration();
    for (const e of seed.scoreEvents) {
      if (e.scorer === 2) continue;
      pointsByRow.set(e.row, (pointsByRow.get(e.row) ?? 0) + e.points);
    }
  }
  return {
    board: seed.grid.map((r) => r.slice()),
    observedRows: [...pointsByRow.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([row]) => row),
  };
}

function gameWithBoard(board: boolean[][]) {
  const game = makeGame();
  for (let r = 0; r < game.rows; r++) {
    for (let c = 0; c < game.cols; c++) game.grid[r]![c] = board[r]![c]!;
  }
  return game;
}

function scoreOverPhase(
  board: boolean[][],
  place: { row: number; col: number } | null,
  gens: number,
): number {
  const game = gameWithBoard(board);
  if (place) {
    game.placePattern(
      place.row,
      place.col,
      getPatternForPlayer(PATTERNS[BLOCK_INDEX]!, 2),
      2,
    );
  }
  for (let i = 0; i < gens; i++) {
    game.currentGeneration = i;
    game.computeNextGeneration();
  }
  return game.scorePlayer1;
}

describe("SimRankingBotPolicy — stationary scoring sources", () => {
  // Swept across seed rows on purpose. With a single fixed row this suite
  // passes even with score-source detection disabled: the uniform scatter's
  // rows land near the debris by luck and the ranker salvages it (measured:
  // 64 points left standing instead of 10). Move the debris off that lucky
  // alignment — seed row 63 — and the scatter answers 340 out of 340, i.e.
  // nothing at all. The threshold below is set to separate those outcomes.
  for (const seedRow of [15, 40, 63, 78]) {
    it(`defends carry-over debris seeded at row ${seedRow}`, () => {
      const { board, observedRows } = debrisPhase(seedRow);
      const game = gameWithBoard(board);
      const policy = new SimRankingBotPolicy(game, { horizon: 170 });

      // opponentPlacements is empty on purpose: the debris is pure carry-over
      // from an earlier phase, so the only signal is where it scored while the
      // player was watching. No motion test could find it either — its
      // bounding box never moves again.
      const result = policy.choosePlacement(
        makeView(game, [{ id: "d1", patternIndex: BLOCK_INDEX }], [], observedRows),
      );
      expect(result).not.toBeNull();

      const undefended = scoreOverPhase(board, null, 170);
      const defended = scoreOverPhase(board, result!, 170);

      expect(undefended).toBeGreaterThan(300); // the debris really is scoring
      expect(defended).toBeLessThanOrEqual(25);
    });
  }

  it("aims hard against the debris, not just anywhere in the zone", () => {
    const { board, observedRows } = debrisPhase(63);
    const game = gameWithBoard(board);
    const policy = new SimRankingBotPolicy(game, { horizon: 170 });

    const result = policy.choosePlacement(
      makeView(game, [{ id: "d1", patternIndex: BLOCK_INDEX }], [], observedRows),
    )!;

    // An exhaustive sweep of the zone found that only the columns hard against
    // the debris do anything at all — the median placement changes nothing.
    // So the column, not just the row, is the load-bearing part of the answer.
    expect(result.col).toBeGreaterThanOrEqual(90);
    expect(Math.abs(result.row - 63)).toBeLessThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// Observed motion (in-flight carry-over)
// ---------------------------------------------------------------------------

// Run a simulation phase through the controller exactly as UIController does,
// so the frames and score events are observed rather than constructed.
function observePhase(
  threats: { patternIndex: number; row: number; col: number }[],
  generations = 150,
) {
  const game = makeGame();
  const controller = new BotController(
    game,
    new LocalSyncManager(),
    new SimRankingBotPolicy(game, { horizon: 170 }),
  );
  for (const t of threats) {
    game.placePattern(
      t.row,
      t.col,
      getPatternForPlayer(PATTERNS[t.patternIndex]!, 1),
      1,
    );
  }
  controller.beginSimulationRecording();
  for (let i = 0; i < generations; i++) {
    game.currentGeneration = i;
    game.computeNextGeneration();
    controller.recordScoreEvents(game.scoreEvents);
    controller.recordSimulationFrame(game.grid, game.currentGeneration);
  }
  const view = (controller as unknown as { buildView(): BotView }).buildView();
  return { board: game.grid.map((r) => r.slice()), view };
}

describe("BotController — observed motion", () => {
  it("measures a spaceship's velocity from the observed frames", () => {
    // Rear of P1's zone: 184 generations of travel, so it scores nothing in a
    // 150-generation phase and is invisible to the score signal.
    const { view } = observePhase([{ patternIndex: MWSS_INDEX, row: 40, col: 4 }]);

    expect(view.observedScoreRows).toEqual([]);
    expect(view.observedMotion).toHaveLength(1);
    const mover = view.observedMotion[0]!;
    expect(mover.colsPerGen).toBeCloseTo(0.5, 2); // c/2, measured not assumed
    expect(mover.rowsPerGen).toBeCloseTo(0, 2); // orthogonal: holds its row
    expect(Math.abs(mover.row - 42)).toBeLessThanOrEqual(4);
  });

  it("measures a glider's diagonal drift", () => {
    const { view } = observePhase([
      { patternIndex: GLIDER_DOWN_INDEX, row: 20, col: 6 },
    ]);

    expect(view.observedMotion.length).toBeGreaterThan(0);
    const mover = view.observedMotion[0]!;
    expect(mover.colsPerGen).toBeCloseTo(0.25, 2); // c/4
    expect(mover.rowsPerGen / mover.colsPerGen).toBeCloseTo(1, 1); // +1 row/col
  });

  it("does not report still lifes or oscillators as movers", () => {
    const { view } = observePhase([
      { patternIndex: BLOCK_INDEX, row: 20, col: 10 },
      { patternIndex: 5, row: 60, col: 10 }, // Blinker
    ]);

    expect(view.observedMotion).toEqual([]);
  });

  it("defends a ship that crosses a phase boundary without ever scoring", () => {
    const { board, view } = observePhase([
      { patternIndex: MWSS_INDEX, row: 40, col: 4 },
    ]);
    const game = gameWithBoard(board);
    const policy = new SimRankingBotPolicy(game, { horizon: 170 });

    const result = policy.choosePlacement({
      ...view,
      grid: game.grid,
      ownHand: [{ id: "d1", patternIndex: BLOCK_INDEX }],
      opponentPlacements: [],
      ownPlacements: [],
      opponentBudget: 0,
      opponentSpentThisPhase: null,
    })!;
    expect(result).not.toBeNull();

    const undefended = scoreOverPhase(board, null, 170);
    const defended = scoreOverPhase(board, result, 170);

    expect(undefended).toBeGreaterThan(200); // it really does land next phase
    expect(defended).toBeLessThanOrEqual(25);
  });
});

// ---------------------------------------------------------------------------
// Buy gating and spread
// ---------------------------------------------------------------------------

const DEFENSIVE_INDICES = new Set([2, 3, 4, 5, 6, 7]);

function defensiveCards(bundles: { patternIndex: number; count: number }[]) {
  return bundles
    .filter((b) => DEFENSIVE_INDICES.has(b.patternIndex))
    .reduce((sum, b) => sum + b.count, 0);
}

describe("SimRankingBotPolicy — buy gating", () => {
  // Balanced profile pinned: this block is about the threat gating, and a
  // drawn defender profile chases card-count parity regardless of threat,
  // which would confound every assertion here.
  const gatingPolicy = (game: ReturnType<typeof makeGame>) =>
    new SimRankingBotPolicy(game, {
      horizon: 60,
      profile: BALANCED_PROFILE,
    });

  // Three cards for nine points: at the cheapest price in the game that is
  // three Blinkers, so the spend proves the incoming hand cannot fly. Stated
  // explicitly because "nothing threatens me" is a claim about all three
  // signals, and leaving the spend unknown makes the bot assume the worst.
  const HARMLESS_SPEND = 9;

  function buyView(
    game: ReturnType<typeof makeGame>,
    observedScoreRows: number[],
    opponentSpentThisPhase: number | null = HARMLESS_SPEND,
  ): BotView {
    return {
      grid: game.grid,
      phase: 2,
      ownBudget: 50,
      ownHand: [],
      opponentCardCount: 3,
      ownScore: 0,
      opponentScore: 0,
      opponentPlacements: [],
      ownPlacements: [],
      opponentBudget: 0,
      opponentSpentThisPhase,
      observedScoreRows,
      observedMotion: [],
    };
  }

  it("buys defence against a hand whose price says it can fly", () => {
    // Same clean board, same card count — only the spend differs. Three cards
    // for 33 is affordable only as three MWSS, so this must not gate down.
    const game = makeGame();
    const policy = gatingPolicy(game);
    expect(
      defensiveCards(policy.chooseBuy(buyView(game, [], 33))),
    ).toBeGreaterThan(1);
  });

  it("treats an unknown spend as dangerous, not as safe", () => {
    const game = makeGame();
    const policy = gatingPolicy(game);
    expect(
      defensiveCards(policy.chooseBuy(buyView(game, [], null))),
    ).toBeGreaterThan(1);
  });

  it("barely buys defence when nothing scored against it last phase", () => {
    const game = makeGame();
    const policy = gatingPolicy(game);
    expect(
      defensiveCards(policy.chooseBuy(buyView(game, []))),
    ).toBeLessThanOrEqual(1);
  });

  it("buys real defence once something has scored against it", () => {
    const { board, observedRows } = debrisPhase();
    const game = gameWithBoard(board);
    const policy = new SimRankingBotPolicy(game, { horizon: 170 });
    expect(
      defensiveCards(policy.chooseBuy(buyView(game, observedRows))),
    ).toBeGreaterThan(1);
  });
});

describe("SimRankingBotPolicy — spread on a quiet board", () => {
  it("does not pile net-neutral pieces into one row", () => {
    const game = makeGame();
    const policy = new SimRankingBotPolicy(game, { horizon: 20 });
    const rows: number[] = [];

    // Three blocks placed in sequence on an empty board: every candidate is
    // net 0, so this is decided entirely by the tie-break tiers.
    for (let i = 0; i < 3; i++) {
      const result = policy.choosePlacement(
        makeView(game, [{ id: `b${i}`, patternIndex: BLOCK_INDEX }], []),
      )!;
      rows.push(result.row);
      game.placePattern(
        result.row,
        result.col,
        getPatternForPlayer(PATTERNS[BLOCK_INDEX]!, 2),
        2,
      );
    }

    expect(new Set(rows).size).toBe(3);
    const sorted = [...rows].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThan(5);
    }
  });
});

// ---------------------------------------------------------------------------
// Controller bookkeeping
// ---------------------------------------------------------------------------

describe("BotController — opponent placement record", () => {
  function setup() {
    const game = makeGame();
    const sync = new LocalSyncManager();
    const seen: BotView[] = [];
    const policy = {
      chooseBuy: () => [],
      choosePlacement: (view: BotView) => {
        seen.push({ ...view, opponentPlacements: [...view.opponentPlacements] });
        return null;
      },
    };
    const controller = new BotController(game, sync, policy);
    return { game, controller, seen };
  }

  it("records opponent placements and exposes them in the view", () => {
    const { controller, seen } = setup();
    controller.recordPlacement(1, MWSS_INDEX, 30, 10);
    controller.recordPlacement(1, GLIDER_DOWN_INDEX, 12, 8);
    controller["executePlacement"]();

    expect(seen[0]!.opponentPlacements).toEqual([
      { patternIndex: MWSS_INDEX, row: 30, col: 10 },
      { patternIndex: GLIDER_DOWN_INDEX, row: 12, col: 8 },
    ]);
  });

  it("ignores the bot's own placements", () => {
    const { controller, seen } = setup();
    controller.recordPlacement(2, MWSS_INDEX, 30, 80);
    controller["executePlacement"]();

    expect(seen[0]!.opponentPlacements).toEqual([]);
  });

  it("ignores unresolved placeholder cards", () => {
    const { controller, seen } = setup();
    controller.recordPlacement(1, -1, 30, 10);
    controller["executePlacement"]();

    expect(seen[0]!.opponentPlacements).toEqual([]);
  });

  it("clears the record between place phases", () => {
    const { controller, seen } = setup();
    controller.recordPlacement(1, MWSS_INDEX, 30, 10);
    controller.clearPlacements();
    controller["executePlacement"]();

    expect(seen[0]!.opponentPlacements).toEqual([]);
  });
});

describe("BotController — observed score rows", () => {
  function setup() {
    const game = makeGame();
    const sync = new LocalSyncManager();
    const seen: BotView[] = [];
    const policy = {
      chooseBuy: () => [],
      choosePlacement: (view: BotView) => {
        seen.push({ ...view, observedScoreRows: [...view.observedScoreRows] });
        return null;
      },
    };
    return { controller: new BotController(game, sync, policy), seen };
  }

  const ev = (row: number, points: number, scorer: 1 | 2 = 1) => ({
    row,
    col: 3,
    scorer,
    points,
  });

  it("ranks rows by the points scored there, heaviest first", () => {
    const { controller, seen } = setup();
    controller.beginSimulationRecording();
    controller.recordScoreEvents([ev(10, 1), ev(40, 5), ev(10, 2)]);
    controller["executePlacement"]();

    expect(seen[0]!.observedScoreRows).toEqual([40, 10]);
  });

  it("ignores its own points — only the opponent's are a threat", () => {
    const { controller, seen } = setup();
    controller.beginSimulationRecording();
    controller.recordScoreEvents([ev(40, 9, 2), ev(12, 1, 1)]);
    controller["executePlacement"]();

    expect(seen[0]!.observedScoreRows).toEqual([12]);
  });

  it("keeps only the most recent simulation phase", () => {
    const { controller, seen } = setup();
    controller.beginSimulationRecording();
    controller.recordScoreEvents([ev(10, 5)]);
    // Next phase's simulation starts: last phase's rows must not linger.
    controller.beginSimulationRecording();
    controller.recordScoreEvents([ev(70, 3)]);
    controller["executePlacement"]();

    expect(seen[0]!.observedScoreRows).toEqual([70]);
  });

  it("is empty before any simulation has run (phase 1)", () => {
    const { controller, seen } = setup();
    controller["executePlacement"]();

    expect(seen[0]!.observedScoreRows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Spend bound — the third threat signal
// ---------------------------------------------------------------------------
//
// The opponent's card count and their spend are both public (each player's
// budget is on screen all match, and remainingBudget rides in buyConfirm so
// the other client can display it). Together they bound how many of the cards
// just bought could possibly travel, without revealing which cards they are.

describe("BotController — opponent spend observation", () => {
  function makeController(): {
    controller: BotController;
    game: ReturnType<typeof makeGame>;
    seen: BotView[];
  } {
    const game = makeGame();
    const seen: BotView[] = [];
    const policy = {
      chooseBuy: (view: BotView) => {
        seen.push(view);
        return [];
      },
      choosePlacement: () => null,
    };
    const controller = new BotController(game, new LocalSyncManager(), policy);
    return { controller, game, seen };
  }

  it("reports the spend measured from the phase's opening budget", () => {
    const { controller, game, seen } = makeController();
    const before = game.getBudget(1);

    controller.beginBuyPhase();
    game.buyPattern(1, MWSS_INDEX);
    game.buyPattern(1, MWSS_INDEX);
    controller.executeBuy();

    const spent = 2 * PATTERNS[MWSS_INDEX]!.cells.length;
    expect(seen[0]!.opponentSpentThisPhase).toBe(spent);
    expect(seen[0]!.opponentBudget).toBe(before - spent);
  });

  it("reports null when no opening budget was taken for the phase", () => {
    const { controller, seen } = makeController();
    controller.executeBuy();
    expect(seen[0]!.opponentSpentThisPhase).toBeNull();
  });

  it("re-bases on every buy phase rather than accumulating", () => {
    const { controller, game, seen } = makeController();

    controller.beginBuyPhase();
    game.buyPattern(1, MWSS_INDEX);
    controller.executeBuy();

    // A second phase: the reference point moves, so the previous phase's
    // spend must not leak into this one.
    controller.beginBuyPhase();
    game.buyPattern(1, BLOCK_INDEX);
    controller.executeBuy();

    expect(seen[1]!.opponentSpentThisPhase).toBe(
      PATTERNS[BLOCK_INDEX]!.cells.length,
    );
  });
});
