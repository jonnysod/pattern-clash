// Buy Overlay UI component.
//
// Presents the buy-phase interface: list of all patterns with mini-previews,
// +/- controls, budget + slot counters, and a confirm button. Owns no game
// state — reads from Game, writes via Game.buyPattern/sellPattern.

import type { Player, Pattern } from "./types.js";
import type { DOMRefs } from "./domRefs.js";
import { Game } from "./game.js";
import { PATTERNS } from "./patterns.js";
import { drawPatternPreview } from "./patternUtils.js";
import { CONFIG, simGenerationsForPhase } from "./config.js";

interface PatternRowRefs {
  countDisplay: HTMLSpanElement;
  minusBtn: HTMLButtonElement;
  plusBtn: HTMLButtonElement;
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

  private confirmHandler: (() => void) | null = null;

  constructor(game: Game, dom: DOMRefs) {
    this.game = game;
    this.dom = dom;

    this.confirmHandler = () => {
      if (this.currentPlayer !== null && this.onConfirm) {
        this.onConfirm(this.currentPlayer);
      }
    };
    this.dom.buyOverlayConfirmBtn.addEventListener(
      "click",
      this.confirmHandler,
    );
  }

  // Removes the confirm-button listener. buyOverlayConfirmBtn is a
  // persistent DOM node shared across UIController restarts — without this,
  // each new BuyOverlay instance stacks another listener onto it.
  destroy(): void {
    if (this.confirmHandler) {
      this.dom.buyOverlayConfirmBtn.removeEventListener(
        "click",
        this.confirmHandler,
      );
      this.confirmHandler = null;
    }
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

    // Simulation length for this phase. Shown here because the buy overlay
    // blocks the status bar — you can't shop for reach you can't see, and
    // the ramp is only a planning tool if it's known before spending.
    const generations = this.game.simGenerations;
    this.dom.buyOverlayGenerations.textContent = String(generations);
    const previous = simGenerationsForPhase(
      this.game.currentPhaseNumber - 1,
    );
    this.dom.buyOverlayGenerationsDelta.textContent =
      this.game.currentPhaseNumber > 1 ? `+${generations - previous}` : "";

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
    priceEl.textContent = `Cost: ${pattern.cells.length}`;
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

    return { rowEl, countDisplay, minusBtn, plusBtn };
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
    drawPatternPreview(canvas, pattern, player, {
      cellColor: CONFIG.COLOR_CELL,
      margin: 4,
      maxCellSize: 6,
    });
  }
}
