// Zone definitions and validation

import type { Player } from "./types.js";

export class Zones {
  readonly cols: number;
  readonly leftEnd: number;
  readonly rightStart: number;

  constructor(cols: number) {
    this.cols = cols;
    this.leftEnd = Math.floor(cols * 0.25); // Linke 25%
    this.rightStart = Math.floor(cols * 0.75); // Rechte 25%
  }

  isValidPlacement(col: number, player: Player): boolean {
    if (player === 1) {
      // Spieler 1: Nur linke Zone
      return col < this.leftEnd;
    } else {
      // Spieler 2: Nur rechte Zone
      return col >= this.rightStart;
    }
  }
}
