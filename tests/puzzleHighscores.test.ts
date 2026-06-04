// Unit tests for the puzzle highscore module.
//
// Covers: update rules (better/worse/equal runs; both metric directions),
// isSolved, getBestScore, and the "binary puzzle first-solve" edge case.

import { describe, it, expect, beforeEach, vi } from "vitest";

// The module uses localStorage internally. We provide a minimal mock so that
// the tests run in a Node environment.
const mockStorage: Record<string, string> = {};

vi.stubGlobal("localStorage", {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, value: string) => { mockStorage[key] = value; },
  removeItem: (key: string) => { delete mockStorage[key]; },
});

// Import after stubbing so the module's lazy init sees the mock.
// We reset the in-memory store between tests by clearing the mock storage and
// reimporting (vitest module isolation handles this).
import {
  getBestScore,
  isSolved,
  recordScore,
} from "../src/puzzleHighscores.js";

const KEY = "pattern-clash:puzzleBestScores:v1";

beforeEach(() => {
  // Clear storage and in-memory cache before each test.
  delete mockStorage[KEY];
  // Force lazy re-init by clearing the module's internal cache via the
  // localStorage mock (the module re-reads on first access after cache clear).
  // Since we can't directly reset the module state, we rely on the mock returning
  // null which loads an empty store.
});

describe("isSolved", () => {
  it("returns false before any solve", () => {
    expect(isSolved("never-seen")).toBe(false);
  });

  it("returns true after a solve", () => {
    recordScore("p-test-solved", 5, true);
    expect(isSolved("p-test-solved")).toBe(true);
  });
});

describe("getBestScore", () => {
  it("returns null before any solve", () => {
    expect(getBestScore("p-no-entry")).toBe(null);
  });

  it("returns the stored score after a solve", () => {
    recordScore("p-get-test", 10, false);
    expect(getBestScore("p-get-test")).toBe(10);
  });
});

describe("recordScore — lowerIsBetter (maxOpponentScore puzzles)", () => {
  it("first solve creates entry and returns new-best", () => {
    const id = "hs-lower-first";
    expect(recordScore(id, 30, true)).toBe("new-best");
    expect(getBestScore(id)).toBe(30);
  });

  it("strictly lower score overwrites and returns new-best", () => {
    const id = "hs-lower-improve";
    recordScore(id, 50, true);
    expect(recordScore(id, 30, true)).toBe("new-best");
    expect(getBestScore(id)).toBe(30);
  });

  it("equal score does not overwrite and returns not-best", () => {
    const id = "hs-lower-equal";
    recordScore(id, 20, true);
    expect(recordScore(id, 20, true)).toBe("not-best");
    expect(getBestScore(id)).toBe(20);
  });

  it("worse (higher) score does not overwrite and returns not-best", () => {
    const id = "hs-lower-worse";
    recordScore(id, 20, true);
    expect(recordScore(id, 40, true)).toBe("not-best");
    expect(getBestScore(id)).toBe(20);
  });
});

describe("recordScore — higherIsBetter (minOwnScore puzzles)", () => {
  it("first solve creates entry and returns new-best", () => {
    const id = "hs-higher-first";
    expect(recordScore(id, 16, false)).toBe("new-best");
    expect(getBestScore(id)).toBe(16);
  });

  it("strictly higher score overwrites and returns new-best", () => {
    const id = "hs-higher-improve";
    recordScore(id, 16, false);
    expect(recordScore(id, 32, false)).toBe("new-best");
    expect(getBestScore(id)).toBe(32);
  });

  it("equal score does not overwrite and returns not-best", () => {
    const id = "hs-higher-equal";
    recordScore(id, 16, false);
    expect(recordScore(id, 16, false)).toBe("not-best");
    expect(getBestScore(id)).toBe(16);
  });

  it("worse (lower) score does not overwrite and returns not-best", () => {
    const id = "hs-higher-worse";
    recordScore(id, 32, false);
    expect(recordScore(id, 16, false)).toBe("not-best");
    expect(getBestScore(id)).toBe(32);
  });
});

describe("binary puzzle edge case (threshold 0)", () => {
  it("first solve with score 0 returns new-best", () => {
    const id = "hs-binary";
    expect(recordScore(id, 0, true)).toBe("new-best");
    expect(getBestScore(id)).toBe(0);
  });

  it("retry with score 0 returns not-best (correct: New best! cannot fire again)", () => {
    const id = "hs-binary-retry";
    recordScore(id, 0, true); // first solve
    expect(recordScore(id, 0, true)).toBe("not-best");
  });
});

describe("localStorage persistence", () => {
  it("persisted entries survive (simulated reload via raw storage)", () => {
    const id = "hs-persist";
    recordScore(id, 42, false);
    // Read the stored JSON directly
    const stored = JSON.parse(mockStorage[KEY]!);
    expect(stored[id]).toBeDefined();
    expect(stored[id].bestScore).toBe(42);
    expect(stored[id].achievedAt).toBeDefined();
  });
});
