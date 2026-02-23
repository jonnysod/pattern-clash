// UI event handlers and interactions

import type { Pattern, Player } from "./types.js";
import { Game } from "./game.js";
import { Renderer, PreviewRenderer } from "./rendering.js";
import { PATTERNS } from "./patterns.js";
import { rotatePattern, getPatternForPlayer } from "./patternUtils.js";
const TURN_DURATION = 7000; // 7 seconds in milliseconds
const MAX_PAUSES_PER_PLAYER = 3;
const PAUSE_DURATION = 10000;
const PAUSE_DECISION_DURATION = 3000;

//#region TurnTimer Class
class TurnTimer {
  private duration: number;
  private remainingTime: number;
  private intervalId: number | null = null;
  private onTimeoutCallback: () => void;
  private onTickCallback: (remaining: number, total: number) => void;

  constructor(
    duration: number,
    onTimeout: () => void,
    onTick: (remaining: number, total: number) => void,
  ) {
    this.duration = duration;
    this.remainingTime = duration;
    this.onTimeoutCallback = onTimeout;
    this.onTickCallback = onTick;
  }

  start(): void {
    this.remainingTime = this.duration;
    this.onTickCallback(this.remainingTime, this.duration);

    this.intervalId = window.setInterval(() => {
      this.remainingTime -= 100;

      if (this.remainingTime <= 0) {
        this.stop();
        this.onTimeoutCallback();
      } else {
        this.onTickCallback(this.remainingTime, this.duration);
      }
    }, 100);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  reset(): void {
    this.stop();
    this.remainingTime = this.duration;
  }
}
//#endregion

export class UIController {
  private game: Game;
  private renderer: Renderer;
  private previewRenderer1: PreviewRenderer;
  private previewRenderer2: PreviewRenderer;
  private cellSize: number;

  private selectedPattern1: Pattern | null = null;
  private selectedPattern2: Pattern | null = null;
  private animationId: number | null = null;

  // Turn-based system
  private activePlayer: Player = 1;
  private player1Ready: boolean = false;
  private player2Ready: boolean = false;

  // Live phase turn system (can be disabled for online multiplayer)
  private enableTurnRestriction: boolean = true; // Set to false for free-for-all
  private turnTimer: TurnTimer | null = null;
  private pauseDecisionTimer: TurnTimer | null = null;
  private pauseDecisionOverlayVisible: boolean = false;

  constructor(
    game: Game,
    renderer: Renderer,
    previewRenderer1: PreviewRenderer,
    previewRenderer2: PreviewRenderer,
    cellSize: number,
  ) {
    this.game = game;
    this.renderer = renderer;
    this.previewRenderer1 = previewRenderer1;
    this.previewRenderer2 = previewRenderer2;
    this.cellSize = cellSize;

    this.setupEventListeners();

    // Initialize UI
    this.updatePointsDisplay();
    this.updateGenerationDisplay();
    this.updateActivePlayerUI();
  }

  private setupEventListeners(): void {
    this.setupCanvasClick();
    this.setupCanvasHover();
    this.setupSurrenderButtons();
    this.setupPatternButtons();
    this.setupReadyButtons();
    this.setupRestartButton();
    this.setupPreviewToggleButtons();
  }

