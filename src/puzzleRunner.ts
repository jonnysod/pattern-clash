// Puzzle harness. Loads a PuzzleDefinition, drives its timeline (simulate /
// place segments), and evaluates success criteria at the end.
//
// Composes engine.ts directly — does not touch game.ts or the 5-phase
// state machine.

import type {
  Card,
  Player,
  PuzzleDefinition,
  PuzzleTimelineEntry,
  BuyInventoryEntry,
} from "./types.js";
import { Engine } from "./engine.js";
import { Zones } from "./zones.js";
import { Renderer } from "./rendering.js";
import type { RenderSource } from "./rendering.js";
import { CardHand } from "./cardHand.js";
import type { CardProvider } from "./cardHand.js";
import { ScoreEffects } from "./scoreEffects.js";
import { PATTERNS } from "./patterns.js";
import { mirrorPatternHorizontal, getPlacementCol } from "./patternUtils.js";
import { CONFIG } from "./config.js";
import { logInfo, logWarn } from "./logger.js";
import { PUZZLE_ZONE_CONFIG, PUZZLE_ZONE_CONFIG_L } from "./puzzles.js";
import { getBestScore, recordScore } from "./puzzleHighscores.js";

// DOM elements the puzzle screen needs.
export interface PuzzleDOMRefs {
  canvas: HTMLCanvasElement;
  cardHand1: HTMLDivElement;
  cardHand2: HTMLDivElement;
  objective: HTMLParagraphElement;
  hint: HTMLParagraphElement;
  doneBtn: HTMLButtonElement;
  generationCounter: HTMLSpanElement;
  simSkipHint: HTMLSpanElement;
  opponentScore: HTMLSpanElement;
  resultOverlay: HTMLDivElement;
  resultTitle: HTMLHeadingElement;
  resultText: HTMLParagraphElement;
  retryBtn: HTMLButtonElement;
  backBtn: HTMLButtonElement;
}

// A placement committed during a place phase (pending until "Done" is clicked).
interface PendingPlacement {
  card: Card;
  row: number;
  col: number;
}

// CardProvider implementation for the puzzle: only P1 has a hand.
class PuzzleCardProvider implements CardProvider {
  private hand: Card[] = [];

  setHand(hand: Card[]): void {
    this.hand = hand;
  }
  getHand(player: Player): Card[] {
    return player === 1 ? this.hand : [];
  }
  getInventory(_player: Player): BuyInventoryEntry[] {
    return [];
  }
}

// RenderSource implementation that delegates grid access to the engine.
class PuzzleRenderSource implements RenderSource {
  readonly rows: number;
  readonly cols: number;
  readonly zones: Zones;
  private engine: Engine;

  get grid(): boolean[][] {
    return this.engine.grid;
  }

  constructor(engine: Engine, zones: Zones) {
    this.rows = engine.rows;
    this.cols = engine.cols;
    this.zones = zones;
    this.engine = engine;
  }
}

type PuzzleState = "idle" | "simulating" | "placing" | "result";

// ---------------------------------------------------------------------------
// Result overlay text builder — extracted for testability
// ---------------------------------------------------------------------------

export interface ResultDisplay {
  title: string;       // "Solved!" or "Failed"
  scoreText: string;   // second line; may be empty for binary successes
  success: boolean;
}

