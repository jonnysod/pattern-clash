// Headless unit tests for P7 (Score Through the L) and P8 (Chain Reaction).
// Pattern: nothing → fails criterion; intended solution → passes criterion.

import { describe, it, expect } from "vitest";
import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { PATTERNS } from "../src/patterns.js";
import { PUZZLES, PUZZLE_ZONE_CONFIG, PUZZLE_ZONE_CONFIG_L } from "../src/puzzles.js";

function runEngine(
  rows: number, cols: number, zones: Zones,
  stamps: { r: number; c: number; cells: [number,number][] }[],
  gens: number,
): { p1: number; p2: number } {
  const eng = new Engine(rows, cols, zones, 9999);
  for (const s of stamps) eng.stampCells(s.r, s.c, s.cells);
  let p1 = 0, p2 = 0;
  for (let i = 0; i < gens; i++)
    for (const e of eng.computeNextGeneration())
      e.scorer === 1 ? (p1 += e.points) : (p2 += e.points);
  for (const e of eng.forceFlushBuckets())
    e.scorer === 1 ? (p1 += e.points) : (p2 += e.points);
  return { p1, p2 };
}

// ---------------------------------------------------------------------------
// P7 — Score Through the L
// ---------------------------------------------------------------------------

describe("P7 — Score Through the L", () => {
  const puzzle = PUZZLES.find(p => p.id === "score-through-the-l")!;
  const zones = new Zones(puzzle.gridCols, puzzle.gridRows, PUZZLE_ZONE_CONFIG_L);
  const simGens = puzzle.timeline.filter(e => e.kind === "simulate")
    .reduce((s, e) => s + (e.kind === "simulate" ? e.generations : 0), 0);

  it("puzzle is present and has correct structure", () => {
    expect(puzzle).toBeDefined();
    expect(puzzle.gridRows).toBe(30);
    expect(puzzle.gridCols).toBe(50);
    expect(puzzle.criteria.minOwnScore).toBe(70);
    expect(puzzle.zoneConfig).toBe("l-shapes");
  });

  it("nothing placed: P1 = 0 (criterion fails)", () => {
    const stamps = puzzle.initialPlacements.map(ip => ({
      r: ip.row, c: ip.col,
      cells: ip.mirror
        ? (() => { const mx = Math.max(...PATTERNS[ip.patternIndex]!.cells.map(([,c]) => c)); return PATTERNS[ip.patternIndex]!.cells.map(([r,c]) => [r, mx-c] as [number,number]); })()
        : PATTERNS[ip.patternIndex]!.cells,
    }));
    const { p1 } = runEngine(puzzle.gridRows, puzzle.gridCols, zones, stamps, simGens);
    expect(p1).toBe(0);
  });

  it("MWSS at row 24 (optimal L-sweep): P1 >= 70 (criterion passes)", () => {
    const mwss = PATTERNS[1]!.cells;
    const { p1 } = runEngine(puzzle.gridRows, puzzle.gridCols, zones,
      [{ r: 24, c: 5, cells: mwss }], simGens);
    expect(p1).toBeGreaterThanOrEqual(70);
  });

  it("MWSS at row 22 (bottom L-arm, boundary): P1 = 70 (criterion passes)", () => {
    const mwss = PATTERNS[1]!.cells;
    const { p1 } = runEngine(puzzle.gridRows, puzzle.gridCols, zones,
      [{ r: 22, c: 5, cells: mwss }], simGens);
    expect(p1).toBeGreaterThanOrEqual(70);
  });

  it("MWSS standard row (13): P1 = 43 — criterion fails (< 70)", () => {
    const mwss = PATTERNS[1]!.cells;
    const { p1 } = runEngine(puzzle.gridRows, puzzle.gridCols, zones,
      [{ r: 13, c: 5, cells: mwss }], simGens);
    expect(p1).toBeLessThan(70);
  });

  it("Blinker (decoy): P1 = 0 (criterion fails)", () => {
    const blinker = PATTERNS[5]!.cells;
    const { p1 } = runEngine(puzzle.gridRows, puzzle.gridCols, zones,
      [{ r: 13, c: 10, cells: blinker }], simGens);
    expect(p1).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P8 — Chain Reaction
// ---------------------------------------------------------------------------

describe("P8 — Chain Reaction", () => {
  const puzzle = PUZZLES.find(p => p.id === "chain-reaction")!;
  const zones = new Zones(puzzle.gridCols, puzzle.gridRows, PUZZLE_ZONE_CONFIG);
  const SIM_GENS = 160;

  const barrierStamps = puzzle.initialPlacements.map(ip => ({
    r: ip.row, c: ip.col,
    cells: PATTERNS[ip.patternIndex]!.cells,
  }));

  it("puzzle is present and has correct structure", () => {
    expect(puzzle).toBeDefined();
    expect(puzzle.gridRows).toBe(36);
    expect(puzzle.gridCols).toBe(60);
    expect(puzzle.criteria.minOwnScore).toBe(150);
    expect(puzzle.initialPlacements).toHaveLength(3); // 3 Blinker in P2 zone
    expect(puzzle.placementRegion!.w).toBe(18);
  });

  it("nothing placed: P1 = 0 (criterion fails)", () => {
    const { p1 } = runEngine(puzzle.gridRows, puzzle.gridCols, zones, barrierStamps, SIM_GENS);
    expect(p1).toBe(0);
  });

  it("solo MWSS row 7 (best single): P1 = 149, just below threshold", () => {
    const mwss = PATTERNS[1]!.cells;
    const { p1 } = runEngine(puzzle.gridRows, puzzle.gridCols, zones,
      [...barrierStamps, { r: 7, c: 5, cells: mwss }], SIM_GENS);
    expect(p1).toBe(149);
    expect(p1).toBeLessThan(150);
  });

  it("MWSS(7,5) + MWSS(19,5): criterion passes (>= 150)", () => {
    const mwss = PATTERNS[1]!.cells;
    const { p1 } = runEngine(puzzle.gridRows, puzzle.gridCols, zones, [
      ...barrierStamps,
      { r: 7,  c: 5, cells: mwss },
      { r: 19, c: 5, cells: mwss },
    ], SIM_GENS);
    expect(p1).toBeGreaterThanOrEqual(150);
  });

  it("Blinker decoy alone: P1 = 0", () => {
    const blinker = PATTERNS[5]!.cells;
    const { p1 } = runEngine(puzzle.gridRows, puzzle.gridCols, zones,
      [...barrierStamps, { r: 13, c: 10, cells: blinker }], SIM_GENS);
    expect(p1).toBe(0);
  });
});