  private setupCanvasClick(): void {
    const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
    canvas.addEventListener("click", (e) => {
      // In placement phase: only allow if not running
      // In live phase: allow placement during simulation
      if (this.game.isRunning && !this.game.isLivePhase) {
        return;
      }

      // Check turn restriction (only in hot-seat mode during live phase)
      if (
        this.game.isLivePhase &&
        this.enableTurnRestriction &&
        !this.isPlayersTurn(this.getClickingPlayer(e))
      ) {
        return; // Not this player's turn
      }

      // During pause: only pausing player can place
      if (
        this.game.isPaused &&
        this.game.pausingPlayer !== this.getClickingPlayer(e)
      ) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const col = Math.floor(x / this.cellSize);
      const row = Math.floor(y / this.cellSize);

      // Determine which player is clicking (based on active player)
      const clickingPlayer = this.game.isLivePhase
        ? this.getClickingPlayer(e)
        : this.activePlayer;

      const selectedPattern =
        clickingPlayer === 1 ? this.selectedPattern1 : this.selectedPattern2;

      if (selectedPattern) {
        // Place rotated and player-specific pattern
        const playerPattern = getPatternForPlayer(
          selectedPattern,
          clickingPlayer,
        );
        const success = this.game.placePattern(
          row,
          col,
          playerPattern,
          clickingPlayer,
        );

        if (success) {
          this.updatePointsDisplay();

          // In placement phase: switch turn as before
          // In live phase: switch turn and restart timer
          if (this.game.isLivePhase) {
            if (!this.game.isPaused) {
              this.switchTurnLivePhase();
            }
            // During pause: don't switch turn, just update buttons
          } else {
            this.switchTurn();
          }
        } else {
          this.renderer.flashInvalidPlacement(col, row);
        }
      }
      this.renderer.drawGrid();
    });
  }

  // Helper: Determine which player is clicking (for future online mode)
  private getClickingPlayer(e: MouseEvent): Player {
    // In hot-seat mode, this is always the active player
    // In online mode, this would be determined by the client
    return this.activePlayer;
  }

  // Helper: Check if it's this player's turn (respects enableTurnRestriction)
  private isPlayersTurn(player: Player): boolean {
    if (!this.enableTurnRestriction) return true; // Free-for-all mode
    return player === this.activePlayer;
  }

  private setupCanvasHover(): void {
    const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;

    canvas.addEventListener("mousemove", (e) => {
      // Allow hover preview in placement phase and live phase
      if (this.game.isRunning && !this.game.isLivePhase) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const col = Math.floor(x / this.cellSize);
      const row = Math.floor(y / this.cellSize);

      this.drawHoverPreview(row, col);
    });

    canvas.addEventListener("mouseleave", () => {
      // Redraw without preview when mouse leaves
      this.renderer.drawGrid();
    });
  }

  private setupSurrenderButtons(): void {
    document.getElementById("surrender1Btn")!.addEventListener("click", () => {
      if (confirm("Surrender? Your opponent wins!")) {
        this.game.surrender(1);
        this.showWinner();
      }
    });

    document.getElementById("surrender2Btn")!.addEventListener("click", () => {
      if (confirm("Surrender? Your opponent wins!")) {
        this.game.surrender(2);
        this.showWinner();
      }
    });
  }

  private setupPatternButtons(): void {
    const player1Btn = document.getElementById("player1Btn")!;
    const player2Btn = document.getElementById("player2Btn")!;

    // Pattern selection handlers für Spieler 1
    document.querySelectorAll(".player1-pattern").forEach((btn) => {
      btn.addEventListener("click", () => {
        player1Btn.style.fontWeight = "bold";
        player1Btn.style.opacity = "1";
        player2Btn.style.fontWeight = "normal";
        player2Btn.style.opacity = "0.6";

        const patternIndex = parseInt(btn.getAttribute("data-pattern")!);
        this.selectedPattern1 = PATTERNS[patternIndex]!;
        this.previewRenderer1.drawPreview(this.selectedPattern1, 1);
        this.updatePatternInfo(1, this.selectedPattern1);
        // Reset preview toggle button
        document.getElementById("previewToggle1")!.textContent = "▶";
      });
    });

    // Pattern selection handlers für Spieler 2
    document.querySelectorAll(".player2-pattern").forEach((btn) => {
      btn.addEventListener("click", () => {
        player2Btn.style.opacity = "1";
        player1Btn.style.fontWeight = "normal";
        player1Btn.style.opacity = "0.6";

        const patternIndex = parseInt(btn.getAttribute("data-pattern")!);
        this.selectedPattern2 = PATTERNS[patternIndex]!;
        this.previewRenderer2.drawPreview(this.selectedPattern2, 2);
        this.updatePatternInfo(2, this.selectedPattern2);
        // Reset preview toggle button
        document.getElementById("previewToggle2")!.textContent = "▶";
      });
    });
  }

