// Zones.isValidPatternPlacement — vertical (row) bounds.
//
// The whole pattern must fit on the grid; a partially off-grid placement
// would be silently clipped by stampCells(). Edge-row placements (e.g. the
// score-zone L-arms) stay valid as long as no cell falls outside the field.

import { describe, it, expect } from "vitest";
import { getPatternForPlayer } from "../src/patternUtils.js";
import { PATTERNS } from "../src/patterns.js";
import { makeGame } from "./_helpers.js";

describe("Zones.isValidPatternPlacement — vertical bounds", () => {
  const game = makeGame();
  const zones = game.zones;
  const rows = game.rows; // 100

  // Mirrored MWSS for P2: row offsets span 0..4 (5 rows tall).
  const mwss = getPatternForPlayer(PATTERNS[1]!, 2);

  // Find a column that is legal for this pattern at a central row.
  let col = -1;
  for (let c = 0; c < game.cols; c++) {
    if (zones.isValidPatternPlacement(mwss, 50, c, 2)) {
      col = c;
      break;
    }
  }

  it("has a legal reference column", () => {
    expect(col).toBeGreaterThanOrEqual(0);
  });

  it("accepts a placement fully inside the grid", () => {
    expect(zones.isValidPatternPlacement(mwss, 50, col, 2)).toBe(true);
  });

  it("accepts an on-grid top-edge placement (L-arm allowed)", () => {
    // startRow 0 → bottom cell at row 4, still on the grid.
    expect(zones.isValidPatternPlacement(mwss, 0, col, 2)).toBe(true);
  });

  it("accepts a bottom-edge placement that just fits", () => {
    // startRow 95 → bottom cell at row 99 = last row.
    expect(zones.isValidPatternPlacement(mwss, rows - 5, col, 2)).toBe(true);
  });

  it("rejects a placement that overflows the bottom edge", () => {
    // startRow 96 → bottom cell at row 100, off-grid.
    expect(zones.isValidPatternPlacement(mwss, rows - 4, col, 2)).toBe(false);
  });

  it("rejects a placement that overflows the top edge", () => {
    expect(zones.isValidPatternPlacement(mwss, -1, col, 2)).toBe(false);
  });

  it("still enforces column/zone bounds (regression)", () => {
    // Column 0 is in P1's goal zone, never legal for P2 regardless of row.
    expect(zones.isValidPatternPlacement(mwss, 50, 0, 2)).toBe(false);
  });
});