// Compute the overlay display values for a finished puzzle run.
// `prevBestFn` allows injection in tests (avoids real localStorage reads).
export function buildResultDisplay(
  puzzleId: string,
  criteria: import("./types.js").PuzzleCriteria,
  p1Score: number,
  p2Score: number,
  prevBestFn: (id: string) => number | null,
  recordFn: (id: string, score: number, lowerIsBetter: boolean) => "new-best" | "not-best",
): ResultDisplay {
  let success = true;
  if (criteria.maxOpponentScore !== undefined && p2Score > criteria.maxOpponentScore) success = false;
  if (criteria.minOwnScore !== undefined && p1Score < criteria.minOwnScore) success = false;

  let scoreText = "";

  if (criteria.maxOpponentScore !== undefined) {
    const isBinary = criteria.maxOpponentScore === 0;
    if (!success) {
      scoreText = `Opponent scored ${p2Score} (limit ≤ ${criteria.maxOpponentScore})`;
    } else if (!isBinary) {
      const prevBest = prevBestFn(puzzleId);
      const result = recordFn(puzzleId, p2Score, true);
      scoreText =
        result === "new-best"
          ? `Opponent scored ${p2Score} (limit ≤ ${criteria.maxOpponentScore}). New best!`
          : `Opponent scored ${p2Score} (limit ≤ ${criteria.maxOpponentScore}). Best: ${prevBest ?? p2Score}`;
    } else {
      recordFn(puzzleId, 0, true);
    }
  } else if (criteria.minOwnScore !== undefined) {
    if (!success) {
      scoreText = `You scored ${p1Score} (needed ≥ ${criteria.minOwnScore})`;
    } else {
      const prevBest = prevBestFn(puzzleId);
      const result = recordFn(puzzleId, p1Score, false);
      scoreText =
        result === "new-best"
          ? `You scored ${p1Score} (target ≥ ${criteria.minOwnScore}). New best!`
          : `You scored ${p1Score} (target ≥ ${criteria.minOwnScore}). Best: ${prevBest ?? p1Score}`;
    }
  }

  return { title: success ? "Solved!" : "Failed", scoreText, success };
}

export class PuzzleRunner {
  private dom: PuzzleDOMRefs;

  private puzzle: PuzzleDefinition | null = null;
  private engine: Engine | null = null;
  private zones: Zones | null = null;
  private renderer: Renderer | null = null;
  private cardProvider: PuzzleCardProvider | null = null;
  private cardHand: CardHand | null = null;
  private scoreEffects: ScoreEffects | null = null;

  private state: PuzzleState = "idle";
  private timelineIndex: number = 0;

  // Simulation
  private simTimerId: number | null = null;
  private simGenTarget: number = 0; // currentGeneration at which this segment ends

  // Place phase
  private currentHand: Card[] = [];
  private pendingPlacements: PendingPlacement[] = [];
  private maxCards: number = 0;
  private selectedCardId: string | null = null;
  private hoverRow: number | null = null;
  private hoverCol: number | null = null;
  private cellSize: number = 7;

  // Generation display offset: reset to engine.currentGeneration at the start
  // of each simulate segment so each segment's counter begins at 0.
  private genDisplayOffset: number = 0;

  // Criteria tracking
  private p1Score: number = 0;
  private p2Score: number = 0;
  private cardsUsed: number = 0;

  // Event handler refs for cleanup
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private mouseLeaveHandler: (() => void) | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;

  // Called when the player navigates back to the puzzle select screen.
  onExit: (() => void) | null = null;

  constructor(dom: PuzzleDOMRefs) {
    this.dom = dom;
  }

  start(puzzle: PuzzleDefinition): void {
    this.puzzle = puzzle;
    this.dom.objective.textContent = puzzle.objective;
    this.dom.hint.textContent = puzzle.hint ?? "";
    this.dom.hint.style.display = puzzle.hint ? "block" : "none";
    this.dom.resultOverlay.style.display = "none";
    this.dom.doneBtn.style.display = "none";

    this.buildEngine(puzzle);
    this.runNextTimelineEntry();
    this.wireCanvasEvents();
  }

  stop(): void {
    this.stopSimulation();
    this.unwireCanvasEvents();
    this.state = "idle";
  }

  // -------------------------------------------------------------------------
  // Engine / setup
  // -------------------------------------------------------------------------