  private setupReadyButtons(): void {
    document.getElementById("ready1Btn")!.addEventListener("click", () => {
      if (this.game.isLivePhase) {
        // Live phase: Pause button
        this.startPause(1);
        return;
      }

      if (this.game.isRunning) return;

      this.player1Ready = true;
      const btn = document.getElementById("ready1Btn")! as HTMLButtonElement;
      btn.disabled = true;
      btn.style.opacity = "0.5";

      this.switchTurn();
    });

    document.getElementById("ready2Btn")!.addEventListener("click", () => {
      if (this.game.isLivePhase) {
        // Live phase: Pause button
        this.startPause(2);
        return;
      }

      if (this.game.isRunning) return;

      this.player2Ready = true;
      const btn = document.getElementById("ready2Btn")! as HTMLButtonElement;
      btn.disabled = true;
      btn.style.opacity = "0.5";

      this.switchTurn();
    });
  }

  private setupRestartButton(): void {
    document.getElementById("restartBtn")!.addEventListener("click", () => {
      // Stop and reset timer
      if (this.turnTimer) {
        this.turnTimer.stop();
        this.turnTimer = null;
      }

      // Hide timer UI
      document.getElementById("turnTimerContainer")!.style.visibility =
        "hidden";

      // Hide winner overlay
      document.getElementById("winnerOverlay")!.style.display = "none";

      // Reset game
      this.game.reset();
      this.renderer.drawGrid();

      // Reset UI state
      this.activePlayer = 1;
      this.player1Ready = false;
      this.player2Ready = false;
      this.selectedPattern1 = null;
      this.selectedPattern2 = null;

      // Reset pause state
      if (this.pauseDecisionTimer) {
        this.pauseDecisionTimer.stop();
        this.pauseDecisionTimer = null;
      }
      document.getElementById("pauseDecisionOverlay")!.style.display = "none";
      this.pauseDecisionOverlayVisible = false;

      // Re-enable controls
      this.enablePlayerControls(1);
      this.updateActivePlayerUI();

      // Update displays
      this.updatePointsDisplay();
      this.updateGenerationDisplay();

      // Re-enable ready buttons
      const ready1 = document.getElementById("ready1Btn")! as HTMLButtonElement;
      const ready2 = document.getElementById("ready2Btn")! as HTMLButtonElement;
      ready1.disabled = false;
      ready1.style.opacity = "1";
      ready1.textContent = "Ready!";
      ready2.disabled = false;
      ready2.style.opacity = "1";
      ready2.textContent = "Ready!";

      // Clear previews
      this.previewRenderer1.drawPreview(null, 1);
      this.previewRenderer2.drawPreview(null, 2);

      // Clear pattern info
      this.updatePatternInfo(1, null);
      this.updatePatternInfo(2, null);

      // Reset preview toggle buttons
      document.getElementById("previewToggle1")!.textContent = "▶";
      document.getElementById("previewToggle2")!.textContent = "▶";
    });
  }

  private setupPreviewToggleButtons(): void {
    const toggle1 = document.getElementById("previewToggle1")!;
    const toggle2 = document.getElementById("previewToggle2")!;

    toggle1.addEventListener("click", () => {
      const isPlaying = this.previewRenderer1.togglePlayPause();
      toggle1.textContent = isPlaying ? "⏸" : "▶";
    });

    toggle2.addEventListener("click", () => {
      const isPlaying = this.previewRenderer2.togglePlayPause();
      toggle2.textContent = isPlaying ? "⏸" : "▶";
    });
  }

  private animate = (): void => {
    if (!this.game.isRunning) return;
    if (this.game.isPaused) {
      // Keep animation loop alive but don't advance
      this.animationId = requestAnimationFrame(this.animate);
      return;
    }

    this.game.computeNextGeneration();
    this.renderer.drawGrid();

    // Update score display
    this.updatePointsDisplay();
    this.updateGenerationDisplay();

    // Check if game ended
    if (!this.game.isRunning) {
      this.showWinner();
      return;
    }

    setTimeout(() => {
      this.animationId = requestAnimationFrame(this.animate);
    }, 80); // 80ms between generations = ~12 FPS
  };

