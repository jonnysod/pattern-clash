// Global leaderboard definitions — which boards exist and how they rank.
// Pure data, no Firebase: the I/O lives in leaderboard.ts.
//
// Board ids and the player-name format must match security-rules.json
// (`leaderboards/$board`, `puzzleSolved/$puzzle`, `name`). A test reads the
// patterns out of the rules file, so the two can't drift apart.

import { BOT_DIFFICULTIES } from "./botDifficulty.js";
import type { BotDifficultyLevel } from "./botDifficulty.js";
import { PUZZLES } from "./puzzles.js";
import type { PuzzleDefinition } from "./types.js";

// "score": ranked entries. "solved": a pass/fail puzzle (target 0) — there
// is nothing to rank, so the board only counts who solved it.
export type BoardKind = "score" | "solved";

export interface LeaderboardBoard {
  id: string;
  title: string;
  group: "bot" | "puzzle";
  kind: BoardKind;
  higherIsBetter: boolean;
}

export function botBoardId(level: BotDifficultyLevel): string {
  return `bot-${level}`;
}

// Score difference (own − bot), so beating the bot by more ranks higher.
const BOT_BOARDS: LeaderboardBoard[] = BOT_DIFFICULTIES.map((d) => ({
  id: botBoardId(d.level),
  title: `vs Bot · ${d.name}`,
  group: "bot",
  kind: "score",
  higherIsBetter: true,
}));

export function puzzleBoard(puzzle: PuzzleDefinition): LeaderboardBoard {
  const { maxOpponentScore, minOwnScore } = puzzle.criteria;
  const solvedOnly = maxOpponentScore === 0 && minOwnScore === undefined;
  return {
    id: solvedOnly ? puzzle.id : `puzzle-${puzzle.id}`,
    title: puzzle.title,
    group: "puzzle",
    kind: solvedOnly ? "solved" : "score",
    // Limiting the opponent ranks by fewest points conceded; everything
    // else by most points scored.
    higherIsBetter: maxOpponentScore === undefined,
  };
}

export const LEADERBOARD_BOARDS: readonly LeaderboardBoard[] = [
  ...BOT_BOARDS,
  ...PUZZLES.map(puzzleBoard),
];

// The value a solved puzzle run enters on its board.
export function puzzleBoardScore(
  puzzle: PuzzleDefinition,
  ownScore: number,
  opponentScore: number,
): number {
  return puzzle.criteria.maxOpponentScore !== undefined ? opponentScore : ownScore;
}

export function isBetter(board: LeaderboardBoard, a: number, b: number): boolean {
  return board.higherIsBetter ? a > b : a < b;
}

// Same character set and length as the `name` rule. Umlauts are allowed
// for German players; anything else is rejected client-side before the
// rules would reject it server-side.
export const PLAYER_NAME_PATTERN = /^[A-Za-z0-9ÄÖÜäöüß _-]{3,16}$/;

export function isValidPlayerName(name: string): boolean {
  return PLAYER_NAME_PATTERN.test(name);
}
