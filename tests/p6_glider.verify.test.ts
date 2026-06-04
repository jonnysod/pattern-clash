import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { PATTERNS } from "../src/patterns.js";
import { describe, it, expect } from "vitest";

const ROWS = 30, COLS = 50, EZ = 3;
const zonesL = new Zones(COLS, ROWS, { endzoneWidth: EZ, lShapes: "both" });

function score(cells: [number,number][], sr: number, sc: number, gens: number): number {
  const eng = new Engine(ROWS, COLS, zonesL, 9999);
  eng.stampCells(sr, sc, cells);
  let p1 = 0;
  for (let i = 0; i < gens; i++) for (const e of eng.computeNextGeneration()) if (e.scorer === 1) p1 += e.points;
  return p1;
}

describe("P6 glider scoring from P1 zone (L-zones)", () => {
  it("GliderDown scoring positions (L-zones, 120 gens)", () => {
    console.log("\n=== P6: GliderDown scoring positions ===");
    const gDown = PATTERNS[8]!.cells;
    let any = false;
    for (let r = 0; r <= 10; r++) for (let c = 8; c <= 16; c++) {
      const s = score(gDown, r, c, 120);
      if (s > 0) { console.log(`  GliderDown at (${r}, ${c}): P1=${s}`); any = true; }
    }
    if (!any) console.log("  No scoring positions found");
    expect(true).toBe(true);
  });

  it("GliderUp scoring positions (L-zones, 120 gens)", () => {
    console.log("\n=== P6: GliderUp scoring positions ===");
    const gUp = PATTERNS[9]!.cells;
    let any = false;
    for (let r = 15; r <= 29; r++) for (let c = 8; c <= 16; c++) {
      const s = score(gUp, r, c, 120);
      if (s > 0) { console.log(`  GliderUp at (${r}, ${c}): P1=${s}`); any = true; }
    }
    if (!any) console.log("  No scoring positions found");
    expect(true).toBe(true);
  });

  it("LWSS scoring in L-zones (confirm row-dependent score)", () => {
    console.log("\n=== P6: LWSS scoring rows in L-zones ===");
    const lwss = PATTERNS[0]!.cells;
    for (let r = 0; r <= 29; r++) {
      const s = score(lwss, r, 5, 120);
      if (s > 0) console.log(`  LWSS at (${r}, 5): P1=${s}`);
    }
    expect(true).toBe(true);
  });
});
