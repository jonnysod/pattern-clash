// Verification tests for P3–P6 puzzle designs.
// Run with: npx vitest run tests/p3456.verify.test.ts
//
// Design tool — never fails CI (only asserts results.length > 0).
// Read the console output to calibrate thresholds in puzzles.ts.

import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { PATTERNS } from "../src/patterns.js";
import { mirrorPatternHorizontal } from "../src/patternUtils.js";
import { describe, it, expect } from "vitest";

const ROWS = 30;
const COLS = 50;
const EZ = 3; // endzone width

const zonesNoL = new Zones(COLS, ROWS, { endzoneWidth: EZ, lShapes: "none" });
const zonesL = new Zones(COLS, ROWS, { endzoneWidth: EZ, lShapes: "both" });

function freshEngine(rows = ROWS, cols = COLS, zones = zonesNoL): Engine {
  return new Engine(rows, cols, zones, 9999);
}

function runScore(eng: Engine, gens: number): { p1: number; p2: number } {
  let p1 = 0, p2 = 0;
  for (let i = 0; i < gens; i++) {
    for (const e of eng.computeNextGeneration()) {
      if (e.scorer === 1) p1 += e.points;
      else p2 += e.points;
    }
  }
  return { p1, p2 };
}

// Print zone layout for reference
describe("Zone layout", () => {
  it("no-L zones (P3/P4/P5 placement info)", () => {
    const z = zonesNoL;
    console.log(`\nNo-L zones (50×30, ez=3):`);
    console.log(`  P1 zone: cols ${z.endzoneLeftEnd}–${z.leftEnd - 1}`);
    console.log(`  neutral: cols ${z.leftEnd}–${z.rightStart - 1}`);
    console.log(`  P2 zone: cols ${z.rightStart}–${z.endzoneRightStart - 1}`);
    console.log(`  scoreColumnRight=${z.scoreColumnRight} (P1 scores)`);
    console.log(`  scoreColumnLeft=${z.scoreColumnLeft} (P2 scores)`);
    expect(true).toBe(true);
  });

  it("L zones (P5/P6)", () => {
    const z = zonesL;
    console.log(`\nL zones (50×30, ez=3):`);
    console.log(`  P1 zone: cols ${z.endzoneLeftEnd}–${z.leftEnd - 1}`);
    console.log(`  scoreColumnRight=${z.scoreColumnRight}`);
    console.log(`  scoreColumnTopRight=${z.scoreColumnTopRight} (top L vertical)`);
    console.log(`  scoreColumnBottomRight=${z.scoreColumnBottomRight} (bottom L vertical)`);
    console.log(`  scoreRowTop=${z.scoreRowTop} (top L horizontal row)`);
    console.log(`  scoreRowBottom=${z.scoreRowBottom} (bottom L horizontal row)`);
    console.log(`  endzoneTopRows=${z.endzoneTopRows}, endzoneBottomStartRow=${z.endzoneBottomStartRow}`);
    console.log(`  P2 scoring: scoreColumnLeft=${z.scoreColumnLeft}`);
    console.log(`  scoreColumnTopLeft=${z.scoreColumnTopLeft} (P2 top L vertical)`);
    console.log(`  scoreColumnBottomLeft=${z.scoreColumnBottomLeft} (P2 bottom L vertical)`);
    expect(true).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// P3 — "Send a Spaceship"
// Pool: LWSS(0), GliderDown(8), GliderUp(9), Blinker(5)
// maxCards: 1, empty board, place then simulate 100 gens
// Lesson: LWSS moves straight right → scores. Gliders/Blinker don't.
// ──────────────────────────────────────────────────────────────────────────────
describe("P3 verification — LWSS vs gliders", () => {
  const lwss = PATTERNS[0]!;
  const gliderDown = PATTERNS[8]!;
  const gliderUp = PATTERNS[9]!;

  it("LWSS scores from mid P1 zone in 100 gens", () => {
    console.log("\n=== P3: LWSS from P1 zone ===");
    for (const startCol of [3, 8, 14, 16]) {
      for (const startRow of [13, 14]) {
        const eng = freshEngine();
        eng.stampCells(startRow, startCol, lwss.cells);
        const { p1 } = runScore(eng, 100);
        console.log(`  LWSS at (${startRow}, ${startCol}): P1 scored ${p1}`);
      }
    }
    expect(true).toBe(true);
  });

  it("GliderDown does NOT score from P1 zone in 100 gens", () => {
    console.log("\n=== P3: GliderDown from P1 zone ===");
    for (const [r, c] of [[3, 5], [3, 14], [10, 5], [10, 14], [0, 5], [0, 14]] as [number, number][]) {
      const eng = freshEngine();
      eng.stampCells(r, c, gliderDown.cells);
      const { p1 } = runScore(eng, 100);
      console.log(`  GliderDown at (${r}, ${c}): P1 scored ${p1}`);
    }
    expect(true).toBe(true);
  });

  it("GliderUp does NOT score from P1 zone in 100 gens", () => {
    console.log("\n=== P3: GliderUp from P1 zone ===");
    for (const [r, c] of [[25, 5], [25, 14], [15, 5], [15, 14]] as [number, number][]) {
      const eng = freshEngine();
      eng.stampCells(r, c, gliderUp.cells);
      const { p1 } = runScore(eng, 100);
      console.log(`  GliderUp at (${r}, ${c}): P1 scored ${p1}`);
    }
    expect(true).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// P4 — "Launch the Fleet"
// Pool: LWSS(0), MWSS(1), GliderDown(8), GliderUp(9), Block(2), Blinker(5)
// maxCards: 3, simulate 100 gens
// Threshold: N such that 1 spaceship alone can't satisfy it, 2-3 correct can.
// ──────────────────────────────────────────────────────────────────────────────
describe("P4 verification — multi-card scoring", () => {
  const lwss = PATTERNS[0]!;
  const mwss = PATTERNS[1]!;

  it("1 LWSS score from various P1 positions", () => {
    console.log("\n=== P4: Single LWSS scores ===");
    for (const [r, c] of [[5, 5], [10, 5], [13, 5], [18, 5]] as [number, number][]) {
      const eng = freshEngine();
      eng.stampCells(r, c, lwss.cells);
      const { p1 } = runScore(eng, 100);
      console.log(`  1× LWSS at (${r}, ${c}): P1=${p1}`);
    }
    expect(true).toBe(true);
  });

  it("1 MWSS score from various P1 positions", () => {
    console.log("\n=== P4: Single MWSS scores ===");
    for (const [r, c] of [[5, 5], [10, 5], [13, 5]] as [number, number][]) {
      const eng = freshEngine();
      eng.stampCells(r, c, mwss.cells);
      const { p1 } = runScore(eng, 100);
      console.log(`  1× MWSS at (${r}, ${c}): P1=${p1}`);
    }
    expect(true).toBe(true);
  });

  it("2 LWSSes from P1 zone (separated rows)", () => {
    console.log("\n=== P4: 2× LWSS scores ===");
    for (const [r1, r2] of [[5, 10], [5, 15], [8, 16], [10, 20]] as [number, number][]) {
      const eng = freshEngine();
      eng.stampCells(r1, 5, lwss.cells);
      eng.stampCells(r2, 5, lwss.cells);
      const { p1 } = runScore(eng, 100);
      console.log(`  2× LWSS at rows ${r1}+${r2}, col 5: P1=${p1}`);
    }
    expect(true).toBe(true);
  });

  it("3 LWSSes from P1 zone", () => {
    console.log("\n=== P4: 3× LWSS scores ===");
    const eng = freshEngine();
    eng.stampCells(5, 5, lwss.cells);
    eng.stampCells(12, 5, lwss.cells);
    eng.stampCells(20, 5, lwss.cells);
    const { p1 } = runScore(eng, 100);
    console.log(`  3× LWSS at rows 5,12,20, col 5: P1=${p1}`);
    expect(true).toBe(true);
  });

  it("1 MWSS + 1 LWSS", () => {
    console.log("\n=== P4: MWSS + LWSS ===");
    const eng = freshEngine();
    eng.stampCells(5, 5, mwss.cells);
    eng.stampCells(20, 5, lwss.cells);
    const { p1 } = runScore(eng, 100);
    console.log(`  1× MWSS + 1× LWSS: P1=${p1}`);
    expect(true).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// P5 — "Stop the Glider" (L-Form)
// Mirrored GliderDown in P2 zone flying left+down toward P1's L score zone.
// Player places Block in P1 zone to intercept.
// ──────────────────────────────────────────────────────────────────────────────
describe("P5 verification — glider approaching L zone", () => {
  const gliderDown = PATTERNS[8]!;
  const gliderMirrored = mirrorPatternHorizontal(gliderDown);
  const block = PATTERNS[2]!;

  it("glider path info (mirrored GliderDown)", () => {
    console.log("\nMirrored GliderDown cells:", JSON.stringify(gliderMirrored.cells));
    expect(true).toBe(true);
  });

  it("glider scores without intervention (L-zones)", () => {
    console.log("\n=== P5: Mirrored GliderDown without block ===");
    const candidates = [
      [5, 35], [5, 33], [5, 40], [3, 35], [8, 35], [3, 40], [5, 30],
    ] as [number, number][];
    for (const [r, c] of candidates) {
      const eng = new Engine(ROWS, COLS, zonesL, 9999);
      eng.stampCells(r, c, gliderMirrored.cells);
      const { p2 } = runScore(eng, 120);
      console.log(`  GliderMirrored at (${r}, ${c}): P2 scored ${p2}`);
    }
    expect(true).toBe(true);
  });

  it("finds first gen P2 scores for candidate glider positions", () => {
    console.log("\n=== P5: First scoring gen ===");
    for (const [r, c] of [[5, 35], [5, 40], [3, 35]] as [number, number][]) {
      const eng = new Engine(ROWS, COLS, zonesL, 9999);
      eng.stampCells(r, c, gliderMirrored.cells);
      let p2 = 0;
      let firstGen = -1;
      for (let i = 0; i < 150; i++) {
        for (const e of eng.computeNextGeneration()) {
          if (e.scorer === 2 && p2 === 0) firstGen = i + 1;
          if (e.scorer === 2) p2 += e.points;
        }
      }
      console.log(`  Glider at (${r}, ${c}): first P2 score at gen ${firstGen}, total=${p2}`);
    }
    expect(true).toBe(true);
  });

  it("Block in P1 zone stops the glider", () => {
    console.log("\n=== P5: Block stops glider (various positions) ===");
    const gliderStart: [number, number] = [5, 35];
    // Block candidates in P1 zone (cols 3-16) along expected glider path
    const candidates: [number, number][] = [
      [15, 13], [16, 12], [17, 11], [18, 10], [19, 9], [20, 8],
      [21, 7], [22, 6], [23, 5], [24, 4], [25, 3],
      [15, 14], [16, 13], [17, 12], [18, 11], [19, 10], [20, 9],
      [21, 8], [22, 7], [23, 6], [24, 5], [25, 4],
    ];
    for (const [br, bc] of candidates) {
      const eng = new Engine(ROWS, COLS, zonesL, 9999);
      eng.stampCells(gliderStart[0], gliderStart[1], gliderMirrored.cells);
      eng.stampCells(br, bc, block.cells);
      const { p2 } = runScore(eng, 120);
      const stops = p2 === 0;
      if (stops) console.log(`  ✅ Block at (${br}, ${bc}): P2=0 (STOPPED)`);
      else console.log(`  ❌ Block at (${br}, ${bc}): P2=${p2}`);
    }
    expect(true).toBe(true);
  });

  it("also test mirrored GliderUp as alternative enemy pattern", () => {
    console.log("\n=== P5 alt: Mirrored GliderUp (moves left+up) ===");
    const gliderUp = PATTERNS[9]!;
    const gliderUpMirrored = mirrorPatternHorizontal(gliderUp);
    console.log("Mirrored GliderUp cells:", JSON.stringify(gliderUpMirrored.cells));
    for (const [r, c] of [[25, 35], [20, 35], [25, 40]] as [number, number][]) {
      const eng = new Engine(ROWS, COLS, zonesL, 9999);
      eng.stampCells(r, c, gliderUpMirrored.cells);
      const { p2 } = runScore(eng, 120);
      console.log(`  Mirrored GliderUp at (${r}, ${c}): P2=${p2}`);
    }
    expect(true).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// P6 — "Hit the L" (offense, L-form)
// P1 places 1 card, simulates 120 gens, scores ≥1 via L zone.
// LWSS moves right, should score via the right L or main column.
// ──────────────────────────────────────────────────────────────────────────────
describe("P6 verification — scoring with L zones", () => {
  const lwss = PATTERNS[0]!;
  const mwss = PATTERNS[1]!;
  const gliderDown = PATTERNS[8]!;

  it("LWSS scores in L-zone config in 120 gens", () => {
    console.log("\n=== P6: LWSS in L-zones ===");
    for (const [r, c] of [[0, 5], [2, 5], [13, 5], [27, 5]] as [number, number][]) {
      const eng = new Engine(ROWS, COLS, zonesL, 9999);
      eng.stampCells(r, c, lwss.cells);
      const { p1 } = runScore(eng, 120);
      console.log(`  LWSS at (${r}, ${c}): P1 scored ${p1}`);
    }
    expect(true).toBe(true);
  });

  it("MWSS scores in L-zone config in 120 gens", () => {
    console.log("\n=== P6: MWSS in L-zones ===");
    for (const [r, c] of [[0, 5], [5, 5], [13, 5], [25, 5]] as [number, number][]) {
      const eng = new Engine(ROWS, COLS, zonesL, 9999);
      eng.stampCells(r, c, mwss.cells);
      const { p1 } = runScore(eng, 120);
      console.log(`  MWSS at (${r}, ${c}): P1 scored ${p1}`);
    }
    expect(true).toBe(true);
  });

  it("GliderDown does NOT score in 120 gens (L-zones)", () => {
    console.log("\n=== P6: GliderDown from P1 zone (L-zones) ===");
    for (const [r, c] of [[0, 5], [3, 14], [10, 8]] as [number, number][]) {
      const eng = new Engine(ROWS, COLS, zonesL, 9999);
      eng.stampCells(r, c, gliderDown.cells);
      const { p1 } = runScore(eng, 120);
      console.log(`  GliderDown at (${r}, ${c}): P1 scored ${p1}`);
    }
    expect(true).toBe(true);
  });
});
