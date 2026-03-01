// Central DOM element registry
// All getElementById calls happen here, once, at startup.
// Crashes immediately with a clear message if an element is missing.

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

    // Points displays
    points1: getElement<HTMLSpanElement>("points1"),
    points2: getElement<HTMLSpanElement>("points2"),

    // Generation display
    generationCounter: getElement<HTMLSpanElement>("generationCounter"),
    maxGenerations: getElement<HTMLSpanElement>("maxGenerations"),

    // Turn timer
    turnTimerContainer: getElement<HTMLDivElement>("turnTimerContainer"),
    turnTimerBar: getElement<HTMLDivElement>("turnTimerBar"),

    // Ready / Pause buttons
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

    // Pause decision overlay
    pauseDecisionOverlay: getElement<HTMLDivElement>("pauseDecisionOverlay"),
    pauseDecisionTitle: getElement<HTMLHeadingElement>("pauseDecisionTitle"),
    pauseDecisionTimerBar: getElement<HTMLDivElement>("pauseDecisionTimerBar"),
    pauseDecisionYes: getElement<HTMLButtonElement>("pauseDecisionYes"),
    pauseDecisionNo: getElement<HTMLButtonElement>("pauseDecisionNo"),
  };
}

export type DOMRefs = ReturnType<typeof createDOMRefs>;
