// Pattern Clash — Main entry point.
//
// Lobby flow:
//   - Local Game: starts a hotseat game with LocalSyncManager
//   - Online Game: Create or Join via Firebase
//       - Create: generates lobby code, waits for opponent
//       - Join: prompts for code, claims player 2 slot
//     Once both players are connected, the actual online game starts
//     in Checkpoint 3. For now, we just confirm the connection.

import { Game } from "./game.js";
import { Renderer } from "./rendering.js";
import { UIController } from "./ui.js";
import { BotController } from "./botController.js";
import { DummyBotPolicy } from "./botPolicy.js";
import { LocalSyncManager, OnlineSyncManager } from "./syncManager.js";
import { FirebaseTransport } from "./firebaseTransport.js";
import { createDOMRefs } from "./domRefs.js";
import { CONFIG } from "./config.js";
import { logInfo } from "./logger.js";
import { PuzzleRunner } from "./puzzleRunner.js";
import type { PuzzleDOMRefs } from "./puzzleRunner.js";
import { PUZZLES } from "./puzzles.js";
import type { PuzzleDefinition } from "./types.js";
import { getBestScore, isSolved } from "./puzzleHighscores.js";

//#region Initialization
const dom = createDOMRefs();

const COLS = CONFIG.CANVAS_WIDTH / CONFIG.CELL_SIZE;
const ROWS = CONFIG.CANVAS_HEIGHT / CONFIG.CELL_SIZE;

const game = new Game(ROWS, COLS);
const renderer = new Renderer(dom.gameCanvas, CONFIG.CELL_SIZE, game);

let uiController: UIController | null = null;
let transport: FirebaseTransport | null = null;

// Re-enable the online button (was disabled before Checkpoint 2).
dom.onlineGameBtn.disabled = false;
dom.onlineGameBtn.style.cursor = "pointer";
dom.onlineGameBtn.style.opacity = "1";
dom.onlineGameBtn.textContent = "Online Game";

renderer.drawGrid();
//#endregion

//#region Game Lifecycle
function startLocalGame(): void {
  dom.startOverlay.style.display = "none";
  game.reset();
  renderer.drawGrid();

  const syncManager = new LocalSyncManager();
  uiController = new UIController(
    game,
    dom,
    renderer,
    syncManager,
    "both", // hotseat
    CONFIG.CELL_SIZE,
  );
  uiController.onRestartRequested = () => {
    uiController = null;
    showLobby();
  };
}

function startBotGame(): void {
  dom.startOverlay.style.display = "none";
  game.reset();
  renderer.drawGrid();

  const syncManager = new LocalSyncManager();
  const policy = new DummyBotPolicy(game);
  const botController = new BotController(game, syncManager, policy);

  uiController = new UIController(
    game,
    dom,
    renderer,
    syncManager,
    1, // human is P1, bot is P2
    CONFIG.CELL_SIZE,
    botController,
  );
  uiController.onRestartRequested = () => {
    uiController = null;
    showLobby();
  };
}

function showLobby(): void {
  // Tear down any active online transport
  if (transport) {
    transport.disconnect();
    transport = null;
  }
  showLobbySection("lobbyModeSelect");
  dom.startOverlay.style.display = "flex";
}

function showLobbySection(sectionId: string): void {
  dom.lobbyModeSelect.style.display = "none";
  dom.lobbyOnlineChoice.style.display = "none";
  dom.lobbyWaiting.style.display = "none";
  dom.lobbyJoin.style.display = "none";
  const target = document.getElementById(sectionId);
  if (target) target.style.display = "block";
}
//#endregion

//#region Puzzle Mode
let puzzleRunner: PuzzleRunner | null = null;
let currentPuzzle: PuzzleDefinition | null = null;

