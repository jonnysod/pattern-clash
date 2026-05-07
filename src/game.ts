// Game state, Conway's Game of Life logic, and phase management.

import type {
  Pattern,
  Player,
  GamePhase,
  ScoreEvent,
  BuyInventoryEntry,
  Card,
} from "./types.js";
import { Zones } from "./zones.js";
import { PATTERNS } from "./patterns.js";
import { CONFIG } from "./config.js";
import { getPatternForPlayer } from "./patternUtils.js";

// Valid phase transitions
const VALID_TRANSITIONS: Record<GamePhase, GamePhase[]> = {
  "tactical-buy": ["tactical-place", "ended"],
  "tactical-place": ["simulation", "ended"],
  simulation: ["tactical-buy", "ended"],
  ended: ["tactical-buy"], // restart
};

export class Game {
  readonly rows: number;
  readonly cols: number;
  readonly zones: Zones;

  grid: boolean[][];

  // Phase state
  private _phase: GamePhase = "tactical-buy";
  currentPhaseNumber: number = 1;
  readonly totalPhases: number = CONFIG.PHASE_COUNT;
  currentGeneration: number = 0;
  readonly simGenerations: number = CONFIG.SIM_GENERATIONS;

  // Score (win metric, decoupled from budget)
  scorePlayer1: number = 0;
  scorePlayer2: number = 0;

  // Budget (spending resource, accumulates across phases)
  budgetPlayer1: number =
    CONFIG.BUDGET_PER_PHASE + CONFIG.ADDITIONAL_INITIAL_BUDGET;
  budgetPlayer2: number =
    CONFIG.BUDGET_PER_PHASE + CONFIG.ADDITIONAL_INITIAL_BUDGET;

  // Buy inventory — reset at start of each buy phase
  inventoryPlayer1: BuyInventoryEntry[] = [];
  inventoryPlayer2: BuyInventoryEntry[] = [];

  // Buy-phase confirmation state
  buyConfirmedPlayer1: boolean = false;
  buyConfirmedPlayer2: boolean = false;

  // Card-count of each player's hand at confirm time. Set by
  // applyBuyConfirm. Used at finalizeBuyPhase to size the placeholder
  // hand for a remote player whose inventory we never saw (online).
  expectedHandSizePlayer1: number = 0;
  expectedHandSizePlayer2: number = 0;

  // Hand (for place phase — populated at finalizeBuyPhase)
  handPlayer1: Card[] = [];
  handPlayer2: Card[] = [];

  // Surrender tracking
  surrenderedPlayer: Player | null = null;

  // Score events from last generation (consumed by UI each frame)
  scoreEvents: ScoreEvent[] = [];

  // Internal counter for unique card IDs
  private _nextCardId: number = 1;

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

  get isBuyPhase(): boolean {
    return this._phase === "tactical-buy";
  }
  get isPlacePhase(): boolean {
    return this._phase === "tactical-place";
  }
  get isSimulation(): boolean {
    return this._phase === "simulation";
  }
  get isEnded(): boolean {
    return this._phase === "ended";
  }

  // Starter alternates: P1 starts phases 1, 3, 5; P2 starts 2, 4.
  getPhaseStarter(): Player {
    return this.currentPhaseNumber % 2 === 1 ? 1 : 2;
  }
  //#endregion

  //#region Grid
  private createEmptyGrid(): boolean[][] {
    return Array(this.rows)
      .fill(null)
      .map(() => Array(this.cols).fill(false));
  }

  // Fast grid hash (kept for future sync debugging)
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
  //#endregion

  //#region Reset
  reset(): void {
    this.grid = this.createEmptyGrid();
    this._phase = "tactical-buy";
    this.currentPhaseNumber = 1;
    this.currentGeneration = 0;
    this.scorePlayer1 = 0;
    this.scorePlayer2 = 0;
    this.budgetPlayer1 =
      CONFIG.BUDGET_PER_PHASE + CONFIG.ADDITIONAL_INITIAL_BUDGET;
    this.budgetPlayer2 =
      CONFIG.BUDGET_PER_PHASE + CONFIG.ADDITIONAL_INITIAL_BUDGET;
    this.inventoryPlayer1 = [];
    this.inventoryPlayer2 = [];
    this.buyConfirmedPlayer1 = false;
    this.buyConfirmedPlayer2 = false;
    this.expectedHandSizePlayer1 = 0;
    this.expectedHandSizePlayer2 = 0;
    this.handPlayer1 = [];
    this.handPlayer2 = [];
    this.surrenderedPlayer = null;
    this.scoreEvents = [];
    this._nextCardId = 1;
  }
  //#endregion