  private buildEngine(puzzle: PuzzleDefinition): void {
    const zoneConfig =
      puzzle.zoneConfig === "l-shapes" ? PUZZLE_ZONE_CONFIG_L : PUZZLE_ZONE_CONFIG;
    this.zones = new Zones(puzzle.gridCols, puzzle.gridRows, zoneConfig);
    this.engine = new Engine(
      puzzle.gridRows,
      puzzle.gridCols,
      this.zones,
      9999, // no natural sim end — the harness drives generation counts
    );

    // Stamp initial placements
    for (const ip of puzzle.initialPlacements) {
      const base = PATTERNS[ip.patternIndex];
      if (!base) {
        logWarn(`[Puzzle] unknown patternIndex ${ip.patternIndex} in initialPlacements`);
        continue;
      }
      const pattern = ip.mirror ? mirrorPatternHorizontal(base) : base;
      this.engine.stampCells(ip.row, ip.col, pattern.cells);
    }

    // Compute cell size to fit the canvas
    const maxW = this.dom.canvas.width || 600;
    const maxH = this.dom.canvas.height || 400;
    this.cellSize = Math.max(
      1,
      Math.floor(Math.min(maxW / puzzle.gridCols, maxH / puzzle.gridRows)),
    );
    this.dom.canvas.width = puzzle.gridCols * this.cellSize;
    this.dom.canvas.height = puzzle.gridRows * this.cellSize;

    const renderSource = new PuzzleRenderSource(this.engine, this.zones);
    this.renderer = new Renderer(this.dom.canvas, this.cellSize, renderSource);

    this.cardProvider = new PuzzleCardProvider();
    this.cardHand = new CardHand(
      this.cardProvider,
      this.dom.cardHand1,
      this.dom.cardHand2,
    );
    this.cardHand.setActiveAndVisible(1, 1);
    this.cardHand.onCardSelect = (id) => this.onCardSelect(id);

    this.scoreEffects = new ScoreEffects(this.dom.canvas, this.cellSize);

    this.genDisplayOffset = 0;
    this.p1Score = 0;
    this.p2Score = 0;
    this.cardsUsed = 0;
    this.timelineIndex = 0;
    this.pendingPlacements = [];
    this.selectedCardId = null;
    this.currentHand = [];

    this.renderer.drawGrid();
    this.updateGenerationCounter();
    this.updateOpponentScore();
  }

  // -------------------------------------------------------------------------
  // Timeline
  // -------------------------------------------------------------------------

  private runNextTimelineEntry(): void {
    if (!this.puzzle) return;

    if (this.timelineIndex >= this.puzzle.timeline.length) {
      this.showResult();
      return;
    }

    const entry = this.puzzle.timeline[this.timelineIndex]!;
    this.timelineIndex++;

    if (entry.kind === "simulate") {
      this.startSimSegment(entry.generations);
    } else {
      this.startPlaceSegment(entry.pool, entry.maxCards);
    }
  }

  // -------------------------------------------------------------------------
  // Simulate segment
  // -------------------------------------------------------------------------

  private startSimSegment(generations: number): void {
    if (!this.engine) return;
    this.state = "simulating";
    this.dom.doneBtn.style.display = "none";
    this.cardHand?.clear();
    // Each simulate segment counts from 0 in the display.
    this.genDisplayOffset = this.engine.currentGeneration;
    this.simGenTarget = this.engine.currentGeneration + generations;
    this.updateGenerationCounter();
    logInfo(`[Puzzle] simulate ${generations} gens (target gen ${this.simGenTarget})`);
    this.scheduleSimTick();
  }

  private scheduleSimTick(): void {
    const tickMs = Math.floor(1000 / CONFIG.FPS_FAST);
    this.simTimerId = window.setTimeout(() => this.simTick(), tickMs);
  }

  private simTick(): void {
    if (this.state !== "simulating" || !this.engine || !this.renderer) return;

    const events = this.engine.computeNextGeneration();
    this.scoreEffects?.feed(events);
    for (const e of events) {
      if (e.scorer === 1) this.p1Score += e.points;
      else this.p2Score += e.points;
    }
    this.renderer.drawGrid();
    this.updateGenerationCounter();
    this.updateOpponentScore();

    if (this.engine.currentGeneration >= this.simGenTarget) {
      this.stopSimulation();
      this.flushAndAdvance();
      return;
    }

    // Early-termination: stable grid with no scoring activity.
    const period = this.engine.detectStablePeriod();
    if (period === 1 || period === 2) {
      this.stopSimulation();
      this.onStabilitySkip(period);
      return;
    }

    this.scheduleSimTick();
  }

