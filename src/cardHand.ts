// Card hand UI component for the place phase.
//
// Renders each player's hand of cards below the game area. Cards belonging
// to the inactive player are shown face-down (back pattern). Clicking an
// active player's card selects it for placement.

import type { Player, Card, Pattern } from "./types.js";
import { Game } from "./game.js";
import { PATTERNS } from "./patterns.js";
import { drawPatternPreview } from "./patternUtils.js";
import { CONFIG } from "./config.js";

export class CardHand {
  private game: Game;
  private container1: HTMLDivElement;
  private container2: HTMLDivElement;

  private activePlayer: Player = 1;
  private selectedCardId: string | null = null;

  // Fired when the active player clicks one of their cards.
  // A second click on the same card deselects it (selectedCardId=null).
  onCardSelect: ((cardId: string | null) => void) | null = null;

  constructor(
    game: Game,
    container1: HTMLDivElement,
    container2: HTMLDivElement,
  ) {
    this.game = game;
    this.container1 = container1;
    this.container2 = container2;
  }

  setActivePlayer(player: Player): void {
    this.activePlayer = player;
    this.selectedCardId = null;
    this.render();
  }

  setSelectedCard(cardId: string | null): void {
    this.selectedCardId = cardId;
    this.render();
  }

  getSelectedCardId(): string | null {
    return this.selectedCardId;
  }

  render(): void {
    this.renderPlayerHand(1, this.container1);
    this.renderPlayerHand(2, this.container2);
  }

  clear(): void {
    this.container1.innerHTML = "";
    this.container2.innerHTML = "";
    this.selectedCardId = null;
  }

  private renderPlayerHand(player: Player, container: HTMLDivElement): void {
    container.innerHTML = "";
    const hand = this.game.getHand(player);
    const isActive = player === this.activePlayer;

    if (hand.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "— no cards —";
      empty.style.cssText = "color: #666; font-size: 13px; padding: 8px;";
      container.appendChild(empty);
      return;
    }

    for (const card of hand) {
      const el = this.createCardElement(card, player, isActive);
      container.appendChild(el);
    }
  }

  private createCardElement(
    card: Card,
    player: Player,
    isActive: boolean,
  ): HTMLDivElement {
    const playerColor =
      player === 1 ? CONFIG.COLOR_PLAYER1 : CONFIG.COLOR_PLAYER2;

    const el = document.createElement("div");
    el.dataset.cardId = card.id;

    const isSelected = isActive && this.selectedCardId === card.id;
    const borderColor = isSelected ? "#00ff00" : playerColor;
    const borderWidth = isSelected ? "3px" : "2px";

    el.style.cssText = `
      width: 72px;
      height: 92px;
      border: ${borderWidth} solid ${borderColor};
      border-radius: 6px;
      background: #1a1a1a;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: ${isActive ? "pointer" : "default"};
      opacity: ${isActive ? "1" : "0.6"};
      flex-shrink: 0;
      transition: transform 0.1s;
    `;

    if (isActive) {
      // Face up: mini preview + name
      const canvas = document.createElement("canvas");
      canvas.width = 56;
      canvas.height = 56;
      canvas.style.cssText = "background: #000;";
      el.appendChild(canvas);
      const pattern = PATTERNS[card.patternIndex];
      if (pattern) {
        this.drawMiniPreview(canvas, pattern, player);
        const nameEl = document.createElement("div");
        nameEl.textContent = pattern.name;
        nameEl.style.cssText =
          "font-size: 10px; margin-top: 4px; color: #ccc; text-align: center;";
        el.appendChild(nameEl);
      }

      el.addEventListener("click", () => {
        if (!this.onCardSelect) return;
        // Toggle: clicking the same card deselects.
        const next = this.selectedCardId === card.id ? null : card.id;
        this.onCardSelect(next);
      });

      el.addEventListener("mouseenter", () => {
        if (!isSelected) el.style.transform = "translateY(-4px)";
      });
      el.addEventListener("mouseleave", () => {
        el.style.transform = "translateY(0)";
      });
    } else {
      // Face down: solid back with player color
      const back = document.createElement("div");
      back.style.cssText = `
        width: 56px;
        height: 72px;
        background: repeating-linear-gradient(
          45deg,
          ${playerColor},
          ${playerColor} 4px,
          #000 4px,
          #000 8px
        );
        border-radius: 4px;
        opacity: 0.5;
      `;
      el.appendChild(back);
    }

    return el;
  }

  private drawMiniPreview(
    canvas: HTMLCanvasElement,
    pattern: Pattern,
    player: Player,
  ): void {
    drawPatternPreview(canvas, pattern, player, {
      cellColor: CONFIG.COLOR_CELL,
      margin: 3,
      maxCellSize: 5,
    });
  }
}
