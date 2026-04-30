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
import { LocalSyncManager, OnlineSyncManager } from "./syncManager.js";
import { FirebaseTransport } from "./firebaseTransport.js";
import { createDOMRefs } from "./domRefs.js";
import { CONFIG } from "./config.js";
import { logInfo } from "./logger.js";

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

//#region Lobby Event Handlers
dom.localGameBtn.addEventListener("click", () => {
  startLocalGame();
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

// Back buttons
dom.lobbyBackBtn1.addEventListener("click", () => {
  showLobbySection("lobbyModeSelect");
});
dom.lobbyBackBtn2.addEventListener("click", () => {
  void onCancelWaiting();
});
dom.lobbyBackBtn3.addEventListener("click", () => {
  showLobbySection("lobbyOnlineChoice");
});
//#endregion

logInfo("[Game] Pattern Clash ready");

// Debug references
(window as any).game = game;