  // Called when the engine detects a stable period with no pending score hits.
  // Runs parity-correction ticks, jumps the generation display to the segment
  // target, shows a brief UX hint, then hands off to the normal flushAndAdvance
  // path which handles force-flush, hold, and timeline advance.
  private onStabilitySkip(period: 1 | 2): void {
    if (!this.engine) return;
    const target = this.simGenTarget;
    const current = this.engine.currentGeneration;
    // Parity correction: run (remaining % period) extra ticks so the end-grid
    // is bitidentical to a full run. These ticks are guaranteed hit-free.
    const extra = (target - current) % period;
    for (let i = 0; i < extra; i++) {
      this.engine.computeNextGeneration();
    }
    // Jump the generation counter to the segment target.
    this.engine.currentGeneration = target;
    this.updateGenerationCounter();

    logInfo(
      `[Puzzle] Stability skip at gen ${current} (period ${period}, target ${target}).`,
    );

    // Show brief hint, then use the normal flushAndAdvance path.
    this.dom.simSkipHint.style.display = "inline";
    // flushAndAdvance already holds for SEGMENT_END_HOLD_MS; hide hint when
    // the hold fires by scheduling at the same delay.
    window.setTimeout(
      () => {
        this.dom.simSkipHint.style.display = "none";
      },
      PuzzleRunner.SEGMENT_END_HOLD_MS,
    );
    this.flushAndAdvance();
  }

  // Force-flush any pending score buckets at segment end, update the score
  // display, then hold briefly so score floaters finish animating before the
  // next phase (or result overlay) appears.
  //
  // The hold matches the scoreEffects float duration (1500 ms) minus a small
  // lead so the overlay appears while floaters are still fading out rather
  // than popping in after the overlay covers the canvas.
  private static readonly SEGMENT_END_HOLD_MS = 1000;

  private flushAndAdvance(): void {
    if (!this.engine) return;

    // Flush any score hits accumulated in pending buckets that haven't yet
    // been emitted via SILENCE_LIMIT or AGE_LIMIT.
    const flushEvents = this.engine.forceFlushBuckets();
    if (flushEvents.length > 0) {
      this.scoreEffects?.feed(flushEvents);
      for (const e of flushEvents) {
        if (e.scorer === 1) this.p1Score += e.points;
        else this.p2Score += e.points;
      }
      this.updateOpponentScore();
    }

    // Hold so floaters are visible before the next phase / result overlay.
    window.setTimeout(
      () => this.runNextTimelineEntry(),
      PuzzleRunner.SEGMENT_END_HOLD_MS,
    );
  }

  private stopSimulation(): void {
    if (this.simTimerId !== null) {
      clearTimeout(this.simTimerId);
      this.simTimerId = null;
    }
  }

  // -------------------------------------------------------------------------
  // Place segment
  // -------------------------------------------------------------------------

  private startPlaceSegment(pool: number[], maxCards: number | undefined): void {
    this.state = "placing";
    this.maxCards = maxCards ?? pool.length;
    this.pendingPlacements = [];
    this.selectedCardId = null;

    // Build hand from pool — one Card per pool entry
    let idCounter = 1;
    this.currentHand = pool.map((patternIndex) => ({
      id: `puzzle-card-${idCounter++}`,
      patternIndex,
    }));

    this.cardProvider!.setHand([...this.currentHand]);
    this.cardHand!.setActiveAndVisible(1, 1);
    this.cardHand!.render();

    // Auto-select first card
    const first = this.currentHand[0];
    if (first) {
      this.selectedCardId = first.id;
      this.cardHand!.setSelectedCard(first.id);
    }

    this.dom.doneBtn.style.display = "inline-block";
    this.dom.doneBtn.disabled = false;
    this.updateDoneLabel();
    logInfo(`[Puzzle] place phase: ${pool.length} cards, maxCards=${this.maxCards}`);
  }

  private onCardSelect(cardId: string | null): void {
    this.selectedCardId = cardId;
    this.cardHand?.setSelectedCard(cardId);
    this.refreshPreview();
  }

