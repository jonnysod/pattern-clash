// SyncManager tests
// Run: npx tsx tests/syncManager.test.ts
//
// Tests the sync state machine in isolation using mock Network and SyncCallbacks.
// No DOM, no Canvas, no Firebase — pure logic tests.

import { Game } from "../dist/game.js";
import { SyncManager, type SyncCallbacks } from "../dist/syncManager.js";
import { RollbackManager } from "../dist/rollback.js";
import type { GameAction } from "../dist/network.js";
import type { Player } from "../dist/types.js";
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

// ─── Mock Network ──────────────────────────────────────────────────

interface MockNetwork {
  localPlayer: Player;
  onRemoteAction: ((action: GameAction) => void) | null;
  onRemotePhaseReady: ((counter: number) => void) | null;
  onRemoteSyncHash: ((syncHash: string) => void) | null;

  sendAction(action: GameAction): void;
  sendPhaseReady(): void;
  sendPhaseReadyWithSync(syncHash: string): void;

  // Test inspection
  sentActions: GameAction[];
  phaseReadySent: number;
  phaseReadyWithSyncSent: { count: number; lastHash: string | null };
}

function createMockNetwork(localPlayer: Player): MockNetwork {
  return {
    localPlayer,
    onRemoteAction: null,
    onRemotePhaseReady: null,
    onRemoteSyncHash: null,

    sentActions: [],
    phaseReadySent: 0,
    phaseReadyWithSyncSent: { count: 0, lastHash: null },

    sendAction(action: GameAction) {
      this.sentActions.push(action);
    },
    sendPhaseReady() {
      this.phaseReadySent++;
    },
    sendPhaseReadyWithSync(syncHash: string) {
      this.phaseReadyWithSyncSent.count++;
      this.phaseReadyWithSyncSent.lastHash = syncHash;
    },
  };
}

// ─── Mock SyncCallbacks ────────────────────────────────────────────

interface CallLog {
  startSimulation: number;
  beginTacticalPhaseAfterSync: number;
  executePlace: {
    player: Player;
    patternIndex: number;
    row: number;
    col: number;
  }[];
  executeSelectPattern: { player: Player; patternIndex: number }[];
  executeSurrender: Player[];
  handleTurnAction: number;
  markPlayerDone: Player[];
  enterSimulationPhase: number;
  stopAnimationAndClock: number;
  refreshDisplay: number;
  showWaitingOverlay: number;
  hideWaitingOverlay: number;
}

function createMockCallbacks(): { callbacks: SyncCallbacks; log: CallLog } {
  const log: CallLog = {
    startSimulation: 0,
    beginTacticalPhaseAfterSync: 0,
    executePlace: [],
    executeSelectPattern: [],
    executeSurrender: [],
    handleTurnAction: 0,
    markPlayerDone: [],
    enterSimulationPhase: 0,
    stopAnimationAndClock: 0,
    refreshDisplay: 0,
    showWaitingOverlay: 0,
    hideWaitingOverlay: 0,
  };

  const callbacks: SyncCallbacks = {
    startSimulation: () => {
      log.startSimulation++;
    },
    beginTacticalPhaseAfterSync: () => {
      log.beginTacticalPhaseAfterSync++;
    },
    executePlace: (player, patternIndex, row, col) => {
      log.executePlace.push({ player, patternIndex, row, col });
      return true;
    },
    executeSelectPattern: (player, patternIndex) => {
      log.executeSelectPattern.push({ player, patternIndex });
    },
    executeSurrender: (player) => {
      log.executeSurrender.push(player);
    },
    handleTurnAction: () => {
      log.handleTurnAction++;
    },
    markPlayerDone: (player) => {
      log.markPlayerDone.push(player);
    },
    enterSimulationPhase: () => {
      log.enterSimulationPhase++;
    },
    stopAnimationAndClock: () => {
      log.stopAnimationAndClock++;
    },
    refreshDisplay: () => {
      log.refreshDisplay++;
    },
    showWaitingOverlay: () => {
      log.showWaitingOverlay++;
    },
    hideWaitingOverlay: () => {
      log.hideWaitingOverlay++;
    },
  };

  return { callbacks, log };
}

// ─── Helpers ───────────────────────────────────────────────────────

