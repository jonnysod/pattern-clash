// Pattern Clash - Main Entry Point

import { Game } from "./game.js";
import { Renderer, PreviewRenderer } from "./rendering.js";
import { UIController } from "./ui.js";
import { createDOMRefs } from "./domRefs.js";
import { Network } from "./network.js";
import { CONFIG } from "./config.js";

//#region Initialization
const dom = createDOMRefs();

const COLS = CONFIG.CANVAS_WIDTH / CONFIG.CELL_SIZE;
const ROWS = CONFIG.CANVAS_HEIGHT / CONFIG.CELL_SIZE;

const game = new Game(ROWS, COLS);
const renderer = new Renderer(dom.gameCanvas, CONFIG.CELL_SIZE, game);
const previewRenderer1 = new PreviewRenderer(dom.previewCanvas1);
const previewRenderer2 = new PreviewRenderer(dom.previewCanvas2);

let uiController: UIController | null = null;
let network: Network | null = null;

// Initial render
renderer.drawGrid();
previewRenderer1.drawPreview(null, 1);
previewRenderer2.drawPreview(null, 2);
//#endregion

//#region Lobby Navigation Helpers
function showLobbySection(sectionId: string): void {
  dom.lobbyModeSelect.style.display = "none";
  dom.lobbyOnlineChoice.style.display = "none";
  dom.lobbyWaiting.style.display = "none";
  dom.lobbyJoin.style.display = "none";
  document.getElementById(sectionId)!.style.display = "block";
}

function startGame(net: Network | null): void {
  dom.startOverlay.style.display = "none";

  // Reset game state
  game.reset();
  renderer.drawGrid();
  previewRenderer1.drawPreview(null, 1);
  previewRenderer2.drawPreview(null, 2);

  uiController = new UIController(
    game,
    dom,
    renderer,
    previewRenderer1,
    previewRenderer2,
    CONFIG.CELL_SIZE,
    net,
  );
}

function showLobby(): void {
  // Clean up previous game
  if (network) {
    network.disconnect();
    network = null;
  }
  uiController = null;

  showLobbySection("lobbyModeSelect");
  dom.startOverlay.style.display = "flex";
  dom.joinError.style.display = "none";
  dom.joinCodeInput.value = "";
}
//#endregion

//#region Lobby Event Handlers
// Mode selection
dom.localGameBtn.addEventListener("click", () => {
  startGame(null);
});

dom.onlineGameBtn.addEventListener("click", () => {
  showLobbySection("lobbyOnlineChoice");
});

// Online: Create or Join
dom.createGameBtn.addEventListener("click", async () => {
  network = new Network();

  network.onOpponentJoined = () => {
    dom.lobbyStatus.textContent = "Opponent joined!";
    dom.lobbyStatus.style.color = "#00ff00";

    // Short delay so the user sees the "joined" message
    setTimeout(() => {
      startGame(network);
    }, 500);
  };

  try {
    const gameId = await network.createGame();
    dom.gameCodeDisplay.textContent = gameId;
    dom.lobbyStatus.textContent = "Waiting for opponent...";
    dom.lobbyStatus.style.color = "#888";
    showLobbySection("lobbyWaiting");
  } catch (err) {
    console.error("Failed to create game:", err);
  }
});

dom.joinGameBtn.addEventListener("click", () => {
  showLobbySection("lobbyJoin");
  dom.joinCodeInput.focus();
});

dom.joinConfirmBtn.addEventListener("click", async () => {
  const code = dom.joinCodeInput.value.trim().toUpperCase();
  if (code.length !== 6) {
    dom.joinError.textContent = "Code must be 6 characters";
    dom.joinError.style.display = "block";
    return;
  }

  network = new Network();

  try {
    await network.joinGame(code);
    startGame(network);
  } catch (err: any) {
    dom.joinError.textContent = err.message || "Failed to join game";
    dom.joinError.style.display = "block";
    network.disconnect();
    network = null;
  }
});

// Allow Enter key in join input
dom.joinCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    dom.joinConfirmBtn.click();
  }
});

// Back buttons
dom.lobbyBackBtn1.addEventListener("click", () => {
  showLobbySection("lobbyModeSelect");
});

dom.lobbyBackBtn2.addEventListener("click", () => {
  if (network) {
    network.disconnect();
    network = null;
  }
  showLobbySection("lobbyOnlineChoice");
});

dom.lobbyBackBtn3.addEventListener("click", () => {
  showLobbySection("lobbyOnlineChoice");
});
//#endregion

console.log("Pattern Clash - Ready!");
