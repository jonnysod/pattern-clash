// Correctness tests for the bot-vs-bot ladder harness (botLadder.ts).
//
// The harness rests on one geometric claim — the board is mirror-symmetric,
// so a bot playing "P2 on the mirrored board" is exactly a P1 player — and
// on the observation feeding being faithful to ui.ts. Both are asserted
// here, because a harness that is quietly wrong measures the wrong ladder.

import { describe, it, expect } from "vitest";
import {
  mirrorAnchorCol,
  mirrorEvent,
  mirrorGrid,
  patternWidth,
  runLadderGame,
} from "./botLadder.js";
import { makeGame, BLOCK_INDEX } from "./_helpers.js";
import { PATTERNS } from "../src/patterns.js";
import { getPatternForPlayer } from "../src/patternUtils.js";
import { BotController } from "../src/botController.js";
import { createBotPolicy } from "../src/botDifficulty.js";
import type { BotView } from "../src/botView.js";
import type { SyncManager } from "../src/syncManager.js";
import type { Game } from "../src/game.js";

describe("mirror geometry", () => {
  it("mirrorGrid and mirrorAnchorCol are involutions", () => {
    const game = makeGame();
    game.grid[3]![7] = true;
    game.grid[99]![95] = true;
    expect(mirrorGrid(mirrorGrid(game.grid))).toEqual(game.grid);

    for (let idx = 0; idx < PATTERNS.length; idx++) {
      const w = patternWidth(idx);
      for (const col of [0, 5, 40, 90]) {
        expect(mirrorAnchorCol(mirrorAnchorCol(col, w, 100), w, 100)).toBe(
          col,
        );
      }
    }
  });

  // Finding (2026-09-17): the board is NOT perfectly mirror-symmetric. The
  // left L-arms extend to scoreColumnTopLeft = leftEnd − goalZoneWidth
  // (col 30), whose mirror image is col 69 — but the right arms sit at
  // rightStart + goalZoneWidth (col 70). The right side leaves goalZoneWidth
  // columns of gap to the neutral zone as the zones.ts comment intends, the
  // left side leaves one less, so P2's target is one L-arm column larger
  // than P1's. 28 corner cells in total.
  //
  // The ladder harness tolerates this: real scoring uses the real zones
  // either way, only the mirrored side's *judgment* is off by those cells,
  // and runPairing alternates sides so any residual bias hits both levels
  // equally. This test pins the asymmetry exactly — if the off-by-one is
  // ever fixed in zones.ts, or anything else drifts, it fails and the pin
  // collapses back to strict symmetry.
  it("score cells mirror-swap scorer, except the known L-arm off-by-one", () => {
    const game = makeGame();
    const zones = game.zones;
    const mirrorCol = (c: number): number => game.cols - 1 - c;
    const suspectCols = new Set([
      zones.scoreColumnTopLeft,
      mirrorCol(zones.scoreColumnTopLeft),
      zones.scoreColumnTopRight,
      mirrorCol(zones.scoreColumnTopRight),
    ]);

    let mismatches = 0;
    for (let r = 0; r < game.rows; r++) {
      for (let c = 0; c < game.cols; c++) {
        const real = zones.isScoreCell(r, c);
        const mirrored = zones.isScoreCell(r, mirrorCol(c));
        const swapped =
          real.scorer === null ? null : real.scorer === 1 ? 2 : 1;
        if (real.scores === mirrored.scores && mirrored.scorer === (real.scores ? swapped : null))
          continue;
        mismatches++;
        // Every deviation must be the documented one: an L-arm corner cell.
        expect(suspectCols.has(c)).toBe(true);
        expect(
          r <= zones.scoreRowTop || r >= zones.scoreRowBottom,
        ).toBe(true);
      }
    }
    expect(mismatches).toBe(28);
  });

  it("placement validity is mirror-symmetric for every pattern", () => {
    const game = makeGame();
    const zones = game.zones;
    for (let idx = 0; idx < PATTERNS.length; idx++) {
      const base = PATTERNS[idx]!;
      const p1Pattern = getPatternForPlayer(base, 1);
      const p2Pattern = getPatternForPlayer(base, 2);
      const w = patternWidth(idx);
      for (let r = 0; r < game.rows; r += 7) {
        for (let c = 0; c < game.cols; c++) {
          expect(
            zones.isValidPatternPlacement(
              p2Pattern,
              r,
              mirrorAnchorCol(c, w, game.cols),
              2,
            ),
          ).toBe(zones.isValidPatternPlacement(p1Pattern, r, c, 1));
        }
      }
    }
  });

  it("a mirrored P2 placement stamps the mirror image of the P1 placement", () => {
    const idx = 0; // LWSS — asymmetric, so orientation errors would show
    const base = PATTERNS[idx]!;
    const w = patternWidth(idx);

    const real = makeGame();
    const row = 30;
    const col = real.zones.goalZoneLeftEnd + 2; // inside P1's zone
    expect(real.placePattern(row, col, getPatternForPlayer(base, 1), 1)).toBe(
      true,
    );

    const mirrored = makeGame();
    expect(
      mirrored.placePattern(
        row,
        mirrorAnchorCol(col, w, mirrored.cols),
        getPatternForPlayer(base, 2),
        2,
      ),
    ).toBe(true);

    expect(mirrorGrid(mirrored.grid)).toEqual(real.grid);
  });
});