function createGame(): Game {
  const cols = CONFIG.CANVAS_WIDTH / CONFIG.CELL_SIZE;
  const rows = CONFIG.CANVAS_HEIGHT / CONFIG.CELL_SIZE;
  return new Game(rows, cols);
}

function createTestSetup(localPlayer: Player = 1) {
  const game = createGame();
  const net = createMockNetwork(localPlayer);
  const { callbacks, log } = createMockCallbacks();
  // SyncManager constructor wires network callbacks, cast to any to satisfy
  // the type — mock has the same shape as Network for what SyncManager uses.
  const sync = new SyncManager(net as any, game, localPlayer, callbacks);
  return { game, net, sync, log };
}

// Simulate remote phaseReady arriving (triggers the callback SyncManager wired)
function fireRemotePhaseReady(net: MockNetwork, counter: number): void {
  net.onRemotePhaseReady?.(counter);
}

// Simulate remote action arriving
function fireRemoteAction(net: MockNetwork, action: GameAction): void {
  net.onRemoteAction?.(action);
}

// Simulate remote syncHash arriving
function fireRemoteSyncHash(net: MockNetwork, hash: string): void {
  net.onRemoteSyncHash?.(hash);
}

// Build a sync hash string matching the game's current state
function buildMatchingSyncHash(game: Game): string {
  return `${game.currentGeneration}|${game.gridHash()}|${game.pointsPlayer1}|${game.pointsPlayer2}|0`;
}

// ─── Tests ─────────────────────────────────────────────────────────

console.log("\n▶ SyncManager Tests\n");

// ── Phase-Ready Handshake ──────────────────────────────────────────

console.log("\n  Phase-Ready Handshake\n");

test("Placement done: local first, then remote → startSimulation", () => {
  const { net, sync, log } = createTestSetup();

  sync.onPlacementDone();
  assertEqual(net.phaseReadySent, 1, "phaseReady sent");
  assertEqual(log.startSimulation, 0, "simulation not started yet");

  fireRemotePhaseReady(net, 1);
  assertEqual(log.startSimulation, 1, "simulation started after remote ready");
});

test("Placement done: remote first, then local → startSimulation", () => {
  const { net, sync, log } = createTestSetup();

  // Remote ready arrives before local calls onPlacementDone
  fireRemotePhaseReady(net, 1);
  assertEqual(
    log.startSimulation,
    0,
    "simulation not started yet (no local ready)",
  );

  sync.onPlacementDone();
  assertEqual(net.phaseReadySent, 1, "phaseReady sent");
  assertEqual(log.startSimulation, 1, "simulation started immediately");
});

test("Tactical start: local first, then remote → beginTacticalPhaseAfterSync", () => {
  const { net, sync, log } = createTestSetup();

  // First handshake (placement→simulation) — complete it
  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  assertEqual(log.startSimulation, 1, "simulation started");

  // Second handshake (simulation→tactical)
  sync.onTacticalStart();
  assertEqual(log.showWaitingOverlay, 1, "overlay shown");
  assertEqual(net.phaseReadySent, 2, "second phaseReady sent");
  assertEqual(log.beginTacticalPhaseAfterSync, 0, "tactical not started yet");

  fireRemotePhaseReady(net, 2);
  assertEqual(log.beginTacticalPhaseAfterSync, 1, "tactical started");
  assertEqual(log.hideWaitingOverlay, 1, "overlay hidden");
});

test("Tactical start: remote first, then local → beginTacticalPhaseAfterSync", () => {
  const { net, sync, log } = createTestSetup();

  // Complete first handshake
  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);

  // Remote ready for tactical arrives early
  fireRemotePhaseReady(net, 2);
  assertEqual(
    log.beginTacticalPhaseAfterSync,
    0,
    "tactical not started (no local ready)",
  );

  sync.onTacticalStart();
  assertEqual(
    log.beginTacticalPhaseAfterSync,
    1,
    "tactical started immediately",
  );
});

test("Multiple handshakes: counters track correctly across phases", () => {
  const { net, sync, log } = createTestSetup();

  // Handshake 1: placement → simulation
  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  assertEqual(log.startSimulation, 1, "first simulation started");

  // Handshake 2: simulation → tactical
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 2);
  assertEqual(log.beginTacticalPhaseAfterSync, 1, "tactical started");

  // Now set up tactical done → handshake 3: tactical → simulation
  // Set game to tactical phase so done action routes correctly
  // (initTacticalPhase already called by handshake 2 completion)
  assert(sync.hasRollback, "rollback manager created");
});

