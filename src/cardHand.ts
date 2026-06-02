// Card hand UI component for the place phase.
//
// Renders each player's hand of cards below the game area. Cards belonging
// to the inactive player are shown face-down (back pattern). Clicking an
// active player's card selects it for placement.

import type { Player, Card, Pattern, BuyInventoryEntry } from "./types.js";
import { PATTERNS } from "./patterns.js";
import { drawPatternPreview } from "./patternUtils.js";
import { CONFIG } from "./config.js";

// Minimal interface CardHand needs from its data source.
// Game satisfies this structurally; the puzzle harness provides its own implementation.
export interface CardProvider {
  getHand(player: Player): Card[];
  getInventory(player: Player): BuyInventoryEntry[];
}

export class CardHand {
  private provider: CardProvider;
  private container1: HTMLDivElement;
  private container2: HTMLDivElement;

  // Which player is currently allowed to click cards (the one whose
  // turn it is in the place phase).
  private activePlayer: Player = 1;

  // Which player's cards are face-up.
  // Hotseat: always equal to activePlayer (cards swap visibility on
  //          turn change).
  // Online:  the local player; the opponent is always face-down.
  private visiblePlayer: Player = 1;

  private selectedCardId: string | null = null;

  // Players whose hand container should show a "waiting" message
  // instead of the actual hand. Used during online buy phase to
  // indicate the opponent hasn't confirmed yet.
  private waitingPlayers: Set<Player> = new Set();

  // Players whose container should show their *inventory* as cards,
  // not the actual game hand. Used online during the gap between
  // local buy-confirm and finalizeBuyPhase: the player has chosen
  // their cards but they aren't in handPlayer* yet (waiting for the
  // opponent to confirm). We render previews from the inventory so
  // the player can see what they bought.
  private previewPlayers: Set<Player> = new Set();

  // Fired when the active player clicks one of their cards.
  // A second click on the same card deselects it (selectedCardId=null).
  onCardSelect: ((cardId: string | null) => void) | null = null;

  constructor(
    provider: CardProvider,
    container1: HTMLDivElement,
    container2: HTMLDivElement,
  ) {
    this.provider = provider;
    this.container1 = container1;
    this.container2 = container2;
  }

  setActivePlayer(player: Player): void {
    this.activePlayer = player;
    this.selectedCardId = null;
    // Hotseat default: visible follows active.
    // (Online callers explicitly call setVisiblePlayer once after construction.)
    this.visiblePlayer = player;
    this.render();
  }

  // Online: pin which player's hand is shown face-up. Call once after
  // construction; subsequent setActivePlayer will overwrite, so for
  // online use, call this after each setActivePlayer too — or use the
  // helper setActiveAndVisible.
  setVisiblePlayer(player: Player): void {
    this.visiblePlayer = player;
    this.render();
  }

  // Set both at once. Used in online mode where visiblePlayer stays
  // pinned to the local player but activePlayer alternates.
  setActiveAndVisible(active: Player, visible: Player): void {
    this.activePlayer = active;
    this.visiblePlayer = visible;
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

  // Mark a player's hand container as "waiting for the player to act"
  // (renders a centered message instead of the hand). Used during
  // online buy phase.
  setWaiting(player: Player, waiting: boolean): void {
    if (waiting) {
      this.waitingPlayers.add(player);
    } else {
      this.waitingPlayers.delete(player);
    }
    this.render();
  }

  clearAllWaiting(): void {
    this.waitingPlayers.clear();
    this.render();
  }

  // Mark a player's container to render their inventory as cards.
  // Used online between local buy-confirm and finalizeBuyPhase.
  setPreview(player: Player, preview: boolean): void {
    if (preview) {
      this.previewPlayers.add(player);
    } else {
      this.previewPlayers.delete(player);
    }
    this.render();
  }

  clearAllPreview(): void {
    this.previewPlayers.clear();
    this.render();
  }

  render(): void {
    this.renderPlayerHand(1, this.container1);
    this.renderPlayerHand(2, this.container2);
  }

  clear(): void {
    this.container1.innerHTML = "";
    this.container2.innerHTML = "";
    this.selectedCardId = null;
    this.waitingPlayers.clear();
    this.previewPlayers.clear();
  }

  private renderPlayerHand(player: Player, container: HTMLDivElement): void {
    container.innerHTML = "";

    if (this.waitingPlayers.has(player)) {
      const msg = document.createElement("div");
      msg.textContent = "Waiting for opponent…";
      msg.style.cssText =
        "color: #888; font-size: 14px; padding: 30px 8px; " +
        "text-align: center; width: 100%; font-style: italic;";
      container.appendChild(msg);
      return;
    }

    // Preview mode: render the inventory as fake cards. patternIndex
    // is real (so the mini-preview draws correctly); id is synthetic
    // (preview cards aren't selectable).
    const isPreview = this.previewPlayers.has(player);
    const cards: Card[] = isPreview
      ? this.expandInventoryAsPreviewCards(player)
      : this.provider.getHand(player);

    const isVisible = player === this.visiblePlayer;
    // In preview mode, cards are non-clickable: the "active turn"
    // notion only applies in place phase.
    const isActive = !isPreview && player === this.activePlayer;

    if (cards.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "— no cards —";
      empty.style.cssText = "color: #666; font-size: 13px; padding: 8px;";
      container.appendChild(empty);
      return;
    }

    for (const card of cards) {
      const el = this.createCardElement(card, player, isVisible, isActive);
      container.appendChild(el);
    }
  }

  private expandInventoryAsPreviewCards(player: Player): Card[] {
    const inventory = this.provider.getInventory(player);
    const cards: Card[] = [];
    let n = 0;
    for (const entry of inventory) {
      for (let i = 0; i < entry.count; i++) {
        cards.push({
          id: `preview-${player}-${n++}`,
          patternIndex: entry.patternIndex,
        });
      }
    }
    return cards;
  }

  private createCardElement(
    card: Card,
    player: Player,
    isVisible: boolean,
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

    if (isVisible) {
      // Face up: mini preview + name (only if pattern is resolved;
      // placeholders have patternIndex = -1)
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

      // Click only enabled if this player is also active
      if (isActive) {
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
      }
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
