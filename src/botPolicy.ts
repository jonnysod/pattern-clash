// Bot policy interface, V1 dummy implementation, and Stufe-2a rule-based policy.
//
// BotPolicy is the single extension point for bot intelligence.
// Stufe 2/3 swap the implementation here — the BotController integration
// stays unchanged.
//
// BotView is a deliberately redacted projection of game state.
// It exposes only what a human player could see on screen:
// own hand (full), opponent card count (never contents), public grid.

import type { Card, Pattern } from "./types.js";
import type { Game } from "./game.js";
import { PATTERNS } from "./patterns.js";
import { getPatternForPlayer } from "./patternUtils.js";
import { Engine } from "./engine.js";

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

// Fixed bundle bought every phase regardless of budget leftovers.
// Stufe 2 will replace this with budget-aware selection.
const DUMMY_BUNDLE: BuyBundle[] = [{ patternIndex: 0, count: 3 }]; // 3x LWSS

// ---------------------------------------------------------------------------
// Stufe 2a — rule-based offensive placement + soft self-score avoidance
// ---------------------------------------------------------------------------
//
// Candidate scoring (lower = better):
//   +1000  self-score penalty   — footprint overlaps own score zone (P1 scores)
//   +500   footprint-overlap    — pattern cells land on already-live grid cells
//   +N     path obstruction     — live cells in the row band the pattern spans
//                                 (min_dr−1 to max_dr+1), counting all cols
//   +0.1×  row tie-breaker      — slight preference for rows near vertical centre
//
// Penalty hierarchy ensures:
//   self-score (1000) > footprint-overlap (500) > path (≤ rows×band ≈ 1000 worst-case)
// In practice path scores are small, so the ordering holds for normal grids.
// All penalties are soft: the best available candidate is always chosen.

const SELF_SCORE_PENALTY = 1000;
const FOOTPRINT_OVERLAP_PENALTY = 500;
const ROW_TIEBREAKER_WEIGHT = 0.1;

export class RuleBasedBotPolicy {
  private game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  chooseBuy(_view: BotView): BuyBundle[] {
    return DUMMY_BUNDLE;
  }

  // Single-best convenience wrapper, kept for tests and as a reference
  // baseline. Stufe 3 calls rankPlacements() directly to get a shortlist
  // instead of just the top pick.
  choosePlacement(view: BotView, card: Card): { row: number; col: number } {
    const basePattern = PATTERNS[card.patternIndex];
    if (!basePattern) return { row: 0, col: this.game.zones.rightStart };
    const pattern = getPatternForPlayer(basePattern, 2);
    const ranked = this.rankPlacements(pattern, view.grid, 1);
    return ranked[0] ?? { row: 0, col: this.game.zones.rightStart };
  }

  // Ranks all legal P2 placements for `pattern` against `grid` using the
  // Stufe 2a offensive heuristic (lower = better), ascending, capped to
  // the top `limit` candidates. This is the offensive shortlist generator
  // for Stufe 3's sim-ranking: it no longer judges, it proposes.
  rankPlacements(
    pattern: Pattern,
    grid: boolean[][],
    limit: number,
  ): { row: number; col: number }[] {
    const zones = this.game.zones;
    const midRow = this.game.rows / 2;

    // Row band extents of the pattern (relative offsets).
    const rowOffsets = pattern.cells.map(([dr]) => dr);
    const minDr = Math.min(...rowOffsets);
    const maxDr = Math.max(...rowOffsets);

    // Pre-compute per-row live-cell counts (used for path-obstruction score).
    const rowLiveCount = new Array<number>(this.game.rows).fill(0);
    for (let r = 0; r < this.game.rows; r++) {
      let count = 0;
      for (let c = 0; c < this.game.cols; c++) {
        if (grid[r]?.[c]) count++;
      }
      rowLiveCount[r] = count;
    }

    const scored: { row: number; col: number; score: number }[] = [];

    for (let row = 0; row < this.game.rows; row++) {
      for (let col = 0; col < this.game.cols; col++) {
        if (!zones.isValidPatternPlacement(pattern, col, 2)) continue;

        // Self-score penalty: footprint cell would give P1 a point.
        let selfScore = false;
        for (const [dr, dc] of pattern.cells) {
          const { scores, scorer } = zones.isScoreCell(row + dr, col + dc);
          if (scores && scorer === 1) {
            selfScore = true;
            break;
          }
        }

        // Footprint-overlap penalty: any pattern cell lands on a live grid cell.
        let footprintOverlap = false;
        for (const [dr, dc] of pattern.cells) {
          if (grid[row + dr]?.[col + dc]) {
            footprintOverlap = true;
            break;
          }
        }

        // Path-obstruction score: sum live cells in the full row band the
        // pattern spans (minDr−1 buffer … maxDr+1 buffer), across all cols.
        // Counts pre-existing cells that could interfere with the pattern's
        // forward trajectory, including cells in adjacent rows.
        let pathScore = 0;
        const bandTop = Math.max(0, row + minDr - 2);
        const bandBot = Math.min(this.game.rows - 1, row + maxDr + 2);
        for (let r = bandTop; r <= bandBot; r++) {
          pathScore += rowLiveCount[r] ?? 0;
        }

        const score =
          (selfScore ? SELF_SCORE_PENALTY : 0) +
          (footprintOverlap ? FOOTPRINT_OVERLAP_PENALTY : 0) +
          pathScore +
          Math.abs(row - midRow) * ROW_TIEBREAKER_WEIGHT;

        scored.push({ row, col, score });
      }
    }

    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, limit).map(({ row, col }) => ({ row, col }));
  }
}