// ── Tactical Done Tracking ─────────────────────────────────────────

console.log("\n  Tactical Done Tracking\n");

test("Local done first, then remote done → sync starts", () => {
  const { game, net, sync, log } = createTestSetup();

  // Complete placement + tactical handshakes to get into tactical phase
  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 2);

  // Set game phase to tactical (normally done by UIController)
  game.setPhase("simulation"); // valid: placement → simulation (done by handshake)
  game.setPhase("tactical"); // valid: simulation → tactical

  // Local done
  sync.onLocalTacticalDone();
  assertEqual(log.markPlayerDone.length, 1, "local player marked done");
  assertEqual(log.markPlayerDone[0], 1, "P1 marked done");
  assertEqual(net.sentActions.length, 1, "done action sent");
  assertEqual(net.sentActions[0]!.type, "done", "action type is done");
  assertEqual(
    log.stopAnimationAndClock,
    0,
    "not stopped yet (waiting for remote)",
  );

  // Remote done
  fireRemoteAction(net, { type: "done", player: 2 });
  assertEqual(log.markPlayerDone.length, 2, "remote player also marked done");
  assertEqual(log.stopAnimationAndClock, 1, "animation+clock stopped");
  assertEqual(log.enterSimulationPhase, 1, "entered simulation phase");
  assertEqual(
    log.showWaitingOverlay,
    2,
    "overlay shown for sync (1 for tactical start + 1 for sync)",
  );
});

test("Remote done first, then local done → sync starts", () => {
  const { game, net, sync, log } = createTestSetup();

  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 2);
  game.setPhase("simulation");
  game.setPhase("tactical");

  // Remote done first
  fireRemoteAction(net, { type: "done", player: 2 });
  assertEqual(log.markPlayerDone.length, 1, "remote marked done");
  assertEqual(log.stopAnimationAndClock, 0, "not stopped yet");

  // Local done
  sync.onLocalTacticalDone();
  assertEqual(log.stopAnimationAndClock, 1, "now stopped");
  assertEqual(log.enterSimulationPhase, 1, "entered simulation phase");
});

test("Local done is idempotent (double-fire guard)", () => {
  const { game, net, sync, log } = createTestSetup();

  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 2);
  game.setPhase("simulation");
  game.setPhase("tactical");

  sync.onLocalTacticalDone();
  sync.onLocalTacticalDone(); // second call
  assertEqual(net.sentActions.length, 1, "only one done action sent");
  assertEqual(log.markPlayerDone.length, 1, "markPlayerDone called once");
});

test("Remote done is idempotent (double-fire guard)", () => {
  const { game, net, sync, log } = createTestSetup();

  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 2);
  game.setPhase("simulation");
  game.setPhase("tactical");

  fireRemoteAction(net, { type: "done", player: 2 });
  fireRemoteAction(net, { type: "done", player: 2 }); // duplicate
  assertEqual(log.markPlayerDone.length, 1, "markPlayerDone called once");
});

test("Tactical done flags are reset after completeTacticalSync (no stale state for next tactical)", () => {
  const { game, net, sync, log } = createTestSetup();

  // First tactical phase: full cycle
  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 2);
  game.setPhase("simulation");
  game.setPhase("tactical");

  sync.onLocalTacticalDone();
  fireRemoteAction(net, { type: "done", player: 2 });

  const matchingHash = buildMatchingSyncHash(game);
  fireRemotePhaseReady(net, 3);
  fireRemoteSyncHash(net, matchingHash);

  assertEqual(log.startSimulation, 2, "first tactical sync completed");

  // Second tactical phase: handshake should proceed normally
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 4);

  assertEqual(
    log.beginTacticalPhaseAfterSync,
    2,
    "second tactical phase started",
  );
  assert(sync.hasRollback, "new rollback created for second tactical phase");
});
// ── Sync Hash Comparison ───────────────────────────────────────────

console.log("\n  Sync Hash Comparison\n");

