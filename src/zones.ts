// Zone definitions and validation

import type { Player } from "./types.js";

export class Zones {
  readonly cols: number;
  readonly leftEnd: number;
  readonly rightStart: number;

  // Endzonen (NEU)
  readonly endzoneWidth: number = 4;
  readonly endzoneLeftStart: number = 0;
  readonly endzoneLeftEnd: number;
  readonly endzoneRightStart: number;
  readonly endzoneRightEnd: number;
  readonly scoreColumnLeft: number = 3; // Score column at edge of left endzone
  readonly scoreColumnRight: number; // Punkt-Spalte rechts (Spieler 1)

  constructor(cols: number) {
    this.cols = cols;
    this.endzoneLeftEnd = this.endzoneWidth;
    this.endzoneRightStart = cols - this.endzoneWidth;
    this.endzoneRightEnd = cols;
    this.scoreColumnRight = cols - 4; // Score column at edge of right endzone

    // Placement zones adjusted for endzones
    this.leftEnd =
      this.endzoneLeftEnd + Math.floor((cols - 2 * this.endzoneWidth) * 0.25);
    this.rightStart =
      this.endzoneLeftEnd + Math.floor((cols - 2 * this.endzoneWidth) * 0.75);
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
