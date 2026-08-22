// Bot policy interface, V1 dummy implementation, and Stufe-2a rule-based policy.
//
// BotPolicy is the single extension point for bot intelligence.
// Stufe 2/3 swap the implementation here — the BotController integration
// stays unchanged.
//
// BotView is a deliberately redacted projection of game state.
// It exposes only what a human player could see on screen:
// own hand (full), opponent card count (never contents), public grid.

import type { Card, Pattern, ScoreEvent } from "./types.js";
import type { Game } from "./game.js";
import { PATTERNS } from "./patterns.js";
import { getPatternForPlayer } from "./patternUtils.js";
import { Engine } from "./engine.js";
import { CONFIG } from "./config.js";

// A placement made during the current place phase — the opponent's (which
// the bot has witnessed) or one of the bot's own.
//
// Fair by the game's own standard: a placement is public. The online
// protocol puts patternIndex on the wire in the `placement` action (only
// `buyConfirm` withholds it), so a remote human client learns exactly this,
// at exactly this moment. What stays hidden is the *hand* — cards not yet
// played — which is what the anti-sniffing model protects.
export interface WitnessedPlacement {
  patternIndex: number;
  row: number;
  col: number;
}

export interface BotView {
  grid: boolean[][];
  phase: number;
  ownBudget: number;
  ownHand: Card[];
  opponentCardCount: number; // count only — contents are never exposed
  // The opponent's remaining budget, and what they spent in this buy phase.
  //
  // Both are public by the game's own standard: each player's budget is on
  // screen for the whole match, and `remainingBudget` rides in the buyConfirm
  // action precisely so the other client can display it. Withholding them from
  // the bot did not protect anything — it just left it blind to two numbers a
  // human reads off the status bar.
  //
  // What they buy is the bound in maxIncomingShips(): the count says how many
  // cards, the spend says how expensive they were, and cheap cards cannot fly.
  // The hand itself stays hidden, so the anti-sniffing model is untouched.
  //
  // opponentSpentThisPhase is null when no reference point was taken for this
  // phase; callers must treat that as "unknown", never as "nothing".
  opponentBudget: number;
  opponentSpentThisPhase: number | null;
  ownScore: number;
  opponentScore: number;
  // Placements made by the opponent during the *current* place phase, in
  // order. Scoped to this phase on purpose: no simulation runs during a
  // place phase, so a piece is still exactly where it was put and the
  // trajectory projection below is exact.
  opponentPlacements: WitnessedPlacement[];
  // The bot's own placements during the *current* place phase, in order.
  //
  // Needed because two spaceships launched too close together destroy each
  // other's debris field when they land (see SHIP_MIN_ROW_SEPARATION), and
  // the grid alone cannot answer "did I launch a ship on that row *this
  // phase*" — old debris in our own zone looks the same. Cleared per phase
  // alongside opponentPlacements.
  ownPlacements: WitnessedPlacement[];
  // Rows where the opponent actually scored during the previous simulation
  // phase, heaviest first. This is the bot's threat signal for anything it
  // did not witness being placed — above all the stationary debris a crashed
  // spaceship leaves behind, which keeps scoring forever without ever moving.
  //
  // Observation rather than a forward simulation of the current board, by
  // design: it is exactly what a human sees while watching the "+N" floaters
  // in the sim phase, and it is fact rather than extrapolation of a board
  // both players are about to reshape with new placements. The trade is
  // accepted knowingly — a piece already in flight that has not scored yet
  // is invisible here until the phase in which it first lands.
  //
  // Empty in phase 1: there is no previous simulation, and the board is empty.
  observedScoreRows: number[];
  // Things that were seen *travelling* towards us during the previous
  // simulation phase, with the velocity measured from two observed frames.
  //
  // This is the third and last threat class, and it is disjoint from the other
  // two: a piece placed this phase has not moved yet (no simulation runs
  // during a place phase), and a piece still in flight has not scored yet, so
  // neither of the other signals can see it. Left uncovered it is expensive —
  // a spaceship launched from the back of the opponent's zone needs 184
  // generations to arrive, so it crosses a phase boundary in silence and then
  // lands for ~275 points.
  //
  // Measured rather than looked up: the frame diff yields the velocity
  // directly, so this also covers movers that were never witnessed as a
  // placement, such as the glider stream a gun emits.
  observedMotion: MovingThreat[];
}

