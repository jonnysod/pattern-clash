// Bot difficulty ladder — maps the player-facing strength level to a policy.
//
// The ladder reuses the existing policy classes as its lower rungs rather
// than inventing new ones: DummyBotPolicy and RuleBasedBotPolicy were kept
// as reference baselines all along, and they are exactly the beginner
// opponents a ladder needs. Only level 3 is new configuration — the full
// sim-ranking policy, deliberately degraded on two axes that are cheap to
// compute and read as human-like weaknesses rather than as noise.
//
// Personas (buy temperament + lead-defence threshold) only exist on levels
// 3 and 4, because only SimRankingBotPolicy draws them. That is intended:
// the lower levels are practice targets, not characters.

import type { Game } from "./game.js";
import type { BotPolicy } from "./botPolicy.js";
import {
  DummyBotPolicy,
  RuleBasedBotPolicy,
  SimRankingBotPolicy,
} from "./botPolicy.js";

export type BotDifficultyLevel = 1 | 2 | 3 | 4;

// Level 3's peek horizon, deliberately below the ~126 generations an
// orthogonal spaceship needs to cross from P2's zone front to the score
// column: this bot literally cannot see a travelling ship pay off, so its
// offence falls back to the heuristic tie-break tiers — short-sighted, not
// random. For the full-strength bot a short horizon is the documented
// cardinal sin (it re-blinds the spaceship ranking); as a *handicap* it is
// the point — and since peek cost is ~linear in the horizon, it also makes
// level 3 several times cheaper per decision than level 4.
const ADVANCED_HORIZON = 60;

// Probability of playing from the second- or third-best tie group instead of
// the best one (see SimRankingBotPolicy.choosePlacement). Roughly one move
// in three is a lapse; the other two are the real ranking's choice.
const ADVANCED_EPSILON = 0.35;

export interface BotDifficulty {
  readonly level: BotDifficultyLevel;
  readonly name: string;
  // SimRanking degradation dials; both undefined means full strength.
  readonly horizon?: number;
  readonly epsilon?: number;
}

export const BOT_DIFFICULTIES: readonly BotDifficulty[] = [
  { level: 1, name: "Random" },
  { level: 2, name: "Casual" },
  {
    level: 3,
    name: "Advanced",
    horizon: ADVANCED_HORIZON,
    epsilon: ADVANCED_EPSILON,
  },
  { level: 4, name: "Full Strength" },
];

// Production passes Math.random for real entropy; tests omit `rng` so the
// policies fall back to their deterministic default seed.
export function createBotPolicy(
  level: BotDifficultyLevel,
  game: Game,
  rng?: () => number,
): BotPolicy {
  const rngOption = rng ? { rng } : {};
  switch (level) {
    case 1:
      return new DummyBotPolicy(game);
    case 2:
      return new RuleBasedBotPolicy(game);
    case 3:
      return new SimRankingBotPolicy(game, {
        horizon: ADVANCED_HORIZON,
        epsilon: ADVANCED_EPSILON,
        ...rngOption,
      });
    case 4:
      return new SimRankingBotPolicy(game, rngOption);
  }
}