  private updatePointsDisplay(): void {
    document.getElementById("points1")!.textContent =
      this.game.pointsPlayer1.toString();
    document.getElementById("points2")!.textContent =
      this.game.pointsPlayer2.toString();
  }

  private updateGenerationDisplay(): void {
    document.getElementById("generationCounter")!.textContent =
      this.game.currentGeneration.toString();
    document.getElementById("maxGenerations")!.textContent =
      this.game.maxGenerations.toString();
  }

  private drawHoverPreview(row: number, col: number): void {
    // Redraw grid first
    this.renderer.drawGrid();

    // Get selected pattern for active player
    const selectedPattern =
      this.activePlayer === 1 ? this.selectedPattern1 : this.selectedPattern2;

    if (!selectedPattern) return;

    // Apply player-specific transformation and rotation
    const playerPattern = getPatternForPlayer(
      selectedPattern,
      this.activePlayer,
    );

    // Check if placement is valid
    const isValid = this.game.zones.isValidPlacement(col, this.activePlayer);

    // Draw preview with transparency
    const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = isValid ? "rgba(0, 255, 0, 0.3)" : "rgba(255, 0, 0, 0.3)"; // Green if valid, red if not

    for (const [rowOffset, colOffset] of playerPattern.cells) {
      const previewRow = row + rowOffset;
      const previewCol = col + colOffset;

      if (
        previewRow >= 0 &&
        previewRow < this.game.rows &&
        previewCol >= 0 &&
        previewCol < this.game.cols
      ) {
        ctx.fillRect(
          previewCol * this.cellSize,
          previewRow * this.cellSize,
          this.cellSize - 1,
          this.cellSize - 1,
        );
      }
    }
  }

  private updatePatternInfo(player: Player, pattern: Pattern | null): void {
    const nameElement = document.getElementById(
      player === 1 ? "patternName1" : "patternName2",
    )!;
    const costElement = document.getElementById(
      player === 1 ? "patternCost1" : "patternCost2",
    )!;

    if (pattern) {
      nameElement.textContent = pattern.name;
      costElement.textContent = `Cost: ${pattern.cells.length}`;
    } else {
      nameElement.textContent = "-";
      costElement.textContent = "Cost: -";
    }
  }

  private updatePatternButtonStates(): void {
    // Player 1 buttons
    document.querySelectorAll(".player1-pattern").forEach((btn) => {
      const patternIndex = parseInt(btn.getAttribute("data-pattern")!);
      const pattern = PATTERNS[patternIndex]!;
      const canAfford = this.game.pointsPlayer1 >= pattern.cells.length;
      const isActive = this.activePlayer === 1;

      (btn as HTMLButtonElement).disabled = !isActive || !canAfford;
      (btn as HTMLButtonElement).style.opacity = !isActive
        ? "0.3"
        : canAfford
          ? "1"
          : "0.3";
    });

    // Player 2 buttons
    document.querySelectorAll(".player2-pattern").forEach((btn) => {
      const patternIndex = parseInt(btn.getAttribute("data-pattern")!);
      const pattern = PATTERNS[patternIndex]!;
      const canAfford = this.game.pointsPlayer2 >= pattern.cells.length;
      const isActive = this.activePlayer === 2;

      (btn as HTMLButtonElement).disabled = !isActive || !canAfford;
      (btn as HTMLButtonElement).style.opacity = !isActive
        ? "0.3"
        : canAfford
          ? "1"
          : "0.3";
    });

    // Deselect if current pattern is now too expensive
    if (
      this.selectedPattern1 &&
      this.game.pointsPlayer1 < this.selectedPattern1.cells.length
    ) {
      this.selectedPattern1 = null;
      this.previewRenderer1.drawPreview(null, 1);
      this.updatePatternInfo(1, null);
    }
    if (
      this.selectedPattern2 &&
      this.game.pointsPlayer2 < this.selectedPattern2.cells.length
    ) {
      this.selectedPattern2 = null;
      this.previewRenderer2.drawPreview(null, 2);
      this.updatePatternInfo(2, null);
    }
  }

