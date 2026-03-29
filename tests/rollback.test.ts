// RollbackManager tests
// Run: npx tsx tests/rollback.test.ts
//
// TODO: Extract P2 column offset logic from both ui.ts (executePlace)
//       and rollback.ts (applyPlacement) into a shared function in
//       patternUtils.ts to guarantee consistency.

import { Game } from "../dist/game.js";
import { RollbackManager, type ActionGen } from "../dist/rollback.js";
import { PATTERNS } from "../dist/patterns.js";
import { getPatternForPlayer } from "../dist/patternUtils.js";
import { CONFIG } from "../dist/config.js";

// ─── Minimal test runner ───────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓ ${name}\x1b[0m`);
  } catch (e: any) {
    failed++;
    const msg = e.message || String(e);
    failures.push(`${name}: ${msg}`);
    console.log(`  \x1b[31m✗ ${name}\x1b[0m`);
    console.log(`    \x1b[31m${msg}\x1b[0m`);
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

function assertEqual(actual: any, expected: any, label: string = ""): void {
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected}, got ${actual}`);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function createGame(): Game {
  const cols = CONFIG.CANVAS_WIDTH / CONFIG.CELL_SIZE;
  const rows = CONFIG.CANVAS_HEIGHT / CONFIG.CELL_SIZE;
  return new Game(rows, cols);
}

// Place a Glider — moves across the board, different grid every generation
function placeGlider(game: Game): void {
  const glider = PATTERNS[8]!; // "Glider down": 5 cells, moves diagonally
  game.placePattern(10, 10, glider, 1, true);
}

// Apply a placement the same way RollbackManager does (with P2 offset)
function applyLikeRollback(game: Game, action: ActionGen): void {
  const pattern = PATTERNS[action.patternIndex]!;
  const playerPattern = getPatternForPlayer(pattern, action.player);
  let placementCol = action.col;
  if (action.player === 2) {
    const maxC = Math.max(...playerPattern.cells.map(([, c]) => c));
    placementCol = action.col - maxC;
  }
  game.placePattern(action.row, placementCol, playerPattern, action.player, true);
}

// ─── Tests ─────────────────────────────────────────────────────────

console.log("\n▶ RollbackManager Tests\n");

// --- Snapshot & Restore ---

test("Snapshot + rollback to gen 0 restores original grid", () => {
  const game = createGame();
  placeGlider(game);
  const hashBefore = game.gridHash();

  const rm = new RollbackManager(game);
  rm.takeSnapshot();

  rm.rollback();
  assertEqual(game.gridHash(), hashBefore, "gridHash unchanged");
  assertEqual(game.currentGeneration, 0, "gen unchanged");
});

test("Snapshot preserves points", () => {
  const game = createGame();
  game.pointsPlayer1 = 42;
  game.pointsPlayer2 = 73;

  const rm = new RollbackManager(game);
  rm.takeSnapshot();

  game.pointsPlayer1 = 0;
  game.pointsPlayer2 = 0;

  rm.rollback();
  assertEqual(game.pointsPlayer1, 42, "pointsPlayer1");
  assertEqual(game.pointsPlayer2, 73, "pointsPlayer2");
});

test("Rollback without actions reproduces same result as forward compute", () => {
  const game = createGame();
  placeGlider(game);

  const rm = new RollbackManager(game);
  rm.takeSnapshot();

  for (let i = 0; i < 5; i++) game.computeNextGeneration();
  const hashAt5 = game.gridHash();
  const pointsP1 = game.pointsPlayer1;
  const pointsP2 = game.pointsPlayer2;

  rm.rollback();
  assertEqual(game.currentGeneration, 5, "gen after rollback");
  assertEqual(game.gridHash(), hashAt5, "gridHash after rollback");
  assertEqual(game.pointsPlayer1, pointsP1, "p1 points after rollback");
  assertEqual(game.pointsPlayer2, pointsP2, "p2 points after rollback");
});

test("Snapshot after N generations: rollback works from mid-game", () => {
  const game = createGame();
  placeGlider(game);

  // Simulate 50 generations before taking snapshot (like a real tactical phase at gen 100)
  for (let i = 0; i < 50; i++) game.computeNextGeneration();
  assertEqual(game.currentGeneration, 50, "at gen 50");
  const hashAt50 = game.gridHash();

  const rm = new RollbackManager(game);
  rm.takeSnapshot();

  // Simulate 10 more generations
  for (let i = 0; i < 10; i++) game.computeNextGeneration();
  assertEqual(game.currentGeneration, 60, "at gen 60");
  assert(game.gridHash() !== hashAt50, "grid changed after 10 more gens");

  // Add a remote placement at gen 53 (in the past)
  const remoteAction: ActionGen = {
    player: 2, patternIndex: 2, row: 40, col: 80, generation: 53,
  };
  rm.addAction(remoteAction);
  rm.rollback();

  // Build reference from gen 50
  const refGame = createGame();
  placeGlider(refGame);
  for (let i = 0; i < 53; i++) refGame.computeNextGeneration(); // → gen 53
  applyLikeRollback(refGame, remoteAction);
  for (let i = 0; i < 7; i++) refGame.computeNextGeneration(); // → gen 60

  assertEqual(game.currentGeneration, 60, "gen after rollback");
  assertEqual(game.gridHash(), refGame.gridHash(), "gridHash matches reference");
  assertEqual(game.pointsPlayer1, refGame.pointsPlayer1, "p1 points match");
  assertEqual(game.pointsPlayer2, refGame.pointsPlayer2, "p2 points match");
});

// --- ActionGen Queue ---

test("Actions are sorted by generation", () => {
  const game = createGame();
  const rm = new RollbackManager(game);
  rm.takeSnapshot();

  rm.addAction({ player: 1, patternIndex: 2, row: 10, col: 10, generation: 5 });
  rm.addAction({ player: 2, patternIndex: 3, row: 20, col: 80, generation: 2 });
  rm.addAction({ player: 1, patternIndex: 0, row: 30, col: 15, generation: 5 });

  assertEqual(rm.getActionsForGeneration(2).length, 1, "1 action at gen 2");
  assertEqual(rm.getActionsForGeneration(5).length, 2, "2 actions at gen 5");
  assertEqual(rm.getActionsForGeneration(99).length, 0, "0 actions at gen 99");
});

// --- needsRollback ---

test("needsRollback detects past, current, future correctly", () => {
  const game = createGame();
  placeGlider(game);
  for (let i = 0; i < 10; i++) game.computeNextGeneration();

  const rm = new RollbackManager(game);
  assert(rm.needsRollback(5), "gen 5 < currentGen 10 → needs rollback");
  assert(!rm.needsRollback(10), "gen 10 = currentGen 10 → no rollback");
  assert(!rm.needsRollback(15), "gen 15 > currentGen 10 → no rollback");
});

// --- Rollback with placements ---

test("Rollback replays past-gen remote placement correctly", () => {
  const game = createGame();
  placeGlider(game);

  const rm = new RollbackManager(game);
  rm.takeSnapshot();

  for (let i = 0; i < 5; i++) game.computeNextGeneration();

  const remoteAction: ActionGen = {
    player: 2, patternIndex: 2, row: 30, col: 80, generation: 2,
  };
  rm.addAction(remoteAction);
  rm.rollback();

  const refGame = createGame();
  placeGlider(refGame);
  for (let i = 0; i < 2; i++) refGame.computeNextGeneration();
  applyLikeRollback(refGame, remoteAction);
  for (let i = 0; i < 3; i++) refGame.computeNextGeneration();

  assertEqual(game.gridHash(), refGame.gridHash(), "gridHash matches reference");
  assertEqual(game.pointsPlayer1, refGame.pointsPlayer1, "p1 points match");
  assertEqual(game.pointsPlayer2, refGame.pointsPlayer2, "p2 points match");
  assertEqual(game.currentGeneration, 5, "gen is 5");
});

test("Rollback with multiple placements at different generations", () => {
  const game = createGame();
  placeGlider(game);

  const rm = new RollbackManager(game);
  rm.takeSnapshot();

  const localAction: ActionGen = {
    player: 1, patternIndex: 3, row: 10, col: 15, generation: 1,
  };
  const remoteAction: ActionGen = {
    player: 2, patternIndex: 4, row: 60, col: 85, generation: 2,
  };

  rm.addAction(localAction);
  game.computeNextGeneration(); // → gen 1
  rm.applyPlacement(localAction);
  for (let i = 0; i < 4; i++) game.computeNextGeneration(); // → gen 5

  rm.addAction(remoteAction);
  rm.rollback();

  const refGame = createGame();
  placeGlider(refGame);
  refGame.computeNextGeneration(); // → gen 1
  applyLikeRollback(refGame, localAction);
  refGame.computeNextGeneration(); // → gen 2
  applyLikeRollback(refGame, remoteAction);
  for (let i = 0; i < 3; i++) refGame.computeNextGeneration(); // → gen 5

  assertEqual(game.gridHash(), refGame.gridHash(), "gridHash multi-placement");
  assertEqual(game.currentGeneration, 5, "gen after rollback");
});

// --- Future generation actions ---

test("Future-gen action is applied at correct generation during rollback", () => {
  const game = createGame();
  placeGlider(game);

  const rm = new RollbackManager(game);
  rm.takeSnapshot();

  const futureAction: ActionGen = {
    player: 2, patternIndex: 2, row: 35, col: 70, generation: 3,
  };
  rm.addAction(futureAction);

  for (let i = 0; i < 5; i++) game.computeNextGeneration();

  rm.rollback();

  const refGame = createGame();
  placeGlider(refGame);
  for (let i = 0; i < 3; i++) refGame.computeNextGeneration();
  applyLikeRollback(refGame, futureAction);
  for (let i = 0; i < 2; i++) refGame.computeNextGeneration();

  assertEqual(game.gridHash(), refGame.gridHash(), "future action applied correctly");
});

test("Future-gen action applied tick-by-tick without rollback", () => {
  // Simulates what animateTactical() does: check for queued actions
  // each generation and apply them — no rollback needed.
  const game = createGame();
  placeGlider(game);

  const rm = new RollbackManager(game);
  rm.takeSnapshot();

  // Remote action arrives for gen 3 while we're at gen 0
  const futureAction: ActionGen = {
    player: 2, patternIndex: 2, row: 35, col: 70, generation: 3,
  };
  rm.addAction(futureAction);

  // Simulate tick-by-tick, applying queued actions at each generation
  for (let i = 0; i < 5; i++) {
    const actions = rm.getActionsForGeneration(game.currentGeneration);
    for (const action of actions) {
      rm.applyPlacement(action);
    }
    game.computeNextGeneration();
  }

  // Build reference
  const refGame = createGame();
  placeGlider(refGame);
  for (let i = 0; i < 3; i++) refGame.computeNextGeneration();
  applyLikeRollback(refGame, futureAction);
  for (let i = 0; i < 2; i++) refGame.computeNextGeneration();

  assertEqual(game.gridHash(), refGame.gridHash(), "tick-by-tick matches reference");
  assertEqual(game.currentGeneration, 5, "gen is 5");
});

// --- actionQueueHash ---

test("actionQueueHash is deterministic", () => {
  const game = createGame();
  const rm1 = new RollbackManager(game);
  const rm2 = new RollbackManager(game);

  const actions: ActionGen[] = [
    { player: 1, patternIndex: 0, row: 10, col: 20, generation: 1 },
    { player: 2, patternIndex: 3, row: 50, col: 80, generation: 3 },
  ];
  for (const a of actions) { rm1.addAction(a); rm2.addAction(a); }

  assertEqual(rm1.actionQueueHash(), rm2.actionQueueHash(), "same actions → same hash");
});

test("actionQueueHash differs for different actions", () => {
  const game = createGame();
  const rm1 = new RollbackManager(game);
  const rm2 = new RollbackManager(game);

  rm1.addAction({ player: 1, patternIndex: 0, row: 10, col: 20, generation: 1 });
  rm2.addAction({ player: 1, patternIndex: 0, row: 10, col: 21, generation: 1 });

  assert(rm1.actionQueueHash() !== rm2.actionQueueHash(), "different actions → different hash");
});

// --- Clear ---

test("clear() resets all state", () => {
  const game = createGame();
  const rm = new RollbackManager(game);
  rm.takeSnapshot();
  rm.addAction({ player: 1, patternIndex: 0, row: 10, col: 20, generation: 1 });

  rm.clear();

  assertEqual(rm.getActionsForGeneration(1).length, 0, "queue empty");
  assert(!rm.rollback(), "rollback returns false (no snapshot)");
});

// --- P2 column offset ---

test("applyPlacement handles P2 column offset correctly", () => {
  const game = createGame();
  const rm = new RollbackManager(game);

  rm.applyPlacement({ player: 2, patternIndex: 2, row: 50, col: 80, generation: 0 });

  assert(game.grid[50]![79], "cell (50,79) alive");
  assert(game.grid[50]![80], "cell (50,80) alive");
  assert(game.grid[51]![79], "cell (51,79) alive");
  assert(game.grid[51]![80], "cell (51,80) alive");
});

// --- Cross-client determinism ---

test("Two independent rollbacks with same actions produce identical results", () => {
  const actions: ActionGen[] = [
    { player: 1, patternIndex: 5, row: 20, col: 20, generation: 1 },
    { player: 2, patternIndex: 2, row: 60, col: 75, generation: 3 },
    { player: 1, patternIndex: 3, row: 40, col: 30, generation: 3 },
  ];

  const gameA = createGame();
  placeGlider(gameA);
  const rmA = new RollbackManager(gameA);
  rmA.takeSnapshot();
  for (const a of actions) rmA.addAction(a);
  for (let i = 0; i < 5; i++) gameA.computeNextGeneration();
  rmA.rollback();

  const gameB = createGame();
  placeGlider(gameB);
  const rmB = new RollbackManager(gameB);
  rmB.takeSnapshot();
  for (const a of actions) rmB.addAction(a);
  for (let i = 0; i < 5; i++) gameB.computeNextGeneration();
  rmB.rollback();

  assertEqual(gameA.gridHash(), gameB.gridHash(), "gridHash identical");
  assertEqual(gameA.pointsPlayer1, gameB.pointsPlayer1, "p1 points identical");
  assertEqual(gameA.pointsPlayer2, gameB.pointsPlayer2, "p2 points identical");
  assertEqual(rmA.actionQueueHash(), rmB.actionQueueHash(), "actionHash identical");
});

// ─── Summary ───────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: \x1b[32m${passed} passed\x1b[0m, ${failed > 0 ? `\x1b[31m${failed} failed\x1b[0m` : `${failed} failed`}\n`);

if (failures.length > 0) {
  console.log("\x1b[31mFailures:\x1b[0m");
  for (const f of failures) console.log(`  \x1b[31m• ${f}\x1b[0m`);
  process.exit(1);
}