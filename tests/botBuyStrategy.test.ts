// Tests for the budget-aware buy planner (Stufe 4).

import { describe, it, expect } from "vitest";
import {
  planBudgetAwareBuy,
  LEAD_DEFENCE_THRESHOLDS,
  BUY_PROFILES,
  BALANCED_PROFILE,
  SimRankingBotPolicy,
} from "../src/botPolicy.js";
import type { BotView, BuyBundle } from "../src/botPolicy.js";
import { PATTERNS } from "../src/patterns.js";
import { CONFIG } from "../src/config.js";
import { makeGame } from "./_helpers.js";

const OFFENSE = new Set([0, 1, 8, 9, 10, 11, 12]); // spaceships + guns
const DEFENSE = new Set([2, 3, 4, 5, 6, 7]); // still lifes + oscillators
const BUY_SLOT_CAP = 7; // mirror of the source constant

function view(overrides: Partial<BotView> = {}): BotView {
  return {
    grid: [],
    phase: 1,
    ownBudget: 65, // phase-1 budget
    ownHand: [],
    opponentCardCount: 0,
    ownScore: 0,
    opponentScore: 0,
    opponentPlacements: [],
    ownPlacements: [],
    opponentBudget: 0,
    opponentSpentThisPhase: null,
    observedScoreRows: [],
    observedMotion: [],
    ...overrides,
  };
}

const totalSlots = (b: BuyBundle[]) => b.reduce((s, x) => s + x.count, 0);
const totalPrice = (b: BuyBundle[]) =>
  b.reduce((s, x) => s + (PATTERNS[x.patternIndex]?.cells.length ?? 0) * x.count, 0);
const slotsIn = (b: BuyBundle[], set: Set<number>) =>
  b.reduce((s, x) => s + (set.has(x.patternIndex) ? x.count : 0), 0);
const offenseFraction = (b: BuyBundle[]) =>
  totalSlots(b) === 0 ? 0 : slotsIn(b, OFFENSE) / totalSlots(b);

describe("planBudgetAwareBuy — legality", () => {
  it("never exceeds the budget", () => {
    for (const budget of [5, 12, 25, 40, 65, 120]) {
      const b = planBudgetAwareBuy(view({ ownBudget: budget }));
      expect(totalPrice(b)).toBeLessThanOrEqual(budget);
    }
  });

  it("respects the slot cap and per-type copy cap", () => {
    const b = planBudgetAwareBuy(view({ ownBudget: 200 })); // budget won't bind
    expect(totalSlots(b)).toBeLessThanOrEqual(BUY_SLOT_CAP);
    for (const x of b) {
      expect(x.count).toBeLessThanOrEqual(CONFIG.MAX_COPIES_PER_TYPE);
    }
  });

  it("spends up to the slot cap when budget is ample", () => {
    const b = planBudgetAwareBuy(view({ ownBudget: 200 }));
    expect(totalSlots(b)).toBe(BUY_SLOT_CAP);
  });

  it("is deterministic", () => {
    const v = view({ ownBudget: 55, ownScore: 3, opponentScore: 7 });
    expect(planBudgetAwareBuy(v)).toEqual(planBudgetAwareBuy(v));
  });

  it("buys the cheapest affordable card on a tiny budget", () => {
    const b = planBudgetAwareBuy(view({ ownBudget: 5 }));
    expect(totalSlots(b)).toBeGreaterThanOrEqual(1);
    expect(totalPrice(b)).toBeLessThanOrEqual(5);
  });
});

describe("planBudgetAwareBuy — composition", () => {
  it("buys both offense and defense at a neutral state", () => {
    const b = planBudgetAwareBuy(view());
    expect(slotsIn(b, OFFENSE)).toBeGreaterThan(0);
    expect(slotsIn(b, DEFENSE)).toBeGreaterThan(0);
  });

  it("leans offensive at a neutral state", () => {
    const b = planBudgetAwareBuy(view());
    expect(offenseFraction(b)).toBeGreaterThanOrEqual(0.5);
  });
});