// ---------------------------------------------------------------------------
// V1 dummy policy — kept for tests and as a reference baseline
// ---------------------------------------------------------------------------

export class DummyBotPolicy implements BotPolicy {
  private game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  chooseBuy(_view: BotView): BuyBundle[] {
    return DUMMY_BUNDLE;
  }

  // Joint BotPolicy entry point: always picks the first card in hand.
  choosePlacement(
    view: BotView,
  ): { cardId: string; row: number; col: number } | null {
    const card = view.ownHand[0];
    if (!card) return null;
    const { row, col } = this.choosePlacementForCard(view, card);
    return { cardId: card.id, row, col };
  }

  // Fixed-card variant, kept for tests that target a specific card.
  choosePlacementForCard(
    _view: BotView,
    card: Card,
  ): { row: number; col: number } {
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

// ---------------------------------------------------------------------------
// Stufe 3 — sim-ranking hybrid (greedy-with-context)
// ---------------------------------------------------------------------------
//
// Subsumes 2b: there is no threat-detection step. A blocking candidate
// ranks high purely because it lowers the opponent term of the net score
// once it's actually simulated — "defense" falls out of the ranking, it's
// never special-cased.
//
// Per-turn decision: rank (remaining card × shortlist position) pairs by
// net score (own − opponent) of a headless peek simulation, joint over the
// whole remaining hand, and take the best pair. Already-placed cards this
// phase are implicitly "context" because they're already stamped on
// view.grid — no separate committed-cards bookkeeping needed.
//
// Known limit (deferred, not a bug): greedy is forward-myopic. It will
// never sacrifice an already-evaluated card for a not-yet-placed one, so
// "clear debris now so a later ship scores" is out of scope for V1.

// Spaceships — patterns that travel and should use the offensive shortlist.
const OFFENSIVE_PATTERN_INDICES = new Set([0, 1, 8, 9, 10, 11, 12]);

// Tuned down from the plan's "start ~100" default after a synchronous-cost
// dry run (see scratch timing in the Stufe-3 PR): horizon=100/shortlist=10
// took >1s for a single choosePlacement() call over a 6-card hand on a
// 100×100 grid — too slow for the 600ms placement pacing window. These
// values keep a single decision under ~0.5s; revisit after a live
// Checkpoint A pass (web worker is the next escalation, not lower numbers).
const SIM_HORIZON_GENERATIONS = 50;
const SHORTLIST_SIZE = 6;
const DEFENSIVE_SHORTLIST_SIZE = 16;

// Fixed bundle bought every phase — defensively stocked so choosePlacement
// always has something to block with. Not budget-aware (deferred); just
// guarantees defensive candidates exist at all.
const SIM_RANKING_BUNDLE: BuyBundle[] = [
  { patternIndex: 0, count: 2 }, // LWSS
  { patternIndex: 1, count: 1 }, // MWSS
  { patternIndex: 2, count: 2 }, // Block
  { patternIndex: 5, count: 1 }, // Blinker
];

export class SimRankingBotPolicy implements BotPolicy {
  private game: Game;
  private shortlistGenerator: RuleBasedBotPolicy;
  private horizon: number;
  private shortlistSize: number;

  constructor(
    game: Game,
    options?: { horizon?: number; shortlistSize?: number },
  ) {
    this.game = game;
    this.shortlistGenerator = new RuleBasedBotPolicy(game);
    this.horizon = options?.horizon ?? SIM_HORIZON_GENERATIONS;
    this.shortlistSize = options?.shortlistSize ?? SHORTLIST_SIZE;
  }

  chooseBuy(_view: BotView): BuyBundle[] {
    return SIM_RANKING_BUNDLE;
  }

  choosePlacement(
    view: BotView,
  ): { cardId: string; row: number; col: number } | null {
    let best: {
      cardId: string;
      row: number;
      col: number;
      net: number;
    } | null = null;

    for (const card of view.ownHand) {
      const basePattern = PATTERNS[card.patternIndex];
      if (!basePattern) continue;
      const pattern = getPatternForPlayer(basePattern, 2);

      const candidates = this.generateShortlist(card, pattern, view.grid);
      for (const { row, col } of candidates) {
        const net = this.peekNetScore(view.grid, pattern, row, col);
        if (best === null || net > best.net) {
          best = { cardId: card.id, row, col, net };
        }
      }
    }

    if (best) return { cardId: best.cardId, row: best.row, col: best.col };

    // Fallback: no legal candidate was found for any card (shouldn't
    // happen given zone geometry, but use-it-or-lose-it requires a
    // placement). Fall back to the first card's single best heuristic pick.
    const fallbackCard = view.ownHand[0];
    if (!fallbackCard) return null;
    const fallbackPattern = PATTERNS[fallbackCard.patternIndex];
    if (!fallbackPattern) return null;
    const mirrored = getPatternForPlayer(fallbackPattern, 2);
    const ranked = this.shortlistGenerator.rankPlacements(
      mirrored,
      view.grid,
      1,
    );
    const pos = ranked[0] ?? { row: 0, col: this.game.zones.rightStart };
    return { cardId: fallbackCard.id, row: pos.row, col: pos.col };
  }

  // Card-type-aware candidate generation: spaceships get the offensive
  // shortlist (2a heuristic, top-K instead of single best); static/
  // oscillating pieces get a broad defensive shortlist. The defensive
  // generator deliberately does not compute trajectories — it scatters
  // candidates across rows with live activity and lets the sim ranking
  // decide which one actually blocks.
  private generateShortlist(
    card: Card,
    pattern: Pattern,
    grid: boolean[][],
  ): { row: number; col: number }[] {
    if (OFFENSIVE_PATTERN_INDICES.has(card.patternIndex)) {
      return this.shortlistGenerator.rankPlacements(
        pattern,
        grid,
        this.shortlistSize,
      );
    }
    return this.generateDefensiveCandidates(pattern, grid);
  }

  // Deliberately not trajectory-aware: a threat seen today at row R may
  // cross into P2's zone several rows away once it actually arrives
  // (diagonal drift). Rather than try to predict that, this scatters
  // candidates evenly across the *whole* P2 zone — coarse rows × a
  // handful of columns spanning the zone — and lets the sim ranking in
  // choosePlacement() pick whichever one actually lowers the opponent's
  // score. "Dumm-breit generieren, Sim richtet."
  private generateDefensiveCandidates(
    pattern: Pattern,
    _grid: boolean[][],
  ): { row: number; col: number }[] {
    const zones = this.game.zones;
    const rows = this.game.rows;

    const candidateCols: number[] = [];
    for (
      let col = zones.rightStart;
      col < zones.endzoneRightStart;
      col +=
        Math.max(1, Math.floor((zones.endzoneRightStart - zones.rightStart) / 4))
    ) {
      candidateCols.push(col);
    }

    const desiredRows = Math.max(
      1,
      Math.ceil(DEFENSIVE_SHORTLIST_SIZE / candidateCols.length),
    );
    const rowStep = Math.max(1, Math.floor(rows / desiredRows));

    const candidates: { row: number; col: number }[] = [];
    for (
      let row = 0;
      row < rows && candidates.length < DEFENSIVE_SHORTLIST_SIZE;
      row += rowStep
    ) {
      for (const col of candidateCols) {
        if (!zones.isValidPatternPlacement(pattern, col, 2)) continue;
        candidates.push({ row, col });
      }
    }
    return candidates;
  }

  // Headless peek: simulate the candidate placement forward on a grid
  // clone, never touching the live game. Returns net score (own − opponent)
  // for the candidate's own simulated outcome up to the horizon, or until
  // the board stabilises (early termination), whichever comes first.
  //
  // Guardrails: operates on a fresh Engine + cloned grid only. Never reads
  // or writes this.game.grid/scorePlayer*, never emits ScoreEvents to any
  // UI listener, never touches _nextCardId, never sends a SyncAction.
  private peekNetScore(
    grid: boolean[][],
    pattern: Pattern,
    row: number,
    col: number,
  ): number {
    const clone = grid.map((r) => r.slice());
    for (const [dr, dc] of pattern.cells) {
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < this.game.rows && c >= 0 && c < this.game.cols) {
        clone[r]![c] = true;
      }
    }

    const engine = new Engine(
      this.game.rows,
      this.game.cols,
      this.game.zones,
      this.horizon,
    );
    engine.grid = clone;

    let ownScore = 0;
    let opponentScore = 0;

    while (!engine.isSimulationComplete()) {
      const events = engine.computeNextGeneration();
      for (const e of events) {
        if (e.scorer === 2) ownScore += e.points;
        else opponentScore += e.points;
      }

      if (engine.detectStablePeriod() !== 0) {
        const flushed = engine.forceFlushBuckets();
        for (const e of flushed) {
          if (e.scorer === 2) ownScore += e.points;
          else opponentScore += e.points;
        }
        break;
      }
    }

    return ownScore - opponentScore;
  }
}
