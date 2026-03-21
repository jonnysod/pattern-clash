// Central DOM element registry
// All getElementById calls happen here, once, at startup.

function getElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) {
    throw new Error(`DOM element not found: #${id}`);
  }
  return el;
}

function getElements(selector: string): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(selector),
  );
}

export function createDOMRefs() {
  return {
    // Canvases
    gameCanvas: getElement<HTMLCanvasElement>("gameCanvas"),
    previewCanvas1: getElement<HTMLCanvasElement>("previewCanvas1"),
    previewCanvas2: getElement<HTMLCanvasElement>("previewCanvas2"),

    // Player header buttons
    player1Btn: getElement<HTMLButtonElement>("player1Btn"),
    player2Btn: getElement<HTMLButtonElement>("player2Btn"),

    // Player side containers
    player1Side: getElement<HTMLDivElement>("player1Side"),
    player2Side: getElement<HTMLDivElement>("player2Side"),

    // Points displays
    points1: getElement<HTMLSpanElement>("points1"),
    points2: getElement<HTMLSpanElement>("points2"),

    // Generation display
    generationCounter: getElement<HTMLSpanElement>("generationCounter"),
    maxGenerations: getElement<HTMLSpanElement>("maxGenerations"),

    // Turn timer
    turnTimerContainer: getElement<HTMLDivElement>("turnTimerContainer"),
    turnTimerBar: getElement<HTMLDivElement>("turnTimerBar"),

    // Action buttons (Pass/Done in placement & tactical, disabled in simulation)
    ready1Btn: getElement<HTMLButtonElement>("ready1Btn"),
    ready2Btn: getElement<HTMLButtonElement>("ready2Btn"),

    // Surrender buttons
    surrender1Btn: getElement<HTMLButtonElement>("surrender1Btn"),
    surrender2Btn: getElement<HTMLButtonElement>("surrender2Btn"),

    // Pattern buttons
    player1Patterns: getElements(".player1-pattern"),
    player2Patterns: getElements(".player2-pattern"),

    // Preview toggle buttons
    previewToggle1: getElement<HTMLButtonElement>("previewToggle1"),
    previewToggle2: getElement<HTMLButtonElement>("previewToggle2"),

    // Pattern info
    patternName1: getElement<HTMLDivElement>("patternName1"),
    patternCost1: getElement<HTMLDivElement>("patternCost1"),
    patternName2: getElement<HTMLDivElement>("patternName2"),
    patternCost2: getElement<HTMLDivElement>("patternCost2"),

    // Winner overlay
    winnerOverlay: getElement<HTMLDivElement>("winnerOverlay"),
    winnerTitle: getElement<HTMLHeadingElement>("winnerTitle"),
    winnerScore: getElement<HTMLParagraphElement>("winnerScore"),
    showBoardBtn: getElement<HTMLButtonElement>("showBoardBtn"),
    restartBtn: getElement<HTMLButtonElement>("restartBtn"),

    // Start / Lobby overlay
    startOverlay: getElement<HTMLDivElement>("startOverlay"),
    lobbyModeSelect: getElement<HTMLDivElement>("lobbyModeSelect"),
    localGameBtn: getElement<HTMLButtonElement>("localGameBtn"),
    onlineGameBtn: getElement<HTMLButtonElement>("onlineGameBtn"),
    lobbyOnlineChoice: getElement<HTMLDivElement>("lobbyOnlineChoice"),
    createGameBtn: getElement<HTMLButtonElement>("createGameBtn"),
    joinGameBtn: getElement<HTMLButtonElement>("joinGameBtn"),
    lobbyWaiting: getElement<HTMLDivElement>("lobbyWaiting"),
    gameCodeDisplay: getElement<HTMLDivElement>("gameCodeDisplay"),
    lobbyStatus: getElement<HTMLParagraphElement>("lobbyStatus"),
    lobbyJoin: getElement<HTMLDivElement>("lobbyJoin"),
    joinCodeInput: getElement<HTMLInputElement>("joinCodeInput"),
    joinError: getElement<HTMLParagraphElement>("joinError"),
    joinConfirmBtn: getElement<HTMLButtonElement>("joinConfirmBtn"),
    lobbyBackBtn1: getElement<HTMLButtonElement>("lobbyBackBtn1"),
    lobbyBackBtn2: getElement<HTMLButtonElement>("lobbyBackBtn2"),
    lobbyBackBtn3: getElement<HTMLButtonElement>("lobbyBackBtn3"),
  };
}

export type DOMRefs = ReturnType<typeof createDOMRefs>;