function buildPuzzleDOMRefs(): PuzzleDOMRefs {
  return {
    canvas: dom.puzzleCanvas,
    cardHand1: dom.puzzleCardHand1,
    cardHand2: dom.puzzleCardHand2,
    objective: dom.puzzleObjective,
    hint: dom.puzzleHint,
    doneBtn: dom.puzzleDoneBtn,
    generationCounter: dom.puzzleGenerationCounter,
    simSkipHint: dom.puzzleSimSkipHint,
    opponentScore: dom.puzzleOpponentScore,
    resultOverlay: dom.puzzleResultOverlay,
    resultTitle: dom.puzzleResultTitle,
    resultText: dom.puzzleResultText,
    retryBtn: dom.puzzleRetryBtn,
    backBtn: dom.puzzleBackBtn,
  };
}

function bestScoreLabel(puzzle: PuzzleDefinition): string {
  if (!isSolved(puzzle.id)) return "";
  const best = getBestScore(puzzle.id);
  if (best === null) return "✓";
  const isBinary =
    puzzle.criteria.maxOpponentScore !== undefined && puzzle.criteria.maxOpponentScore === 0;
  return isBinary ? "✓" : `✓ Best: ${best}`;
}

function showPuzzleSelect(): void {
  dom.startOverlay.style.display = "none";
  dom.puzzleSelectOverlay.style.display = "flex";

  // Rebuild list on every entry in case PUZZLES changes in the future.
  dom.puzzleList.innerHTML = "";
  for (const puzzle of PUZZLES) {
    const item = document.createElement("div");
    item.style.cssText = "display: flex; flex-direction: column; align-items: center; gap: 4px;";

    const btn = document.createElement("button");
    btn.textContent = puzzle.title;
    btn.style.cssText =
      "padding: 12px 24px; font-size: 18px; background-color: #00ff00; " +
      "color: #1a1a1a; border: none; border-radius: 5px; cursor: pointer; " +
      "font-weight: bold; width: 250px;";
    btn.addEventListener("click", () => startPuzzle(puzzle));

    const indicator = document.createElement("span");
    indicator.style.cssText = "font-size: 13px; color: #aaa; min-height: 18px;";
    indicator.textContent = bestScoreLabel(puzzle);

    item.appendChild(btn);
    item.appendChild(indicator);
    dom.puzzleList.appendChild(item);
  }
}

function startPuzzle(puzzle: PuzzleDefinition): void {
  currentPuzzle = puzzle;
  dom.puzzleSelectOverlay.style.display = "none";
  dom.puzzleScreen.style.display = "flex";
  dom.puzzleTitle.textContent = puzzle.title;

  // Create the runner once; reuse across retries and puzzle switches.
  if (!puzzleRunner) {
    puzzleRunner = new PuzzleRunner(buildPuzzleDOMRefs());
    puzzleRunner.onExit = () => {
      dom.puzzleScreen.style.display = "none";
      showPuzzleSelect();
    };
  }

  puzzleRunner.start(puzzle);
  logInfo(`[Puzzle] started: ${puzzle.id}`);
}
//#endregion

//#region Online Lobby
async function onCreateGame(): Promise<void> {
  transport = new FirebaseTransport();
  try {
    const code = await transport.createGame();
    dom.gameCodeDisplay.textContent = code;
    dom.lobbyStatus.textContent = "Waiting for opponent…";
    showLobbySection("lobbyWaiting");

    transport.onGameActive = () => {
      logInfo("[Lobby] Both players connected — starting online game");
      onOnlineGameReady();
    };
  } catch (err) {
    logInfo("[Lobby] createGame failed:", err);
    alert(
      "Could not create online game. Check your internet connection or try again.",
    );
    transport.disconnect();
    transport = null;
    showLobbySection("lobbyModeSelect");
  }
}

async function onJoinConfirm(): Promise<void> {
  const rawCode = dom.joinCodeInput.value.trim().toUpperCase();
  if (rawCode.length === 0) {
    showJoinError("Please enter a game code");
    return;
  }

  transport = new FirebaseTransport();
  try {
    const result = await transport.joinGame(rawCode);
    if (!result.ok) {
      showJoinError(result.error);
      transport.disconnect();
      transport = null;
      return;
    }
    logInfo("[Lobby] Joined successfully — starting online game");
    onOnlineGameReady();
  } catch (err) {
    logInfo("[Lobby] joinGame failed:", err);
    showJoinError("Connection failed. Try again.");
    transport?.disconnect();
    transport = null;
  }
}

