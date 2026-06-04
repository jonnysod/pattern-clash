// Targeted P5 verification: test with proper timeline timing and alternative designs.

import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { PATTERNS } from "../src/patterns.js";
import { mirrorPatternHorizontal } from "../src/patternUtils.js";
import { describe, it, expect } from "vitest";

const ROWS = 30;
const COLS = 50;
const EZ = 3;
const zonesL = new Zones(COLS, ROWS, { endzoneWidth: EZ, lShapes: "both" });

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

const gliderDown = PATTERNS[8]!;
const gliderUp = PATTERNS[9]!;
const gliderMirrored = mirrorPatternHorizontal(gliderDown); // moves left+down (SW)
const gliderUpMirrored = mirrorPatternHorizontal(gliderUp); // moves left+up (NW)
const mwss = PATTERNS[1]!;
const mwssMirrored = mirrorPatternHorizontal(mwss);
const block = PATTERNS[2]!;

describe("P5 targeted — proper timeline (sim 20, place, sim 80)", () => {
  it("mirrored GliderDown (5,35) with block placed at gen 20", () => {
    console.log("\n=== P5: Glider(5,35) + Block placed at gen 20 ===");
    const candidates: [number, number][] = [];
    for (let r = 15; r <= 28; r++) {
      for (let c = 3; c <= 16; c++) {
        candidates.push([r, c]);
      }
    }
    const stopped: [number, number][] = [];
    for (const [br, bc] of candidates) {
      const eng = new Engine(ROWS, COLS, zonesL, 9999);
      eng.stampCells(5, 35, gliderMirrored.cells);
      runScore(eng, 20); // simulate 20 gens first
      eng.stampCells(br, bc, block.cells);
      const { p2 } = runScore(eng, 80);
      if (p2 === 0) stopped.push([br, bc]);
    }
    console.log(`  Stopped positions (P2=0): ${stopped.length}`);
    if (stopped.length > 0) {
      for (const [r, c] of stopped.slice(0, 10)) console.log(`  ✅ Block at (${r}, ${c})`);
    } else {
      console.log("  No block positions stop the glider.");
    }
    expect(true).toBe(true);
  });

  it("mirrored GliderUp (25,35) with block placed at gen 20", () => {
    console.log("\n=== P5: GliderUp mirrored (25,35) + Block at gen 20 ===");
    // Mirrored GliderUp moves left+up (NW)
    const stopped: [number, number][] = [];
    for (let br = 0; br <= 20; br++) {
      for (let bc = 3; bc <= 16; bc++) {
        const eng = new Engine(ROWS, COLS, zonesL, 9999);
        eng.stampCells(25, 35, gliderUpMirrored.cells);
        runScore(eng, 20);
        eng.stampCells(br, bc, block.cells);
        const { p2 } = runScore(eng, 80);
        if (p2 === 0) stopped.push([br, bc]);
      }
    }
    console.log(`  Stopped positions: ${stopped.length}`);
    for (const [r, c] of stopped.slice(0, 10)) console.log(`  ✅ Block at (${r}, ${c})`);
    expect(true).toBe(true);
  });

  it("mirrored MWSS in P2 zone with L-zone scoring, check if block can stop", () => {
    console.log("\n=== P5 alt: MWSS mirrored toward L-zone ===");
    // First check if MWSS scores in L-zones
    for (const [r, c] of [[12, 38], [3, 38], [24, 38]] as [number, number][]) {
      const eng = new Engine(ROWS, COLS, zonesL, 9999);
      eng.stampCells(r, c, mwssMirrored.cells);
      const { p2 } = runScore(eng, 100);
      console.log(`  MWSS mirrored at (${r}, ${c}): P2 scored ${p2}`);
    }
    expect(true).toBe(true);
  });

  it("MWSS mirrored at (3, 38) with block placed at gen 20", () => {
    console.log("\n=== P5 alt: MWSS(3,38) block at gen 20 ===");
    const stopped: [number, number][] = [];
    for (let br = 0; br <= 10; br++) {
      for (let bc = 3; bc <= 16; bc++) {
        const eng = new Engine(ROWS, COLS, zonesL, 9999);
        eng.stampCells(3, 38, mwssMirrored.cells);
        runScore(eng, 20);
        eng.stampCells(br, bc, block.cells);
        const { p2 } = runScore(eng, 80);
        if (p2 === 0) stopped.push([br, bc]);
      }
    }
    console.log(`  Stopped positions: ${stopped.length}`);
    for (const [r, c] of stopped.slice(0, 10)) console.log(`  ✅ Block at (${r}, ${c})`);
    expect(true).toBe(true);
  });

  it("try more glider start positions that score and can be stopped", () => {
    console.log("\n=== P5: sweep glider start positions ===");
    for (const [sr, sc] of [
      [5, 33], [5, 30], [3, 35], [3, 33], [3, 30],
      [2, 35], [2, 33], [1, 35], [0, 35], [0, 33],
    ] as [number, number][]) {
      const engBase = new Engine(ROWS, COLS, zonesL, 9999);
      engBase.stampCells(sr, sc, gliderMirrored.cells);
      const { p2: p2base } = runScore(engBase, 100);

      // Check if any block can stop it
      let bestBlock: [number, number] | null = null;
      for (let br = 0; br <= 29 && !bestBlock; br++) {
        for (let bc = 3; bc <= 16 && !bestBlock; bc++) {
          const eng = new Engine(ROWS, COLS, zonesL, 9999);
          eng.stampCells(sr, sc, gliderMirrored.cells);
          runScore(eng, 20);
          eng.stampCells(br, bc, block.cells);
          const { p2 } = runScore(eng, 80);
          if (p2 === 0) bestBlock = [br, bc];
        }
      }
      const blockStr = bestBlock ? `✅ Block at (${bestBlock[0]}, ${bestBlock[1]})` : "❌ no block stops it";
      console.log(`  Glider(${sr},${sc}) base P2=${p2base}: ${blockStr}`);
    }
    expect(true).toBe(true);
  });

  it("try mirrored GliderUp (NW) with various starts", () => {
    console.log("\n=== P5: mirrored GliderUp (NW) start sweep ===");
    for (const [sr, sc] of [
      [25, 33], [25, 30], [27, 35], [27, 33], [27, 30],
      [28, 35], [29, 35], [24, 33], [26, 33],
    ] as [number, number][]) {
      const engBase = new Engine(ROWS, COLS, zonesL, 9999);
      engBase.stampCells(sr, sc, gliderUpMirrored.cells);
      const { p2: p2base } = runScore(engBase, 100);

      let bestBlock: [number, number] | null = null;
      for (let br = 0; br <= 29 && !bestBlock; br++) {
        for (let bc = 3; bc <= 16 && !bestBlock; bc++) {
          const eng = new Engine(ROWS, COLS, zonesL, 9999);
          eng.stampCells(sr, sc, gliderUpMirrored.cells);
          runScore(eng, 20);
          eng.stampCells(br, bc, block.cells);
          const { p2 } = runScore(eng, 80);
          if (p2 === 0) bestBlock = [br, bc];
        }
      }
      const blockStr = bestBlock ? `✅ Block at (${bestBlock[0]}, ${bestBlock[1]})` : "❌ no block stops it";
      console.log(`  GliderUpMirr(${sr},${sc}) base P2=${p2base}: ${blockStr}`);
    }
    expect(true).toBe(true);
  });
});
