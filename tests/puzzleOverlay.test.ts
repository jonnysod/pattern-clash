// Unit tests for the result overlay text selection (buildResultDisplay).
//
// Tests every combination: failed/solved × maxOpponentScore/minOwnScore × binary/non-binary,
// including "New best!" and "Best: B" variants.

import { describe, it, expect } from "vitest";
import { buildResultDisplay } from "../src/puzzleRunner.js";
import type { PuzzleCriteria } from "../src/types.js";

// Stateless mock helpers injected into buildResultDisplay.
// `prevBest` controls what getBestScore would return (null = never solved).
// `recordResult` controls what recordScore would return.
function helpers(
  prevBest: number | null,
  recordResult: "new-best" | "not-best",
) {
  return {
    prevBestFn: (_id: string) => prevBest,
    recordFn: (_id: string, _score: number, _lower: boolean) => recordResult,
  };
}

// --- maxOpponentScore criteria ---

describe("maxOpponentScore — failed", () => {
  const criteria: PuzzleCriteria = { maxOpponentScore: 50 };

  it("shows opponent score and limit", () => {
    const { prevBestFn, recordFn } = helpers(null, "new-best");
    const d = buildResultDisplay("p", criteria, 0, 70, prevBestFn, recordFn);
    expect(d.success).toBe(false);
    expect(d.title).toBe("Failed");
    expect(d.scoreText).toBe("Opponent scored 70 (limit ≤ 50)");
  });
});

describe("maxOpponentScore — solved, non-binary, first run (new best)", () => {
  const criteria: PuzzleCriteria = { maxOpponentScore: 50 };

  it("shows New best!", () => {
    const { prevBestFn, recordFn } = helpers(null, "new-best");
    const d = buildResultDisplay("p", criteria, 0, 30, prevBestFn, recordFn);
    expect(d.success).toBe(true);
    expect(d.title).toBe("Solved!");
    expect(d.scoreText).toContain("30");
    expect(d.scoreText).toContain("New best!");
  });
});

describe("maxOpponentScore — solved, non-binary, improved run (new best)", () => {
  const criteria: PuzzleCriteria = { maxOpponentScore: 50 };

  it("shows New best! when strictly better", () => {
    const { prevBestFn, recordFn } = helpers(40, "new-best");
    const d = buildResultDisplay("p", criteria, 0, 20, prevBestFn, recordFn);
    expect(d.success).toBe(true);
    expect(d.scoreText).toContain("New best!");
  });
});

describe("maxOpponentScore — solved, non-binary, not best", () => {
  const criteria: PuzzleCriteria = { maxOpponentScore: 50 };

  it("shows Best: B with previous best", () => {
    const { prevBestFn, recordFn } = helpers(20, "not-best");
    const d = buildResultDisplay("p", criteria, 0, 35, prevBestFn, recordFn);
    expect(d.success).toBe(true);
    expect(d.scoreText).toContain("35");
    expect(d.scoreText).toContain("Best: 20");
    expect(d.scoreText).not.toContain("New best!");
  });
});

describe("maxOpponentScore — binary (threshold 0), solved", () => {
  const criteria: PuzzleCriteria = { maxOpponentScore: 0 };

  it("no score line on success", () => {
    const { prevBestFn, recordFn } = helpers(null, "new-best");
    const d = buildResultDisplay("p", criteria, 0, 0, prevBestFn, recordFn);
    expect(d.success).toBe(true);
    expect(d.title).toBe("Solved!");
    expect(d.scoreText).toBe("");
  });
});

describe("maxOpponentScore — binary (threshold 0), failed", () => {
  const criteria: PuzzleCriteria = { maxOpponentScore: 0 };

  it("shows opponent score on failure", () => {
    const { prevBestFn, recordFn } = helpers(null, "new-best");
    const d = buildResultDisplay("p", criteria, 0, 47, prevBestFn, recordFn);
    expect(d.success).toBe(false);
    expect(d.scoreText).toContain("47");
  });
});

// --- minOwnScore criteria ---

describe("minOwnScore — failed", () => {
  const criteria: PuzzleCriteria = { minOwnScore: 25 };

  it("shows own score and target", () => {
    const { prevBestFn, recordFn } = helpers(null, "new-best");
    const d = buildResultDisplay("p", criteria, 16, 0, prevBestFn, recordFn);
    expect(d.success).toBe(false);
    expect(d.title).toBe("Failed");
    expect(d.scoreText).toBe("You scored 16 (needed ≥ 25)");
  });
});

describe("minOwnScore — solved, first run (new best)", () => {
  const criteria: PuzzleCriteria = { minOwnScore: 25 };

  it("shows New best!", () => {
    const { prevBestFn, recordFn } = helpers(null, "new-best");
    const d = buildResultDisplay("p", criteria, 32, 0, prevBestFn, recordFn);
    expect(d.success).toBe(true);
    expect(d.title).toBe("Solved!");
    expect(d.scoreText).toContain("32");
    expect(d.scoreText).toContain("New best!");
  });
});

describe("minOwnScore — solved, not best", () => {
  const criteria: PuzzleCriteria = { minOwnScore: 25 };

  it("shows Best: B", () => {
    const { prevBestFn, recordFn } = helpers(48, "not-best");
    const d = buildResultDisplay("p", criteria, 32, 0, prevBestFn, recordFn);
    expect(d.success).toBe(true);
    expect(d.scoreText).toContain("32");
    expect(d.scoreText).toContain("Best: 48");
  });
});

describe("minOwnScore — solved, improved (new best)", () => {
  const criteria: PuzzleCriteria = { minOwnScore: 25 };

  it("shows New best! when strictly better", () => {
    const { prevBestFn, recordFn } = helpers(32, "new-best");
    const d = buildResultDisplay("p", criteria, 48, 0, prevBestFn, recordFn);
    expect(d.success).toBe(true);
    expect(d.scoreText).toContain("New best!");
  });
});