  private showWinner(): void {
    // Stop timer when game ends
    if (this.turnTimer) {
      this.turnTimer.stop();
      this.turnTimer = null;
    }

    // Hide timer UI
    document.getElementById("turnTimerContainer")!.style.visibility = "hidden";

    const result = this.game.getWinner();
    const overlay = document.getElementById("winnerOverlay")!;
    const title = document.getElementById("winnerTitle")!;
    const score = document.getElementById("winnerScore")!;

    const restartBtn = document.getElementById("restartBtn")!;

    if (result.winner === 1) {
      title.textContent = "Player 1 Wins!";
      title.style.color = "#44dddd";
      restartBtn.style.backgroundColor = "#44dddd";
    } else if (result.winner === 2) {
      title.textContent = "Player 2 Wins!";
      title.style.color = "#dd44dd";
      restartBtn.style.backgroundColor = "#dd44dd";
    } else {
      title.textContent = "It's a Tie!";
      title.style.color = "#ffaa00";
      restartBtn.style.backgroundColor = "#ffaa00";
    }

    score.textContent = `Score: ${result.player1Score} - ${result.player2Score}`;
    overlay.style.display = "flex";
  }

  private switchTurn(): void {
    // Switch to other player
    if (this.activePlayer === 1) {
      // Check if Player 2 has points left
      if (this.game.canAffordAnyPattern(2) && !this.player2Ready) {
        this.activePlayer = 2;
      }
    } else {
      // Check if Player 1 has points left
      if (this.game.canAffordAnyPattern(1) && !this.player1Ready) {
        this.activePlayer = 1;
      }
    }

    this.updateActivePlayerUI();
    this.checkGameStart();
  }

  private updateActivePlayerUI(): void {
    const player1Btn = document.getElementById("player1Btn")!;
    const player2Btn = document.getElementById("player2Btn")!;

    if (this.activePlayer === 1) {
      // Player 1 is active
      player1Btn.style.opacity = "1";
      player1Btn.style.boxShadow = "0 0 15px #44dddd";
      player2Btn.style.opacity = "0.5";
      player2Btn.style.boxShadow = "none";

      this.enablePlayerControls(1);
      this.disablePlayerControls(2);
      this.enablePreview(1);
      this.disablePreview(2);
    } else {
      // Player 2 is active
      player1Btn.style.opacity = "0.5";
      player1Btn.style.boxShadow = "none";
      player2Btn.style.opacity = "1";
      player2Btn.style.boxShadow = "0 0 15px #dd44dd";

      this.enablePlayerControls(2);
      this.disablePlayerControls(1);
      this.enablePreview(2);
      this.disablePreview(1);
    }

    this.updatePatternButtonStates();
    // Update pause button states in live phase
    if (this.game.isLivePhase) {
      this.updatePauseButtonLabels();

      const btn1 = document.getElementById("ready1Btn")! as HTMLButtonElement;
      const btn2 = document.getElementById("ready2Btn")! as HTMLButtonElement;

      if (this.game.isPaused) {
        // During pause: only pausing player can interact
        btn1.disabled = true;
        btn1.style.opacity = "0.3";
        btn2.disabled = true;
        btn2.style.opacity = "0.3";
      } else {
        btn1.disabled = this.activePlayer !== 1 || this.game.pausesPlayer1 <= 0;
        btn1.style.opacity = btn1.disabled ? "0.3" : "1";
        btn2.disabled = this.activePlayer !== 2 || this.game.pausesPlayer2 <= 0;
        btn2.style.opacity = btn2.disabled ? "0.3" : "1";
      }
    }
  }

