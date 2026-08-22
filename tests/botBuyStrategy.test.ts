// Tests for the budget-aware buy planner (Stufe 4).

import { describe, it, expect } from "vitest";
import { planBudgetAwareBuy } from "../src/botPolicy.js";
import type { BotView, BuyBundle } from "../src/botPolicy.js";
import { PATTERNS } from "../src/patterns.js";
import { CONFIG } from "../src/config.js";

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
  it("buys more offense when behind than when ahead", () => {
    const behind = planBudgetAwareBuy(view({ ownScore: 0, opponentScore: 8 }));
    const ahead = planBudgetAwareBuy(view({ ownScore: 8, opponentScore: 0 }));
    expect(offenseFraction(behind)).toBeGreaterThan(offenseFraction(ahead));
  });

  it("tilts defensive when ahead vs. a neutral state", () => {
    const neutral = planBudgetAwareBuy(view());
    const ahead = planBudgetAwareBuy(view({ ownScore: 8, opponentScore: 0 }));
    expect(offenseFraction(ahead)).toBeLessThan(offenseFraction(neutral));
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
