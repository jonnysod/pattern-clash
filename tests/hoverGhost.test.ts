import { describe, it, expect } from "vitest";
import { ghostRun } from "../src/hoverGhost.js";
import { PATTERNS } from "../src/patterns.js";
import { getPatternForPlayer } from "../src/patternUtils.js";

const ROWS = 100;
const COLS = 100;

function indexOf(name: string): number {
  const idx = PATTERNS.findIndex((p) => p.name === name);
  if (idx < 0) throw new Error(`no pattern ${name}`);
  return idx;
}

const meanCol = (cells: [number, number][]): number =>
  cells.reduce((sum, [, c]) => sum + c, 0) / cells.length;

describe("ghostRun", () => {
  it("starts with the pattern as placed, in absolute cells", () => {
    const idx = indexOf("MWSS");
    const frames = ghostRun(idx, 1, 40, 20, ROWS, COLS, 150);
    const placed = getPatternForPlayer(PATTERNS[idx]!, 1).cells.map(
      ([r, c]) => [40 + r, 20 + c],
    );
    expect([...frames[0]!].sort()).toEqual([...placed].sort());
  });

  it("flies a ship towards the opponent at c/2, mirrored for P2", () => {
    const p1 = ghostRun(indexOf("LWSS"), 1, 50, 20, ROWS, COLS, 150);
    const p2 = ghostRun(indexOf("LWSS"), 2, 50, 75, ROWS, COLS, 150);
    expect(meanCol(p1[32]!) - meanCol(p1[0]!)).toBeCloseTo(16, 0);
    expect(meanCol(p2[32]!) - meanCol(p2[0]!)).toBeCloseTo(-16, 0);
  });

  it("crashes a ship into the wall and plays out the debris instead of vanishing", () => {
    // From col 60 an LWSS reaches the right edge after ~70 generations. What
    // the crash leaves is real physics (here it even sends a glider back),
    // so only assert that something survives the impact.
    const frames = ghostRun(indexOf("LWSS"), 1, 50, 60, ROWS, COLS, 250);
    const impact = frames.findIndex((f) => f.some(([, c]) => c === COLS - 1));
    expect(impact).toBeGreaterThan(0);
    expect(frames.length).toBeGreaterThan(impact + 20);
    expect(frames[frames.length - 1]!.length).toBeGreaterThan(0);
  });

  it("never runs longer than the phase", () => {
    const frames = ghostRun(indexOf("MWSS"), 1, 40, 20, ROWS, COLS, 150);
    expect(frames.length).toBeLessThanOrEqual(151);
  });

  it("stops early once the board settles", () => {
    // A block is a still life — nothing to play out.
    expect(ghostRun(indexOf("Block"), 1, 40, 20, ROWS, COLS, 250).length).toBeLessThan(5);
    // A glider flying into the top edge dies or freezes long before 250.
    const glider = ghostRun(indexOf("Glider up"), 1, 10, 20, ROWS, COLS, 250);
    expect(glider.length).toBeLessThan(120);
  });
});
