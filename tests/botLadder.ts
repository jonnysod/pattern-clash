// Bot-vs-bot calibration harness — a design tool, not shipped code.
//
// Plays two difficulty levels against each other headless, through the same
// production path a real bot game takes: BotController → sendAction →
// game.apply*, with the observation layer (score events, motion frames,
// budget snapshots) fed exactly the way ui.ts feeds it during a live match.
// Skipping that feeding would silently measure a *blind* level-3/4 bot —
// the threat signals would stay empty — which is the wrong ladder.
//
// The mirror trick: every policy and the whole BotController are hardwired
// to play P2. The P1 side therefore plays behind a mirrored facade — it
// believes it is P2 on a horizontally mirrored board. The board layout is
// mirror-symmetric (asserted in botLadder.test.ts) except for a known
// off-by-one in the score L-arms — 28 corner cells where the mirrored
// side's judgment is slightly wrong while the real scoring stays exact
// (see the pinning test for the details). Measurements stay fair because
// runPairing alternates which side each level plays, so the residual bias
// hits both levels equally. The facade swaps the player axis; the harness
// mirrors grids, event columns and placement anchors at the boundary.
// Production code is untouched.
//
// Timers are bypassed on purpose: executePlacement() is invoked directly,
// which is the same policy → sendAction → apply path schedulePlacement()
// would take, minus the pacing setTimeout (see the "verify bots headless"
// learning — hidden-tab timer freezes are exactly what this avoids).

import { Game } from "../src/game.js";
import { BotController } from "../src/botController.js";
import { createBotPolicy } from "../src/botDifficulty.js";
import type { BotDifficultyLevel } from "../src/botDifficulty.js";
import { PATTERNS } from "../src/patterns.js";
import type { Player, ScoreEvent, SyncAction } from "../src/types.js";
import type { SyncManager } from "../src/syncManager.js";
import type { BuyPersona } from "../src/botBuy.js";
import { TEST_COLS, TEST_ROWS } from "./_helpers.js";

//#region Mirror geometry

export function mirrorGrid(grid: boolean[][]): boolean[][] {
  return grid.map((row) => [...row].reverse());
}

// Anchor translation between real space and mirrored space (an involution):
// a pattern of width w anchored at `col` occupies [col, col+w-1], its mirror
// image occupies [cols-w-col, cols-1-col] — anchored at cols - w - col.
// Works in both directions because base pattern (P1) and mirrored pattern
// (P2) share the same bounding-box width.
export function mirrorAnchorCol(
  col: number,
  patternWidth: number,
  cols: number,
): number {
  return cols - patternWidth - col;
}

export function patternWidth(patternIndex: number): number {
  const pattern = PATTERNS[patternIndex];
  if (!pattern) return 1;
  let max = 0;
  for (const [, dc] of pattern.cells) {
    if (dc > max) max = dc;
  }
  return max + 1;
}

// A real-space score event as the mirrored P1 side must see it: the column
// mirrors, the row stays, and the player axis swaps — the P1 side's "own"
// points are real P1 points, so real scorer 1 becomes mirrored scorer 2.
export function mirrorEvent(e: ScoreEvent, cols: number): ScoreEvent {
  return {
    row: e.row,
    col: cols - 1 - e.col,
    scorer: e.scorer === 1 ? 2 : 1,
    points: e.points,
  };
}

//#endregion

//#region PRNG

// Deterministic Park–Miller PRNG, same style the bot tests already use.
// Each game gets its own seed so a run is reproducible line by line.
export function makeRng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => ((s = (s * 48271) % 2147483647) / 2147483647);
}

//#endregion

//#region Mirrored game facade

const swapPlayer = (p: Player): Player => (p === 1 ? 2 : 1);

// The subset of Game that BotController and the policies actually touch,
// re-expressed for a bot that believes it is P2 on the mirrored board.
// zones is passed through unchanged: the layout is mirror-symmetric, so the
// real Zones object answers mirrored-space questions correctly as-is.
function makeMirrorFacade(game: Game): Game {
  const facade = {
    rows: game.rows,
    cols: game.cols,
    zones: game.zones,
    get grid() {
      return mirrorGrid(game.grid);
    },
    get simGenerations() {
      return game.simGenerations;
    },
    get currentPhaseNumber() {
      return game.currentPhaseNumber;
    },
    get scorePlayer1() {
      return game.scorePlayer2;
    },
    get scorePlayer2() {
      return game.scorePlayer1;
    },
    getBudget: (p: Player) => game.getBudget(swapPlayer(p)),
    getHand: (p: Player) => game.getHand(swapPlayer(p)),
    getSlotCount: (p: Player) => game.getSlotCount(swapPlayer(p)),
    getCardById: (p: Player, id: string) =>
      game.getCardById(swapPlayer(p), id),
    buyPattern: (p: Player, idx: number) =>
      game.buyPattern(swapPlayer(p), idx),
  };
  return facade as unknown as Game;
}

//#endregion

//#region Single game

