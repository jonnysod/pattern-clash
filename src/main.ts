// Pattern Clash - Main Entry Point

import { Game } from "./game.js";
import { Renderer, PreviewRenderer } from "./rendering.js";
import { UIController } from "./ui.js";

//#region Canvas Setup
const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
const CELL_SIZE = 10;
const COLS = canvas.width / CELL_SIZE;
const ROWS = canvas.height / CELL_SIZE;
//#endregion

//#region Preview Canvas Setup
const previewCanvas1 = document.getElementById(
  "previewCanvas1",
) as HTMLCanvasElement;
const previewCanvas2 = document.getElementById(
  "previewCanvas2",
) as HTMLCanvasElement;
const PREVIEW_CELL_SIZE = 10;
//#endregion

//#region Initialization
const game = new Game(ROWS, COLS);
const renderer = new Renderer(canvas, CELL_SIZE, game);
const previewRenderer1 = new PreviewRenderer(previewCanvas1, PREVIEW_CELL_SIZE);
const previewRenderer2 = new PreviewRenderer(previewCanvas2, PREVIEW_CELL_SIZE);

const uiController = new UIController(
  game,
  renderer,
  previewRenderer1,
  previewRenderer2,
  CELL_SIZE,
);

// Initial render
renderer.drawGrid();
previewRenderer1.drawPreview(null, 1);
previewRenderer2.drawPreview(null, 2);

console.log("Pattern Clash - Ready!");
//#endregion