test("Matching sync hash → completeTacticalSync → startSimulation", () => {
  const { game, net, sync, log } = createTestSetup();

  // Get into tactical phase
  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 2);
  game.setPhase("simulation");
  game.setPhase("tactical");

  // Both done
  sync.onLocalTacticalDone();
  fireRemoteAction(net, { type: "done", player: 2 });

  // At this point, sync sent phaseReadyWithSync
  assertEqual(net.phaseReadyWithSyncSent.count, 1, "phaseReadyWithSync sent");

  // Remote sends matching phaseReady + syncHash
  const matchingHash = buildMatchingSyncHash(game);
  fireRemotePhaseReady(net, 3); // counter 3 (after 1=placement, 2=tactical)
  fireRemoteSyncHash(net, matchingHash);

  // Should complete sync and start simulation
  assertEqual(
    log.startSimulation,
    2,
    "simulation started (1 from placement + 1 from tactical sync)",
  );
  assertEqual(
    log.hideWaitingOverlay,
    2,
    "overlay hidden (1 tactical init + 1 sync complete)",
  );
  assert(!sync.hasRollback, "rollback cleaned up");
});

test("Diverged sync hash as P1 → sends syncFix + completes", () => {
  const { game, net, sync, log } = createTestSetup(1); // P1

  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 2);
  game.setPhase("simulation");
  game.setPhase("tactical");

  sync.onLocalTacticalDone();
  fireRemoteAction(net, { type: "done", player: 2 });

  // Remote sends mismatching hash (different generation)
  const badHash = "999|12345|80|80|0";
  fireRemotePhaseReady(net, 3);
  fireRemoteSyncHash(net, badHash);

  // P1 is authoritative: should send syncFix
  const syncFixAction = net.sentActions.find((a) => a.type === "syncFix");
  assert(syncFixAction !== undefined, "syncFix action sent");
  assertEqual(syncFixAction!.type, "syncFix", "action is syncFix");

  // Should still complete sync
  assertEqual(log.startSimulation, 2, "simulation started despite divergence");
  assert(!sync.hasRollback, "rollback cleaned up");
});

test("Diverged sync hash as P2 → waits for syncFix, does NOT send one", () => {
  const { game, net, sync, log } = createTestSetup(2); // P2

  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 2);
  game.setPhase("simulation");
  game.setPhase("tactical");

  sync.onLocalTacticalDone();
  fireRemoteAction(net, { type: "done", player: 1 });

  // Remote sends mismatching hash
  const badHash = "999|12345|80|80|0";
  fireRemotePhaseReady(net, 3);
  fireRemoteSyncHash(net, badHash);

  // P2 is NOT authoritative: should NOT send syncFix, should NOT complete yet
  const syncFixAction = net.sentActions.find((a) => a.type === "syncFix");
  assert(syncFixAction === undefined, "no syncFix sent by P2");
  assertEqual(
    log.startSimulation,
    1,
    "simulation not started yet (waiting for syncFix)",
  );
});

test("P2 receives syncFix → applies it and completes", () => {
  const { game, net, sync, log } = createTestSetup(2);

  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 2);
  game.setPhase("simulation");
  game.setPhase("tactical");

  sync.onLocalTacticalDone();
  fireRemoteAction(net, { type: "done", player: 1 });

  // Diverged hash
  const badHash = "999|12345|80|80|0";
  fireRemotePhaseReady(net, 3);
  fireRemoteSyncHash(net, badHash);

  // Now P1 sends syncFix
  const fixGrid = RollbackManager.serializeGrid(game.grid);
  fireRemoteAction(net, {
    type: "syncFix",
    gridData: fixGrid,
    rows: game.rows,
    cols: game.cols,
    pointsPlayer1: 42,
    pointsPlayer2: 73,
    generation: 50,
  });

  // P2 should apply the fix
  assertEqual(game.pointsPlayer1, 42, "points P1 updated");
  assertEqual(game.pointsPlayer2, 73, "points P2 updated");
  assertEqual(game.currentGeneration, 50, "generation updated");
  assertEqual(log.refreshDisplay, 1, "display refreshed");
  assertEqual(log.startSimulation, 2, "simulation started after syncFix");
  assert(!sync.hasRollback, "rollback cleaned up");
});

