import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  LEADERBOARD_BOARDS,
  PLAYER_NAME_PATTERN,
  botBoardId,
  isBetter,
  isValidPlayerName,
  puzzleBoard,
  puzzleBoardScore,
} from "../src/leaderboardBoards.js";
import { PUZZLES } from "../src/puzzles.js";

// The deployed rules are the only server-side check. Read the patterns out
// of the actual rules file so client and rules can't drift apart.
const rules = JSON.parse(readFileSync("security-rules.json", "utf8")).rules;

function rulePattern(expr: string): RegExp {
  const m = expr.match(/matches\(\/(.+?)\/\)/);
  if (!m) throw new Error(`no regex in ${expr}`);
  return new RegExp(m[1]!);
}

const scoreBoardPattern = rulePattern(rules.leaderboards.$board[".read"]);
const solvedPattern = rulePattern(rules.puzzleSolved.$puzzle[".read"]);
const namePattern = rulePattern(rules.leaderboards.$board.$uid.name[".validate"]);

describe("leaderboard boards", () => {
  it("has one board per bot level and per puzzle, with unique ids", () => {
    expect(LEADERBOARD_BOARDS.filter((b) => b.group === "bot")).toHaveLength(4);
    expect(LEADERBOARD_BOARDS.filter((b) => b.group === "puzzle")).toHaveLength(PUZZLES.length);
    const ids = LEADERBOARD_BOARDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every board id is accepted by the deployed rules", () => {
    for (const board of LEADERBOARD_BOARDS) {
      const pattern = board.kind === "solved" ? solvedPattern : scoreBoardPattern;
      expect(pattern.test(board.id), board.id).toBe(true);
    }
  });

  it("the client name check is the rules' name check", () => {
    expect(PLAYER_NAME_PATTERN.source).toBe(namePattern.source);
  });

  it("accepts sensible names and rejects the rest", () => {
    for (const ok of ["Jonny", "Glider-4821", "Müller_99", "abc", "a b c"]) {
      expect(isValidPlayerName(ok), ok).toBe(true);
    }
    for (const bad of ["", "ab", "x".repeat(17), "<script>", "a.b", "émile"]) {
      expect(isValidPlayerName(bad), bad).toBe(false);
    }
  });

  it("bot boards rank by highest score difference", () => {
    const board = LEADERBOARD_BOARDS.find((b) => b.id === botBoardId(3))!;
    expect(board.higherIsBetter).toBe(true);
    expect(isBetter(board, 120, -40)).toBe(true);
  });

  it("puzzle boards follow the puzzle's criterion", () => {
    for (const puzzle of PUZZLES) {
      const board = puzzleBoard(puzzle);
      const { maxOpponentScore, minOwnScore } = puzzle.criteria;
      if (maxOpponentScore === 0) {
        // Pass/fail: nothing to rank, only counted.
        expect(board.kind).toBe("solved");
      } else if (maxOpponentScore !== undefined) {
        // Limiting the opponent: fewer conceded points is better.
        expect(board.kind).toBe("score");
        expect(board.higherIsBetter).toBe(false);
        expect(puzzleBoardScore(puzzle, 7, 42)).toBe(42);
      } else if (minOwnScore !== undefined) {
        expect(board.kind).toBe("score");
        expect(board.higherIsBetter).toBe(true);
        expect(puzzleBoardScore(puzzle, 7, 42)).toBe(7);
      }
    }
  });
});
