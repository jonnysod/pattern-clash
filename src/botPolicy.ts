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
import { CONFIG } from "./config.js";

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

// True if any of the pattern's cells would land on an already-live grid cell.
// Out-of-range rows/cols read as undefined (falsy) via optional chaining.
function footprintOverlapsGrid(
  pattern: Pattern,
  row: number,
  col: number,
  grid: boolean[][],
): boolean {
  for (const [dr, dc] of pattern.cells) {
    if (grid[row + dr]?.[col + dc]) return true;
  }
  return false;
}

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
        if (!zones.isValidPatternPlacement(pattern, row, col, 2)) continue;

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
        const footprintOverlap = footprintOverlapsGrid(pattern, row, col, grid);

        // Path-obstruction score: sum live cells in the full row band the
        // pattern spans (minDr−2 buffer … maxDr+2 buffer), across all cols.
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
      if (zones.isValidPatternPlacement(pattern, row, col, 2)) {
        return { row, col };
      }
    }

    // Zone-scan fallback — guaranteed to find a legal position.
    for (let row = 0; row < this.game.rows; row++) {
      for (let col = 0; col < this.game.cols; col++) {
        if (zones.isValidPatternPlacement(pattern, row, col, 2)) {
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

// Horizon defaults to the game's full simulation length (game.simGenerations,
// currently 150) — the real sim runs exactly that many generations and then
// stops, so anything that ever scores does so within this window. A shorter
// horizon silently mis-ranks travelling spaceships: an orthogonal ship moves
// at c/2 (1 cell per 2 gens) and needs ~126 gens to cross from the front of
// P2's zone to the left score column, so a 50-gen peek returns 0 for exactly
// the placements that are actually good. Looking *past* simGenerations buys
// nothing: the sim has ended, and the next phase's board is reshaped by fresh
// placements, so extrapolating the current board would be speculative.
//
// Cost is ~linear in the horizon (~13 ms/gen for a 6-card hand on a 100×100
// grid, worst case = first placement of a phase) and plateaus past ~225 gens
// as the board stabilises (peek early-terminates via detectStablePeriod).
// At 150 a single decision blocks ~1.9 s synchronously — the 600 ms pacing
// window is exceeded, so a web worker is the next escalation if that freeze
// becomes noticeable (do NOT lower the horizon to compensate: that re-blinds
// the spaceship ranking this default exists to fix).
const SHORTLIST_SIZE = 6;
const DEFENSIVE_SHORTLIST_SIZE = 16;

// ---------------------------------------------------------------------------
// Budget-aware buy planner (Stufe 4)
// ---------------------------------------------------------------------------
//
// Placement is where the intelligence lives (sim-ranking picks *where* each
// card goes); the buy only needs to (a) spend the budget instead of leaving
// it on the table and (b) hand the ranker good raw material, tilted by game
// state. So this stays a cheap rule-based heuristic with no simulation — a
// sim-based buy would have to evaluate bundle × placement × sim, which is
// unbounded and pointless given the placement stage already picks "where".
//
// Preference lists are role-internal priority: buy the top pattern up to the
// copy cap, then fall to the next. Orthogonal spaceships lead the offense
// list because they fly straight at the score column; gliders drift diagonally
// and miss more often. Block leads the defense list as the cheapest solid
// absorber.
const OFFENSE_PREFERENCE = [1, 0, 8]; // MWSS, LWSS, Glider down
const DEFENSE_PREFERENCE = [2, 5, 4]; // Block, Blinker, Boat

// Of MAX_SLOTS (10): enough board pressure without flooding the own zone with
// forced use-it-or-lose-it placements (which also raises self-score risk).
const BUY_SLOT_CAP = 7;

// Offense is the win condition (the horizon fix makes travelling spaceships
// the strongest moves), so the neutral split leans offensive.
const BASE_OFFENSE_SHARE = 0.6;

function clampShare(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// Target fraction of bought slots that should be offense, from view state.
function computeOffenseShare(view: BotView): number {
  const scoreDiff = view.ownScore - view.opponentScore; // + = ahead

  let share = BASE_OFFENSE_SHARE;
  // Ahead → tilt defensive (protect the lead); behind → tilt offensive
  // (catch up). Saturates around a ±4 point gap.
  share -= clampShare(scoreDiff / 20, -0.2, 0.2);
  // More opponent cards on the board → more incoming threats → more defense.
  share -= clampShare((view.opponentCardCount - 4) / 40, 0, 0.1);

  // Final phase, no carryover into a next phase: if not already ahead, there
  // is nothing left to protect — go all-in on scoring.
  if (view.phase >= 6 && scoreDiff <= 0) share = 0.85;

  return clampShare(share, 0.3, 0.85);
}

// Greedily fill up to BUY_SLOT_CAP cards, interleaving offense/defense to keep
// the running offense fraction near computeOffenseShare(view), always buying
// the cheapest-affordable preferred pattern in the chosen role (respecting the
// per-type copy cap and the remaining budget). Leftover budget rolls over —
// saving across phases is legal and intended.
export function planBudgetAwareBuy(view: BotView): BuyBundle[] {
  const priceOf = (idx: number): number =>
    PATTERNS[idx]?.cells.length ?? Infinity;
  const offenseShare = computeOffenseShare(view);

  const counts = new Map<number, number>();
  const copiesOf = (idx: number): number => counts.get(idx) ?? 0;
  let slots = 0;
  let budget = view.ownBudget;

  // Buy the first affordable, under-cap pattern from a role's preference list.
  const tryBuy = (preference: number[]): boolean => {
    for (const idx of preference) {
      if (copiesOf(idx) >= CONFIG.MAX_COPIES_PER_TYPE) continue;
      const price = priceOf(idx);
      if (price > budget) continue;
      counts.set(idx, copiesOf(idx) + 1);
      budget -= price;
      slots += 1;
      return true;
    }
    return false;
  };

  while (slots < BUY_SLOT_CAP) {
    const offenseSlots = OFFENSE_PREFERENCE.reduce(
      (sum, idx) => sum + copiesOf(idx),
      0,
    );
    const wantOffenseFirst =
      slots === 0 ? offenseShare >= 0.5 : offenseSlots / slots < offenseShare;
    const primary = wantOffenseFirst ? OFFENSE_PREFERENCE : DEFENSE_PREFERENCE;
    const secondary = wantOffenseFirst ? DEFENSE_PREFERENCE : OFFENSE_PREFERENCE;
    // Fall back to the other role if the preferred one has nothing affordable.
    if (!tryBuy(primary) && !tryBuy(secondary)) break;
  }

  return [...counts.entries()].map(([patternIndex, count]) => ({
    patternIndex,
    count,
  }));
}

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
    this.horizon = options?.horizon ?? game.simGenerations;
    this.shortlistSize = options?.shortlistSize ?? SHORTLIST_SIZE;
  }

  chooseBuy(view: BotView): BuyBundle[] {
    return planBudgetAwareBuy(view);
  }

  choosePlacement(
    view: BotView,
  ): { cardId: string; row: number; col: number } | null {
    let best: {
      cardId: string;
      row: number;
      col: number;
      net: number;
      overlapFree: number;
      centrality: number;
    } | null = null;

    // Lexicographic ranking: (1) net score, (2) no footprint overlap,
    // (3) central row. Net is an integer point sum, so ties are exact and
    // common on a sparse board (a block neither scores nor blocks → net 0).
    //
    // The overlap tier is load-bearing: without it, equal-net ties let a
    // defensive piece land on already-live cells — stacking on another
    // defensive piece, or dropping onto a friendly offensive piece and
    // destroying it on the first tick. (A scoring piece is already protected
    // by the net comparison; overlap only decides net-neutral cases.)
    //
    // The centrality tier keeps net+overlap ties off the low-obstruction
    // top/bottom edges (the score-zone L-arms), reserving those for
    // placements that genuinely improve the net score.
    const midRow = this.game.rows / 2;

    for (const card of view.ownHand) {
      const basePattern = PATTERNS[card.patternIndex];
      if (!basePattern) continue;
      const pattern = getPatternForPlayer(basePattern, 2);

      const candidates = this.generateShortlist(card, pattern, view.grid);
      for (const { row, col } of candidates) {
        const net = this.peekNetScore(view.grid, pattern, row, col);
        const overlapFree = footprintOverlapsGrid(pattern, row, col, view.grid)
          ? 0
          : 1;
        const centrality = -Math.abs(row - midRow); // higher = more central
        if (
          best === null ||
          net > best.net ||
          (net === best.net &&
            (overlapFree > best.overlapFree ||
              (overlapFree === best.overlapFree &&
                centrality > best.centrality)))
        ) {
          best = { cardId: card.id, row, col, net, overlapFree, centrality };
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
      col < zones.goalZoneRightStart;
      col +=
        Math.max(1, Math.floor((zones.goalZoneRightStart - zones.rightStart) / 4))
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
        if (!zones.isValidPatternPlacement(pattern, row, col, 2)) continue;
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
