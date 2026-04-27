// Tests for pattern transformations.

import { describe, it, expect } from "vitest";
import {
  mirrorPatternHorizontal,
  rotatePattern,
  getPatternForPlayer,
  getPlacementCol,
} from "../src/patternUtils.js";
import type { Pattern } from "../src/types.js";

const makePattern = (cells: [number, number][]): Pattern => ({
  name: "test",
  cells,
  previewGridSize: 8,
  previewGenerations: 4,
});

describe("patternUtils — mirrorPatternHorizontal", () => {
  it("mirrors columns around the maximum column", () => {
    // Pattern: . X .
    //          X . X
    // cells: (0,1), (1,0), (1,2)  → maxCol=2 → c becomes 2-c
    const p = makePattern([
      [0, 1],
      [1, 0],
      [1, 2],
    ]);
    const mirrored = mirrorPatternHorizontal(p);
    expect(new Set(mirrored.cells.map((c) => c.join(",")))).toEqual(
      new Set(["0,1", "1,2", "1,0"]),
    );
  });

  it("returns the same pattern when given an empty cell list", () => {
    const p = makePattern([]);
    const mirrored = mirrorPatternHorizontal(p);
    expect(mirrored.cells).toEqual([]);
  });

  it("preserves pattern metadata (name, previewGridSize, previewGenerations)", () => {
    const p = makePattern([
      [0, 0],
      [0, 1],
    ]);
    const mirrored = mirrorPatternHorizontal(p);
    expect(mirrored.name).toBe(p.name);
    expect(mirrored.previewGridSize).toBe(p.previewGridSize);
    expect(mirrored.previewGenerations).toBe(p.previewGenerations);
  });
});

describe("patternUtils — rotatePattern", () => {
  it("rotates a horizontal blinker 90° clockwise into a vertical line", () => {
    // Horizontal: (0,0), (0,1), (0,2) → maxRow=0
    // [r,c] → [c, 0 - r] = [c, 0]
    // → (0,0), (1,0), (2,0)  — vertical line in col 0
    const p = makePattern([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    const rotated = rotatePattern(p);
    expect(new Set(rotated.cells.map((c) => c.join(",")))).toEqual(
      new Set(["0,0", "1,0", "2,0"]),
    );
  });
});

describe("patternUtils — getPatternForPlayer", () => {
  it("returns the original pattern unchanged for player 1", () => {
    const p = makePattern([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
    const result = getPatternForPlayer(p, 1);
    expect(result).toBe(p); // identity
  });

  it("returns a horizontally mirrored pattern for player 2", () => {
    const p = makePattern([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    const result = getPatternForPlayer(p, 2);
    // mirror of col 0/1/2 with maxCol=2 → 2/1/0 (set, order independent)
    expect(new Set(result.cells.map((c) => c.join(",")))).toEqual(
      new Set(["0,0", "0,1", "0,2"]),
    );
    // But it must be a new object (not the same reference)
    expect(result).not.toBe(p);
  });
});

describe("patternUtils — getPlacementCol", () => {
  it("returns the cursor column unchanged for player 1", () => {
    const p = makePattern([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    expect(getPlacementCol(50, p, 1)).toBe(50);
  });

  it("offsets the cursor column for player 2 so the pattern is placed left of it", () => {
    // For P2: returns col - maxC. maxC = 2 → 50 - 2 = 48.
    const p = makePattern([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    expect(getPlacementCol(50, p, 2)).toBe(48);
  });
});