  private enablePreview(player: Player): void {
    const canvas = document.getElementById(
      player === 1 ? "previewCanvas1" : "previewCanvas2",
    )!;
    const toggle = document.getElementById(
      player === 1 ? "previewToggle1" : "previewToggle2",
    )! as HTMLButtonElement;

    canvas.style.opacity = "1";
    toggle.style.opacity = "1";
    toggle.disabled = false;
    toggle.textContent = "▶";
  }

  private disablePreview(player: Player): void {
    const canvas = document.getElementById(
      player === 1 ? "previewCanvas1" : "previewCanvas2",
    )!;
    const toggle = document.getElementById(
      player === 1 ? "previewToggle1" : "previewToggle2",
    )! as HTMLButtonElement;
    const renderer =
      player === 1 ? this.previewRenderer1 : this.previewRenderer2;
    const pattern =
      player === 1 ? this.selectedPattern1 : this.selectedPattern2;

    // Reset preview to initial state
    renderer.drawPreview(pattern, player);

    canvas.style.opacity = "0.3";
    toggle.style.opacity = "0.3";
    toggle.disabled = true;
    toggle.textContent = "▶";
  }

  private enablePlayerControls(player: Player): void {
    const patterns =
      player === 1
        ? document.querySelectorAll(".player1-pattern")
        : document.querySelectorAll(".player2-pattern");
    const rotateLeft = document.getElementById(
      player === 1 ? "rotateLeft1" : "rotateLeft2",
    )! as HTMLButtonElement;
    const rotateRight = document.getElementById(
      player === 1 ? "rotateRight1" : "rotateRight2",
    )! as HTMLButtonElement;

    patterns.forEach((btn) => {
      (btn as HTMLButtonElement).disabled = false;
      (btn as HTMLButtonElement).style.opacity = "1";
    });

    // Enable ready/pause button
    const readyBtn = document.getElementById(
      player === 1 ? "ready1Btn" : "ready2Btn",
    )! as HTMLButtonElement;

    if (this.game.isLivePhase) {
      const pausesLeft =
        player === 1 ? this.game.pausesPlayer1 : this.game.pausesPlayer2;
      readyBtn.disabled = pausesLeft <= 0;
      readyBtn.style.opacity = pausesLeft > 0 ? "1" : "0.3";
    } else {
      const isReady = player === 1 ? this.player1Ready : this.player2Ready;
      if (!isReady) {
        readyBtn.disabled = false;
        readyBtn.style.opacity = "1";
      }
    }
    // Enable surrender button
    const surrenderBtn = document.getElementById(
      player === 1 ? "surrender1Btn" : "surrender2Btn",
    )! as HTMLButtonElement;
    surrenderBtn.disabled = false;
    surrenderBtn.style.opacity = "1";
  }

  private disablePlayerControls(player: Player): void {
    const patterns =
      player === 1
        ? document.querySelectorAll(".player1-pattern")
        : document.querySelectorAll(".player2-pattern");
    const rotateLeft = document.getElementById(
      player === 1 ? "rotateLeft1" : "rotateLeft2",
    )! as HTMLButtonElement;
    const rotateRight = document.getElementById(
      player === 1 ? "rotateRight1" : "rotateRight2",
    )! as HTMLButtonElement;

    patterns.forEach((btn) => {
      (btn as HTMLButtonElement).disabled = true;
      (btn as HTMLButtonElement).style.opacity = "0.3";
    });

    // Disable player button (NEU)
    const playerBtn = document.getElementById(
      player === 1 ? "player1Btn" : "player2Btn",
    )! as HTMLButtonElement;
    playerBtn.disabled = true;

    // Disable ready button (NEU)
    const readyBtn = document.getElementById(
      player === 1 ? "ready1Btn" : "ready2Btn",
    )! as HTMLButtonElement;
    readyBtn.disabled = true;
    readyBtn.style.opacity = "0.3";
    // Disable surrender button
    const surrenderBtn = document.getElementById(
      player === 1 ? "surrender1Btn" : "surrender2Btn",
    )! as HTMLButtonElement;
    surrenderBtn.disabled = true;
    surrenderBtn.style.opacity = "0.3";
  }

