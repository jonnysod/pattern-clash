// Tests for Game (state machine, buy/place logic, simulation, scoring).

import { describe, it, expect, beforeEach } from "vitest";
import { Game } from "../src/game.js";
import { CONFIG } from "../src/config.js";
import { PATTERNS } from "../src/patterns.js";
import {
  makeGame,
  TEST_ROWS,
  TEST_COLS,
  BLOCK_INDEX,
  BLINKER_INDEX,
  LWSS_INDEX,
} from "./_helpers.js";

const INITIAL_BUDGET =
  CONFIG.BUDGET_PER_PHASE + CONFIG.ADDITIONAL_INITIAL_BUDGET;

describe("Game — Buy Logic", () => {
  let game: Game;
  beforeEach(() => {
    game = makeGame();
  });

  it("starts both players with the initial budget", () => {
    expect(game.getBudget(1)).toBe(INITIAL_BUDGET);
    expect(game.getBudget(2)).toBe(INITIAL_BUDGET);
  });

  it("buyPattern reduces budget and increases inventory count", () => {
    const price = game.getPatternPrice(BLOCK_INDEX);
    const ok = game.buyPattern(1, BLOCK_INDEX);
    expect(ok).toBe(true);
    expect(game.getBudget(1)).toBe(INITIAL_BUDGET - price);
    expect(game.getCopyCount(1, BLOCK_INDEX)).toBe(1);
    expect(game.getSlotCount(1)).toBe(1);
  });

  it("buyPattern fails when budget is too low", () => {
    // Drain budget down to under the price of a Block (4 cells)
    game.budgetPlayer1 = 2;
    const ok = game.buyPattern(1, BLOCK_INDEX);
    expect(ok).toBe(false);
    expect(game.getCopyCount(1, BLOCK_INDEX)).toBe(0);
    expect(game.getBudget(1)).toBe(2);
  });

  it("canBuy returns false when MAX_SLOTS is reached", () => {
    // Fill up slots with the cheapest pattern (Blinker = 3 cells)
    game.budgetPlayer1 = 1000;
    for (let i = 0; i < CONFIG.MAX_SLOTS; i++) {
      // Cycle through a few patterns to avoid hitting copy limit
      const idx = i % 4 === 0 ? BLINKER_INDEX : i % 4 === 1 ? BLOCK_INDEX : i % 4 === 2 ? 3 : 4;
      game.buyPattern(1, idx);
    }
    expect(game.getSlotCount(1)).toBe(CONFIG.MAX_SLOTS);
    expect(game.canBuy(1, BLINKER_INDEX)).toBe(false);
  });

  it("canBuy returns false when MAX_COPIES_PER_TYPE is reached", () => {
    game.budgetPlayer1 = 1000;
    for (let i = 0; i < CONFIG.MAX_COPIES_PER_TYPE; i++) {
      expect(game.buyPattern(1, BLINKER_INDEX)).toBe(true);
    }
    expect(game.canBuy(1, BLINKER_INDEX)).toBe(false);
    expect(game.buyPattern(1, BLINKER_INDEX)).toBe(false);
  });

  it("sellPattern refunds budget and decrements count", () => {
    const price = game.getPatternPrice(BLOCK_INDEX);
    game.buyPattern(1, BLOCK_INDEX);
    game.buyPattern(1, BLOCK_INDEX);
    const budgetAfterBuys = game.getBudget(1);

    const ok = game.sellPattern(1, BLOCK_INDEX);
    expect(ok).toBe(true);
    expect(game.getBudget(1)).toBe(budgetAfterBuys + price);
    expect(game.getCopyCount(1, BLOCK_INDEX)).toBe(1);
  });

  it("sellPattern removes the inventory entry when count reaches 0", () => {
    game.buyPattern(1, BLOCK_INDEX);
    game.sellPattern(1, BLOCK_INDEX);
    expect(game.getInventory(1)).toEqual([]);
    expect(game.getCopyCount(1, BLOCK_INDEX)).toBe(0);
  });

  it("canSell is false without any purchased copy", () => {
    expect(game.canSell(1, BLOCK_INDEX)).toBe(false);
    expect(game.sellPattern(1, BLOCK_INDEX)).toBe(false);
  });

  it("confirmBuy sets the flag and bothPlayersConfirmed reflects state", () => {
    expect(game.bothPlayersConfirmed()).toBe(false);
    game.confirmBuy(1);
    expect(game.isBuyConfirmed(1)).toBe(true);
    expect(game.bothPlayersConfirmed()).toBe(false);
    game.confirmBuy(2);
    expect(game.bothPlayersConfirmed()).toBe(true);
  });

  it("finalizeBuyPhase expands inventory to hand, clears inventory, and transitions to place phase", () => {
    game.buyPattern(1, BLOCK_INDEX);
    game.buyPattern(1, BLOCK_INDEX);
    game.buyPattern(1, BLINKER_INDEX);
    game.buyPattern(2, LWSS_INDEX);

    game.finalizeBuyPhase();

    expect(game.getHand(1)).toHaveLength(3);
    expect(game.getHand(2)).toHaveLength(1);
    expect(game.getInventory(1)).toEqual([]);
    expect(game.getInventory(2)).toEqual([]);
    expect(game.isBuyConfirmed(1)).toBe(false);
    expect(game.isBuyConfirmed(2)).toBe(false);
    expect(game.phase).toBe("tactical-place");

    // Each card must have a unique ID
    const ids = game.getHand(1).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Game — Place Logic", () => {
  let game: Game;
  beforeEach(() => {
    game = makeGame();
  });

  it("placePattern succeeds in the player's own zone", () => {
    const block = PATTERNS[BLOCK_INDEX]!;
    // P1 zone: cols [endzoneLeftEnd, leftEnd) — well inside that range.
    const startCol = game.zones.endzoneLeftEnd + 5;
    const ok = game.placePattern(20, startCol, block, 1);
    expect(ok).toBe(true);
    expect(game.grid[20]![startCol]).toBe(true);
    expect(game.grid[21]![startCol + 1]).toBe(true);
  });

  it("placePattern symmetrically succeeds for P2 in their own zone", () => {
    const block = PATTERNS[BLOCK_INDEX]!;
    const startCol = game.zones.rightStart + 5;
    const ok = game.placePattern(20, startCol, block, 2);
    expect(ok).toBe(true);
    expect(game.grid[20]![startCol]).toBe(true);
  });

  it("placePattern fails when placing in the opponent's zone", () => {
    const block = PATTERNS[BLOCK_INDEX]!;
    const startCol = game.zones.rightStart + 5; // P2's zone
    const ok = game.placePattern(20, startCol, block, 1); // P1 trying
    expect(ok).toBe(false);
    expect(game.grid[20]![startCol]).toBe(false);
  });

  it("placePattern fails when the pattern would extend out of the player's zone", () => {
    const block = PATTERNS[BLOCK_INDEX]!;
    // Block has cells [0,0],[0,1],[1,0],[1,1] → maxOffset=1.
    // Place such that rightCol == leftEnd (just outside P1 zone).
    const startCol = game.zones.leftEnd - 1;
    const ok = game.placePattern(20, startCol, block, 1);
    expect(ok).toBe(false);
  });

  it("removeCardById removes a card from the hand", () => {
    game.buyPattern(1, BLOCK_INDEX);
    game.finalizeBuyPhase();
    const card = game.getHand(1)[0]!;
    expect(game.removeCardById(1, card.id)).toBe(true);
    expect(game.getHand(1)).toHaveLength(0);
    expect(game.removeCardById(1, card.id)).toBe(false); // gone now
  });

  it("isPlacePhaseDone is true only when both hands are empty", () => {
    game.buyPattern(1, BLOCK_INDEX);
    game.buyPattern(2, BLOCK_INDEX);
    game.finalizeBuyPhase();
    expect(game.isPlacePhaseDone()).toBe(false);

    const c1 = game.getHand(1)[0]!;
    game.removeCardById(1, c1.id);
    expect(game.isPlacePhaseDone()).toBe(false);

    const c2 = game.getHand(2)[0]!;
    game.removeCardById(2, c2.id);
    expect(game.isPlacePhaseDone()).toBe(true);
  });

  it("getPhaseStarter alternates: P1 in odd phases, P2 in even phases", () => {
    game.currentPhaseNumber = 1;
    expect(game.getPhaseStarter()).toBe(1);
    game.currentPhaseNumber = 2;
    expect(game.getPhaseStarter()).toBe(2);
    game.currentPhaseNumber = 3;
    expect(game.getPhaseStarter()).toBe(1);
    game.currentPhaseNumber = 4;
    expect(game.getPhaseStarter()).toBe(2);
    game.currentPhaseNumber = 5;
    expect(game.getPhaseStarter()).toBe(1);
  });
});

describe("Game — Simulation & Scoring", () => {
  let game: Game;
  beforeEach(() => {
    game = makeGame();
  });

  it("a horizontal blinker oscillates back to horizontal after 2 generations", () => {
    // Place horizontal blinker at row 20, cols 10–12 (inside P1 zone, well clear of borders)
    game.grid[20]![10] = true;
    game.grid[20]![11] = true;
    game.grid[20]![12] = true;

    game.computeNextGeneration();
    // Now vertical: (19,11), (20,11), (21,11)
    expect(game.grid[19]![11]).toBe(true);
    expect(game.grid[20]![11]).toBe(true);
    expect(game.grid[21]![11]).toBe(true);
    expect(game.grid[20]![10]).toBe(false);
    expect(game.grid[20]![12]).toBe(false);

    game.computeNextGeneration();
    // Back to horizontal
    expect(game.grid[20]![10]).toBe(true);
    expect(game.grid[20]![11]).toBe(true);
    expect(game.grid[20]![12]).toBe(true);
  });

  it("a cell born in the right score zone awards P1 a point and emits a ScoreEvent", () => {
    // Place 3 cells one column left of the right score column so that
    // the cell at (50, scoreColumnRight) is born next generation.
    const sc = game.zones.scoreColumnRight;
    game.grid[49]![sc - 1] = true;
    game.grid[50]![sc - 1] = true;
    game.grid[51]![sc - 1] = true;

    const beforeScore = game.scorePlayer1;
    game.computeNextGeneration();

    expect(game.grid[50]![sc]).toBe(true);
    expect(game.scorePlayer1).toBe(beforeScore + CONFIG.SCORE_POINTS);
    expect(game.scoreEvents).toHaveLength(1);
    expect(game.scoreEvents[0]).toMatchObject({
      row: 50,
      col: sc,
      scorer: 1,
      points: CONFIG.SCORE_POINTS,
    });
  });

  it("a cell born in the left score zone awards P2 a point", () => {
    const sc = game.zones.scoreColumnLeft;
    game.grid[49]![sc + 1] = true;
    game.grid[50]![sc + 1] = true;
    game.grid[51]![sc + 1] = true;

    game.computeNextGeneration();
    expect(game.grid[50]![sc]).toBe(true);
    expect(game.scorePlayer2).toBe(CONFIG.SCORE_POINTS);
    expect(game.scoreEvents[0]?.scorer).toBe(2);
  });

  it("isSimulationComplete is true after exactly SIM_GENERATIONS ticks", () => {
    expect(game.isSimulationComplete()).toBe(false);
    for (let i = 0; i < game.simGenerations; i++) {
      game.computeNextGeneration();
    }
    expect(game.currentGeneration).toBe(game.simGenerations);
    expect(game.isSimulationComplete()).toBe(true);
  });

  it("scoreEvents is reset at the start of each generation", () => {
    const sc = game.zones.scoreColumnRight;
    game.grid[49]![sc - 1] = true;
    game.grid[50]![sc - 1] = true;
    game.grid[51]![sc - 1] = true;

    game.computeNextGeneration();
    expect(game.scoreEvents.length).toBeGreaterThan(0);

    // Next gen: nothing scoring expected (the original 3 cells are now
    // mostly dead; we don't assert what's left, just that scoreEvents resets).
    game.computeNextGeneration();
    expect(game.scoreEvents).toEqual([]);
  });
});

describe("Game — End Conditions & Phase Flow", () => {
  let game: Game;
  beforeEach(() => {
    game = makeGame();
  });

  it("getWinner: higher score wins", () => {
    game.scorePlayer1 = 5;
    game.scorePlayer2 = 3;
    const r = game.getWinner();
    expect(r.winner).toBe(1);
    expect(r.player1Score).toBe(5);
    expect(r.player2Score).toBe(3);

    game.scorePlayer1 = 1;
    game.scorePlayer2 = 9;
    expect(game.getWinner().winner).toBe(2);
  });

  it("getWinner: equal scores produce a draw (winner = null)", () => {
    game.scorePlayer1 = 4;
    game.scorePlayer2 = 4;
    expect(game.getWinner().winner).toBe(null);
  });

  it("getWinner: a surrendered player loses, regardless of score", () => {
    game.scorePlayer1 = 100;
    game.scorePlayer2 = 0;
    game.surrender(1);
    expect(game.phase).toBe("ended");
    expect(game.getWinner().winner).toBe(2);
  });

  it("advanceAfterSimulation in a non-final phase increments and returns to buy phase", () => {
    game.currentPhaseNumber = 2;
    game.setPhase("tactical-place");
    game.setPhase("simulation");
    game.currentGeneration = 150;

    game.advanceAfterSimulation();
    expect(game.currentPhaseNumber).toBe(3);
    expect(game.currentGeneration).toBe(0);
    expect(game.phase).toBe("tactical-buy");
  });

  it("advanceAfterSimulation in the final phase ends the game", () => {
    game.currentPhaseNumber = game.totalPhases;
    game.setPhase("tactical-place");
    game.setPhase("simulation");

    game.advanceAfterSimulation();
    expect(game.phase).toBe("ended");
    expect(game.currentPhaseNumber).toBe(game.totalPhases);
  });
});