  // Called when the player clicks "Done" to commit pending placements.
  commitPlacements(): void {
    if (this.state !== "placing" || !this.engine) return;

    // Stamp all pending placements onto the engine grid
    for (const pending of this.pendingPlacements) {
      const base = PATTERNS[pending.card.patternIndex];
      if (!base) continue;
      // In puzzle mode playerSide=P1 — no mirroring needed (patterns face right)
      this.engine.stampCells(pending.row, pending.col, base.cells);
      this.cardsUsed++;
    }

    this.pendingPlacements = [];
    this.dom.doneBtn.style.display = "none";
    this.selectedCardId = null;
    this.hoverRow = null;
    this.hoverCol = null;
    this.renderer?.drawGrid();
    this.runNextTimelineEntry();
  }

  // -------------------------------------------------------------------------
  // Canvas interaction (place phase)
  // -------------------------------------------------------------------------

  private wireCanvasEvents(): void {
    this.mouseMoveHandler = (e) => this.onMouseMove(e);
    this.mouseLeaveHandler = () => this.onMouseLeave();
    this.clickHandler = (e) => this.onCanvasClick(e);
    this.dom.canvas.addEventListener("mousemove", this.mouseMoveHandler);
    this.dom.canvas.addEventListener("mouseleave", this.mouseLeaveHandler);
    this.dom.canvas.addEventListener("click", this.clickHandler);
  }