describe("planBudgetAwareBuy — state-aware tilt", () => {
  // Deficits are stated at the scale real games run at (100-400 points a
  // match). The tilt used to saturate at four points, which made every score
  // in a real game look identical to it.
  it("buys more offense when behind than at a neutral state", () => {
    const behind = planBudgetAwareBuy(
      view({ ownScore: 0, opponentScore: 100 }),
    );
    const neutral = planBudgetAwareBuy(view());
    expect(offenseFraction(behind)).toBeGreaterThan(offenseFraction(neutral));
  });

  it("scales the catch-up tilt with the size of the deficit", () => {
    const slightly = planBudgetAwareBuy(view({ ownScore: 0, opponentScore: 20 }));
    const badly = planBudgetAwareBuy(view({ ownScore: 0, opponentScore: 200 }));
    expect(offenseFraction(badly)).toBeGreaterThan(offenseFraction(slightly));
  });

  it("ignores a lead on its own — protecting it is the persona's call", () => {
    // Without a threshold the bot races whatever the score. Being ahead is
    // only a reason to defend once a drawn threshold says so, which is what
    // the lead-defence tests below cover.
    const neutral = planBudgetAwareBuy(view());
    const ahead = planBudgetAwareBuy(view({ ownScore: 200, opponentScore: 0 }));
    expect(offenseFraction(ahead)).toBe(offenseFraction(neutral));
  });

  it("nudges toward defense when the opponent holds many cards", () => {
    const few = planBudgetAwareBuy(view({ opponentCardCount: 0 }));
    const many = planBudgetAwareBuy(view({ opponentCardCount: 8 }));
    expect(offenseFraction(many)).toBeLessThanOrEqual(offenseFraction(few));
  });

  it("goes nearly all-in on offense in phase 6 when not ahead", () => {
    const b = planBudgetAwareBuy(
      view({ phase: 6, ownScore: 4, opponentScore: 4 }),
    );
    expect(offenseFraction(b)).toBeGreaterThanOrEqual(0.8);
  });
});

// ---------------------------------------------------------------------------
// Card-count parity
// ---------------------------------------------------------------------------
//
// The place phase alternates, so whoever still holds cards when the other runs
// out plays the remainder unanswered. Buying cheap defence towards the
// opponent's card count lengthens that tail, which is what makes holding
// offence back (see choosePlacement) pay off.

const countCards = (b: ReturnType<typeof planBudgetAwareBuy>): number =>
  b.reduce((s, x) => s + x.count, 0);
const countOffence = (b: ReturnType<typeof planBudgetAwareBuy>): number =>
  b.filter((x) => OFFENSE.has(x.patternIndex)).reduce((s, x) => s + x.count, 0);

describe("planBudgetAwareBuy — card-count parity", () => {
  it("buys extra cheap cards to lengthen the tail", () => {
    // Five opponent cards, one phase's budget. The share arithmetic alone
    // spends this on two spaceships and one block (3 cards); parity turns the
    // same budget into four, without giving up either spaceship.
    const bundles = planBudgetAwareBuy(
      view({ ownBudget: 26, opponentCardCount: 5 }),
    );

    expect(countCards(bundles)).toBeGreaterThanOrEqual(4);
    expect(countOffence(bundles)).toBe(2);
  });

  it("never trades away the last spaceship for parity", () => {
    // 18 points against a ten-card hand: four cheap cards cost 15 and would
    // leave nothing that can fly. The reserve has to win over parity here.
    const bundles = planBudgetAwareBuy(
      view({ ownBudget: 18, opponentCardCount: 10 }),
    );
    expect(countOffence(bundles)).toBeGreaterThanOrEqual(1);
  });

  it("leaves a small opponent hand alone", () => {
    // floor(2 × 0.4) = 0, so the rule must not fire at all here — the share
    // arithmetic keeps deciding, exactly as before.
    const bundles = planBudgetAwareBuy(
      view({ ownBudget: 26, opponentCardCount: 2 }),
    );
    expect(countOffence(bundles)).toBe(2);
  });

  it("keeps every buy legal while chasing parity", () => {
    const bundles = planBudgetAwareBuy(
      view({ ownBudget: 26, opponentCardCount: 10 }),
    );
    const spent = bundles.reduce(
      (s, b) => s + PATTERNS[b.patternIndex]!.cells.length * b.count,
      0,
    );
    expect(spent).toBeLessThanOrEqual(26);
    expect(countCards(bundles)).toBeLessThanOrEqual(CONFIG.MAX_SLOTS);
    for (const b of bundles) {
      expect(b.count).toBeLessThanOrEqual(CONFIG.MAX_COPIES_PER_TYPE);
    }
  });
});

