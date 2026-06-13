// Conway engine: grid, generation stepping, pattern stamping, and score-bucket
// aggregation. Phase-agnostic — knows nothing about game structure, buy economy,
// or card management. Callers decide when to stamp cells and when to step.

import type { Player, ScoreEvent } from "./types.js";
import { Zones } from "./zones.js";
import { CONFIG } from "./config.js";

// A pending score bucket. Score isn't credited the moment a cell
// reaches the endzone — it accumulates here. The bucket flushes when
// the stream goes quiet (silenceCounter >= SCORE_BUCKET_SILENCE_LIMIT)
// or has grown for too long (ageCounter >= SCORE_BUCKET_AGE_LIMIT),
// at which point its points are credited and a single ScoreEvent is
// emitted. This keeps the displayed "+N" text in sync with the actual
// point award — they're the same event.
interface ScoreBucket {
  scorer: Player;
  points: number;
  // Position of the most recent hit — where the floating "+N" appears.
  row: number;
  col: number;
  silenceCounter: number; // generations since last hit in this region (0 on hit)
  ageCounter: number; // generations since bucket creation (never resets)
}

export class Engine {
  readonly rows: number;
  readonly cols: number;
  readonly simGenerations: number;
  private readonly zones: Zones;

  grid: boolean[][];
  currentGeneration: number = 0;

  // Score events emitted in the most recent computeNextGeneration() call.
  // Populated only when buckets flush, not on every individual hit.
  scoreEvents: ScoreEvent[] = [];

  // Pending score buckets, keyed by `scorer-regionRow-regionCol`.
  private scoreBuckets: Map<string, ScoreBucket> = new Map();

  // Stability detection: hold references to the last two grids and whether
  // each of the last two ticks produced any score-zone hits.
  // Nulled by stampCells() and reset() whenever the grid changes externally.
  private prevGrid: boolean[][] | null = null;
  private prevPrevGrid: boolean[][] | null = null;
  private hadHitsLastTick: boolean = false;
  private hadHitsTwoTicksAgo: boolean = false;

  constructor(
    rows: number,
    cols: number,
    zones: Zones,
    simGenerations: number,
  ) {
    this.rows = rows;
    this.cols = cols;
    this.zones = zones;
    this.simGenerations = simGenerations;
    this.grid = this.createEmptyGrid();
  }

  reset(): void {
    this.grid = this.createEmptyGrid();
    this.currentGeneration = 0;
    this.scoreEvents = [];
    this.scoreBuckets.clear();
    this.invalidateStabilityHistory();
  }