// A moving object observed on the board, in cells per generation. colsPerGen
// is positive when it is travelling towards us (increasing columns).
export interface MovingThreat {
  row: number; // centroid row in the most recent observed frame
  col: number; // centroid column in the most recent observed frame
  colsPerGen: number;
  rowsPerGen: number;
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
    isRowAllowed?: (row: number) => boolean,
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
      if (isRowAllowed && !isRowAllowed(row)) continue;
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
// which ramps 150 → 250 across the six phases) — the real sim runs exactly
// that many generations and then stops, so anything that ever scores does so
// within this window. Because it ramps, the value must be read per decision
// rather than cached at construction (see the horizon getter). A shorter
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
// At 150 a single decision blocks ~1.9 s synchronously and the late-phase 250
// sits at roughly the plateau (~2.8 s) — the 600 ms pacing window is exceeded
// either way, so a web worker is the next escalation if that freeze becomes
// noticeable (do NOT lower the horizon to compensate: that re-blinds the
// spaceship ranking this default exists to fix).
const SHORTLIST_SIZE = 6;
// Swept in both directions and left at 16 both times.
//
// Upwards: widening to 24 was tried when score-source detection arrived, on
// the theory that two threat signals and several simultaneous threats need
// more room. It changed no decision in any scenario and cost 27% more time
// per decision (4.5 s vs 3.3 s for a 7-card hand at horizon 250). Aiming the
// candidates well is what mattered, not offering more of them.
//
// Downwards: the full suite locates a cliff between 10 and 12 —
//
//   size    8   10   12   14   16
//   suite   ✗    ✗    ✓    ✓    ✓
//
// At 10 and below two tests break: the bot stops answering an unannounced
// glider at all (defensive recall), and net-neutral pieces collapse from
// three distinct rows into two (spread). The list is then too short to hold
// both the threat-aimed candidates and the scatter behind them.
//
// 12 passes everything and costs ~20% less, and was still rejected: a probe
// over five scenarios could not tell 12 and 16 apart on *outcome* — points
// the opponent still scored after the answer were identical (63 of 402 for
// one debris source, 867 of 1206 for three) across every size from 8 to 24,
// including the sizes that fail the suite. So the only discriminator the
// project has is those two tests, which makes 12 a value one step above a
// cliff with unknown clearance. The 20% also does not solve what it would be
// bought for: 4.5 s of synchronous freeze becoming 3.6 s is still a freeze,
// and the fix for that is moving the peek off the main thread.
const DEFENSIVE_SHORTLIST_SIZE = 16;

// ---------------------------------------------------------------------------
// Threat model (Fix 3b)
// ---------------------------------------------------------------------------
//
// The interception row is a *function of the interception column*, not a
// fixed row. For an orthogonal spaceship the function is constant — it holds
// its row, so blocking anywhere in that row works. For a glider it has slope
// ±1: a glider placed at row 10 / col 20 enters P2's zone (col 66) at row 56.
// A band around the *placement* row would miss it by 46 rows, which is why
// this projects per candidate column instead of scattering around a row.
//
// A pattern is only worth intercepting if it can arrive at all. A glider
// whose diagonal leaves the grid before reaching the defended zone dies at
// the edge and is no threat — checking the row at the zone's near edge is
// enough, since the drift is monotonic in the column.
//
// Deliberately *not* filtered by time: "cannot arrive within this phase's
// generations" is not the same as harmless, because the board carries over
// and a slow glider simply lands next phase. Only leaving the grid is a real
// all-clear.
// Upper bound on how many pieces in the opponent's freshly bought hand could
// possibly reach us, from the two public numbers: card count and total spend.
//
// Every card costs at least the cheapest pattern in the game, and anything
// that can actually travel the board costs at least the cheapest of *those*.
// So for k travellers among c cards costing s in total:
//
//     cheapTravel*k + cheapAny*(c-k) <= s   =>   k <= (s - cheapAny*c) / delta
//
// With today's prices (Blinker 3, LWSS 9) that is k <= (s - 3c) / 6. Five
// cards for 15 points proves *zero* travellers; three cards for 33 allows
// three. The zero case is the valuable one — it is a certainty, not a guess,
// and it says defence bought this phase would have nothing to catch.
//
// Diagonal patterns are excluded from "can travel": a glider moves at c/4 and
// does not cross the board inside a phase (see the movement notes above), so
// counting it would only make the bound needlessly pessimistic. Being wrong
// in that direction is safe — the bound overstates the threat, never hides it.
//
// Prices are read from PATTERNS rather than written down, so the bound cannot
// drift when a pattern is added or repriced.
function maxIncomingShips(view: BotView): number {
  const spent = view.opponentSpentThisPhase;
  const cards = view.opponentCardCount;
  // No reference point, or nothing bought: assume the worst rather than
  // claiming a safety that was never observed.
  if (spent === null) return cards;
  if (cards <= 0) return 0;

  let cheapAny = Infinity;
  let cheapTravel = Infinity;
  for (const pattern of PATTERNS) {
    const price = pattern.cells.length;
    if (price < cheapAny) cheapAny = price;
    const kind = pattern.movement.kind;
    if (kind === "orthogonal" || kind === "emitter") {
      if (price < cheapTravel) cheapTravel = price;
    }
  }

  const delta = cheapTravel - cheapAny;
  if (delta <= 0) return cards; // no price separation to reason from
  const bound = Math.floor((spent - cheapAny * cards) / delta);
  return Math.max(0, Math.min(cards, bound));
}

const THREAT_WEIGHT: Record<string, number> = {
  static: 0, // still lifes and oscillators never travel — ignore
  orthogonal: 1,
  diagonal: 1,
  emitter: 2, // a gun keeps producing; one block never retires the threat
};

// Vertical reference point of a placed pattern, used as the origin of its
// trajectory. The bounding-box centre tracks the measured centroid closely
// for ships and gliders, and lands within a couple of rows of a gun's muzzle
// (a 36-row gun placed at row 30 emits from ~row 48). Residual offset is
// absorbed by INTERCEPT_ROW_BAND.
function patternSourceRow(pattern: Pattern, placedRow: number): number {
  let maxRowOffset = 0;
  for (const [rowOffset] of pattern.cells) {
    if (rowOffset > maxRowOffset) maxRowOffset = rowOffset;
  }
  return placedRow + Math.floor((maxRowOffset + 1) / 2);
}

// Rows either side of the projected intercept row to also offer. Covers the
// bounding-box/centroid residual and the fact that a blocker sitting exactly
// in a ship's path is not always the position that actually stops it —
// Conway collisions are offset-sensitive. The sim ranking picks the winner;
// this only has to put candidates in the right neighbourhood.
const INTERCEPT_ROW_BAND = 2;

// Share of the defensive shortlist reserved for threat-projected candidates.
// The remainder stays a uniform scatter so a misread threat (or none at all)
// never leaves the ranker without options.
const THREAT_CANDIDATE_SHARE = 0.75;

// Rows of clearance a net-neutral placement wants from anything already in our
// zone. Wide enough to break up a clump, narrow enough that on a busy board
// the tier simply goes inert rather than forcing pieces to the edges.
const SPREAD_MIN_ROWS = 10;

// Rows of clearance one of our spaceships wants from another one we launched
// this phase. Not a preference — below it the two are worth *less than one*.
//
// A spaceship that hits the far wall leaves a stationary oscillator that keeps
// scoring, and that debris field reaches roughly ten rows either way. Two of
// them overlapping annihilate each other. Measured on an otherwise empty board,
// two MWSS launched in the same phase, scored over that phase alone:
//
//   row gap    8 →  92     16 → 466
//             12 → 210     20 → 466   (466 = exactly 2 × a single ship)
//
// So the loss at gap 12 is 55%, at gap 8 it is 80% — worse than not buying the
// second ship at all. The transition sits between 12 and 16; 16 is the first
// gap measured at full value.
const SHIP_MIN_ROW_SEPARATION = 16;

// Small seeded PRNG (mulberry32) used to pick among placements the ranker
// considers exactly equivalent.
//
// Seeded, per instance, and deterministic *by default* on purpose: the test
// suite asserts on the bot's decisions, and a bare Math.random() in here would
// make every one of those tests flaky. Production opts into real entropy by
// passing `rng` (see main.ts); everything else replays the same stream.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULT_RNG_SEED = 0x5eed;

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

// Cap on the *number* of defensive cards when nothing on the board is scoring
// against us. Not zero: one absorber is cheap insurance against a threat placed
// later in the same phase, which no peek of the current board can see yet.
const DEFENSE_CAP_WITHOUT_THREAT = 1;

// How hard to chase card-count parity with the opponent, as a fraction of
// their hand: 0 disables the rule entirely, 1 aims to match them card for card.
//
// Why parity is worth budget at all: the place phase alternates, so whoever
// still holds cards when the other runs out plays the remainder unanswered.
// Combined with holding offence back (see choosePlacement), every defensive
// card bought past the opponent's count converts one of our spaceships from
// "answerable by a 4-cell block" into "unanswerable". The condition for *all*
// our offence to land in that tail is defence >= their card count.
//
// Why not 1: full parity is not affordable. From phase 2 the budget, not the
// slot cap, is the binding constraint — 25 points buys either two MWSS and one
// block, or one MWSS and four cheap cards. Chasing parity against a five-card
// hand would cost the entire offence, and offence is the win condition.
//
// 0.4 is where the tempo is still free. Swept against a five-card opponent,
// cards bought in phases 3–6 and how much offence survives:
//
//   0.0 / 0.3 → 3 cards, 2 spaceships   (target ≤ 1, rule never fires)
//   0.4       → 4–5 cards, 2 spaceships
//   0.6 / 0.8 → 4–5 cards, 1 spaceship
//   1.0       → 5–7 cards, 1 spaceship
//
// The step from 0.4 to 0.6 costs an entire MWSS and buys no extra cards, so
// everything above 0.4 pays for tempo with the win condition. Whether that is
// ever worth it depends on how reliably a human blocks a spaceship they can
// see — which no simulation here can answer, since it is the whole reason the
// trade exists. Hence a playtest dial, defaulted to the free end of it.
const DEFENCE_PARITY_TARGET = 0.4;

// Never trade away the last spaceship, whatever parity would like. Enforced by
// ordering rather than by reserving budget: below the floor the offensive buy
// simply goes first, which on an empty basket is the very first purchase, so
// the strongest affordable spaceship is secured before parity spends anything.
const OFFENCE_FLOOR_CARDS = 1;

// Target fraction of bought slots that should be offense, from view state.
// `underThreat` comes from the score-source peek — see planBudgetAwareBuy.
function computeOffenseShare(view: BotView, underThreat: boolean): number {
  const scoreDiff = view.ownScore - view.opponentScore; // + = ahead

  let share = BASE_OFFENSE_SHARE;
  // Nothing is scoring against us: defensive cards have nothing to block, and
  // use-it-or-lose-it would force them onto the board anyway. Buy offense.
  if (!underThreat) return 0.85;
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
// `underThreat` defaults to true so the Dummy/RuleBased policies and existing
// callers keep the previous, threat-agnostic behaviour; only SimRankingBotPolicy
// has a peek to base the answer on.
export function planBudgetAwareBuy(
  view: BotView,
  underThreat: boolean = true,
): BuyBundle[] {
  const priceOf = (idx: number): number =>
    PATTERNS[idx]?.cells.length ?? Infinity;
  const offenseShare = computeOffenseShare(view, underThreat);

  const counts = new Map<number, number>();
  const copiesOf = (idx: number): number => counts.get(idx) ?? 0;
  let slots = 0;
  let budget = view.ownBudget;

  // Cards of cheap defence that would put our offence in the unanswerable
  // tail of the place phase. Rounded down: overshooting parity buys nothing
  // extra, the tail only has to start before our first ship goes down.
  const parityTarget = Math.floor(
    view.opponentCardCount * DEFENCE_PARITY_TARGET,
  );

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
    const defenseSlots = slots - offenseSlots;

    // Below the offence floor nothing else may spend: the win condition comes
    // first, and parity protecting no offence protects nothing.
    const needOffenceFloor = offenseSlots < OFFENCE_FLOOR_CARDS;

    // Parity outranks the share arithmetic and the no-threat cap alike. The
    // cap was written against blocks bought to *block* with nothing to block;
    // these are bought for tempo, which does not depend on a threat existing.
    const wantParity = !needOffenceFloor && defenseSlots < parityTarget;

    // Hard cap rather than trusting the share arithmetic: with nothing to
    // block, every defensive card past the first is a forced wasted placement.
    const defenseCapped =
      !wantParity &&
      !underThreat &&
      defenseSlots >= DEFENSE_CAP_WITHOUT_THREAT;

    const wantOffenseFirst =
      needOffenceFloor ||
      (!wantParity &&
        (defenseCapped ||
          (slots === 0
            ? offenseShare >= 0.5
            : offenseSlots / slots < offenseShare)));
    const primary = wantOffenseFirst ? OFFENSE_PREFERENCE : DEFENSE_PREFERENCE;
    const secondary = wantOffenseFirst ? DEFENSE_PREFERENCE : OFFENSE_PREFERENCE;
    // Fall back to the other role if the preferred one has nothing affordable,
    // unless that fallback is the defence we just capped.
    if (!tryBuy(primary) && (defenseCapped || !tryBuy(secondary))) break;
  }

  return [...counts.entries()].map(([patternIndex, count]) => ({
    patternIndex,
    count,
  }));
}

export class SimRankingBotPolicy implements BotPolicy {
  private game: Game;
  private shortlistGenerator: RuleBasedBotPolicy;
  private horizonOverride: number | undefined;
  private shortlistSize: number;
  private rng: () => number;