  private checkGameStart(): void {
    // Start game if both players are ready or out of points
    const p1Done = this.player1Ready || !this.game.canAffordAnyPattern(1);
    const p2Done = this.player2Ready || !this.game.canAffordAnyPattern(2);

    if (p1Done && p2Done) {
      this.startLivePhase();
    }
  }

  private startLivePhase(): void {
    this.game.isRunning = true;
    this.game.isLivePhase = true;

    // Show turn timer UI
    document.getElementById("turnTimerContainer")!.style.visibility = "visible";

    // Start animation
    this.animate();

    // Re-enable player controls for live phase
    this.enablePlayerControls(1);
    this.enablePlayerControls(2);

    // Convert ready buttons to pause buttons
    this.updatePauseButtonLabels();

    // Start turn timer
    this.activePlayer = 1; // Reset to player 1
    this.startTurnTimer();
    this.updateActivePlayerUI();
  }

  private startTurnTimer(): void {
    if (this.turnTimer) {
      this.turnTimer.stop();
    }

    this.turnTimer = new TurnTimer(
      TURN_DURATION,
      () => this.onTurnTimeout(),
      (remaining, total) => this.updateTimerDisplay(remaining, total),
    );

    this.turnTimer.start();
  }

  private onTurnTimeout(): void {
    // Timer ran out, switch to next player
    this.switchTurnLivePhase();
  }

  private updateTimerDisplay(remaining: number, total: number): void {
    const barElement = document.getElementById("turnTimerBar")!;

    // Update bar width
    const percentage = (remaining / total) * 100;
    barElement.style.width = `${percentage}%`;

    // Update bar color based on active player
    barElement.style.backgroundColor =
      this.activePlayer === 1 ? "#44dddd" : "#dd44dd";
  }

  private switchTurnLivePhase(): void {
    // Determine next player
    let nextPlayer: Player;

    if (this.activePlayer === 1) {
      // Try to switch to Player 2
      if (this.game.canAffordAnyPattern(2)) {
        nextPlayer = 2;
      } else {
        // Player 2 has no points, stay with Player 1
        nextPlayer = 1;
      }
    } else {
      // Try to switch to Player 1
      if (this.game.canAffordAnyPattern(1)) {
        nextPlayer = 1;
      } else {
        // Player 1 has no points, stay with Player 2
        nextPlayer = 2;
      }
    }

    // If both players have no points, don't switch
    if (
      !this.game.canAffordAnyPattern(1) &&
      !this.game.canAffordAnyPattern(2)
    ) {
      this.turnTimer?.stop();
      document.getElementById("turnTimerContainer")!.style.visibility =
        "hidden";
      return;
    }

    this.activePlayer = nextPlayer;
    this.updateActivePlayerUI();

    // Restart timer
    this.startTurnTimer();
  }

  private startPause(player: Player): void {
    // Validate
    const pausesLeft =
      player === 1 ? this.game.pausesPlayer1 : this.game.pausesPlayer2;
    if (pausesLeft <= 0 || this.game.isPaused) return;
    // During pause decision dialog, the deciding player is allowed to pause
    // even though activePlayer hasn't switched yet
    if (this.activePlayer !== player && !this.pauseDecisionOverlayVisible)
      return;

    // Deduct pause
    if (player === 1) {
      this.game.pausesPlayer1--;
    } else {
      this.game.pausesPlayer2--;
    }

    // Set active player to pausing player (important for counter-pause)
    this.activePlayer = player;

    // Stop simulation
    this.game.isPaused = true;
    this.game.pausingPlayer = player;

    // Stop turn timer
    if (this.turnTimer) {
      this.turnTimer.stop();
    }

    // Update UI
    this.updatePauseButtonLabels();
    this.updateActivePlayerUI();

    // Start pause countdown (orange bar)
    this.turnTimer = new TurnTimer(
      PAUSE_DURATION,
      () => this.onPauseEnd(),
      (remaining, total) => {
        const barElement = document.getElementById("turnTimerBar")!;
        const percentage = (remaining / total) * 100;
        barElement.style.width = `${percentage}%`;
        barElement.style.backgroundColor = "#ffaa00";
      },
    );
    this.turnTimer.start();
  }

