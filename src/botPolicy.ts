// Bot policies: V1 dummy, Stufe-2a rule-based, and the Stufe-3 sim-ranking
// hybrid that production runs.
//
// BotPolicy (botView.ts) is the single extension point for bot intelligence —
// difficulty levels and future personas swap or configure the implementation
// here, the BotController integration stays unchanged. The threat model lives
// in botThreat.ts, the buy planner and personas in botBuy.ts.

import type { Card, Pattern } from "./types.js";
import type { Game } from "./game.js";
import { PATTERNS } from "./patterns.js";
import { getPatternForPlayer } from "./patternUtils.js";
import type { BotPolicy, BotView, BuyBundle } from "./botView.js";
import { peekNetScore } from "./botPeek.js";
import { defensiveRowsFor, maxIncomingShips } from "./botThreat.js";
import {
  BALANCED_PROFILE,
  BUY_PROFILES,
  LEAD_DEFENCE_THRESHOLDS,
  planBudgetAwareBuy,
} from "./botBuy.js";
import type { BuyPersona, BuyProfile } from "./botBuy.js";

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

export class RuleBasedBotPolicy implements BotPolicy {
  private game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  chooseBuy(_view: BotView): BuyBundle[] {
    return DUMMY_BUNDLE;
  }

  // Joint BotPolicy entry point: always plays the first card in hand at its
  // single best heuristic position. This is what the "Casual" difficulty
  // level runs — placement quality comes entirely from the 2a heuristic,
  // with no simulation peek and no card selection.
  choosePlacement(
    view: BotView,
  ): { cardId: string; row: number; col: number } | null {
    const card = view.ownHand[0];
    if (!card) return null;
    const { row, col } = this.choosePlacementForCard(view, card);
    return { cardId: card.id, row, col };
  }

