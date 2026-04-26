// Buy Overlay UI component.
//
// Presents the buy-phase interface: list of all patterns with mini-previews,
// +/- controls, budget + slot counters, and a confirm button. Owns no game
// state — reads from Game, writes via Game.buyPattern/sellPattern.

import type { Player, Pattern } from "./types.js";
import type { DOMRefs } from "./domRefs.js";
import { Game } from "./game.js";
import { PATTERNS } from "./patterns.js";
import { getPatternForPlayer } from "./patternUtils.js";
import { CONFIG } from "./config.js";

interface PatternRowRefs {
  countDisplay: HTMLSpanElement;
  minusBtn: HTMLButtonElement;
  plusBtn: HTMLButtonElement;
  priceDisplay: HTMLSpanElement;
}

export class BuyOverlay {
  private game: Game;
  private dom: DOMRefs;

  // Populated on first show(); one row per pattern, in PATTERNS order.
  private patternRows: PatternRowRefs[] = [];
  private initialized: boolean = false;

  // Currently-shown player (for re-renders during open overlay)
  private currentPlayer: Player | null = null;

  // Callback when the player confirms their buy
  onConfirm: ((player: Player) => void) | null = null;

  constructor(game: Game, dom: DOMRefs) {
    this.game = game;
    this.dom = dom;

    this.dom.buyOverlayConfirmBtn.addEventListener("click", () => {
      if (this.currentPlayer !== null && this.onConfirm) {
        this.onConfirm(this.currentPlayer);
      }
    });
  }

  show(player: Player): void {
    this.currentPlayer = player;

    if (!this.initialized) {
      this.buildPatternList();
      this.initialized = true;
    }

    // Re-render previews for this player's orientation
    this.renderPreviews(player);

    // Update title with player color
    const color = player === 1 ? CONFIG.COLOR_PLAYER1 : CONFIG.COLOR_PLAYER2;
    this.dom.buyOverlayTitle.textContent = `Player ${player} — Buy Phase`;
    this.dom.buyOverlayTitle.style.color = color;

    // Set static maxima
    this.dom.buyOverlaySlotsMax.textContent = String(CONFIG.MAX_SLOTS);

    this.refresh();
    this.dom.buyOverlay.style.display = "flex";
  }

  hide(): void {
    this.dom.buyOverlay.style.display = "none";
    this.currentPlayer = null;
  }

  // Re-read state from Game and update all controls + counters.
  refresh(): void {
    const player = this.currentPlayer;
    if (player === null) return;

    this.dom.buyOverlayBudget.textContent = String(this.game.getBudget(player));
    this.dom.buyOverlaySlots.textContent = String(
      this.game.getSlotCount(player),
    );

    for (let i = 0; i < PATTERNS.length; i++) {
      const row = this.patternRows[i];
      if (!row) continue;

      const count = this.game.getCopyCount(player, i);
      row.countDisplay.textContent = String(count);

      row.minusBtn.disabled = !this.game.canSell(player, i);
      row.plusBtn.disabled = !this.game.canBuy(player, i);

      // Dim disabled +button visually (button.disabled handles the style
      // via browser default, but we also adjust opacity for clarity)
      row.plusBtn.style.opacity = row.plusBtn.disabled ? "0.3" : "1";
      row.minusBtn.style.opacity = row.minusBtn.disabled ? "0.3" : "1";
    }
  }

  private buildPatternList(): void {
    const list = this.dom.buyOverlayPatternList;
    list.innerHTML = "";
    this.patternRows = [];

    PATTERNS.forEach((pattern, index) => {
      const row = this.createPatternRow(pattern, index);
      list.appendChild(row.rowEl);
      this.patternRows.push({
        countDisplay: row.countDisplay,
        minusBtn: row.minusBtn,
        plusBtn: row.plusBtn,
        priceDisplay: row.priceDisplay,
      });
    });
  }