  private unwireCanvasEvents(): void {
    if (this.mouseMoveHandler)
      this.dom.canvas.removeEventListener("mousemove", this.mouseMoveHandler);
    if (this.mouseLeaveHandler)
      this.dom.canvas.removeEventListener("mouseleave", this.mouseLeaveHandler);
    if (this.clickHandler)
      this.dom.canvas.removeEventListener("click", this.clickHandler);
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.state !== "placing") return;
    const rect = this.dom.canvas.getBoundingClientRect();
    this.hoverCol = Math.floor((e.clientX - rect.left) / this.cellSize);
    this.hoverRow = Math.floor((e.clientY - rect.top) / this.cellSize);
    this.refreshPreview();
  }

  private onMouseLeave(): void {
    if (this.state !== "placing") return;
    this.hoverRow = null;
    this.hoverCol = null;
    this.renderer?.drawGrid();
    this.drawPendingPlacements();
  }

  private onCanvasClick(e: MouseEvent): void {
    if (this.state !== "placing" || !this.engine || !this.renderer) return;
    if (this.selectedCardId === null) return;

    // Check maxCards limit
    if (this.pendingPlacements.length >= this.maxCards) return;

    const rect = this.dom.canvas.getBoundingClientRect();
    const col = Math.floor((e.clientX - rect.left) / this.cellSize);
    const row = Math.floor((e.clientY - rect.top) / this.cellSize);

    const card = this.currentHand.find((c) => c.id === this.selectedCardId);
    if (!card) return;

    const pattern = PATTERNS[card.patternIndex];
    if (!pattern) return;

    const placementCol = getPlacementCol(col, pattern, 1);

    if (!this.isValidPuzzlePlacement(pattern.cells, row, placementCol)) return;

    // Remove card from current hand, add to pending
    this.currentHand = this.currentHand.filter((c) => c.id !== card.id);
    this.pendingPlacements.push({ card, row, col: placementCol });
    this.selectedCardId = null;

    this.cardProvider!.setHand([...this.currentHand]);
    this.cardHand!.setSelectedCard(null);
    this.cardHand!.render();

    // Auto-select next card if hand not empty and limit not reached
    if (
      this.currentHand.length > 0 &&
      this.pendingPlacements.length < this.maxCards
    ) {
      const next = this.currentHand[0]!;
      this.selectedCardId = next.id;
      this.cardHand!.setSelectedCard(next.id);
    }

    this.renderer.drawGrid();
    this.drawPendingPlacements();
    this.updateDoneLabel();
    logInfo(`[Puzzle] pending placement: pattern ${card.patternIndex} at (${row}, ${placementCol})`);
  }

  // Check if a placement is valid: all cells must be within placementRegion
  // (or whole grid if not set), and within grid bounds.
  private isValidPuzzlePlacement(
    cells: [number, number][],
    startRow: number,
    startCol: number,
  ): boolean {
    const region = this.puzzle?.placementRegion;
    for (const [dr, dc] of cells) {
      const r = startRow + dr;
      const c = startCol + dc;
      if (r < 0 || r >= (this.engine?.rows ?? 0)) return false;
      if (c < 0 || c >= (this.engine?.cols ?? 0)) return false;
      if (region) {
        if (r < region.y || r >= region.y + region.h) return false;
        if (c < region.x || c >= region.x + region.w) return false;
      }
    }
    return true;
  }

  private refreshPreview(): void {
    if (!this.renderer) return;
    this.renderer.drawGrid();
    this.drawPendingPlacements();

    if (
      this.state !== "placing" ||
      this.selectedCardId === null ||
      this.hoverRow === null ||
      this.hoverCol === null ||
      this.pendingPlacements.length >= this.maxCards
    ) {
      return;
    }

    const card = this.currentHand.find((c) => c.id === this.selectedCardId);
    if (!card) return;
    const pattern = PATTERNS[card.patternIndex];
    if (!pattern) return;

    const placementCol = getPlacementCol(this.hoverCol, pattern, 1);
    const valid = this.isValidPuzzlePlacement(
      pattern.cells,
      this.hoverRow,
      placementCol,
    );
    this.renderer.drawPlacementPreview(
      pattern,
      this.hoverRow,
      placementCol,
      1,
      valid,
    );
    // Re-draw pending placements on top of the preview
    this.drawPendingPlacements();
  }

  // Draw pending placements as a distinct color overlay (cyan = committed-but-not-yet-stamped)
  private drawPendingPlacements(): void {
    if (!this.renderer || this.pendingPlacements.length === 0) return;
    const ctx = this.dom.canvas.getContext("2d");
    if (!ctx) return;
    const cs = this.cellSize;
    ctx.fillStyle = "rgba(0, 220, 220, 0.6)";
    for (const p of this.pendingPlacements) {
      const pattern = PATTERNS[p.card.patternIndex];
      if (!pattern) continue;
      for (const [dr, dc] of pattern.cells) {
        ctx.fillRect(
          (p.col + dc) * cs,
          (p.row + dr) * cs,
          cs - 1,
          cs - 1,
        );
      }
    }
  }

  private updateDoneLabel(): void {
    const placed = this.pendingPlacements.length;
    this.dom.doneBtn.textContent =
      placed === 0 ? "Done (skip)" : `Done (${placed} placed)`;
  }

  // -------------------------------------------------------------------------
  // Result
  // -------------------------------------------------------------------------

  private showResult(): void {
    this.state = "result";
    this.stopSimulation();

    if (!this.puzzle) return;

    const display = buildResultDisplay(
      this.puzzle.id,
      this.puzzle.criteria,
      this.p1Score,
      this.p2Score,
      getBestScore,
      recordScore,
    );

    this.dom.resultTitle.textContent = display.title;
    this.dom.resultTitle.style.color = display.success ? "#00ff88" : "#ff6666";
    this.dom.resultText.textContent = display.scoreText;
    this.dom.resultOverlay.style.display = "flex";
    this.dom.doneBtn.style.display = "none";
    logInfo(`[Puzzle] result: ${display.success ? "success" : "failure"} — p1=${this.p1Score} p2=${this.p2Score}`);
  }

  // Exposed for tests (headless evaluation without rendering)
  evaluateCriteria(): boolean {
    if (!this.puzzle) return false;
    const { criteria } = this.puzzle;
    if (criteria.maxOpponentScore !== undefined && this.p2Score > criteria.maxOpponentScore) {
      return false;
    }
    if (criteria.minOwnScore !== undefined && this.p1Score < criteria.minOwnScore) {
      return false;
    }
    return true;
  }

  // Exposed for tests
  get scores(): { p1: number; p2: number } {
    return { p1: this.p1Score, p2: this.p2Score };
  }

  get placedCount(): number {
    return this.cardsUsed;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private updateGenerationCounter(): void {
    const gen = (this.engine?.currentGeneration ?? 0) - this.genDisplayOffset;
    this.dom.generationCounter.textContent = String(gen);
  }

  private updateOpponentScore(): void {
    this.dom.opponentScore.textContent = String(this.p2Score);
  }
}