test("SyncHash arrives before phaseReady → waits, completes when phaseReady arrives", () => {
  const { game, net, sync, log } = createTestSetup();

  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 2);
  game.setPhase("simulation");
  game.setPhase("tactical");

  sync.onLocalTacticalDone();
  fireRemoteAction(net, { type: "done", player: 2 });

  // SyncHash arrives BEFORE phaseReady
  const matchingHash = buildMatchingSyncHash(game);
  fireRemoteSyncHash(net, matchingHash);
  assertEqual(
    log.startSimulation,
    1,
    "simulation not started yet (no phaseReady)",
  );

  // PhaseReady arrives
  fireRemotePhaseReady(net, 3);
  assertEqual(log.startSimulation, 2, "simulation started after phaseReady");
});

// ── Remote Action Dispatching ──────────────────────────────────────

console.log("\n  Remote Action Dispatching\n");

test("Remote placePattern → delegates to executePlace callback", () => {
  const { net, log } = createTestSetup();

  fireRemoteAction(net, {
    type: "placePattern",
    player: 2,
    patternIndex: 3,
    row: 20,
    col: 80,
  });

  assertEqual(log.executePlace.length, 1, "executePlace called");
  assertEqual(log.executePlace[0]!.player, 2, "player");
  assertEqual(log.executePlace[0]!.patternIndex, 3, "patternIndex");
  assertEqual(log.executePlace[0]!.row, 20, "row");
  assertEqual(log.executePlace[0]!.col, 80, "col");
});

test("Remote selectPattern → delegates to executeSelectPattern", () => {
  const { net, log } = createTestSetup();

  fireRemoteAction(net, { type: "selectPattern", player: 2, patternIndex: 5 });

  assertEqual(
    log.executeSelectPattern.length,
    1,
    "executeSelectPattern called",
  );
  assertEqual(log.executeSelectPattern[0]!.player, 2, "player");
  assertEqual(log.executeSelectPattern[0]!.patternIndex, 5, "patternIndex");
});

test("Remote pass → delegates to handleTurnAction", () => {
  const { net, log } = createTestSetup();

  fireRemoteAction(net, { type: "pass", player: 2 });
  assertEqual(log.handleTurnAction, 1, "handleTurnAction called");
});

test("Remote done in placement phase → delegates to handleTurnAction", () => {
  const { net, log } = createTestSetup();

  // Game is in placement phase (default) — done should go to handleTurnAction
  fireRemoteAction(net, { type: "done", player: 2 });
  assertEqual(
    log.handleTurnAction,
    1,
    "handleTurnAction called (not tactical done)",
  );
});

test("Remote done in tactical phase → triggers tactical done", () => {
  const { game, net, sync, log } = createTestSetup();

  // Get into tactical phase
  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 2);
  game.setPhase("simulation");
  game.setPhase("tactical");

  fireRemoteAction(net, { type: "done", player: 2 });
  assertEqual(log.markPlayerDone.length, 1, "markPlayerDone called");
  assertEqual(log.markPlayerDone[0], 2, "P2 marked done");
  assertEqual(log.handleTurnAction, 0, "handleTurnAction NOT called");
});

test("Remote surrender → delegates to executeSurrender", () => {
  const { net, log } = createTestSetup();

  fireRemoteAction(net, { type: "surrender", player: 2 });
  assertEqual(log.executeSurrender.length, 1, "executeSurrender called");
  assertEqual(log.executeSurrender[0], 2, "P2 surrendered");
});

// ── Remote Tactical Placement ──────────────────────────────────────

console.log("\n  Remote Tactical Placement\n");

test("Remote tacticalPlace without rollback → just delegates to executePlace", () => {
  const { net, sync, log } = createTestSetup();

  // No tactical phase → no rollback manager
  assert(!sync.hasRollback, "no rollback");

  fireRemoteAction(net, {
    type: "tacticalPlace",
    player: 2,
    patternIndex: 2,
    row: 30,
    col: 80,
    generation: 5,
  });

  assertEqual(log.executePlace.length, 1, "executePlace called");
  assertEqual(log.refreshDisplay, 0, "no refreshDisplay (no rollback)");
});

test("Remote tacticalPlace at current gen → executePlace + add to queue, no rollback", () => {
  const { game, net, sync, log } = createTestSetup();

  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 2);
  game.setPhase("simulation");
  game.setPhase("tactical");

  assert(sync.hasRollback, "rollback active");

  // Remote places at current generation (gen 0)
  fireRemoteAction(net, {
    type: "tacticalPlace",
    player: 2,
    patternIndex: 2,
    row: 30,
    col: 80,
    generation: 0,
  });

  assertEqual(log.executePlace.length, 1, "executePlace called");
  assertEqual(
    log.refreshDisplay,
    0,
    "no refreshDisplay (current gen, no rollback needed)",
  );
});