  private createPatternRow(
    pattern: Pattern,
    index: number,
  ): {
    rowEl: HTMLDivElement;
    countDisplay: HTMLSpanElement;
    minusBtn: HTMLButtonElement;
    plusBtn: HTMLButtonElement;
    priceDisplay: HTMLSpanElement;
  } {
    const rowEl = document.createElement("div");
    rowEl.style.cssText =
      "display: flex; align-items: center; gap: 12px; padding: 8px 10px; " +
      "background: #1e1e1e; border: 1px solid #333; border-radius: 4px;";

    // Mini preview canvas (static, one generation)
    const previewCanvas = document.createElement("canvas");
    previewCanvas.width = 60;
    previewCanvas.height = 60;
    previewCanvas.style.cssText =
      "background: #000; border: 1px solid #444; flex-shrink: 0;";
    previewCanvas.dataset.patternIndex = String(index);
    rowEl.appendChild(previewCanvas);

    // Name + price block
    const infoBlock = document.createElement("div");
    infoBlock.style.cssText = "flex: 1; display: flex; flex-direction: column;";
    const nameEl = document.createElement("div");
    nameEl.textContent = pattern.name;
    nameEl.style.cssText = "font-weight: bold; font-size: 14px;";
    const priceEl = document.createElement("div");
    priceEl.style.cssText = "font-size: 12px; color: #aaa;";
    priceEl.innerHTML = `Cost: <span data-price>${pattern.cells.length}</span>`;
    const priceDisplay = priceEl.querySelector(
      "[data-price]",
    ) as HTMLSpanElement;
    infoBlock.appendChild(nameEl);
    infoBlock.appendChild(priceEl);
    rowEl.appendChild(infoBlock);

    // - / count / + controls
    const controls = document.createElement("div");
    controls.style.cssText =
      "display: flex; align-items: center; gap: 8px; flex-shrink: 0;";

    const minusBtn = document.createElement("button");
    minusBtn.textContent = "−";
    minusBtn.style.cssText =
      "width: 32px; height: 32px; padding: 0; font-size: 18px; " +
      "background: #444; color: white; border: 1px solid #666; " +
      "border-radius: 4px; cursor: pointer;";
    minusBtn.addEventListener("click", () => this.handleSell(index));

    const countDisplay = document.createElement("span");
    countDisplay.textContent = "0";
    countDisplay.style.cssText =
      "min-width: 24px; text-align: center; font-weight: bold; " +
      "font-size: 16px;";

    const plusBtn = document.createElement("button");
    plusBtn.textContent = "+";
    plusBtn.style.cssText =
      "width: 32px; height: 32px; padding: 0; font-size: 18px; " +
      "background: #444; color: white; border: 1px solid #666; " +
      "border-radius: 4px; cursor: pointer;";
    plusBtn.addEventListener("click", () => this.handleBuy(index));

    controls.appendChild(minusBtn);
    controls.appendChild(countDisplay);
    controls.appendChild(plusBtn);
    rowEl.appendChild(controls);

    return { rowEl, countDisplay, minusBtn, plusBtn, priceDisplay };
  }

  private handleBuy(patternIndex: number): void {
    if (this.currentPlayer === null) return;
    if (this.game.buyPattern(this.currentPlayer, patternIndex)) {
      this.refresh();
    }
  }

  private handleSell(patternIndex: number): void {
    if (this.currentPlayer === null) return;
    if (this.game.sellPattern(this.currentPlayer, patternIndex)) {
      this.refresh();
    }
  }

  // Draw mini previews for each pattern in the given player's orientation.
  private renderPreviews(player: Player): void {
    const canvases = this.dom.buyOverlayPatternList.querySelectorAll(
      "canvas[data-pattern-index]",
    );
    canvases.forEach((c) => {
      const canvas = c as HTMLCanvasElement;
      const idx = Number(canvas.dataset.patternIndex);
      const pattern = PATTERNS[idx];
      if (pattern) {
        this.drawMiniPreview(canvas, pattern, player);
      }
    });
  }

  private drawMiniPreview(
    canvas: HTMLCanvasElement,
    pattern: Pattern,
    player: Player,
  ): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const playerPattern = getPatternForPlayer(pattern, player);
    const rows = playerPattern.cells.map(([r]) => r);
    const cols = playerPattern.cells.map(([, c]) => c);
    const minRow = Math.min(...rows);
    const maxRow = Math.max(...rows);
    const minCol = Math.min(...cols);
    const maxCol = Math.max(...cols);
    const patternHeight = maxRow - minRow + 1;
    const patternWidth = maxCol - minCol + 1;

    // Fit pattern into canvas with a small margin, cap cell size for tiny patterns.
    const margin = 4;
    const availW = canvas.width - 2 * margin;
    const availH = canvas.height - 2 * margin;
    const cellSize = Math.max(
      1,
      Math.min(
        6,
        Math.floor(Math.min(availW / patternWidth, availH / patternHeight)),
      ),
    );

    const drawW = patternWidth * cellSize;
    const drawH = patternHeight * cellSize;
    const offsetX = Math.floor((canvas.width - drawW) / 2);
    const offsetY = Math.floor((canvas.height - drawH) / 2);

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = CONFIG.COLOR_CELL;
    const px = Math.max(1, cellSize - 1);
    for (const [r, c] of playerPattern.cells) {
      const x = offsetX + (c - minCol) * cellSize;
      const y = offsetY + (r - minRow) * cellSize;
      ctx.fillRect(x, y, px, px);
    }
  }
}
