// P8 redesign verification: understand Conway barrier physics, find workable design.

import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { PATTERNS } from "../src/patterns.js";
import { describe, it, expect } from "vitest";

const ROWS = 36, COLS = 60;
const zones = new Zones(COLS, ROWS, { endzoneWidth: 3, lShapes: "none" });

function run(stamps: { r: number; c: number; cells: [number,number][] }[], gens: number): number {
  const eng = new Engine(ROWS, COLS, zones, 9999);
  for (const s of stamps) eng.stampCells(s.r, s.c, s.cells);
  let p1 = 0;
  for (let i = 0; i < gens; i++)
    for (const e of eng.computeNextGeneration()) if (e.scorer === 1) p1 += e.points;
  for (const e of eng.forceFlushBuckets()) if (e.scorer === 1) p1 += e.points;
  return p1;
}

const mwss = PATTERNS[1]!.cells;
const lwss = PATTERNS[0]!.cells;
const blinker = PATTERNS[5]!.cells;
const block = PATTERNS[2]!.cells;

const blinkerRow = 7;
const blockRow = 28;
const barrierCols = [25, 31, 37];
const blinkers = barrierCols.map(c => ({ r: blinkerRow, c, cells: blinker }));
const blocks = barrierCols.map(c => ({ r: blockRow, c, cells: block }));
const allBarriers = [...blinkers, ...blocks];

describe("P8 redesign — understand mechanics + find workable 3-card design", () => {
  it("diagnose the 165 score", () => {
    console.log("\n=== Diagnose 3-card 165 score ===");
    // solo mid-row scores
    for (const c of [3, 10, 14, 18]) {
      const s = run([{ r: 10, c, cells: mwss }, ...allBarriers], 140);
      console.log(`  solo MWSS(10,${c}) + barriers: P1=${s}`);
    }
    // two clearers + mid scorer (col 3)
    const s3 = run([{ r: 5, c: 3, cells: mwss }, { r: 28, c: 3, cells: mwss }, { r: 10, c: 3, cells: mwss }, ...allBarriers], 140);
    console.log(`  Clear(5,3)+Clear(28,3)+Score(10,3): P1=${s3}`);
    // no barriers baseline
    const nobar = run([{ r: 5, c: 3, cells: mwss }, { r: 28, c: 3, cells: mwss }, { r: 10, c: 3, cells: mwss }], 140);
    console.log(`  Same 3 MWSS no barriers: P1=${nobar}`);
    expect(true).toBe(true);
  });

  it("does a 2nd MWSS follow through after 1st clears blinker (many col offsets)?", () => {
    console.log("\n=== Does blinker clearing EVER let follower through? (120 gens) ===");
    for (const fc of [20, 25, 30, 35, 38, 40]) {
      const s = run([{ r: 5, c: 3, cells: mwss }, { r: 5, c: fc, cells: mwss }, ...blinkers], 160);
      const solo = run([{ r: 5, c: fc, cells: mwss }, ...blinkers], 160);
      if (s > solo) console.log(`  ✅ Leader(5,3)+Follower(5,${fc}): P1=${s} vs solo=${solo}`);
      else console.log(`  ❌ Leader(5,3)+Follower(5,${fc}): P1=${s} vs solo=${solo}`);
    }
    expect(true).toBe(true);
  });

  it("does LWSS clear blinker for MWSS on adjacent row?", () => {
    console.log("\n=== LWSS(row 5) + MWSS(row 8) -- different rows, blinker barrier ===");
    for (const [r1, r2] of [[5,8],[5,9],[5,10],[6,9],[4,8]]) {
      const s = run([{ r: r1, c: 5, cells: lwss }, { r: r2, c: 5, cells: mwss }, ...blinkers], 160);
      console.log(`  LWSS(${r1},5)+MWSS(${r2},5) + blinkers: P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("ALTERNATIVE: one free lane (middle), two blocked — does any 3-card combo score >30?", () => {
    console.log("\n=== Alt design: only upper blinker + lower block barrier, free middle ===");
    // Strategy A: 3x MWSS all through middle (row 13-20)
    const a = run([
      { r: 13, c: 5, cells: mwss }, { r: 17, c: 5, cells: mwss }, { r: 20, c: 5, cells: mwss },
      ...allBarriers,
    ], 140);
    console.log(`  A: 3×MWSS middle rows (13,17,20): P1=${a}`);
    // Strategy B: 2x middle MWSS + 1 blocked = 2 score
    const b = run([
      { r: 13, c: 5, cells: mwss }, { r: 17, c: 5, cells: mwss },
      { r: 5, c: 5, cells: mwss }, // blocked upper
      ...allBarriers,
    ], 140);
    console.log(`  B: 2×MWSS(13,17) + 1 blocked(5): P1=${b}`);
    // Strategy C: 1 MWSS middle + 2 LWSS middle
    const c = run([
      { r: 13, c: 5, cells: mwss }, { r: 16, c: 5, cells: lwss }, { r: 19, c: 5, cells: lwss },
      ...allBarriers,
    ], 140);
    console.log(`  C: MWSS(13)+LWSS(16,19): P1=${c}`);
    // Baseline: nothing scores (1-card wrong)
    const d = run([{ r: 5, c: 5, cells: mwss }, ...allBarriers], 140);
    const e = run([{ r: 28, c: 5, cells: mwss }, ...allBarriers], 140);
    console.log(`  Wrong 1-card: blocked MWSS upper=${d}, blocked MWSS lower=${e}`);
    expect(true).toBe(true);
  });

  it("ALTERNATIVE: stagger barriers to cover ALL rows — what does that look like?", () => {
    console.log("\n=== Full-coverage barriers: upper blinker + middle block + lower blinker ===");
    const midBlock = [24, 30, 36].map(c => ({ r: 18, c, cells: block }));
    const allFull = [...blinkers, ...midBlock, ...blocks];
    for (const r of [5, 12, 18, 24, 28]) {
      const s = run([{ r, c: 5, cells: mwss }, ...allFull], 140);
      console.log(`  MWSS(${r},5) + full barriers: P1=${s}`);
    }
    // Does any single card score?
    const allBlocked = [5,8,12,15,18,22,25,28].every(r =>
      run([{ r, c: 5, cells: mwss }, ...allFull], 140) === 0
    );
    console.log(`  All rows blocked by full barriers: ${allBlocked}`);
    expect(true).toBe(true);
  });

  it("ALTERNATIVE: 3 MWSS in 3 different rows with full barriers — does any get through?", () => {
    console.log("\n=== 3 cards vs full barriers ===");
    const midBlock = [24, 30, 36].map(c => ({ r: 18, c, cells: block }));
    const allFull = [...blinkers, ...midBlock, ...blocks];
    // 3 MWSS in different rows — some might create inter-row debris that opens paths
    for (const [r1, r2, r3] of [[5,18,28],[8,18,25],[5,12,28]] as [number,number,number][]) {
      const s = run([
        { r: r1, c: 5, cells: mwss }, { r: r2, c: 5, cells: mwss }, { r: r3, c: 5, cells: mwss },
        ...allFull,
      ], 140);
      console.log(`  3×MWSS(${r1},${r2},${r3}): P1=${s}`);
    }
    expect(true).toBe(true);
  });
});