  // Write a set of cells onto the grid at the given origin.
  // Pure stamp — no zone validation. Callers are responsible for
  // checking placement validity before calling.
  stampCells(
    startRow: number,
    startCol: number,
    cells: [number, number][],
  ): void {
    for (const [rowOffset, colOffset] of cells) {
      const row = startRow + rowOffset;
      const col = startCol + colOffset;
      if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
        this.grid[row]![col] = true;
      }
    }
    this.invalidateStabilityHistory();
  }

  // Advance the grid one Conway generation and update score buckets.
  // Returns the ScoreEvents emitted by bucket flushes this tick
  // (also stored in this.scoreEvents).
  computeNextGeneration(): ScoreEvent[] {
    this.currentGeneration++;
    this.scoreEvents = [];

    const newGrid: boolean[][] = this.createEmptyGrid();
    const hitsThisTick = new Set<string>();

    // 1. Conway step. Cells born in a score zone don't credit points
    //    immediately — they accumulate into a regional bucket.
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const neighbors = this.countNeighbors(row, col);
        const isAlive = this.grid[row]![col];

        if (isAlive && (neighbors === 2 || neighbors === 3)) {
          newGrid[row]![col] = true;
        } else if (!isAlive && neighbors === 3) {
          newGrid[row]![col] = true;

          const scoreResult = this.zones.isScoreCell(row, col);
          if (scoreResult.scores && scoreResult.scorer) {
            const scorer = scoreResult.scorer;
            const key = this.regionKey(row, col, scorer);
            hitsThisTick.add(key);
            let bucket = this.scoreBuckets.get(key);
            if (!bucket) {
              bucket = {
                scorer,
                points: 0,
                row,
                col,
                silenceCounter: 0,
                ageCounter: 0,
              };
              this.scoreBuckets.set(key, bucket);
            }
            bucket.points += CONFIG.SCORE_POINTS;
            // Track most recent hit position — that's where the
            // floating "+N" will pop on flush.
            bucket.row = row;
            bucket.col = col;
          }
        }
      }
    }

    // Save grid references for stability detection before replacing this.grid.
    this.prevPrevGrid = this.prevGrid;
    this.prevGrid = this.grid;
    this.grid = newGrid;

    // 2. Decay phase. Bump silence/age counters on every existing
    //    bucket, mark expired ones for flush.
    //    Atomic-tick semantics: this runs *after* all hits are
    //    collected, so a tick that both adds to a bucket AND ages it
    //    past the cap flushes the bucket *with* the current tick's
    //    points included.
    const expiredKeys: string[] = [];
    for (const [key, bucket] of this.scoreBuckets) {
      if (hitsThisTick.has(key)) {
        bucket.silenceCounter = 0;
      } else {
        bucket.silenceCounter++;
      }
      bucket.ageCounter++;

      if (
        bucket.silenceCounter >= CONFIG.SCORE_BUCKET_SILENCE_LIMIT ||
        bucket.ageCounter >= CONFIG.SCORE_BUCKET_AGE_LIMIT
      ) {
        expiredKeys.push(key);
      }
    }
    for (const key of expiredKeys) {
      const bucket = this.scoreBuckets.get(key)!;
      this.scoreEvents.push({
        row: bucket.row,
        col: bucket.col,
        scorer: bucket.scorer,
        points: bucket.points,
      });
      this.scoreBuckets.delete(key);
    }

    // 3. End-of-simulation force-flush. Anything still pending gets
    //    emitted on the final tick — otherwise points would be silently
    //    dropped.
    if (this.currentGeneration >= this.simGenerations) {
      for (const bucket of this.scoreBuckets.values()) {
        this.scoreEvents.push({
          row: bucket.row,
          col: bucket.col,
          scorer: bucket.scorer,
          points: bucket.points,
        });
      }
      this.scoreBuckets.clear();
    }

    // Update hit history for stability detection.
    this.hadHitsTwoTicksAgo = this.hadHitsLastTick;
    this.hadHitsLastTick = hitsThisTick.size > 0;

    return this.scoreEvents;
  }

  // Check whether the grid has reached a stable period-1 (still life) or
  // period-2 (oscillator) state with no score-zone hits in the last cycle.
  // Returns 0 if not stable, 1 for period-1, 2 for period-2.
  // Requires at least p+1 ticks of history since the last stampCells/reset.
  detectStablePeriod(): 0 | 1 | 2 {
    if (this.prevGrid === null) return 0;
    if (this.hadHitsLastTick) return 0;
    if (this.gridsEqual(this.grid, this.prevGrid)) return 1;
    if (
      this.prevPrevGrid !== null &&
      !this.hadHitsTwoTicksAgo &&
      this.gridsEqual(this.grid, this.prevPrevGrid)
    ) {
      return 2;
    }
    return 0;
  }

  // Advance the grid one Conway generation without any score-pipeline work.
  // No hit-detection, no buckets, no ScoreEvents, no force-flush concerns.
  // Intended for the post-game freerun sandbox where scoring is frozen.
  // Also updates the stability-detection history so detectStablePeriod() works.
  stepOnly(): void {
    this.currentGeneration++;
    const newGrid: boolean[][] = this.createEmptyGrid();
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const neighbors = this.countNeighbors(row, col);
        const isAlive = this.grid[row]![col];
        if (isAlive && (neighbors === 2 || neighbors === 3)) {
          newGrid[row]![col] = true;
        } else if (!isAlive && neighbors === 3) {
          newGrid[row]![col] = true;
        }
      }
    }
    this.prevPrevGrid = this.prevGrid;
    this.prevGrid = this.grid;
    this.grid = newGrid;
    // No hits in score-free mode.
    this.hadHitsTwoTicksAgo = this.hadHitsLastTick;
    this.hadHitsLastTick = false;
  }

  isSimulationComplete(): boolean {
    return this.currentGeneration >= this.simGenerations;
  }

  // Flush all pending score buckets immediately and return the resulting
  // ScoreEvents. Intended for external callers (e.g. the puzzle runner) that
  // control segment boundaries independently of simGenerations.
  // After this call scoreBuckets is empty and scoreEvents contains the flushed
  // events (same as the end-of-simulation flush inside computeNextGeneration).
  forceFlushBuckets(): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    for (const bucket of this.scoreBuckets.values()) {
      events.push({
        row: bucket.row,
        col: bucket.col,
        scorer: bucket.scorer,
        points: bucket.points,
      });
    }
    this.scoreBuckets.clear();
    this.scoreEvents = events;
    return events;
  }

  // Fast grid hash (kept for sync debugging).
  gridHash(): number {
    let hash = 0;
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        if (this.grid[row]![col]) {
          hash = (hash * 31 + row * this.cols + col) | 0;
        }
      }
    }
    return hash;
  }

  private createEmptyGrid(): boolean[][] {
    return Array(this.rows)
      .fill(null)
      .map(() => Array(this.cols).fill(false));
  }

  private countNeighbors(row: number, col: number): number {
    let count = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = row + dr;
        const c = col + dc;
        if (
          r >= 0 &&
          r < this.rows &&
          c >= 0 &&
          c < this.cols &&
          this.grid[r]![c]
        ) {
          count++;
        }
      }
    }
    return count;
  }

  private regionKey(row: number, col: number, scorer: Player): string {
    const r = Math.floor(row / CONFIG.SCORE_BUCKET_REGION_SIZE);
    const c = Math.floor(col / CONFIG.SCORE_BUCKET_REGION_SIZE);
    return `${scorer}-${r}-${c}`;
  }

  private gridsEqual(a: boolean[][], b: boolean[][]): boolean {
    for (let row = 0; row < this.rows; row++) {
      const aRow = a[row]!;
      const bRow = b[row]!;
      for (let col = 0; col < this.cols; col++) {
        if (aRow[col] !== bRow[col]) return false;
      }
    }
    return true;
  }

  private invalidateStabilityHistory(): void {
    this.prevGrid = null;
    this.prevPrevGrid = null;
    this.hadHitsLastTick = false;
    this.hadHitsTwoTicksAgo = false;
  }
}