  constructor(
    game: Game,
    options?: {
      horizon?: number;
      shortlistSize?: number;
      rng?: () => number;
    },
  ) {
    this.game = game;
    this.shortlistGenerator = new RuleBasedBotPolicy(game);
    this.horizonOverride = options?.horizon;
    this.shortlistSize = options?.shortlistSize ?? SHORTLIST_SIZE;
    this.rng = options?.rng ?? mulberry32(DEFAULT_RNG_SEED);
  }

  // Read per decision, not captured in the constructor: the policy is built
  // once per game but simGenerations ramps up each phase, so a cached value
  // would peek the phase-1 window while the real sim runs longer — the exact
  // "wrong slice" blind spot the full-length horizon exists to avoid.
  private get horizon(): number {
    return this.horizonOverride ?? this.game.simGenerations;
  }

  chooseBuy(view: BotView): BuyBundle[] {
    // Buying defence only pays when there is something to defend against.
    // Without this the bot bought its defensive share every phase regardless,
    // and use-it-or-lose-it then forced those blocks onto the board somewhere
    // — which is what the clump of blocks in the middle of an empty board was.
    // Three signals, and they cover different times. The first two are
    // observations of the phase just watched — debris that scored, and things
    // seen in flight. The third is about the phase about to be played: what
    // the opponent just bought and has not placed yet, which nothing observed
    // can see. Without it a clean board plus a hand full of freshly bought
    // spaceships read as "no threat", and the bot bought almost no defence.
    const underThreat =
      view.observedScoreRows.length > 0 ||
      view.observedMotion.some((m) => m.colsPerGen > 0) ||
      maxIncomingShips(view) > 0;
    return planBudgetAwareBuy(view, underThreat);
  }

