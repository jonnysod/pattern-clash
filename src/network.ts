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
  | { type: "tacticalPlace"; player: Player; patternIndex: number; row: number; col: number; generation: number }
  | { type: "selectPattern"; player: Player; patternIndex: number }
  | { type: "pass"; player: Player }
  | { type: "done"; player: Player }
  | { type: "surrender"; player: Player }
  | { type: "startGame" }
  | { type: "syncFix"; gridData: string; rows: number; cols: number; pointsPlayer1: number; pointsPlayer2: number; generation: number };

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

  // Callback when remote player signals phase ready
  onRemotePhaseReady: ((counter: number) => void) | null = null;

  // Callback when remote player's sync hash arrives (for tactical end sync)
  onRemoteSyncHash: ((syncHash: string) => void) | null = null;

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
      player1PhaseReady: 0,
      player2PhaseReady: 0,
      player1SyncHash: null,
      player2SyncHash: null,
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

  // Signal that this player is ready for the next phase (no sync data)
  async sendPhaseReady(): Promise<void> {
    if (!this.gameId || !this.localPlayer) return;

    const gameRef = doc(db, "games", this.gameId);
    const field = this.localPlayer === 1 ? "player1PhaseReady" : "player2PhaseReady";
    const syncField = this.localPlayer === 1 ? "player1SyncHash" : "player2SyncHash";

    const snapshot = await getDoc(gameRef);
    const current = snapshot.data()?.[field] ?? 0;

    await updateDoc(gameRef, {
      [field]: current + 1,
      [syncField]: null, // Clear any previous sync hash
    });
  }

  // Signal phase ready WITH sync data (used at tactical phase end)
  async sendPhaseReadyWithSync(syncHash: string): Promise<void> {
    if (!this.gameId || !this.localPlayer) return;

    const gameRef = doc(db, "games", this.gameId);
    const field = this.localPlayer === 1 ? "player1PhaseReady" : "player2PhaseReady";
    const syncField = this.localPlayer === 1 ? "player1SyncHash" : "player2SyncHash";

    const snapshot = await getDoc(gameRef);
    const current = snapshot.data()?.[field] ?? 0;

    await updateDoc(gameRef, {
      [field]: current + 1,
      [syncField]: syncHash,
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
    let lastRemotePhaseReady = 0;
    let lastRemoteSyncHash: string | null = null;

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

        // syncFix has no player field — P2 always handles it (P1 is authoritative)
        if (action.type === "syncFix" && this.localPlayer === 2) {
          this.onRemoteAction?.(action);
        }

        // startGame has no player field - both sides handle it
        if (action.type === "startGame" && this.localPlayer === 2) {
          this.onRemoteAction?.(action);
        }
      }

      // Check remote player's phase ready counter
      const remotePhaseReady = this.localPlayer === 1
        ? (data.player2PhaseReady ?? 0)
        : (data.player1PhaseReady ?? 0);

      if (remotePhaseReady > lastRemotePhaseReady) {
        lastRemotePhaseReady = remotePhaseReady;
        this.onRemotePhaseReady?.(remotePhaseReady);
      }

      // Check remote player's sync hash (may arrive with or after phaseReady)
      const remoteSyncHash = this.localPlayer === 1
        ? (data.player2SyncHash ?? null)
        : (data.player1SyncHash ?? null);

      if (remoteSyncHash !== null && remoteSyncHash !== lastRemoteSyncHash) {
        lastRemoteSyncHash = remoteSyncHash;
        this.onRemoteSyncHash?.(remoteSyncHash);
      }
    });
  }
}