export interface LadderGameResult {
  winner: Player | null; // null = draw
  score1: number;
  score2: number;
  // Persona label per side ("balanced/150"), or "-" for levels without one.
  persona1: string;
  persona2: string;
  decisionMs1: number[];
  decisionMs2: number[];
}

interface Side {
  player: Player;
  controller: BotController;
  takePending: () => SyncAction[];
  personaLabel: string;
}

function makeSide(
  player: Player,
  level: BotDifficultyLevel,
  game: Game,
  facade: Game,
  seed: number,
): Side {
  const g = player === 1 ? facade : game;
  const policy = createBotPolicy(level, g, makeRng(seed));
  let pending: SyncAction[] = [];
  const sync = {
    start() {},
    stop() {},
    sendAction(action: SyncAction) {
      pending.push(action);
    },
    onRemoteAction: null,
  } as unknown as SyncManager;
  const persona = (policy as { persona?: BuyPersona }).persona;
  return {
    player,
    controller: new BotController(g, sync, policy),
    takePending: () => {
      const actions = pending;
      pending = [];
      return actions;
    },
    personaLabel: persona
      ? `${persona.profile.name}/${persona.leadDefenceThreshold}`
      : "-",
  };
}

export function runLadderGame(
  levelP1: BotDifficultyLevel,
  levelP2: BotDifficultyLevel,
  seed: number,
  options?: { phases?: number },
): LadderGameResult {
  const game = new Game(TEST_ROWS, TEST_COLS);
  if (options?.phases !== undefined) {
    // Shortened games for cheap smoke runs of the harness itself; real
    // measurements always play the full arc (the late phases carry ~30% of
    // the points, so truncating would measure a different game).
    (game as { totalPhases: number }).totalPhases = options.phases;
  }
  const facade = makeMirrorFacade(game);
  const sides: [Side, Side] = [
    makeSide(1, levelP1, game, facade, seed * 2 + 1),
    makeSide(2, levelP2, game, facade, seed * 2 + 2),
  ];
  const sideOf = (p: Player): Side => sides[p - 1]!;
  const decisionMs: [number[], number[]] = [[], []];

  // Every event batch reaches both observation layers, each in its own
  // coordinate frame — including the stability skip's trailing flush, the
  // same invariant ui.ts holds for the score floaters.
  const feedEvents = (events: ScoreEvent[]): void => {
    if (events.length === 0) return;
    sideOf(2).controller.recordScoreEvents(events);
    sideOf(1).controller.recordScoreEvents(
      events.map((e) => mirrorEvent(e, game.cols)),
    );
  };

  const applyPlacement = (side: Side, action: SyncAction): boolean => {
    if (action.type !== "placement") return false;
    const width = patternWidth(action.patternIndex);
    const realCol =
      side.player === 1
        ? mirrorAnchorCol(action.col, width, game.cols)
        : action.col;
    const ok = game.applyPlacement(
      side.player,
      action.cardId,
      action.patternIndex,
      action.row,
      realCol,
    );
    if (!ok) return false;
    // Both sides witness the placement (like ui.ts right after a successful
    // applyPlacement), each in its own frame.
    sideOf(2).controller.recordPlacement(
      side.player,
      action.patternIndex,
      action.row,
      realCol,
    );
    sideOf(1).controller.recordPlacement(
      swapPlayer(side.player),
      action.patternIndex,
      action.row,
      mirrorAnchorCol(realCol, width, game.cols),
    );
    return true;
  };

  for (let phase = 1; phase <= game.totalPhases; phase++) {
    // --- Buy phase (mirrors ui.startBuyPhase) ---
    game.awardPhaseBudget();
    sideOf(1).controller.beginBuyPhase();
    sideOf(2).controller.beginBuyPhase();

    // The phase starter buys first, so the second buyer reads the starter's
    // spend — the information edge production always gives the bot (it buys
    // after the human confirms). Alternating the starter hands that edge to
    // each side for three of the six phases.
    const starter = game.getPhaseStarter();
    for (const side of [sideOf(starter), sideOf(swapPlayer(starter))]) {
      side.controller.executeBuy();
      for (const action of side.takePending()) {
        if (action.type === "buyConfirm") {
          game.applyBuyConfirm(
            side.player,
            action.cardCount,
            action.remainingBudget,
          );
        }
      }
    }
    if (!game.bothPlayersConfirmed()) {
      throw new Error(`buy phase ${phase} did not confirm both players`);
    }
    game.finalizeBuyPhase();

    // --- Place phase (mirrors ui.startPlacePhase/beginTurn/advanceTurn) ---
    sideOf(1).controller.clearPlacements();
    sideOf(2).controller.clearPlacements();
    let active: Player = starter;
    let safety = 0;
    while (!game.isPlacePhaseDone()) {
      if (safety++ > 200) throw new Error(`place phase ${phase} stuck`);
      if (game.getHand(active).length === 0) active = swapPlayer(active);
      const side = sideOf(active);
      const handBefore = game.getHand(active).length;
      const t0 = performance.now();
      // Same production path schedulePlacement() triggers, minus the timer.
      (side.controller as unknown as { executePlacement(): void })
        .executePlacement();
      decisionMs[active - 1]!.push(performance.now() - t0);
      let placed = false;
      for (const action of side.takePending()) {
        placed = applyPlacement(side, action) || placed;
      }
      if (!placed || game.getHand(active).length !== handBefore - 1) {
        throw new Error(
          `P${active} failed to place in phase ${phase} (hand ${handBefore})`,
        );
      }
      active = swapPlayer(active);
    }

    // --- Simulation (mirrors ui.startSimulation/onStabilitySkip) ---
    game.setPhase("simulation");
    sideOf(1).controller.beginSimulationRecording();
    sideOf(2).controller.beginSimulationRecording();
    for (;;) {
      game.computeNextGeneration();
      feedEvents(game.scoreEvents);
      sideOf(2).controller.recordSimulationFrame(
        game.grid,
        game.currentGeneration,
      );
      sideOf(1).controller.recordSimulationFrame(
        mirrorGrid(game.grid),
        game.currentGeneration,
      );
      if (game.isSimulationComplete()) break;
      const period = game.detectStablePeriod();
      if (period === 1 || period === 2) {
        feedEvents(game.skipToGeneration(game.simGenerations, period));
        break;
      }
    }
    game.advanceAfterSimulation();
  }

  if (!game.isEnded) throw new Error("game did not end after final phase");
  const result = game.getWinner();
  return {
    winner: result.winner,
    score1: result.player1Score,
    score2: result.player2Score,
    persona1: sideOf(1).personaLabel,
    persona2: sideOf(2).personaLabel,
    decisionMs1: decisionMs[0]!,
    decisionMs2: decisionMs[1]!,
  };
}

