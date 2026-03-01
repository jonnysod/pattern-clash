// Pattern Clash - Main Entry Point

import { Game } from "./game.js";
import { Renderer, PreviewRenderer } from "./rendering.js";
import { UIController } from "./ui.js";
import { createDOMRefs } from "./domRefs.js";
import { CONFIG } from "./config.js";

//#region Initialization
const dom = createDOMRefs();

const COLS = CONFIG.CANVAS_WIDTH / CONFIG.CELL_SIZE;
const ROWS = CONFIG.CANVAS_HEIGHT / CONFIG.CELL_SIZE;

const game = new Game(ROWS, COLS);
const renderer = new Renderer(dom.gameCanvas, CONFIG.CELL_SIZE, game);
const previewRenderer1 = new PreviewRenderer(dom.previewCanvas1);
const previewRenderer2 = new PreviewRenderer(dom.previewCanvas2);

const uiController = new UIController(
  game,
  dom,
  renderer,
  previewRenderer1,
  previewRenderer2,
  CONFIG.CELL_SIZE,
);

// Initial render
renderer.drawGrid();
previewRenderer1.drawPreview(null, 1);
previewRenderer2.drawPreview(null, 2);

console.log("Pattern Clash - Ready!");
//#endregion