  //#region Simulation
  computeNextGeneration(): void {
    this.currentGeneration++;
    this.scoreEvents = [];

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
          if (scoreResult.scores && scoreResult.scorer) {
            if (scoreResult.scorer === 1) {
              this.scorePlayer1 += CONFIG.SCORE_POINTS;
            } else {
              this.scorePlayer2 += CONFIG.SCORE_POINTS;
            }
            this.scoreEvents.push({
              row,
              col,
              scorer: scoreResult.scorer,
              points: CONFIG.SCORE_POINTS,
            });
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

  isSimulationComplete(): boolean {
    return this.currentGeneration >= this.simGenerations;
  }
  //#endregion

  //#region Pattern Placement
  placePattern(
    startRow: number,
    startCol: number,
    pattern: Pattern,
    player: Player,
  ): boolean {
    if (!this.zones.isValidPatternPlacement(pattern, startCol, player)) {
      return false;
    }

    for (const [rowOffset, colOffset] of pattern.cells) {
      const row = startRow + rowOffset;
      const col = startCol + colOffset;
      if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
        this.grid[row]![col] = true;
      }
    }

    return true;
  }
  //#endregion

  //#region Buy Phase: Queries
  getBudget(player: Player): number {
    return player === 1 ? this.budgetPlayer1 : this.budgetPlayer2;
  }

  getInventory(player: Player): BuyInventoryEntry[] {
    return player === 1 ? this.inventoryPlayer1 : this.inventoryPlayer2;
  }

  getSlotCount(player: Player): number {
    return this.getInventory(player).reduce((sum, e) => sum + e.count, 0);
  }

  getCopyCount(player: Player, patternIndex: number): number {
    const entry = this.getInventory(player).find(
      (e) => e.patternIndex === patternIndex,
    );
    return entry?.count ?? 0;
  }

  getPatternPrice(patternIndex: number): number {
    const p = PATTERNS[patternIndex];
    return p ? p.cells.length : 0;
  }

  canBuy(player: Player, patternIndex: number): boolean {
    const price = this.getPatternPrice(patternIndex);
    if (price <= 0) return false;
    if (this.getBudget(player) < price) return false;
    if (this.getSlotCount(player) >= CONFIG.MAX_SLOTS) return false;
    if (this.getCopyCount(player, patternIndex) >= CONFIG.MAX_COPIES_PER_TYPE) {
      return false;
    }
    return true;
  }

  canSell(player: Player, patternIndex: number): boolean {
    return this.getCopyCount(player, patternIndex) > 0;
  }
  //#endregion

  //#region Buy Phase: Mutations
  buyPattern(player: Player, patternIndex: number): boolean {
    if (!this.canBuy(player, patternIndex)) return false;

    const price = this.getPatternPrice(patternIndex);
    const inv = this.getInventory(player);
    const existing = inv.find((e) => e.patternIndex === patternIndex);
    if (existing) {
      existing.count++;
    } else {
      inv.push({ patternIndex, count: 1 });
    }

    if (player === 1) {
      this.budgetPlayer1 -= price;
    } else {
      this.budgetPlayer2 -= price;
    }

    return true;
  }

  sellPattern(player: Player, patternIndex: number): boolean {
    if (!this.canSell(player, patternIndex)) return false;

    const price = this.getPatternPrice(patternIndex);
    const inv = this.getInventory(player);
    const existing = inv.find((e) => e.patternIndex === patternIndex);
    if (!existing) return false;

    existing.count--;
    if (existing.count <= 0) {
      const idx = inv.indexOf(existing);
      inv.splice(idx, 1);
    }

    if (player === 1) {
      this.budgetPlayer1 += price;
    } else {
      this.budgetPlayer2 += price;
    }

    return true;
  }
  //#endregion

  //#region Buy Phase: Confirmation
  isBuyConfirmed(player: Player): boolean {
    return player === 1 ? this.buyConfirmedPlayer1 : this.buyConfirmedPlayer2;
  }

  // Apply a buyConfirm action. Sets the confirmed flag, stores the
  // declared cardCount, and updates the player's budget to the declared
  // remainder. Idempotent: a second call for the same player is a no-op
  // (protects against accidental double-apply).
  //
  // Note: this client may or may not have the player's full inventory.
  // - In hotseat, both players' inventories are local (set via buyPattern),
  //   so remainingBudget equals the already-correct local budget (no-op).
  // - In online, only the local player's inventory is present; the remote
  //   player's inventory stays empty here, and finalizeBuyPhase uses
  //   cardCount instead to build placeholder cards. remainingBudget is
  //   how the remote opponent's budget gets updated to reflect their spend.
  applyBuyConfirm(
    player: Player,
    cardCount: number,
    remainingBudget: number,
  ): void {
    if (this.isBuyConfirmed(player)) return;
    if (player === 1) {
      this.buyConfirmedPlayer1 = true;
      this.expectedHandSizePlayer1 = cardCount;
      this.budgetPlayer1 = remainingBudget;
    } else {
      this.buyConfirmedPlayer2 = true;
      this.expectedHandSizePlayer2 = cardCount;
      this.budgetPlayer2 = remainingBudget;
    }
  }

  bothPlayersConfirmed(): boolean {
    return this.buyConfirmedPlayer1 && this.buyConfirmedPlayer2;
  }

  // Expand both players' inventories into hand cards and transition to
  // place phase. Called by the UI once bothPlayersConfirmed() is true.
  //
  // Card-ID assignment is hardcoded P1 → P2. This is independent of
  // getPhaseStarter(): even if the starter ever becomes configurable
  // (random/manual/loser-starts), card IDs are always assigned in
  // P1→P2 order so they match across clients deterministically.
  finalizeBuyPhase(): void {
    this.handPlayer1 = this.buildHand(
      this.inventoryPlayer1,
      this.expectedHandSizePlayer1,
    );
    this.handPlayer2 = this.buildHand(
      this.inventoryPlayer2,
      this.expectedHandSizePlayer2,
    );
    this.inventoryPlayer1 = [];
    this.inventoryPlayer2 = [];
    this.buyConfirmedPlayer1 = false;
    this.buyConfirmedPlayer2 = false;
    this.expectedHandSizePlayer1 = 0;
    this.expectedHandSizePlayer2 = 0;
    this.setPhase("tactical-place");
  }

  // If the inventory has entries, expand it to real cards (local player
  // or hotseat). Otherwise, build placeholder cards from cardCount
  // (online: this is the remote player whose inventory we never saw).
  // Either way, IDs come from the same _nextCardId counter, so they
  // match across clients.
  private buildHand(inventory: BuyInventoryEntry[], cardCount: number): Card[] {
    if (inventory.length > 0) {
      return this.expandInventoryToHand(inventory);
    }
    const placeholders: Card[] = [];
    for (let i = 0; i < cardCount; i++) {
      placeholders.push({
        id: `c${this._nextCardId++}`,
        patternIndex: -1, // resolved when its placement action arrives
      });
    }
    return placeholders;
  }

  private expandInventoryToHand(inventory: BuyInventoryEntry[]): Card[] {
    const cards: Card[] = [];
    for (const entry of inventory) {
      for (let i = 0; i < entry.count; i++) {
        cards.push({
          id: `c${this._nextCardId++}`,
          patternIndex: entry.patternIndex,
        });
      }
    }
    return cards;
  }
  //#endregion

  //#region Place Phase
  getHand(player: Player): Card[] {
    return player === 1 ? this.handPlayer1 : this.handPlayer2;
  }

  getCardById(player: Player, cardId: string): Card | null {
    return this.getHand(player).find((c) => c.id === cardId) ?? null;
  }

  removeCardById(player: Player, cardId: string): boolean {
    const hand = this.getHand(player);
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return false;
    hand.splice(idx, 1);
    return true;
  }

  // Apply a placement action atomically: resolve the card's
  // patternIndex if it was a placeholder, mirror the pattern for the
  // player, place it on the grid, and remove the card from the hand.
  //
  // `col` is the placement column (already adjusted for player 2 by
  // the caller via getPlacementCol). `patternIndex` is the action's
  // patternIndex; for the local player's own cards it equals the
  // card's patternIndex, and for an unresolved placeholder it sets it.
  applyPlacement(
    player: Player,
    cardId: string,
    patternIndex: number,
    row: number,
    col: number,
  ): boolean {
    const card = this.getCardById(player, cardId);
    if (!card) return false;

    const basePattern = PATTERNS[patternIndex];
    if (!basePattern) return false;

    const pattern = getPatternForPlayer(basePattern, player);
    if (!this.placePattern(row, col, pattern, player)) {
      return false;
    }
    // Resolve placeholder if needed (no-op for already-resolved cards).
    card.patternIndex = patternIndex;
    this.removeCardById(player, cardId);
    return true;
  }

  isPlacePhaseDone(): boolean {
    return this.handPlayer1.length === 0 && this.handPlayer2.length === 0;
  }

  // Called by the UI after the final simulation tick of a phase.
  // Advances currentPhaseNumber or ends the game.
  advanceAfterSimulation(): void {
    if (this.currentPhaseNumber >= this.totalPhases) {
      this._phase = "ended";
      return;
    }
    this.currentPhaseNumber++;
    this.currentGeneration = 0;
    this.setPhase("tactical-buy");
  }
  //#endregion

  //#region End Conditions
  applySurrender(player: Player): void {
    if (this.surrenderedPlayer !== null) return; // idempotent
    this.surrenderedPlayer = player;
    this._phase = "ended";
  }

  getWinner(): {
    winner: Player | null; // null = draw
    player1Score: number;
    player2Score: number;
  } {
    if (this.surrenderedPlayer === 1) {
      return {
        winner: 2,
        player1Score: this.scorePlayer1,
        player2Score: this.scorePlayer2,
      };
    }
    if (this.surrenderedPlayer === 2) {
      return {
        winner: 1,
        player1Score: this.scorePlayer1,
        player2Score: this.scorePlayer2,
      };
    }

    const diff = this.scorePlayer1 - this.scorePlayer2;
    return {
      winner: diff > 0 ? 1 : diff < 0 ? 2 : null, // null = draw
      player1Score: this.scorePlayer1,
      player2Score: this.scorePlayer2,
    };
  }
  //#endregion
}
