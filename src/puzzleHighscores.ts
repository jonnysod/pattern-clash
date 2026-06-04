// Persistent puzzle highscores backed by localStorage.
//
// Key: "pattern-clash:puzzleBestScores:v1" (versioned so future schema changes
// can migrate cleanly).
//
// Schema:
//   { [puzzleId]: { bestScore: number, achievedAt: ISO-date } }
//
// "Solved" ⟺ an entry exists. No separate boolean field.

import { logWarn } from "./logger.js";

const STORAGE_KEY = "pattern-clash:puzzleBestScores:v1";

export interface ScoreEntry {
  bestScore: number;
  achievedAt: string; // ISO-8601 date
}

export type PuzzleBestScores = Record<string, ScoreEntry>;

// In-memory mirror; populated lazily on first access.
let _store: PuzzleBestScores | null = null;

function getStore(): PuzzleBestScores {
  if (_store === null) _store = loadFromStorage();
  return _store;
}

function loadFromStorage(): PuzzleBestScores {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as PuzzleBestScores;
  } catch {
    logWarn("[Highscores] Failed to load from localStorage — running in-memory only");
    return {};
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getStore()));
  } catch {
    // Load failure already warned; silent persist failure is acceptable.
  }
}

// Return the best score for a puzzle, or null if never solved.
export function getBestScore(puzzleId: string): number | null {
  const entry = getStore()[puzzleId];
  return entry !== undefined ? entry.bestScore : null;
}

// Return true if the puzzle has been solved at least once.
export function isSolved(puzzleId: string): boolean {
  return puzzleId in getStore();
}

// Record a successful run.
//
// lowerIsBetter=true  → used for maxOpponentScore puzzles (lower opponent score is better)
// lowerIsBetter=false → used for minOwnScore puzzles (higher own score is better)
//
// Returns "new-best" if this run improves (or sets) the stored record,
// "not-best" otherwise.
export function recordScore(
  puzzleId: string,
  score: number,
  lowerIsBetter: boolean,
): "new-best" | "not-best" {
  const store = getStore();
  const existing = store[puzzleId];
  const isNewBest =
    existing === undefined ||
    (lowerIsBetter ? score < existing.bestScore : score > existing.bestScore);

  if (isNewBest) {
    store[puzzleId] = { bestScore: score, achievedAt: new Date().toISOString() };
    persist();
    return "new-best";
  }
  return "not-best";
}