function showJoinError(msg: string): void {
  dom.joinError.textContent = msg;
  dom.joinError.style.display = "block";
  dom.joinError.style.color = "#ff6666";
}

// Called once both players are connected via Firebase.
// Starts the actual online game with OnlineSyncManager.
function onOnlineGameReady(): void {
  if (!transport) return;
  const me = transport.getLocalPlayer();
  if (me === null) {
    logInfo("[Lobby] onOnlineGameReady but no local player — aborting");
    return;
  }

  dom.startOverlay.style.display = "none";
  game.reset();
  renderer.drawGrid();

  const syncManager = new OnlineSyncManager(transport, me);
  uiController = new UIController(
    game,
    dom,
    renderer,
    syncManager,
    me,
    CONFIG.CELL_SIZE,
  );

  // Cleanup the Firebase game node as soon as the game ends
  // (regular finish, surrender, or connection loss).
  uiController.onGameEnded = () => {
    void transport?.cleanup();
  };

  // Return to lobby on restart click.
  uiController.onRestartRequested = () => {
    transport?.disconnect();
    transport = null;
    uiController = null;
    showLobby();
  };
}

async function onCancelWaiting(): Promise<void> {
  if (transport) {
    await transport.cancelGame();
    transport = null;
  }
  showLobbySection("lobbyOnlineChoice");
}
//#endregion

//#region Lobby & Puzzle Event Handlers
dom.localGameBtn.addEventListener("click", () => {
  startLocalGame();
});

dom.botGameBtn.addEventListener("click", () => {
  startBotGame();
});

dom.onlineGameBtn.addEventListener("click", () => {
  showLobbySection("lobbyOnlineChoice");
});

dom.createGameBtn.addEventListener("click", () => {
  void onCreateGame();
});
dom.joinGameBtn.addEventListener("click", () => {
  dom.joinCodeInput.value = "";
  dom.joinError.style.display = "none";
  showLobbySection("lobbyJoin");
  // Slight delay so the focus happens after the section becomes visible
  // (focus on a hidden element is a no-op in some browsers).
  setTimeout(() => dom.joinCodeInput.focus(), 0);
});
dom.joinConfirmBtn.addEventListener("click", () => {
  void onJoinConfirm();
});

dom.joinCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    void onJoinConfirm();
  }
});

// Back buttons (lobby)
dom.lobbyBackBtn1.addEventListener("click", () => {
  showLobbySection("lobbyModeSelect");
});
dom.lobbyBackBtn2.addEventListener("click", () => {
  void onCancelWaiting();
});
dom.lobbyBackBtn3.addEventListener("click", () => {
  showLobbySection("lobbyOnlineChoice");
});

// Puzzle routing
dom.miniGamesBtn.addEventListener("click", () => {
  showPuzzleSelect();
});
dom.puzzleSelectBackBtn.addEventListener("click", () => {
  dom.puzzleSelectOverlay.style.display = "none";
  dom.startOverlay.style.display = "flex";
});
dom.puzzleDoneBtn.addEventListener("click", () => {
  puzzleRunner?.commitPlacements();
});
dom.puzzleRetryBtn.addEventListener("click", () => {
  if (currentPuzzle && puzzleRunner) {
    // start() already hides the result overlay — no pre-hide needed.
    puzzleRunner.start(currentPuzzle);
    logInfo(`[Puzzle] retrying: ${currentPuzzle.id}`);
  }
});
dom.puzzleBackBtn.addEventListener("click", () => {
  puzzleRunner?.stop();
  dom.puzzleScreen.style.display = "none";
  showPuzzleSelect();
});
//#endregion

logInfo("[Game] Pattern Clash ready");

// Debug references
(window as any).game = game;