// ---------------------------------------------------------------------------
// Lead defence (persona axis)
// ---------------------------------------------------------------------------
//
// Once ahead by more than a threshold drawn at game start, the bot stops
// racing and starts denying points instead. Defence is the more efficient
// role when a target exists (a 4-point block took a debris source from 402 to
// 63 over a phase; an unanswered 11-point MWSS scores 233), and ahead that
// asymmetry counts twice — points denied widen the gap like points scored.

describe("planBudgetAwareBuy — lead defence", () => {
  const ahead = (by: number) => view({ ownScore: by, opponentScore: 0 });
  // Balanced profile throughout: this block is about the threshold axis, so
  // the buying profile is held fixed rather than drawn.
  const persona = (leadDefenceThreshold: number) => ({
    profile: BALANCED_PROFILE,
    leadDefenceThreshold,
  });
  const countDefence = (b: BuyBundle[]): number =>
    b.filter((x) => DEFENSE.has(x.patternIndex)).reduce((s, x) => s + x.count, 0);

  it("swings defensive once the lead passes the threshold", () => {
    const below = planBudgetAwareBuy(ahead(40), true, persona(50));
    const above = planBudgetAwareBuy(ahead(60), true, persona(50));
    expect(offenseFraction(above)).toBeLessThan(offenseFraction(below));
  });

  it("keeps racing below the threshold", () => {
    const neutral = planBudgetAwareBuy(view(), true, persona(50));
    const slightly = planBudgetAwareBuy(ahead(40), true, persona(50));
    expect(offenseFraction(slightly)).toBe(offenseFraction(neutral));
  });

  it("respects where the threshold sits", () => {
    // A 120-point lead protects under a 100 threshold but not under a 150 one.
    const tight = planBudgetAwareBuy(ahead(120), true, persona(100));
    const loose = planBudgetAwareBuy(ahead(120), true, persona(150));
    expect(offenseFraction(tight)).toBeLessThan(offenseFraction(loose));
  });

  it("never protects when the drawn threshold is 'never'", () => {
    const huge = planBudgetAwareBuy(ahead(1000), true, persona(Infinity));
    const neutral = planBudgetAwareBuy(view(), true, persona(Infinity));
    expect(offenseFraction(huge)).toBe(offenseFraction(neutral));
  });

  it("does not stockpile blocks for a lead with nothing to block", () => {
    // Asserted on the card count rather than the share, because two
    // independent mechanisms produce this outcome — lead defence is never
    // reached without a threat, and the no-threat defence cap would limit it
    // anyway — so no assertion on the share can pin down which one acted.
    // What matters either way: blocks with no target are not stockpiled,
    // since use-it-or-lose-it puts them on our own board.
    const bundles = planBudgetAwareBuy(ahead(200), false, persona(50));
    expect(countDefence(bundles)).toBeLessThanOrEqual(1);
  });
});