  private onPauseEnd(): void {
    const pausingPlayer = this.game.pausingPlayer;
    const opponent: Player = pausingPlayer === 1 ? 2 : 1;

    // Check if opponent can counter-pause
    const opponentPauses =
      opponent === 1 ? this.game.pausesPlayer1 : this.game.pausesPlayer2;

    if (opponentPauses > 0) {
      // Keep paused while decision dialog is shown
      this.game.pausingPlayer = null; // Nobody can place during decision
      this.showPauseDecisionDialog(opponent);
    } else {
      // Resume fully
      this.game.isPaused = false;
      this.game.pausingPlayer = null;
      this.resumeNormalPlay(opponent);
    }
  }

  private showPauseDecisionDialog(player: Player): void {
    this.pauseDecisionOverlayVisible = true;

    const overlay = document.getElementById("pauseDecisionOverlay")!;
    const title = document.getElementById("pauseDecisionTitle")!;
    const timerBar = document.getElementById("pauseDecisionTimerBar")!;

    const playerColor = player === 1 ? "#44dddd" : "#dd44dd";
    title.textContent = `Spieler ${player}: Auch pausieren?`;
    title.style.color = playerColor;
    timerBar.style.backgroundColor = playerColor;

    overlay.style.display = "flex";

    // Start decision timer
    this.pauseDecisionTimer = new TurnTimer(
      PAUSE_DECISION_DURATION,
      () => this.onPauseDecision(player, false), // Timeout = No
      (remaining, total) => {
        const percentage = (remaining / total) * 100;
        timerBar.style.width = `${percentage}%`;
      },
    );
    this.pauseDecisionTimer.start();

    // Setup dialog buttons
    const yesBtn = document.getElementById("pauseDecisionYes")!;
    const noBtn = document.getElementById("pauseDecisionNo")!;

    // Remove old listeners by cloning
    const newYes = yesBtn.cloneNode(true) as HTMLElement;
    const newNo = noBtn.cloneNode(true) as HTMLElement;
    yesBtn.parentNode!.replaceChild(newYes, yesBtn);
    noBtn.parentNode!.replaceChild(newNo, noBtn);

    newYes.addEventListener("click", () => this.onPauseDecision(player, true));
    newNo.addEventListener("click", () => this.onPauseDecision(player, false));
  }

  private onPauseDecision(player: Player, accepted: boolean): void {
    if (!this.pauseDecisionOverlayVisible) return;
    this.pauseDecisionOverlayVisible = false;

    // Stop decision timer
    if (this.pauseDecisionTimer) {
      this.pauseDecisionTimer.stop();
      this.pauseDecisionTimer = null;
    }

    // Hide dialog
    document.getElementById("pauseDecisionOverlay")!.style.display = "none";

    this.game.isPaused = false;
    this.game.pausingPlayer = null;

    if (accepted) {
      this.activePlayer = player;
      this.startPause(player);
    } else {
      this.resumeNormalPlay(player);
    }
  }

  private resumeNormalPlay(nextPlayer: Player): void {
    this.activePlayer = nextPlayer;
    this.updateActivePlayerUI();
    this.startTurnTimer();

    // Resume animation if not already running
    if (this.game.isLivePhase && !this.game.isRunning) {
      this.game.isRunning = true;
      this.animate();
    }
  }

  private updatePauseButtonLabels(): void {
    const btn1 = document.getElementById("ready1Btn")!;
    const btn2 = document.getElementById("ready2Btn")!;

    if (this.game.isLivePhase) {
      btn1.textContent = `Pause ${this.game.pausesPlayer1}/${MAX_PAUSES_PER_PLAYER}`;
      btn2.textContent = `Pause ${this.game.pausesPlayer2}/${MAX_PAUSES_PER_PLAYER}`;
    }
  }
}
