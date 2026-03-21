// Network module: Firestore-based P2P game communication

import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase.js";
import type { Player } from "./types.js";

// Action types sent between clients
export type GameAction =
  | { type: "placePattern"; player: Player; patternIndex: number; row: number; col: number }
  | { type: "selectPattern"; player: Player; patternIndex: number }
  | { type: "pass"; player: Player }
  | { type: "done"; player: Player }
  | { type: "surrender"; player: Player }
  | { type: "startGame" };

export interface GameResult {
  winner: Player | null;
  player1Score: number;
  player2Score: number;
}

// Generate a short random game code
function generateGameId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// Generate a unique session ID for this browser tab
function generateSessionId(): string {
  const chars = "abcdef0123456789";
  let id = "";
  for (let i = 0; i < 32; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export class Network {
  private gameId: string | null = null;
  private sessionId: string;
  private unsubscribe: Unsubscribe | null = null;

  localPlayer: Player | null = null;

  // Callback for incoming actions from the remote player
  onRemoteAction: ((action: GameAction) => void) | null = null;

  // Callback when opponent joins
  onOpponentJoined: (() => void) | null = null;

  // Callback when opponent disconnects
  onOpponentLeft: (() => void) | null = null;

  constructor() {
    this.sessionId = generateSessionId();
  }

  // Create a new game and wait for opponent
  async createGame(): Promise<string> {
    const gameId = generateGameId();
    this.gameId = gameId;
    this.localPlayer = 1;

    const gameRef = doc(db, "games", gameId);
    await setDoc(gameRef, {
      player1: this.sessionId,
      player2: null,
      state: "waiting",
      currentAction: null,
      actionCounter: 0,
      createdAt: serverTimestamp(),
    });

    // Listen for opponent joining and actions
    this.startListening();

    return gameId;
  }

  // Join an existing game
  async joinGame(gameId: string): Promise<void> {
    this.gameId = gameId.toUpperCase();
    this.localPlayer = 2;

    const gameRef = doc(db, "games", this.gameId);
    const snapshot = await getDoc(gameRef);

    if (!snapshot.exists()) {
      throw new Error("Game not found");
    }

    const data = snapshot.data();
    if (data.state !== "waiting") {
      throw new Error("Game already in progress");
    }

    if (data.player2 !== null) {
      throw new Error("Game is full");
    }

    await updateDoc(gameRef, {
      player2: this.sessionId,
      state: "playing",
    });

    // Start listening for actions
    this.startListening();
  }

  // Send an action to the remote player
  async sendAction(action: GameAction): Promise<void> {
    if (!this.gameId) return;

    const gameRef = doc(db, "games", this.gameId);

    // Increment actionCounter to ensure every write triggers onSnapshot
    const snapshot = await getDoc(gameRef);
    const currentCounter = snapshot.data()?.actionCounter ?? 0;

    await updateDoc(gameRef, {
      currentAction: action,
      actionCounter: currentCounter + 1,
    });
  }

  // Save final game result
  async saveResult(result: GameResult): Promise<void> {
    if (!this.gameId) return;

    const gameRef = doc(db, "games", this.gameId);
    await updateDoc(gameRef, {
      state: "ended",
      result,
    });
  }

  // Stop listening and clean up
  disconnect(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.gameId = null;
    this.localPlayer = null;
  }

  private startListening(): void {
    if (!this.gameId) return;

    const gameRef = doc(db, "games", this.gameId);
    let lastActionCounter = -1;
    let opponentJoinedFired = false;

    this.unsubscribe = onSnapshot(gameRef, (snapshot) => {
      const data = snapshot.data();
      if (!data) return;

      // Detect opponent joining (for player 1) — fire only once
      if (this.localPlayer === 1 && data.state === "playing" && data.player2 && !opponentJoinedFired) {
        opponentJoinedFired = true;
        this.onOpponentJoined?.();
      }

      // Process actions only from the remote player
      if (data.currentAction && data.actionCounter > lastActionCounter) {
        lastActionCounter = data.actionCounter;
        const action = data.currentAction as GameAction;

        // Only handle actions from the OTHER player
        if ("player" in action && action.player !== this.localPlayer) {
          this.onRemoteAction?.(action);
        }

        // startGame has no player field - both sides handle it
        if (action.type === "startGame" && this.localPlayer === 2) {
          this.onRemoteAction?.(action);
        }
      }
    });
  }
}