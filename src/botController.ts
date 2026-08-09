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
import type { ScoreEvent } from "./types.js";
import type {
  BotPolicy,
  BotView,
  MovingThreat,
  OpponentPlacement,
} from "./botPolicy.js";

const BOT_PLACEMENT_DELAY_MS = 600;

// Generations between the two observed frames. Wide enough that a c/2
// spaceship has moved 10 columns — far past the ±2 wobble an oscillator's
// centroid shows — and a multiple of the common period-2 oscillation, so
// still lifes and blinkers land back where they started and cancel out.
const MOTION_SAMPLE_GAP = 20;

// Columns per generation below which a cluster counts as standing still.
// A glider is 0.25 and a spaceship 0.5; measured oscillator noise sat at 0.1.
const MIN_DRIFT_COLS_PER_GEN = 0.15;

// How far from a late cluster to look for its earlier self. A c/2 ship covers
// 10 columns across the sample gap, so this has room to spare.
const MOTION_MATCH_RADIUS = 20;

interface Cluster {
  row: number;
  col: number;
  size: number;
}

// Connected components of live cells (8-connectivity), as centroids. Objects
// rather than rows: a glider changes row as it travels, so per-row comparison
// would lose it exactly when it matters.
function findClusters(grid: boolean[][]): Cluster[] {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const seen: boolean[][] = grid.map(() => new Array<boolean>(cols).fill(false));
  const clusters: Cluster[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!grid[r]![c] || seen[r]![c]) continue;

      let sumRow = 0;
      let sumCol = 0;
      let size = 0;
      const stack: [number, number][] = [[r, c]];
      seen[r]![c] = true;

      while (stack.length > 0) {
        const [cr, cc] = stack.pop()!;
        sumRow += cr;
        sumCol += cc;
        size += 1;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = cr + dr;
            const nc = cc + dc;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            if (!grid[nr]![nc] || seen[nr]![nc]) continue;
            seen[nr]![nc] = true;
            stack.push([nr, nc]);
          }
        }
      }
      clusters.push({ row: sumRow / size, col: sumCol / size, size });
    }
  }
  return clusters;
}

export class BotController {
  private game: Game;
  private syncManager: SyncManager;
  private policy: BotPolicy;
  private pendingTimer: number | null = null;

  // Opponent placements witnessed during the current place phase. Recorded
  // by UIController as each placement is applied, cleared per phase.
  //
  // This is fed from the applied action rather than diffed out of the grid on
  // purpose: a placement may legally land on top of existing debris, in which
  // case the grid only gains the cells that were not already alive. A diff
  // would then see a partial footprint and could not identify the pattern —
  // and the pattern's identity is exactly what the trajectory projection
  // needs. The action already carries patternIndex, and the online protocol
  // publishes it at this same moment, so no new information is exposed.
  private opponentPlacements: OpponentPlacement[] = [];

  // Points the opponent scored per row during the simulation phase, fed by
  // UIController as the real simulation emits them. Cleared when a new
  // simulation starts, so during the following buy and place phases this
  // holds exactly the phase that just finished — the same thing the human
  // watched happen on screen.
  private observedPointsByRow: Map<number, number> = new Map();

  // Two frames from the simulation phase, far enough apart for a travelling
  // object to have visibly moved. Diffing them recovers what is in flight —
  // observation of a phase the player watched, not a forward simulation.
  private earlyFrame: { generation: number; grid: boolean[][] } | null = null;
  private lateFrame: { generation: number; grid: boolean[][] } | null = null;

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

  // Record a placement the opponent just made, so the policy can project its
  // trajectory. Ignores the bot's own placements — those are not threats.
  recordOpponentPlacement(
    player: 1 | 2,
    patternIndex: number,
    row: number,
    col: number,
  ): void {
    if (player !== 1) return;
    // A placeholder (-1) is an unresolved remote card; a real placement
    // always carries its index. Nothing to project without one.
    if (patternIndex < 0) return;
    this.opponentPlacements.push({ patternIndex, row, col });
  }

