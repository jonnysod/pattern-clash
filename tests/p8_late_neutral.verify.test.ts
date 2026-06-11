// Blocks in später Neutralzone (col 30–38) – direkt vor P2-Zone-Grenze.

import { Engine } from "../src/engine.js";
import { Zones } from "../src/zones.js";
import { PATTERNS } from "../src/patterns.js";
import { describe, it, expect } from "vitest";

const ROWS = 36, COLS = 60;
const zones = new Zones(COLS, ROWS, { endzoneWidth: 3, lShapes: "none" });

function p1(stamps: { r: number; c: number; cells: [number,number][] }[], gens: number): number {
  const eng = new Engine(ROWS, COLS, zones, 9999);
  for (const s of stamps) eng.stampCells(s.r, s.c, s.cells);
  let total = 0;
  for (let i = 0; i < gens; i++)
    for (const e of eng.computeNextGeneration()) if (e.scorer === 1) total += e.points;
  for (const e of eng.forceFlushBuckets()) if (e.scorer === 1) total += e.points;
  return total;
}

const mwss  = PATTERNS[1]!.cells;
const lwss  = PATTERNS[0]!.cells;
const block = PATTERNS[2]!.cells;
const gliderDown = PATTERNS[8]!.cells;

// Finde die letzte Spalte in der Neutralzone, bei der freie Zeilen noch sauber punkte
describe("P8 – maximale Block-Spalte für saubere freie Zeilen", () => {
  it("Sweep: Block-Spalte 24–38, je 4 Blocks, freie Zeilen in Mitte", () => {
    console.log("\n=== Block-Spalten-Sweep: MWSS freie Zeile 10 ===");
    for (const col of [24, 26, 28, 30, 32, 34, 36, 37, 38]) {
      // 4 Blocks spread: Zeilen 2, 11, 20, 29 (9er-Abstand, MWSS-Höhe 5 → Lücken 5–9, 14–18, 23–27)
      const obs = [2, 11, 20, 29].map(r => ({ r, c: col, cells: block }));
      const freeScore = p1([{ r: 6, c: 5, cells: mwss }, ...obs], 140);
      const blockedScore = p1([{ r: 2, c: 5, cells: mwss }, ...obs], 140);
      console.log(`  Col ${col}: freie Zeile 6 → P1=${freeScore}, geblockte Zeile 2 → P1=${blockedScore}`);
    }
    expect(true).toBe(true);
  });

  it("Beste Spalte: alle freien Zeilen prüfen", () => {
    // Aus dem Sweep-Ergebnis wählen wir die beste Spalte
    // Erst mal col 30 (Anfang ruhige Neutralzone) und col 34 testen
    console.log("\n=== Col 30 – alle Zeilen mit 4 Blocks (2,11,20,29) ===");
    const obs30 = [2, 11, 20, 29].map(r => ({ r, c: 30, cells: block }));
    for (let r = 0; r < 36; r++) {
      const s = p1([{ r, c: 5, cells: mwss }, ...obs30], 140);
      if (s > 0) console.log(`  Zeile ${String(r).padStart(2)}: P1=${s}`);
    }

    console.log("\n=== Col 34 – alle Zeilen mit 4 Blocks (2,11,20,29) ===");
    const obs34 = [2, 11, 20, 29].map(r => ({ r, c: 34, cells: block }));
    for (let r = 0; r < 36; r++) {
      const s = p1([{ r, c: 5, cells: mwss }, ...obs34], 140);
      if (s > 0) console.log(`  Zeile ${String(r).padStart(2)}: P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("3×MWSS in freien Zeilen (beste Spalte)", () => {
    console.log("\n=== 3×MWSS Kombinationen – col 30, Blocks 2/11/20/29 ===");
    const obs = [2, 11, 20, 29].map(r => ({ r, c: 30, cells: block }));
    // Lücken sollten sein: 6–8, 15–17, 24–26
    for (const [r1,r2,r3] of [
      [6,15,24],[6,16,25],[7,15,24],[7,16,25],[6,15,25],[7,15,25],
    ] as [number,number,number][]) {
      const s = p1([
        { r: r1, c: 5, cells: mwss },
        { r: r2, c: 5, cells: mwss },
        { r: r3, c: 5, cells: mwss },
        ...obs,
      ], 140);
      console.log(`  3×MWSS(${r1},${r2},${r3}): P1=${s}`);
    }
    expect(true).toBe(true);
  });

  it("GliderDown aus P1-Zone löscht Block (col 30) – P1-Zone col 3–20", () => {
    console.log("\n=== GliderDown räumt Block bei col 30 ===");
    // Block bei (2, 30): GliderDown-Formel c = 30-2+r = 28+r → zu weit
    // Block bei (11, 30): c = 30-11+r = 19+r → r=0: c=19 ✓, r=1: c=20 ✓
    // Block bei (20, 30): c = 30-20+r = 10+r → r=0..10 ✓
    console.log("  Block(11,30): GliderDown(0,19) und (1,20)?");
    for (const [gr, gc] of [[0,19],[1,20],[0,18],[1,19]] as [number,number][]) {
      const cleared = p1([
        { r: gr, c: gc, cells: gliderDown },
        { r: 8, c: 5, cells: mwss },  // MWSS die durch Lücke nach block(11) fahren würde
        { r: 11, c: 30, cells: block },
      ], 140);
      const blocked = p1([
        { r: 8, c: 5, cells: mwss },
        { r: 11, c: 30, cells: block },
      ], 140);
      console.log(`  GliderDown(${gr},${gc})+MWSS(8,5)+Block(11,30): ${blocked}→${cleared} ${cleared > blocked ? "✅" : "❌"}`);
    }
    console.log("  Block(20,30): GliderDown(r, 10+r)?");
    for (const r of [0,1,2,5,10]) {
      const gc = 10 + r;
      if (gc > 20) continue;
      const cleared = p1([
        { r, c: gc, cells: gliderDown },
        { r: 17, c: 5, cells: mwss },
        { r: 20, c: 30, cells: block },
      ], 140);
      const blocked = p1([
        { r: 17, c: 5, cells: mwss },
        { r: 20, c: 30, cells: block },
      ], 140);
      console.log(`  GliderDown(${r},${gc})+MWSS(17,5)+Block(20,30): ${blocked}→${cleared} ${cleared > blocked ? "✅" : "❌"}`);
    }
    expect(true).toBe(true);
  });
});
