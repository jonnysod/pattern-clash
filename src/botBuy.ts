// Budget-aware buy planner (Stufe 4) and the buying personas.
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

import { PATTERNS } from "./patterns.js";
import { CONFIG } from "./config.js";
import type { BotView, BuyBundle } from "./botView.js";

const OFFENSE_PREFERENCE = [1, 0, 8]; // MWSS, LWSS, Glider down
const DEFENSE_PREFERENCE = [2, 5, 4]; // Block, Blinker, Boat

// A buying temperament, drawn once per game alongside the lead threshold.
//
// Only dials that are genuinely a matter of taste belong here. The rest of
// the bot's numbers were measured and have a right answer — ship separation,
// the offence-hold gate, the shortlist size, the peek horizon — and varying
// those would not produce a personality, only a worse opponent.
//
// The three differ in how they convert budget into board presence: the
// aggressor buys few expensive pieces and ignores card count, the defender
// buys many cheap ones and chases it, the balanced one is what the measured
// defaults arrived at.
export interface BuyProfile {
  readonly name: string;
  // Target fraction of bought slots that should be offensive.
  readonly offenceShare: number;
  // How hard to chase card-count parity, as a fraction of the opponent's hand:
  // 0 disables the rule, 1 aims to match them card for card.
  //
  // Why parity is worth budget at all: the place phase alternates, so whoever
  // still holds cards when the other runs out plays the remainder unanswered.
  // Combined with holding offence back (see choosePlacement), every defensive
  // card bought past the opponent's count converts one of our spaceships from
  // "answerable by a 4-cell block" into "unanswerable".
  //
  // Why nobody gets 1: full parity is not affordable. From phase 2 the budget,
  // not the slot cap, is binding — 25 points buys either two MWSS and one
  // block, or one MWSS and four cheap cards. Swept against a five-card
  // opponent, cards bought in phases 3-6 and offence surviving:
  //
  //   0.0 / 0.3 -> 3 cards, 2 spaceships   (target <= 1, rule never fires)
  //   0.4       -> 4-5 cards, 2 spaceships
  //   0.6 / 0.8 -> 4-5 cards, 1 spaceship
  //   1.0       -> 5-7 cards, 1 spaceship
  //
  // 0.4 is where the tempo is still free; the step to 0.6 costs a whole MWSS
  // and buys no extra cards. The defender pays that price knowingly — trading
  // a spaceship for tempo is exactly what makes it a different opponent rather
  // than a differently-tuned one.
  readonly parityTarget: number;
  // Of MAX_SLOTS (10): the cap on cards bought in one phase. Lower means less
  // board presence but also fewer forced use-it-or-lose-it placements, which
  // are what clutter our own zone and raise self-score risk.
  readonly slotCap: number;
}

export const BUY_PROFILES: readonly BuyProfile[] = [
  { name: "aggressor", offenceShare: 0.8, parityTarget: 0, slotCap: 5 },
  { name: "balanced", offenceShare: 0.6, parityTarget: 0.4, slotCap: 7 },
  { name: "defender", offenceShare: 0.4, parityTarget: 0.7, slotCap: 8 },
];

// The measured defaults, and what direct callers get when they pass nothing.
export const BALANCED_PROFILE = BUY_PROFILES[1]!;

// Persona = the two independent draws. Kept separate rather than folding the
// threshold into a profile because they are orthogonal: "how do I buy" and
// "what do I do when winning" are different questions, and pinning them
// together would cut the variety a player actually notices.
export interface BuyPersona {
  readonly profile: BuyProfile;
  readonly leadDefenceThreshold: number;
}

export const DEFAULT_PERSONA: BuyPersona = {
  profile: BALANCED_PROFILE,
  leadDefenceThreshold: Infinity,
};

