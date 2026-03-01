// Game state and Conway's Game of Life logic

import type { Pattern, Player, GamePhase } from "./types.js";
import { Zones } from "./zones.js";
import { PATTERNS } from "./patterns.js";
import { CONFIG } from "./config.js";

// Valid phase transitions (source → allowed targets)
const VALID_TRANSITIONS: Record<GamePhase, GamePhase[]> = {
  placement: ["live", "ended"],
  live: ["paused", "ended"],
  paused: ["pauseDecision", "live", "ended"],
  pauseDecision: ["paused", "live", "ended"],
  ended: ["placement"], // restart
};

export class Game {
  readonly rows: number;
  readonly cols: number;
  readonly zones: Zones;

  grid: boolean[][];

  // State machine (replaces isRunning, isLivePhase, isPaused)
  private _phase: GamePhase = "placement";

  // Points system
  pointsPlayer1: number = CONFIG.INITIAL_BUDGET;
  pointsPlayer2: number = CONFIG.INITIAL_BUDGET;

  // Generation tracking
  currentGeneration: number = 0;
  readonly maxGenerations: number = CONFIG.MAX_GENERATIONS;

  // Surrender tracking
  surrenderedPlayer: Player | null = null;

  // Pause tracking
  pausesPlayer1: number = CONFIG.MAX_PAUSES_PER_PLAYER;
  pausesPlayer2: number = CONFIG.MAX_PAUSES_PER_PLAYER;
  pausingPlayer: Player | null = null;

  constructor(rows: number, cols: number) {
    this.rows = rows;
    this.cols = cols;
    this.zones = new Zones(cols, rows);
    this.grid = this.createEmptyGrid();
  }

  //#region Phase State Machine
  get phase(): GamePhase {
    return this._phase;
  }

  setPhase(newPhase: GamePhase): void {
    const allowed = VALID_TRANSITIONS[this._phase];
    if (!allowed?.includes(newPhase)) {
      console.warn(
        `Invalid phase transition: ${this._phase} → ${newPhase}. Allowed: ${allowed?.join(", ")}`,
      );
      return;
    }
    this._phase = newPhase;
  }

  // Convenience getters for backwards compatibility / readability
  get isPlacement(): boolean {
    return this._phase === "placement";
  }
  get isLive(): boolean {
    return this._phase === "live";
  }
  get isPaused(): boolean {
    return this._phase === "paused";
  }
  get isPauseDecision(): boolean {
    return this._phase === "pauseDecision";
  }
  get isEnded(): boolean {
    return this._phase === "ended";
  }
  get isSimulationRunning(): boolean {
    return (
      this._phase === "live" ||
      this._phase === "paused" ||
      this._phase === "pauseDecision"
    );
  }
  //#endregion

  //#region Grid
  private createEmptyGrid(): boolean[][] {
    return Array(this.rows)
      .fill(null)
      .map(() => Array(this.cols).fill(false));
  }
  //#endregion

  //#region Reset
  reset(): void {
    this.grid = this.createEmptyGrid();
    this._phase = "placement";
    this.pointsPlayer1 = CONFIG.INITIAL_BUDGET;
    this.pointsPlayer2 = CONFIG.INITIAL_BUDGET;
    this.currentGeneration = 0;
    this.surrenderedPlayer = null;
    this.pausesPlayer1 = CONFIG.MAX_PAUSES_PER_PLAYER;
    this.pausesPlayer2 = CONFIG.MAX_PAUSES_PER_PLAYER;
    this.pausingPlayer = null;
  }
  //#endregion

  //#region Simulation
  computeNextGeneration(): void {
    this.currentGeneration++;

    if (this.currentGeneration >= this.maxGenerations) {
      this.setPhase("ended");
      return;
    }

    const newGrid: boolean[][] = this.createEmptyGrid();

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const neighbors = this.countNeighbors(row, col);
        const isAlive = this.grid[row]![col];

        if (isAlive && (neighbors === 2 || neighbors === 3)) {
          newGrid[row]![col] = true;
        } else if (!isAlive && neighbors === 3) {
          newGrid[row]![col] = true;

          const scoreResult = this.zones.isScoreCell(row, col);
          if (scoreResult.scores) {
            if (scoreResult.scorer === 1) {
              this.pointsPlayer1 += CONFIG.SCORE_POINTS;
            } else if (scoreResult.scorer === 2) {
              this.pointsPlayer2 += CONFIG.SCORE_POINTS;
            }
          }
        }
      }
    }

    this.grid = newGrid;
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
  //#endregion

  //#region Pattern Placement
  placePattern(
    startRow: number,
    startCol: number,
    pattern: Pattern,
    player: Player,
    skipZoneCheck: boolean = false,
  ): boolean {
    if (!skipZoneCheck && !this.zones.isValidPlacement(startCol, player)) {
      return false;
    }

    const cost = pattern.cells.length;
    const points = player === 1 ? this.pointsPlayer1 : this.pointsPlayer2;
    if (points < cost) {
      return false;
    }

    for (const [rowOffset, colOffset] of pattern.cells) {
      const row = startRow + rowOffset;
      const col = startCol + colOffset;
      if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
        this.grid[row]![col] = true;
      }
    }

    if (player === 1) {
      this.pointsPlayer1 -= cost;
    } else {
      this.pointsPlayer2 -= cost;
    }

    return true;
  }

  toggleCell(row: number, col: number, player: Player): boolean {
    if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
      if (this.zones.isValidPlacement(col, player)) {
        this.grid[row]![col] = !this.grid[row]![col];
        return true;
      }
    }
    return false;
  }
  //#endregion

  //#region Budget Queries
  getMinPatternCost(): number {
    return Math.min(...PATTERNS.map((p) => p.cells.length));
  }

  canAffordAnyPattern(player: Player): boolean {
    const points = player === 1 ? this.pointsPlayer1 : this.pointsPlayer2;
    return points >= this.getMinPatternCost();
  }

  getPauses(player: Player): number {
    return player === 1 ? this.pausesPlayer1 : this.pausesPlayer2;
  }

  deductPause(player: Player): void {
    if (player === 1) {
      this.pausesPlayer1--;
    } else {
      this.pausesPlayer2--;
    }
  }
  //#endregion

  //#region End Conditions
  surrender(player: Player): void {
    this.surrenderedPlayer = player;
    if (player === 1) {
      this.pointsPlayer1 = 0;
    } else {
      this.pointsPlayer2 = 0;
    }
    this.setPhase("ended");
  }

  getWinner(): {
    winner: Player | null;
    player1Score: number;
    player2Score: number;
  } {
    if (this.surrenderedPlayer === 1) {
      return {
        winner: 2,
        player1Score: this.pointsPlayer1,
        player2Score: this.pointsPlayer2,
      };
    }
    if (this.surrenderedPlayer === 2) {
      return {
        winner: 1,
        player1Score: this.pointsPlayer1,
        player2Score: this.pointsPlayer2,
      };
    }

    const diff = this.pointsPlayer1 - this.pointsPlayer2;
    return {
      winner: diff > 0 ? 1 : diff < 0 ? 2 : null,
      player1Score: this.pointsPlayer1,
      player2Score: this.pointsPlayer2,
    };
  }
  //#endregion
}
