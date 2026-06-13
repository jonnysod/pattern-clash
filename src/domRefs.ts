// Central DOM element registry
// All getElementById calls happen here, once, at startup.

function getElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) {
    throw new Error(`DOM element not found: #${id}`);
  }
  return el;
}

export function createDOMRefs() {
  return {
    // Main game canvas
    gameCanvas: getElement<HTMLCanvasElement>("gameCanvas"),

    // Player side containers & headers
    player1Side: getElement<HTMLDivElement>("player1Side"),
    player2Side: getElement<HTMLDivElement>("player2Side"),
    player1Btn: getElement<HTMLButtonElement>("player1Btn"),
    player2Btn: getElement<HTMLButtonElement>("player2Btn"),

    // Budget & Score displays per player
    budget1: getElement<HTMLSpanElement>("budget1"),
    budget2: getElement<HTMLSpanElement>("budget2"),
    score1: getElement<HTMLSpanElement>("score1"),
    score2: getElement<HTMLSpanElement>("score2"),

    // Status bar above canvas
    phaseCounter: getElement<HTMLSpanElement>("phaseCounter"),
    totalPhases: getElement<HTMLSpanElement>("totalPhases"),
    generationCounter: getElement<HTMLSpanElement>("generationCounter"),
    maxGenerations: getElement<HTMLSpanElement>("maxGenerations"),
    simSkipHint: getElement<HTMLSpanElement>("simSkipHint"),

    // Post-game freerun sandbox controls
    freerunBar: getElement<HTMLDivElement>("freerunBar"),
    freerunPlayBtn: getElement<HTMLButtonElement>("freerunPlayBtn"),
    freerunStatus: getElement<HTMLSpanElement>("freerunStatus"),

    // Card hand containers (below canvas, one per player)
    cardHand1: getElement<HTMLDivElement>("cardHand1"),
    cardHand2: getElement<HTMLDivElement>("cardHand2"),

    // Quit / surrender
    surrender1Btn: getElement<HTMLSpanElement>("surrender1Btn"),
    surrender2Btn: getElement<HTMLSpanElement>("surrender2Btn"),

    // Buy overlay
    buyOverlay: getElement<HTMLDivElement>("buyOverlay"),
    buyOverlayTitle: getElement<HTMLHeadingElement>("buyOverlayTitle"),
    buyOverlayBudget: getElement<HTMLSpanElement>("buyOverlayBudget"),
    buyOverlaySlots: getElement<HTMLSpanElement>("buyOverlaySlots"),
    buyOverlaySlotsMax: getElement<HTMLSpanElement>("buyOverlaySlotsMax"),
    buyOverlayPatternList: getElement<HTMLDivElement>("buyOverlayPatternList"),
    buyOverlayConfirmBtn: getElement<HTMLButtonElement>("buyOverlayConfirmBtn"),

    // Hotseat switch overlay
    switchOverlay: getElement<HTMLDivElement>("switchOverlay"),
    switchOverlayTitle: getElement<HTMLHeadingElement>("switchOverlayTitle"),
    switchOverlayReadyBtn: getElement<HTMLButtonElement>(
      "switchOverlayReadyBtn",
    ),

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

    // Lobby: Mini Games entry point
    miniGamesBtn: getElement<HTMLButtonElement>("miniGamesBtn"),

    // Puzzle selection overlay
    puzzleSelectOverlay: getElement<HTMLDivElement>("puzzleSelectOverlay"),
    puzzleList: getElement<HTMLDivElement>("puzzleList"),
    puzzleSelectBackBtn: getElement<HTMLButtonElement>("puzzleSelectBackBtn"),

    // Puzzle screen
    puzzleScreen: getElement<HTMLDivElement>("puzzleScreen"),
    puzzleTitle: getElement<HTMLHeadingElement>("puzzleTitle"),
    puzzleObjective: getElement<HTMLParagraphElement>("puzzleObjective"),
    puzzleHint: getElement<HTMLParagraphElement>("puzzleHint"),
    puzzleGenerationCounter: getElement<HTMLSpanElement>(
      "puzzleGenerationCounter",
    ),
    puzzleSimSkipHint: getElement<HTMLSpanElement>("puzzleSimSkipHint"),
    puzzleOpponentScore: getElement<HTMLSpanElement>("puzzleOpponentScore"),
    puzzleCanvas: getElement<HTMLCanvasElement>("puzzleCanvas"),
    puzzleCardHand1: getElement<HTMLDivElement>("puzzleCardHand1"),
    puzzleCardHand2: getElement<HTMLDivElement>("puzzleCardHand2"),
    puzzleDoneBtn: getElement<HTMLButtonElement>("puzzleDoneBtn"),
    puzzleResultOverlay: getElement<HTMLDivElement>("puzzleResultOverlay"),
    puzzleResultTitle: getElement<HTMLHeadingElement>("puzzleResultTitle"),
    puzzleResultText: getElement<HTMLParagraphElement>("puzzleResultText"),
    puzzleRetryBtn: getElement<HTMLButtonElement>("puzzleRetryBtn"),
    puzzleBackBtn: getElement<HTMLButtonElement>("puzzleBackBtn"),
  };
}

export type DOMRefs = ReturnType<typeof createDOMRefs>;