describe("SimRankingBotPolicy — lead threshold draw", () => {
  it("draws one of the offered thresholds and keeps it for the game", () => {
    const game = makeGame();
    const policy = new SimRankingBotPolicy(game, { horizon: 10 });
    expect(LEAD_DEFENCE_THRESHOLDS).toContain(policy.leadDefenceThreshold);

    // Fixed for the match: reading it again must not redraw.
    const first = policy.leadDefenceThreshold;
    policy.chooseBuy(view());
    expect(policy.leadDefenceThreshold).toBe(first);
  });

  it("varies across games", () => {
    const game = makeGame();
    const seen = new Set<number>();
    let seed = 1;
    for (let i = 0; i < 40; i++) {
      // A fresh stream per game, as production gets from Math.random.
      const rng = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
      seen.add(
        new SimRankingBotPolicy(game, { horizon: 10, rng }).leadDefenceThreshold,
      );
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Buy profiles (persona axis)
// ---------------------------------------------------------------------------
//
// A profile is only a personality if it changes what lands on the board.
// These check that each one is distinguishable from the others in the buy
// itself, not merely that the constants differ.

describe("planBudgetAwareBuy — buy profiles", () => {
  const withProfile = (name: string) => ({
    profile: BUY_PROFILES.find((p) => p.name === name)!,
    leadDefenceThreshold: Infinity,
  });
  const buy = (name: string, over: Partial<BotView> = {}) =>
    planBudgetAwareBuy(
      view({ ownBudget: 65, opponentCardCount: 5, ...over }),
      true,
      withProfile(name),
    );

  it("offers three named profiles including the measured defaults", () => {
    expect(BUY_PROFILES.map((p) => p.name)).toEqual([
      "aggressor",
      "balanced",
      "defender",
    ]);
    expect(BALANCED_PROFILE.name).toBe("balanced");
  });

  it("buys a higher offence fraction as aggressor than as defender", () => {
    expect(offenseFraction(buy("aggressor"))).toBeGreaterThan(
      offenseFraction(buy("defender")),
    );
  });

  it("puts the balanced profile between the other two", () => {
    const a = offenseFraction(buy("aggressor"));
    const b = offenseFraction(buy("balanced"));
    const d = offenseFraction(buy("defender"));
    expect(b).toBeLessThanOrEqual(a);
    expect(b).toBeGreaterThanOrEqual(d);
  });

  it("buys fewer, costlier cards as aggressor than as defender", () => {
    const cards = (name: string) =>
      buy(name).reduce((s, x) => s + x.count, 0);
    expect(cards("aggressor")).toBeLessThan(cards("defender"));
  });

  it("keeps every profile inside budget, slot and copy limits", () => {
    for (const p of BUY_PROFILES) {
      const bundles = buy(p.name);
      const spent = bundles.reduce(
        (s, b) => s + PATTERNS[b.patternIndex]!.cells.length * b.count,
        0,
      );
      expect(spent).toBeLessThanOrEqual(65);
      expect(bundles.reduce((s, x) => s + x.count, 0)).toBeLessThanOrEqual(
        CONFIG.MAX_SLOTS,
      );
      for (const b of bundles) {
        expect(b.count).toBeLessThanOrEqual(CONFIG.MAX_COPIES_PER_TYPE);
      }
    }
  });

  it("never leaves any profile without a spaceship", () => {
    // The offence floor is global, not a profile dial: a bot that scores
    // nothing cannot win, whatever its temperament.
    for (const p of BUY_PROFILES) {
      const offence = buy(p.name, { ownBudget: 18, opponentCardCount: 10 })
        .filter((x) => OFFENSE.has(x.patternIndex))
        .reduce((s, x) => s + x.count, 0);
      expect(offence).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("SimRankingBotPolicy — persona draw", () => {
  it("draws both axes and keeps them for the game", () => {
    const game = makeGame();
    const policy = new SimRankingBotPolicy(game, { horizon: 10 });

    expect(BUY_PROFILES).toContain(policy.persona.profile);
    expect(LEAD_DEFENCE_THRESHOLDS).toContain(policy.leadDefenceThreshold);

    const before = policy.persona;
    policy.chooseBuy(view());
    expect(policy.persona).toBe(before);
  });

  it("varies the profile across games", () => {
    const game = makeGame();
    const seen = new Set<string>();
    let seed = 7;
    for (let i = 0; i < 40; i++) {
      const rng = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
      seen.add(
        new SimRankingBotPolicy(game, { horizon: 10, rng }).persona.profile.name,
      );
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("draws the two axes independently", () => {
    // If they were pinned together, profile would determine threshold and the
    // observed pairs would number at most BUY_PROFILES.length.
    const game = makeGame();
    const pairs = new Set<string>();
    let seed = 11;
    for (let i = 0; i < 200; i++) {
      const rng = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
      const p = new SimRankingBotPolicy(game, { horizon: 10, rng }).persona;
      pairs.add(`${p.profile.name}/${p.leadDefenceThreshold}`);
    }
    expect(pairs.size).toBeGreaterThan(BUY_PROFILES.length);
  });
});