//#endregion

//#region Pairing

export interface PairingSummary {
  levelA: BotDifficultyLevel;
  levelB: BotDifficultyLevel;
  games: number;
  winsA: number;
  winsB: number;
  draws: number;
  // Mean of (A score − B score): a continuous strength signal with far more
  // statistical power per game than the win/loss bit, which matters for the
  // expensive pairings that cannot afford 100 games.
  meanMargin: number;
  maxDecisionMsA: number;
  maxDecisionMsB: number;
}

// Runs `games` games of level A vs level B, alternating which side A plays
// so neither level collects a side-specific artefact. `onGame` receives one
// finished-game line at a time for incremental logging (long runs must not
// buffer silently — see the pipe-buffering learning).
export function runPairing(
  levelA: BotDifficultyLevel,
  levelB: BotDifficultyLevel,
  games: number,
  baseSeed: number,
  onGame?: (line: string) => void,
  options?: { phases?: number },
): PairingSummary {
  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  let marginSum = 0;
  let maxA = 0;
  let maxB = 0;

  for (let i = 0; i < games; i++) {
    const aPlaysP1 = i % 2 === 0;
    const r = runLadderGame(
      aPlaysP1 ? levelA : levelB,
      aPlaysP1 ? levelB : levelA,
      baseSeed + i,
      options,
    );
    const scoreA = aPlaysP1 ? r.score1 : r.score2;
    const scoreB = aPlaysP1 ? r.score2 : r.score1;
    const winner =
      r.winner === null ? null : (r.winner === 1) === aPlaysP1 ? "A" : "B";
    if (winner === "A") winsA++;
    else if (winner === "B") winsB++;
    else draws++;
    marginSum += scoreA - scoreB;
    const msA = aPlaysP1 ? r.decisionMs1 : r.decisionMs2;
    const msB = aPlaysP1 ? r.decisionMs2 : r.decisionMs1;
    maxA = Math.max(maxA, ...msA, 0);
    maxB = Math.max(maxB, ...msB, 0);
    onGame?.(
      `L${levelA}vL${levelB} game ${i + 1}/${games} | ` +
        `A(${aPlaysP1 ? "P1" : "P2"}) ${scoreA} : ${scoreB} B | ` +
        `winner ${winner ?? "draw"} | ` +
        `personas ${aPlaysP1 ? r.persona1 : r.persona2} vs ` +
        `${aPlaysP1 ? r.persona2 : r.persona1}`,
    );
  }

  return {
    levelA,
    levelB,
    games,
    winsA,
    winsB,
    draws,
    meanMargin: marginSum / games,
    maxDecisionMsA: maxA,
    maxDecisionMsB: maxB,
  };
}

export function formatSummary(s: PairingSummary): string {
  const rate = ((100 * s.winsA) / s.games).toFixed(0);
  return (
    `=== L${s.levelA} vs L${s.levelB} over ${s.games} games: ` +
    `A wins ${s.winsA} (${rate}%), B wins ${s.winsB}, draws ${s.draws} | ` +
    `mean margin ${s.meanMargin.toFixed(1)} | ` +
    `max decision A ${s.maxDecisionMsA.toFixed(0)}ms / ` +
    `B ${s.maxDecisionMsB.toFixed(0)}ms ===`
  );
}

//#endregion
