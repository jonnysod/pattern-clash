// Game state and Conway's Game of Life logic

import type { Pattern, Player } from "./types.js";
import { Zones } from "./zones.js";

export class Game {
  readonly rows: number;
  readonly cols: number;
  readonly zones: Zones;

  grid: boolean[][];
  isRunning: boolean = false;

  // Score
  scorePlayer1: number = 0;
  scorePlayer2: number = 0;

  // Budget system
  budgetPlayer1: number = 100;
  budgetPlayer2: number = 100;

  constructor(rows: number, cols: number) {
    this.rows = rows;
    this.cols = cols;
    this.zones = new Zones(cols);
    this.grid = this.createEmptyGrid();
  }

  private createEmptyGrid(): boolean[][] {
    return Array(this.rows)
      .fill(null)
      .map(() => Array(this.cols).fill(false));
  }

  reset(): void {
    this.grid = this.createEmptyGrid();
    this.isRunning = false;
    this.scorePlayer1 = 0;
    this.scorePlayer2 = 0;
    this.budgetPlayer1 = 100;
    this.budgetPlayer2 = 100;
  }

  computeNextGeneration(): void {
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

          // Count score
          if (col === this.zones.scoreColumnLeft) {
            this.scorePlayer2++; // Birth in left score-col
          } else if (col === this.zones.scoreColumnRight) {
            this.scorePlayer1++; //  Birth in right score-col
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
    const currentBudget =
      player === 1 ? this.budgetPlayer1 : this.budgetPlayer2;

    if (currentBudget < patternCost) {
      return false; // Not enough budget
    }

    // Place pattern
    for (const [rowOffset, colOffset] of pattern.cells) {
      const row = startRow + rowOffset;
      const col = startCol + colOffset;

      if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
        this.grid[row]![col] = true;
      }
    }

    // Deduct budget
    if (player === 1) {
      this.budgetPlayer1 -= patternCost;
    } else {
      this.budgetPlayer2 -= patternCost;
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
}