  choosePlacement(
    view: BotView,
  ): { cardId: string; row: number; col: number } | null {
    // Every placement that ties on the full ranking key. One is drawn at
    // random at the end rather than taking whichever the loop saw first.
    //
    // The tiers below are thresholds and integer sums, so exact ties are the
    // common case, not an edge case — and resolving them by iteration order
    // made the bot needlessly predictable: the centrality tier always answers
    // "the middle", so a hand with nothing to block landed in the same place
    // every game. Measured on an empty board, a single MWSS scores identically
    // (2129) launched from row 10, 20, 32, 44, 56, 68 or 80 — the choice among
    // tied rows is worth nothing, which is exactly what makes it free to
    // randomise. Nothing below the tie is randomised: the tiers themselves are
    // never sampled past.
    let bestKey: number[] | null = null;
    let tied: { cardId: string; row: number; col: number }[] = [];

    const compare = (a: number[], b: number[]): number => {
      for (let i = 0; i < a.length; i++) {
        if (a[i]! !== b[i]!) return a[i]! > b[i]! ? 1 : -1;
      }
      return 0;
    };

    // Lexicographic ranking: (1) net score, (2) no footprint overlap,
    // (3) not clumped against what is already there, (4) central row. Net is
    // an integer point sum, so ties are exact and common on a sparse board
    // (a block neither scores nor blocks → net 0). Ship separation is not a
    // tier here — it is enforced when the candidates are generated, because
    // the offensive generator offers only one row to begin with.
    //
    // The overlap tier is load-bearing: without it, equal-net ties let a
    // defensive piece land on already-live cells — stacking on another
    // defensive piece, or dropping onto a friendly offensive piece and
    // destroying it on the first tick. (A scoring piece is already protected
    // by the net comparison; overlap only decides net-neutral cases.)
    //
    // The spread tier stops net-neutral pieces from piling into one row.
    // Without it every tie fell through to centrality, which always answers
    // "the middle" — so a hand with nothing to block put its whole defence in
    // a row-50 clump. Deliberately a proximity *threshold*, not "maximise
    // distance": maximising would send the second piece to row 0 or 99, back
    // into the score-zone L-arms that the centrality tier exists to avoid.
    //
    // Occupancy is read from our own zone rather than from a list of our
    // placements: no extra state to keep in sync, and it also spreads away
    // from carried-over debris, which is just as good a reason to move.
    const occupiedRows = this.occupiedRowsInOwnZone(view.grid);
    const isClear = (row: number): boolean => {
      const lo = Math.max(0, row - SPREAD_MIN_ROWS);
      const hi = Math.min(this.game.rows - 1, row + SPREAD_MIN_ROWS);
      for (let r = lo; r <= hi; r++) if (occupiedRows[r]) return false;
      return true;
    };

    // The centrality tier keeps net+overlap ties off the low-obstruction
    // top/bottom edges (the score-zone L-arms), reserving those for
    // placements that genuinely improve the net score.
    const midRow = this.game.rows / 2;

    // Hold offence back for the tail of the place phase. While the opponent
    // still holds cards, any spaceship we commit can be neutralised by a
    // single cheap block dropped into its lane — a 4-cell answer to an
    // 11-cell piece worth up to 233 points. Playing a defensive piece early
    // risks only its own price, and that asymmetry sets the order: cheap
    // first, expensive last. Ideally the opponent's hand is empty by the
    // time the ships go down, and the placements are unanswerable.
    //
    // A hard filter rather than another ranking tier, because the net score
    // cannot see this at all: the peek evaluates as if the board froze after
    // our placement, so the opponent's answer never enters any number. Left
    // to net alone the bot played its ships *first* — they rank highest.
    //
    // No "keep one blocker in reserve" carve-out. An offensive piece is a
    // perfectly good interceptor (both sides travel towards each other and
    // meet in the neutral zone), and the peek already prices that: a head-on
    // kill lowers the opponent's score and rises in the ranking on its own.
    // Roles decide the *order* here, never the value.
    const isOffensive = (card: Card): boolean =>
      OFFENSIVE_PATTERN_INDICES.has(card.patternIndex);
    const holdOffence =
      view.opponentCardCount > 0 && view.ownHand.some((c) => !isOffensive(c));
    const playableHand = holdOffence
      ? view.ownHand.filter((c) => !isOffensive(c))
      : view.ownHand;

    for (const card of playableHand) {
      const basePattern = PATTERNS[card.patternIndex];
      if (!basePattern) continue;
      const pattern = getPatternForPlayer(basePattern, 2);

      const candidates = this.generateShortlist(card, pattern, view);
      for (const { row, col } of candidates) {
        const key = [
          this.peekNetScore(view.grid, pattern, row, col),
          footprintOverlapsGrid(pattern, row, col, view.grid) ? 0 : 1,
          isClear(row) ? 1 : 0,
          -Math.abs(row - midRow), // higher = more central
        ];
        const cmp = bestKey === null ? 1 : compare(key, bestKey);
        if (cmp > 0) {
          bestKey = key;
          tied = [{ cardId: card.id, row, col }];
        } else if (cmp === 0) {
          tied.push({ cardId: card.id, row, col });
        }
      }
    }

    if (tied.length > 0) {
      return tied[Math.floor(this.rng() * tied.length)] ?? tied[0]!;
    }

    // Fallback: no legal candidate was found for any card (shouldn't
    // happen given zone geometry, but use-it-or-lose-it requires a
    // placement). Fall back to the first card's single best heuristic pick.
    const fallbackCard = playableHand[0];
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
  // oscillating pieces get a defensive shortlist aimed at the trajectories
  // of threats the opponent has placed this phase, with a uniform scatter
  // behind it as a floor.
  private generateShortlist(
    card: Card,
    pattern: Pattern,
    view: BotView,
  ): { row: number; col: number }[] {
    if (OFFENSIVE_PATTERN_INDICES.has(card.patternIndex)) {
      // Keep a second ship away from the debris field the first one will
      // leave (see SHIP_MIN_ROW_SEPARATION). This has to happen here rather
      // than as a ranking tier: on a quiet board the offensive heuristic is
      // dominated by its centrality term, so every one of the top candidates
      // sits in the *same* row and differs only by column — a tier would have
      // had nothing else to choose from, and both ships would stack.
      const shipRows = view.ownPlacements
        .filter((p) => OFFENSIVE_PATTERN_INDICES.has(p.patternIndex))
        .map((p) => p.row);
      const clear = (row: number): boolean =>
        shipRows.every((r) => Math.abs(r - row) >= SHIP_MIN_ROW_SEPARATION);

      const spaced = this.shortlistGenerator.rankPlacements(
        pattern,
        view.grid,
        this.shortlistSize,
        clear,
      );
      // Fall back to the unfiltered list rather than returning nothing:
      // use-it-or-lose-it means the card is placed regardless, and a stacked
      // ship still beats a random one from the generic fallback path.
      if (spaced.length > 0) return spaced;
      return this.shortlistGenerator.rankPlacements(
        pattern,
        view.grid,
        this.shortlistSize,
      );
    }
    return this.generateDefensiveCandidates(pattern, view);
  }

  // Project where each witnessed opponent placement crosses the given column,
  // most dangerous first. Returns intercept rows, not threat positions.
  //
  // Skipped: static pieces (weight 0 — an opponent's own block is not coming
  // for anyone) and any trajectory that has left the grid by the time it
  // reaches this column, which is a glider that dies against the top or
  // bottom edge on the way over.
  private projectInterceptRows(atCol: number, view: BotView): number[] {
    const rows = this.game.rows;
    const scored: { row: number; weight: number }[] = [];

    for (const placement of view.opponentPlacements) {
      const pattern = PATTERNS[placement.patternIndex];
      if (!pattern) continue;

      const { kind, rowPerCol } = pattern.movement;
      const weight = THREAT_WEIGHT[kind] ?? 0;
      if (weight === 0) continue;

      // The opponent is P1, travelling towards increasing columns. A column
      // already behind the threat is not on its path.
      const colsToTravel = atCol - placement.col;
      if (colsToTravel <= 0) continue;

      const interceptRow =
        patternSourceRow(pattern, placement.row) + rowPerCol * colsToTravel;
      if (interceptRow < 0 || interceptRow >= rows) continue;

      scored.push({ row: interceptRow, weight });
    }

    scored.sort((a, b) => b.weight - a.weight);
    return scored.map((s) => s.row);
  }

  // Rows of our own zone that already hold something — our earlier placements
  // this phase, plus any debris that carried over.
  private occupiedRowsInOwnZone(grid: boolean[][]): boolean[] {
    const zones = this.game.zones;
    const occupied = new Array<boolean>(this.game.rows).fill(false);
    for (let r = 0; r < this.game.rows; r++) {
      for (let c = zones.rightStart; c < zones.goalZoneRightStart; c++) {
        if (grid[r]?.[c]) {
          occupied[r] = true;
          break;
        }
      }
    }
    return occupied;
  }

  // Rows worth defending at this column: observed first, projected second.
  //
  // Observed leads because it is the stronger signal for the threats nothing
  // else can see — stationary wall debris keeps scoring in the same rows phase
  // after phase, so where it scored last time is where it will score next.
  //
  // Projection covers what observation structurally cannot: a piece placed
  // this phase, which has never scored and therefore appears nowhere in the
  // previous phase's events.
  private defensiveRowsFor(atCol: number, view: BotView): number[] {
    return [
      ...view.observedScoreRows,
      ...this.projectMotionRows(atCol, view),
      ...this.projectInterceptRows(atCol, view),
    ];
  }

  // Where each observed mover crosses the given column, using the velocity
  // measured from the frame diff rather than a table lookup. Same geometry as
  // projectInterceptRows, but it needs no idea of *what* the thing is — which
  // is the point, since some movers (a gun's glider stream) were never placed
  // as a unit and have no pattern to look up.
  private projectMotionRows(atCol: number, view: BotView): number[] {
    const rows = this.game.rows;
    const out: number[] = [];

    for (const mover of view.observedMotion) {
      // Travelling away from us, or not really travelling: not a threat.
      if (mover.colsPerGen <= 0) continue;
      const colsToTravel = atCol - mover.col;
      if (colsToTravel <= 0) continue;

      const interceptRow = Math.round(
        mover.row + (mover.rowsPerGen / mover.colsPerGen) * colsToTravel,
      );
      // Leaves the board before it gets here — it dies against an edge.
      if (interceptRow < 0 || interceptRow >= rows) continue;

      out.push(interceptRow);
    }
    return out;
  }

  // Threat-aware defensive shortlist. Most of the budget goes to rows where
  // a witnessed threat actually crosses each candidate column; the rest stays
  // a uniform scatter across the zone, so an unseen carry-over threat or a
  // phase with no placements yet still yields usable candidates.
  //
  // The sim ranking in choosePlacement() remains the arbiter — this only
  // decides what gets offered to it. "Gut zielen, Sim richtet."
  private generateDefensiveCandidates(
    pattern: Pattern,
    view: BotView,
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

    const candidates: { row: number; col: number }[] = [];
    const seen = new Set<string>();
    const add = (row: number, col: number): void => {
      const key = `${row},${col}`;
      if (seen.has(key)) return;
      if (!zones.isValidPatternPlacement(pattern, row, col, 2)) return;
      seen.add(key);
      candidates.push({ row, col });
    };

    // Pass 1 — cover the rows that are actually dangerous.
    //
    // Columns are walked *farthest first*, which is not the obvious choice.
    // Measurement drove it: a stationary debris field parked against the wall
    // is only answerable from the columns right next to it — an exhaustive
    // sweep found the median placement changes nothing at all (340 points
    // either way) while a block at column 94 removes 97% of it. A travelling
    // ship, by contrast, passes through every column on its way, so the far
    // columns work for it too. Far-first covers both threat classes; the
    // near-first ordering only ever covered one.
    //
    // Threat index is the outer loop so several simultaneous threats each get
    // their best column before any single one gets its second-best.
    const rowsByCol = candidateCols.map((col) => ({
      col,
      rows: this.defensiveRowsFor(col, view),
    }));
    rowsByCol.reverse();

    const threatBudget = Math.floor(
      DEFENSIVE_SHORTLIST_SIZE * THREAT_CANDIDATE_SHARE,
    );
    const deepestThreatList = Math.max(0, ...rowsByCol.map((e) => e.rows.length));

    outer: for (let i = 0; i < deepestThreatList; i++) {
      for (const { col, rows: threatRows } of rowsByCol) {
        const threatRow = threatRows[i];
        if (threatRow === undefined) continue;
        for (
          let offset = -INTERCEPT_ROW_BAND;
          offset <= INTERCEPT_ROW_BAND;
          offset++
        ) {
          if (candidates.length >= threatBudget) break outer;
          add(threatRow + offset, col);
        }
      }
    }

    // Pass 2 — uniform scatter fills the rest. This is the whole shortlist
    // when no threat has been witnessed (phase openers, or a phase where the
    // opponent has yet to place), which keeps the previous behaviour intact
    // as the floor rather than as the strategy.
    const desiredRows = Math.max(
      1,
      Math.ceil(DEFENSIVE_SHORTLIST_SIZE / candidateCols.length),
    );
    const rowStep = Math.max(1, Math.floor(rows / desiredRows));

    // Row-at-a-time, not candidate-at-a-time: truncating mid-row would drop
    // exactly the columns that catch a threat this pass never witnessed —
    // one stamped onto the grid, or carried over from an earlier phase.
    for (
      let row = 0;
      row < rows && candidates.length < DEFENSIVE_SHORTLIST_SIZE;
      row += rowStep
    ) {
      for (const col of candidateCols) {
        add(row, col);
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