  // Single-best convenience wrapper, kept for tests and as a reference
  // baseline. Stufe 3 calls rankPlacements() directly to get a shortlist
  // instead of just the top pick.
  choosePlacementForCard(
    view: BotView,
    card: Card,
  ): { row: number; col: number } {
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

// Patterns that travel and should use the offensive shortlist: anything with
// a non-static movement profile. Derived from the movement physics in
// patterns.ts rather than kept as a hand-maintained index set — the previous
// `OFFENSIVE_PATTERN_INDICES = {0, 1, 8, 9, 10, 11, 12}` duplicated exactly
// that information, and a newly added ship would have fallen silently into
// the defensive candidate generator until someone remembered the set.
// An unknown index reads as static (defensive path), matching the old
// behaviour of not being in the set.
function isOffensivePatternIndex(patternIndex: number): boolean {
  return (PATTERNS[patternIndex]?.movement.kind ?? "static") !== "static";
}

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

export class SimRankingBotPolicy implements BotPolicy {
  private game: Game;
  private shortlistGenerator: RuleBasedBotPolicy;
  private horizonOverride: number | undefined;
  private shortlistSize: number;
  private rng: () => number;
  // Difficulty handicap: probability of deliberately playing from the second-
  // or third-best tie group of the placement ranking instead of the best one.
  // 0 (the default) is full strength — every dial in this class is tuned for
  // the strongest bot, and epsilon is the one exception, existing purely so
  // lower difficulty levels can be built from the same policy (see
  // botDifficulty.ts). It never touches the buy.
  private epsilon: number;

  // Drawn once per game and then fixed: a persona is only a personality if it
  // is coherent for a whole match. Redrawing per phase would read as noise.
  //
  // The two axes are drawn independently — an aggressor that protects a small
  // lead and a defender that never stops racing are both coherent opponents,
  // and pinning the axes together would throw away most of the variety.
  readonly persona: BuyPersona;

  constructor(
    game: Game,
    options?: {
      horizon?: number;
      shortlistSize?: number;
      rng?: () => number;
      leadDefenceThreshold?: number;
      profile?: BuyProfile;
      epsilon?: number;
    },
  ) {
    this.game = game;
    this.shortlistGenerator = new RuleBasedBotPolicy(game);
    this.horizonOverride = options?.horizon;
    this.shortlistSize = options?.shortlistSize ?? SHORTLIST_SIZE;
    this.rng = options?.rng ?? mulberry32(DEFAULT_RNG_SEED);
    this.epsilon = options?.epsilon ?? 0;
    this.persona = {
      profile:
        options?.profile ??
        BUY_PROFILES[Math.floor(this.rng() * BUY_PROFILES.length)] ??
        BALANCED_PROFILE,
      leadDefenceThreshold:
        options?.leadDefenceThreshold ??
        LEAD_DEFENCE_THRESHOLDS[
          Math.floor(this.rng() * LEAD_DEFENCE_THRESHOLDS.length)
        ] ??
        Infinity,
    };
  }

  // Kept as its own accessor because the tests and the buy planner both read
  // it far more often than they read the profile.
  get leadDefenceThreshold(): number {
    return this.persona.leadDefenceThreshold;
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
    return planBudgetAwareBuy(view, underThreat, this.persona);
  }

  choosePlacement(
    view: BotView,
  ): { cardId: string; row: number; col: number } | null {
    // Every evaluated candidate with its full ranking key; the winner is
    // grouped and drawn at the end rather than taken in loop order.
    //
    // The tiers below are thresholds and integer sums, so exact ties are the
    // common case, not an edge case — and resolving them by iteration order
    // made the bot needlessly predictable: the centrality tier always answers
    // "the middle", so a hand with nothing to block landed in the same place
    // every game. Measured on an empty board, a single MWSS scores identically
    // (2129) launched from row 10, 20, 32, 44, 56, 68 or 80 — the choice among
    // tied rows is worth nothing, which is exactly what makes it free to
    // randomise. Nothing below the tie is randomised: the tiers themselves are
    // only ever sampled past by the explicit epsilon handicap at the end,
    // which full strength (epsilon 0) never takes.
    const entries: {
      key: number[];
      cardId: string;
      row: number;
      col: number;
    }[] = [];

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
      isOffensivePatternIndex(card.patternIndex);
    const holdOffence =
      view.opponentCardCount > 0 && view.ownHand.some((c) => !isOffensive(c));
    const playableHand = holdOffence
      ? view.ownHand.filter((c) => !isOffensive(c))
      : view.ownHand;

    // Fixed for the whole decision — the horizon getter reads the current
    // phase's simGenerations once, and a phase cannot change mid-turn.
    const peekEnv = {
      rows: this.game.rows,
      cols: this.game.cols,
      zones: this.game.zones,
      horizon: this.horizon,
    };

    for (const card of playableHand) {
      const basePattern = PATTERNS[card.patternIndex];
      if (!basePattern) continue;
      const pattern = getPatternForPlayer(basePattern, 2);

      const candidates = this.generateShortlist(card, pattern, view);
      for (const { row, col } of candidates) {
        const key = [
          peekNetScore(view.grid, pattern, row, col, peekEnv),
          footprintOverlapsGrid(pattern, row, col, view.grid) ? 0 : 1,
          isClear(row) ? 1 : 0,
          -Math.abs(row - midRow), // higher = more central
        ];
        entries.push({ key, cardId: card.id, row, col });
      }
    }

    if (entries.length > 0) {
      // Stable sort, best key first: equal keys keep their loop order, so
      // with epsilon 0 the group draw below picks from exactly the same set,
      // in the same order, with the same single rng call as the pre-epsilon
      // implementation — full strength is bit-for-bit unchanged.
      entries.sort((a, b) => compare(b.key, a.key));
      const groups: (typeof entries)[] = [];
      for (const entry of entries) {
        const current = groups[groups.length - 1];
        if (current && compare(current[0]!.key, entry.key) === 0) {
          current.push(entry);
        } else {
          groups.push([entry]);
        }
      }

      // Epsilon handicap: occasionally play from the second- or third-best
      // tie group. Sampled over *groups* rather than raw ranks on purpose — a
      // group is one strategic option repeated across equivalent spots, so
      // rank-based sampling would mostly land in the (large) best group and
      // barely weaken anything. Never deeper than the third group: the point
      // is a plausible lapse, not a random move — level 1 already covers
      // random.
      let groupIndex = 0;
      if (this.epsilon > 0 && groups.length > 1 && this.rng() < this.epsilon) {
        groupIndex =
          1 + Math.floor(this.rng() * Math.min(2, groups.length - 1));
      }
      const group = groups[groupIndex]!;
      const pick = group[Math.floor(this.rng() * group.length)] ?? group[0]!;
      return { cardId: pick.cardId, row: pick.row, col: pick.col };
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
    if (isOffensivePatternIndex(card.patternIndex)) {
      // Keep a second ship away from the debris field the first one will
      // leave (see SHIP_MIN_ROW_SEPARATION). This has to happen here rather
      // than as a ranking tier: on a quiet board the offensive heuristic is
      // dominated by its centrality term, so every one of the top candidates
      // sits in the *same* row and differs only by column — a tier would have
      // had nothing else to choose from, and both ships would stack.
      const shipRows = view.ownPlacements
        .filter((p) => isOffensivePatternIndex(p.patternIndex))
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

  // Threat-aware defensive shortlist. Most of the budget goes to rows where
  // a witnessed threat actually crosses each candidate column (observed and
  // projected, see botThreat.ts); the rest stays a uniform scatter across the
  // zone, so an unseen carry-over threat or a phase with no placements yet
  // still yields usable candidates.
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
      rows: defensiveRowsFor(col, view, rows),
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
}
