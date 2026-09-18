// Ladder measurement — a design tool in the style of puzzle.verify.test.ts:
// it reports, it never fails. Use it to verify that each difficulty level
// actually beats the one below it, and by how much, before trusting the
// ladder's constants (botDifficulty.ts).
//
// Default run (part of the normal suite): one tiny smoke pairing, so the
// tool itself cannot rot unnoticed. Real measurements are opt-in via env:
//
//   LADDER_PAIRINGS="1v2,2v3,1v3" LADDER_GAMES=100 \
//     LADDER_LOG=ladder-results.txt \
//     npx vitest run tests/botLadder.verify.test.ts
//
// Costs: levels 1/2 decide in microseconds and level 3 peeks only 60
// generations, so those pairings run at simulation speed. Level 4 peeks the
// full ramp (3-4.5 s per decision on a full board) — budget roughly one to
// two minutes per game for anything "v4" and prefer the mean margin over
// the raw win rate there: it carries far more signal per game, which is
// what makes a 20-game run for the expensive pairing meaningful at all.
//
// Progress goes through LADDER_LOG line by line (appendFileSync, flushed
// per game): vitest buffers console output until the test ends, and a
// synchronous multi-hour loop cannot be interrupted by its timeout anyway
// (see the tooling learnings), so the log file is the only live view.

import { appendFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { formatSummary, runPairing } from "./botLadder.js";
import type { BotDifficultyLevel } from "../src/botDifficulty.js";
import type { PairingSummary } from "./botLadder.js";

function parsePairing(spec: string): [BotDifficultyLevel, BotDifficultyLevel] {
  const m = /^([1-4])v([1-4])$/.exec(spec.trim());
  if (!m) throw new Error(`bad pairing "${spec}" — expected e.g. "1v2"`);
  return [
    Number(m[1]) as BotDifficultyLevel,
    Number(m[2]) as BotDifficultyLevel,
  ];
}

const pairingsEnv = process.env["LADDER_PAIRINGS"];
const isMeasurement = pairingsEnv !== undefined;
const pairings = (pairingsEnv ?? "1v2").split(",").map(parsePairing);
const games = Number(
  process.env["LADDER_GAMES"] ?? (isMeasurement ? 50 : 2),
);
const logFile = process.env["LADDER_LOG"];
const baseSeed = Number(process.env["LADDER_SEED"] ?? 20260917);

function log(line: string): void {
  if (logFile) appendFileSync(logFile, line + "\n");
  // Also collected by vitest (shown when the test finishes).
  console.log(line);
}

describe("difficulty ladder measurement", () => {
  it(
    isMeasurement
      ? `measure ${pairings.map(([a, b]) => `${a}v${b}`).join(", ")} × ${games}`
      : "smoke: harness produces a pairing summary",
    { timeout: 7 * 24 * 3600 * 1000 },
    () => {
      const summaries: PairingSummary[] = [];
      for (const [a, b] of pairings) {
        const summary = runPairing(
          a,
          b,
          games,
          baseSeed,
          log,
          // The smoke run shortens games to keep the suite fast; any real
          // measurement plays the full six phases.
          isMeasurement ? undefined : { phases: 2 },
        );
        log(formatSummary(summary));
        summaries.push(summary);
      }
      // Design tool: results are read, not asserted.
      expect(summaries.length).toBeGreaterThan(0);
    },
  );
});