test("Remote tacticalPlace at past gen → executePlace + rollback + refreshDisplay", () => {
  const { game, net, sync, log } = createTestSetup();

  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 2);
  game.setPhase("simulation");
  game.setPhase("tactical");

  // Advance a few generations
  for (let i = 0; i < 5; i++) game.computeNextGeneration();

  // Remote places at past generation
  fireRemoteAction(net, {
    type: "tacticalPlace",
    player: 2,
    patternIndex: 2,
    row: 50,
    col: 80,
    generation: 2,
  });

  assertEqual(log.executePlace.length, 1, "executePlace called");
  assertEqual(log.refreshDisplay, 1, "refreshDisplay called after rollback");
});

// ── addLocalTacticalAction ─────────────────────────────────────────

console.log("\n  Local Tactical Action\n");

test("addLocalTacticalAction sends tacticalPlace and adds to rollback queue", () => {
  const { game, net, sync } = createTestSetup();

  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 2);
  game.setPhase("simulation");
  game.setPhase("tactical");

  sync.addLocalTacticalAction({
    player: 1,
    patternIndex: 3,
    row: 20,
    col: 15,
    generation: 0,
  });

  // Should have sent tacticalPlace (done action not sent yet)
  const tacticalAction = net.sentActions.find(
    (a) => a.type === "tacticalPlace",
  );
  assert(tacticalAction !== undefined, "tacticalPlace action sent");

  // Should be in rollback queue
  assert(sync.rollback !== null, "rollback exists");
  assertEqual(
    sync.rollback!.getActionsForGeneration(0).length,
    1,
    "action in queue",
  );
});

// ── Reset ──────────────────────────────────────────────────────────

console.log("\n  Reset\n");

test("reset() clears all sync state", () => {
  const { game, net, sync } = createTestSetup();

  // Get into tactical phase
  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 2);
  game.setPhase("simulation");
  game.setPhase("tactical");

  assert(sync.hasRollback, "rollback exists before reset");

  sync.reset();

  assert(!sync.hasRollback, "rollback cleared after reset");
});

test("reset() during tactical done does not leave stale state", () => {
  const { game, net, sync, log } = createTestSetup();

  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 2);
  game.setPhase("simulation");
  game.setPhase("tactical");

  // Local done, but not remote yet
  sync.onLocalTacticalDone();

  // Reset mid-flow (e.g. surrender)
  sync.reset();

  // After reset, a new tactical phase should work cleanly
  // (localTacticalDone should be false again)
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 3);

  // The new tactical phase should create a fresh rollback
  assert(sync.hasRollback, "new rollback created after reset");
});

// ── P2 Perspective ─────────────────────────────────────────────────

console.log("\n  P2 Perspective\n");

test("P2 handshake works symmetrically", () => {
  const { net, sync, log } = createTestSetup(2); // P2

  sync.onPlacementDone();
  assertEqual(net.phaseReadySent, 1, "phaseReady sent");

  fireRemotePhaseReady(net, 1);
  assertEqual(log.startSimulation, 1, "simulation started");
});

test("P2 local tactical done sends action with player=2", () => {
  const { game, net, sync } = createTestSetup(2);

  sync.onPlacementDone();
  fireRemotePhaseReady(net, 1);
  sync.onTacticalStart();
  fireRemotePhaseReady(net, 2);
  game.setPhase("simulation");
  game.setPhase("tactical");

  sync.onLocalTacticalDone();
  const doneAction = net.sentActions.find((a) => a.type === "done");
  assert(doneAction !== undefined, "done action sent");
  assertEqual((doneAction as any).player, 2, "done action has player=2");
});

// ─── Summary ───────────────────────────────────────────────────────

console.log(
  `\n${passed + failed} tests: \x1b[32m${passed} passed\x1b[0m, ${failed > 0 ? `\x1b[31m${failed} failed\x1b[0m` : `${failed} failed`}\n`,
);

if (failures.length > 0) {
  console.log("\x1b[31mFailures:\x1b[0m");
  for (const f of failures) console.log(`  \x1b[31m• ${f}\x1b[0m`);
  process.exit(1);
}