function clampShare(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// Point lead at which the bot stops racing and starts protecting, drawn once
// per game (see SimRankingBotPolicy). Infinity means never — it plays the same
// whether it is winning or losing, which is roughly the old behaviour.
//
// Calibrated against real games rather than the single-piece measurements in
// this file: serious matches end between 100 and 400 points, rarely 800. So 50
// is an eighth to a half of a final score, and 200 is a commanding lead.
//
// Randomised because it is the axis a human notices most — "it went turtle on
// me" reads as a personality, not as a weaker opponent — and because the
// threshold is a genuine strategic choice rather than a solved value.
export const LEAD_DEFENCE_THRESHOLDS = [50, 100, 150, 200, Infinity];

// Offense share once the lead is being protected. Below the 0.3 floor the
// normal tilt is clamped to, so protecting returns early rather than being
// clamped back up into ordinary play.
//
// Defence is worth this much because it is the more point-efficient role once
// a target exists: measured over a phase, a 4-point block on a debris source
// took the opponent from 402 to 63 (~85 points saved per budget point), while
// an unanswered 11-point MWSS scores 233 (~21 per budget point). Ahead, that
// asymmetry counts twice — points denied widen the gap exactly as points
// scored do.
const LEAD_DEFENCE_SHARE = 0.2;

// Cap on the *number* of defensive cards when nothing on the board is scoring
// against us. Not zero: one absorber is cheap insurance against a threat placed
// later in the same phase, which no peek of the current board can see yet.
const DEFENSE_CAP_WITHOUT_THREAT = 1;

// Never trade away the last spaceship, whatever parity would like. Enforced by
// ordering rather than by reserving budget: below the floor the offensive buy
// simply goes first, which on an empty basket is the very first purchase, so
// the strongest affordable spaceship is secured before parity spends anything.
const OFFENCE_FLOOR_CARDS = 1;

// Target fraction of bought slots that should be offense, from view state.
// `underThreat` comes from the threat signals — see planBudgetAwareBuy.
function computeOffenseShare(
  view: BotView,
  underThreat: boolean,
  persona: BuyPersona,
): number {
  const scoreDiff = view.ownScore - view.opponentScore; // + = ahead

  let share = persona.profile.offenceShare;
  // Nothing is scoring against us: defensive cards have nothing to block, and
  // use-it-or-lose-it would force them onto the board anyway. Buy offense.
  if (!underThreat) return 0.85;

  // Protecting a lead. Deliberately below the threat check, so the two are
  // conjunctive: a comfortable lead is no reason to buy blocks that have
  // nothing to block, since use-it-or-lose-it forces them onto our own board
  // anyway.
  //
  // That conjunction happens to be held twice over — the early return above
  // means this line is never reached without a threat, and even if it were,
  // DEFENSE_CAP_WITHOUT_THREAT caps defensive cards at one further down. Both
  // guards predate this dial and are independently motivated, so neither was
  // removed; it is worth knowing that no single test can distinguish them.
  //
  // Returns early to bypass the 0.3 floor below, which exists to stop the
  // ordinary tilt from abandoning offence; here abandoning it is the point.
  if (scoreDiff >= persona.leadDefenceThreshold) return LEAD_DEFENCE_SHARE;

  // Behind → tilt offensive to catch up.
  //
  // Only the behind half is a gradient now. This used to be two-sided as
  // `scoreDiff / 20`, which saturated at a four-point gap — two orders of
  // magnitude below real scores (100-400 a game), so it was permanently
  // pinned and acted as a constant flag rather than a slope. The ahead half
  // is now the explicit threshold above; this half is rescaled to saturate
  // around a hundred-point deficit, which is a real one.
  if (scoreDiff < 0) share += clampShare(-scoreDiff / 500, 0, 0.2);

  // More opponent cards on the board → more incoming threats → more defense.
  share -= clampShare((view.opponentCardCount - 4) / 40, 0, 0.1);

  // Final phase, no carryover into a next phase: if not already ahead, there
  // is nothing left to protect — go all-in on scoring.
  if (view.phase >= 6 && scoreDiff <= 0) share = 0.85;

  return clampShare(share, 0.3, 0.85);
}

// Greedily fill up to the profile's slot cap, interleaving offense/defense to keep
// the running offense fraction near computeOffenseShare(view), always buying
// the cheapest-affordable preferred pattern in the chosen role (respecting the
// per-type copy cap and the remaining budget). Leftover budget rolls over —
// saving across phases is legal and intended.
// `underThreat` defaults to true so the Dummy/RuleBased policies and existing
// callers keep the previous, threat-agnostic behaviour; only SimRankingBotPolicy
// has a peek to base the answer on.
// `persona` defaults to the balanced profile that never protects a lead, so
// the Dummy/RuleBased policies and direct callers keep the behaviour they had
// before either dial existed.
export function planBudgetAwareBuy(
  view: BotView,
  underThreat: boolean = true,
  persona: BuyPersona = DEFAULT_PERSONA,
): BuyBundle[] {
  const priceOf = (idx: number): number =>
    PATTERNS[idx]?.cells.length ?? Infinity;
  const offenseShare = computeOffenseShare(view, underThreat, persona);

  const counts = new Map<number, number>();
  const copiesOf = (idx: number): number => counts.get(idx) ?? 0;
  let slots = 0;
  let budget = view.ownBudget;

  // Cards of cheap defence that would put our offence in the unanswerable
  // tail of the place phase. Rounded down: overshooting parity buys nothing
  // extra, the tail only has to start before our first ship goes down.
  const parityTarget = Math.floor(
    view.opponentCardCount * persona.profile.parityTarget,
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

  while (slots < persona.profile.slotCap) {
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