  // Called when a new place phase begins. Trajectories are only exact for
  // pieces that have not moved yet, and a simulation runs between phases —
  // so last phase's placements are stale and must not be projected.
  clearOpponentPlacements(): void {
    this.opponentPlacements = [];
  }

  // Called when a simulation phase starts, before the first tick.
  beginSimulationRecording(): void {
    this.observedPointsByRow = new Map();
    this.earlyFrame = null;
    this.lateFrame = null;
  }

  // Called once per simulation tick with the live grid. Keeps a rolling pair
  // of frames MOTION_SAMPLE_GAP generations apart; only the last pair of the
  // phase survives, which is the state the next decision reasons about.
  recordSimulationFrame(grid: boolean[][], generation: number): void {
    if (
      this.lateFrame !== null &&
      generation - this.lateFrame.generation < MOTION_SAMPLE_GAP
    ) {
      return;
    }
    this.earlyFrame = this.lateFrame;
    this.lateFrame = { generation, grid: grid.map((r) => r.slice()) };
  }

  // Called with every batch of score events the real simulation emits.
  //
  // Must be fed from *every* path that produces events, including the
  // stability skip's trailing flush — the same invariant the score floaters
  // depend on. A path that forgets to report leaves the bot blind to whatever
  // scored there, silently.
  recordScoreEvents(events: ScoreEvent[]): void {
    for (const e of events) {
      if (e.scorer === 2) continue; // our own points are not a threat
      this.observedPointsByRow.set(
        e.row,
        (this.observedPointsByRow.get(e.row) ?? 0) + e.points,
      );
    }
  }

  private executePlacement(): void {
    const view = this.buildView();
    const result = this.policy.choosePlacement(view);
    if (!result) return;

    const card = this.game.getCardById(2, result.cardId);
    if (!card) return;

    this.syncManager.sendAction({
      type: "placement",
      player: 2,
      cardId: card.id,
      patternIndex: card.patternIndex,
      row: result.row,
      col: result.col,
    });
  }

  // Match each cluster on the later frame against its earlier self and report
  // the ones that actually travelled. A still life or oscillator matches at
  // distance ~0 and falls out at the drift threshold; a spaceship matches ~10
  // columns back and survives, carrying its measured velocity with it.
  //
  // Mismatches are possible when clusters merge or collide, and are tolerated:
  // the result only steers which candidates get offered, and the sim ranking
  // still has to agree that a placement helps.
  private computeObservedMotion(): MovingThreat[] {
    const early = this.earlyFrame;
    const late = this.lateFrame;
    if (early === null || late === null) return [];

    const elapsed = late.generation - early.generation;
    if (elapsed <= 0) return [];

    const earlyClusters = findClusters(early.grid);
    const movers: MovingThreat[] = [];

    for (const current of findClusters(late.grid)) {
      let best: Cluster | null = null;
      let bestDistance = Infinity;
      for (const previous of earlyClusters) {
        const distance = Math.hypot(
          current.row - previous.row,
          current.col - previous.col,
        );
        if (distance < bestDistance && distance <= MOTION_MATCH_RADIUS) {
          bestDistance = distance;
          best = previous;
        }
      }
      if (best === null) continue;

      const colsPerGen = (current.col - best.col) / elapsed;
      if (Math.abs(colsPerGen) < MIN_DRIFT_COLS_PER_GEN) continue;

      movers.push({
        row: Math.round(current.row),
        col: Math.round(current.col),
        colsPerGen,
        rowsPerGen: (current.row - best.row) / elapsed,
      });
    }
    return movers;
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
      opponentPlacements: this.opponentPlacements,
      observedScoreRows: [...this.observedPointsByRow.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([row]) => row),
      observedMotion: this.computeObservedMotion(),
    };
  }
}
