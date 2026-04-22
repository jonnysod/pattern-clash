// Pattern Clash — Main entry point (Checkpoint C: local-only).
//
// Online mode is temporarily disabled while the game is being rebuilt
// around the 5-phase structure. It will be re-wired in a later step.

import { Game } from "./game.js";
import { Renderer } from "./rendering.js";
import { UIController } from "./ui.js";
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

renderer.drawGrid();
//#endregion

//#region Game Lifecycle
function startLocalGame(): void {
  dom.startOverlay.style.display = "none";
  game.reset();
  renderer.drawGrid();

  uiController = new UIController(game, dom, renderer, CONFIG.CELL_SIZE);
  uiController.onRestartRequested = () => {
    uiController = null;
    showLobby();
  };
}

function showLobby(): void {
  showLobbySection("lobbyModeSelect");
  dom.startOverlay.style.display = "flex";
}

function showLobbySection(sectionId: string): void {
  dom.lobbyModeSelect.style.display = "none";
  dom.lobbyOnlineChoice.style.display = "none";
  dom.lobbyWaiting.style.display = "none";
  dom.lobbyJoin.style.display = "none";
  document.getElementById(sectionId)!.style.display = "block";
}
//#endregion

//#region Lobby Event Handlers
dom.localGameBtn.addEventListener("click", () => {
  startLocalGame();
});

dom.onlineGameBtn.addEventListener("click", () => {
  alert("Online mode is temporarily disabled while the game is being rebuilt.");
});

// Back buttons (kept wired so navigation works if online is re-enabled later)
dom.lobbyBackBtn1.addEventListener("click", () => {
  showLobbySection("lobbyModeSelect");
});
dom.lobbyBackBtn2.addEventListener("click", () => {
  showLobbySection("lobbyOnlineChoice");
});
dom.lobbyBackBtn3.addEventListener("click", () => {
  showLobbySection("lobbyOnlineChoice");
});

// Online create/join: no-ops during Checkpoint C.
dom.createGameBtn.addEventListener("click", () => {
  alert("Online mode is temporarily disabled.");
});
dom.joinGameBtn.addEventListener("click", () => {
  alert("Online mode is temporarily disabled.");
});
dom.joinConfirmBtn.addEventListener("click", () => {
  alert("Online mode is temporarily disabled.");
});
//#endregion

logInfo("[Game] Pattern Clash ready");

// Debug references
(window as any).game = game;
