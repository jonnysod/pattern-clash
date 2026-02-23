// Game state and Conway's Game of Life logic

import type { Pattern, Player } from "./types.js";
import { Zones } from "./zones.js";
import { PATTERNS } from "./patterns.js";

const INITIAL_BUDGET = 80;
const MAX_GENERATIONS = 800;

export class Game {
  readonly rows: number;
  readonly cols: number;
  readonly zones: Zones;

  grid: boolean[][];
  isRunning: boolean = false;
  isLivePhase: boolean = false; // Live-phase: Simulation runs, players can still place

  // Points system (used for placing patterns and scoring)
  pointsPlayer1: number = INITIAL_BUDGET;
  pointsPlayer2: number = INITIAL_BUDGET;

  // Generation tracking
  currentGeneration: number = 0;
  maxGenerations: number = MAX_GENERATIONS;

  // Surrender tracking
  surrenderedPlayer: Player | null = null;

  // Pause tracking
  pausesPlayer1: number = 3;
  pausesPlayer2: number = 3;
  isPaused: boolean = false;
  pausingPlayer: Player | null = null;

  constructor(rows: number, cols: number) {
    this.rows = rows;
    this.cols = cols;
    this.zones = new Zones(cols, rows);
    this.grid = this.createEmptyGrid();
    this.resetPoints();
  }

  private createEmptyGrid(): boolean[][] {
    return Array(this.rows)
      .fill(null)
      .map(() => Array(this.cols).fill(false));
  }

  reset(): void {
    this.grid = this.createEmptyGrid();
    this.isRunning = false;
    this.isLivePhase = false;
    this.resetPoints();
    this.currentGeneration = 0;
    this.surrenderedPlayer = null;
    this.pausesPlayer1 = 3;
    this.pausesPlayer2 = 3;
    this.isPaused = false;
    this.pausingPlayer = null;
  }

  private resetPoints(): void {
    this.pointsPlayer1 = INITIAL_BUDGET;
    this.pointsPlayer2 = INITIAL_BUDGET;
  }

  computeNextGeneration(): void {
    // Increment generation counter
    this.currentGeneration++;

    // Stop if max generations reached
    if (this.currentGeneration >= this.maxGenerations) {
      this.isRunning = false;
      return;
    }

    const newGrid: boolean[][] = this.createEmptyGrid();

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const neighbors = this.countNeighbors(row, col);
        const isAlive = this.grid[row]![col];

        // Conway's rules - gilt für ALLE Zellen gleich
        if (isAlive && (neighbors === 2 || neighbors === 3)) {
          newGrid[row]![col] = true; // Survives
        } else if (!isAlive && neighbors === 3) {
          newGrid[row]![col] = true; // Birth

          // Check scoring
          const scoreResult = this.zones.isScoreCell(row, col);
          if (scoreResult.scores) {
            if (scoreResult.scorer === 1) {
              this.pointsPlayer1 += 2;
            } else if (scoreResult.scorer === 2) {
              this.pointsPlayer2 += 2;
            }
          }
        } else {
          newGrid[row]![col] = false; // Dies or stays dead
        }
      }
    }

    this.grid = newGrid;
  }

  private countNeighbors(row: number, col: number): number {
    let count = 0;

    // Check all 8 neighbors
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue; // Skip the cell itself

        const newRow = row + dr;
        const newCol = col + dc;

        // Check if neighbor is in grid and alive
        if (
          newRow >= 0 &&
          newRow < this.rows &&
          newCol >= 0 &&
          newCol < this.cols &&
          this.grid[newRow]![newCol]
        ) {
          count++;
        }
      }
    }

    return count;
  }

  placePattern(
    startRow: number,
    startCol: number,
    pattern: Pattern,
    player: Player,
  ): boolean {
    // Check zone validation
    if (!this.zones.isValidPlacement(startCol, player)) {
      return false;
    }

    // Check budget
    const patternCost = pattern.cells.length;
    const currentPoints =
      player === 1 ? this.pointsPlayer1 : this.pointsPlayer2;

    if (currentPoints < patternCost) {
      return false; // Not enough points
    }

    // Place pattern
    for (const [rowOffset, colOffset] of pattern.cells) {
      const row = startRow + rowOffset;
      const col = startCol + colOffset;

      if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
        this.grid[row]![col] = true;
      }
    }

    // Deduct points
    if (player === 1) {
      this.pointsPlayer1 -= patternCost;
    } else {
      this.pointsPlayer2 -= patternCost;
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

  getMinPatternCost(): number {
    return Math.min(...PATTERNS.map((p) => p.cells.length));
  }

  canAffordAnyPattern(player: Player): boolean {
    const points = player === 1 ? this.pointsPlayer1 : this.pointsPlayer2;
    return points >= this.getMinPatternCost();
  }

  surrender(player: Player): void {
    this.surrenderedPlayer = player;
    if (player === 1) {
      this.pointsPlayer1 = 0;
    } else {
      this.pointsPlayer2 = 0;
    }
    this.isRunning = false;
  }

  getWinner(): {
    winner: Player | null;
    player1Score: number;
    player2Score: number;
  } {
    // Surrender: The other player always wins
    if (this.surrenderedPlayer === 1) {
      return {
        winner: 2,
        player1Score: this.pointsPlayer1,
        player2Score: this.pointsPlayer2,
      };
    } else if (this.surrenderedPlayer === 2) {
      return {
        winner: 1,
        player1Score: this.pointsPlayer1,
        player2Score: this.pointsPlayer2,
      };
    }

    // Normal: Higher points wins
    if (this.pointsPlayer1 > this.pointsPlayer2) {
      return {
        winner: 1,
        player1Score: this.pointsPlayer1,
        player2Score: this.pointsPlayer2,
      };
    } else if (this.pointsPlayer2 > this.pointsPlayer1) {
      return {
        winner: 2,
        player1Score: this.pointsPlayer1,
        player2Score: this.pointsPlayer2,
      };
    } else {
      return {
        winner: null,
        player1Score: this.pointsPlayer1,
        player2Score: this.pointsPlayer2,
      };
    }
  }
}