describe("observation feeding for the mirrored side", () => {
  function makeMirroredController(game: ReturnType<typeof makeGame>): {
    controller: BotController;
    buildView: () => BotView;
  } {
    // Minimal inline mirror facade — only what buildView touches.
    const facade = {
      rows: game.rows,
      cols: game.cols,
      zones: game.zones,
      get grid() {
        return mirrorGrid(game.grid);
      },
      get currentPhaseNumber() {
        return game.currentPhaseNumber;
      },
      get scorePlayer1() {
        return game.scorePlayer2;
      },
      get scorePlayer2() {
        return game.scorePlayer1;
      },
      getBudget: (p: 1 | 2) => game.getBudget(p === 1 ? 2 : 1),
      getHand: (p: 1 | 2) => game.getHand(p === 1 ? 2 : 1),
    } as unknown as Game;
    const sync = {
      start() {},
      stop() {},
      sendAction() {},
      onRemoteAction: null,
    } as unknown as SyncManager;
    const controller = new BotController(
      facade,
      sync,
      createBotPolicy(2, facade),
    );
    return {
      controller,
      buildView: () =>
        (controller as unknown as { buildView(): BotView }).buildView(),
    };
  }

  it("real P2 scoring becomes a threat for the P1 side, own scoring does not", () => {
    const game = makeGame();
    const { controller, buildView } = makeMirroredController(game);
    controller.beginSimulationRecording();

    // Real P2 scored in row 20 — for the mirrored P1 side that is opponent
    // scoring and must land in observedScoreRows.
    controller.recordScoreEvents([
      mirrorEvent({ row: 20, col: 96, scorer: 2, points: 7 }, game.cols),
    ]);
    // Real P1 scored in row 10 — the P1 side's own points, never a threat.
    controller.recordScoreEvents([
      mirrorEvent({ row: 10, col: 3, scorer: 1, points: 5 }, game.cols),
    ]);

    expect(buildView().observedScoreRows).toEqual([20]);
  });

  it("the budget snapshot reads the real opponent through the facade", () => {
    const game = makeGame();
    const { controller, buildView } = makeMirroredController(game);
    // For the mirrored P1 side, "opponent" is real P2.
    controller.beginBuyPhase();
    expect(game.buyPattern(2, BLOCK_INDEX)).toBe(true);
    const spent = PATTERNS[BLOCK_INDEX]!.cells.length;
    expect(buildView().opponentSpentThisPhase).toBe(spent);
  });
});

describe("full ladder game", () => {
  // Shortened to two phases: this checks that the harness drives buy, place,
  // simulation, stability skip and phase advance to a finished game — ladder
  // *measurements* always run the full six phases (botLadder.verify.test.ts).
  it("plays a complete game to a result", { timeout: 60000 }, () => {
    const result = runLadderGame(1, 2, 42, { phases: 2 });
    expect([1, 2, null]).toContain(result.winner);
    expect(result.score1).toBeGreaterThanOrEqual(0);
    expect(result.score2).toBeGreaterThanOrEqual(0);
    // Both sides placed their bought cards (dummy bundle: 3 per phase).
    expect(result.decisionMs1.length).toBeGreaterThanOrEqual(6);
    expect(result.decisionMs2.length).toBeGreaterThanOrEqual(6);
    // Levels 1 and 2 carry no persona.
    expect(result.persona1).toBe("-");
    expect(result.persona2).toBe("-");
  });
});
