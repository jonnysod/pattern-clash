// Rollback netcode for tactical phase synchronization
//
// Both clients simulate optimistically. When a remote placement arrives
// tagged with a past generation, the manager rolls the grid back to the
// tactical-phase snapshot, replays all ActionGens in order, and
// resimulates forward to the current generation.

import type { Player } from "./types.js";
import { Game } from "./game.js";
import { PATTERNS } from "./patterns.js";
import { getPatternForPlayer } from "./patternUtils.js";

// A placement tagged with the generation it was made at
export interface ActionGen {
  player: Player;
  patternIndex: number;
  row: number;
  col: number;
  generation: number; // "placed between gen N and gen N+1"
}

// Snapshot of game state at the start of a tactical phase
interface Snapshot {
  grid: boolean[][];
  pointsPlayer1: number;
  pointsPlayer2: number;
  generation: number;
}

export class RollbackManager {
  private game: Game;
  private snapshot: Snapshot | null = null;
  private actionQueue: ActionGen[] = [];

  constructor(game: Game) {
    this.game = game;
  }

  // Call at the start of each tactical phase
  takeSnapshot(): void {
    this.snapshot = {
      grid: this.deepCopyGrid(this.game.grid),
      pointsPlayer1: this.game.pointsPlayer1,
      pointsPlayer2: this.game.pointsPlayer2,
      generation: this.game.currentGeneration,
    };
    this.actionQueue = [];

    console.log(
      `[Rollback] Snapshot taken at gen=${this.snapshot.generation} hash=${this.game.gridHash()}`,
    );
  }

  // Record a placement (local or remote) into the queue
  addAction(action: ActionGen): void {
    this.actionQueue.push(action);
    // Keep sorted by generation (stable: preserve insertion order within same gen)
    this.actionQueue.sort((a, b) => a.generation - b.generation);
  }

  // Check if a remote action requires rollback (its generation is in the past)
  needsRollback(actionGeneration: number): boolean {
    return actionGeneration < this.game.currentGeneration;
  }

  // Get all queued actions for the given generation
  getActionsForGeneration(generation: number): ActionGen[] {
    return this.actionQueue.filter((a) => a.generation === generation);
  }

  // Apply a single placement to the game grid (used during normal play and resimulation)
  applyPlacement(action: ActionGen): boolean {
    const pattern = PATTERNS[action.patternIndex];
    if (!pattern) return false;

    const playerPattern = getPatternForPlayer(pattern, action.player);

    // P2: offset so pattern is placed left of cursor column
    let placementCol = action.col;
    if (action.player === 2) {
      const maxC = Math.max(...playerPattern.cells.map(([, c]) => c));
      placementCol = action.col - maxC;
    }

    return this.game.placePattern(
      action.row,
      placementCol,
      playerPattern,
      action.player,
      true, // skipZoneCheck
    );
  }

  // Perform a full rollback: restore snapshot, replay all actions, resimulate
  // Returns true if rollback was performed successfully.
  rollback(): boolean {
    if (!this.snapshot) {
      console.warn("[Rollback] No snapshot available, cannot rollback");
      return false;
    }

    const targetGeneration = this.game.currentGeneration;

    console.log(
      `[Rollback] Rolling back from gen=${targetGeneration} to snapshot gen=${this.snapshot.generation}, replaying ${this.actionQueue.length} actions`,
    );

    // Step 1: Restore grid and points from snapshot
    this.game.grid = this.deepCopyGrid(this.snapshot.grid);
    this.game.pointsPlayer1 = this.snapshot.pointsPlayer1;
    this.game.pointsPlayer2 = this.snapshot.pointsPlayer2;
    this.game.currentGeneration = this.snapshot.generation;

    // Step 2: Replay generation by generation from snapshot to target
    for (let gen = this.snapshot.generation; gen < targetGeneration; gen++) {
      // Apply all placements for this generation
      const actions = this.actionQueue.filter((a) => a.generation === gen);
      for (const action of actions) {
        this.applyPlacement(action);
      }

      // Compute next generation (score events will be overwritten each time, that's fine)
      this.game.computeNextGeneration();
    }

    // Step 3: Apply placements for the current (target) generation
    // (these haven't been "consumed" by a computeNextGeneration yet)
    const currentActions = this.actionQueue.filter(
      (a) => a.generation === targetGeneration,
    );
    for (const action of currentActions) {
      this.applyPlacement(action);
    }

    console.log(
      `[Rollback] Resimulated to gen=${this.game.currentGeneration} hash=${this.game.gridHash()} p1=${this.game.pointsPlayer1} p2=${this.game.pointsPlayer2}`,
    );

    return true;
  }

  // Compute a hash of the ActionGen queue (for sync debugging)
  actionQueueHash(): number {
    let hash = 0;
    for (const a of this.actionQueue) {
      hash = (hash * 31 + a.generation * 1000 + a.patternIndex * 100 + a.row * 10 + a.col) | 0;
      hash = (hash * 7 + a.player) | 0;
    }
    return hash;
  }

  // Format a sync status log for the current state
  formatSyncLog(phase: string, localPlayer: Player): string {
    const lines: string[] = [];
    lines.push(`[SyncCheck] Phase: ${phase}`);
    lines.push(
      `  gen=${this.game.currentGeneration} gridHash=${this.game.gridHash()} ` +
      `points=${this.game.pointsPlayer1}/${this.game.pointsPlayer2} ` +
      `actionGens=${this.actionQueue.length} actionHash=${this.actionQueueHash()} ` +
      `player=P${localPlayer}`,
    );
    if (this.actionQueue.length > 0) {
      const summary = this.actionQueue
        .map((a) => `P${a.player}@gen${a.generation}:pat${a.patternIndex}(${a.row},${a.col})`)
        .join(" ");
      lines.push(`  actions: ${summary}`);
    }
    return lines.join("\n");
  }

  // Clean up when tactical phase ends
  clear(): void {
    this.snapshot = null;
    this.actionQueue = [];
  }

  private deepCopyGrid(grid: boolean[][]): boolean[][] {
    return grid.map((row) => [...row]);
  }
}
