// Firebase transport layer.
//
// Owns Realtime Database paths and primitive operations:
// - createGame(): generate a code, write meta+player1
// - joinGame(code): claim player2 slot, return success/failure
// - listenForOpponent(): notifies when the second player joins
// - disconnect(): cleanup
//
// Action streaming (placement/buyConfirm/surrender) is added in Checkpoint 3.
//
// Schema (Realtime DB):
//   games/{code}/
//     meta:    { createdAt, status: "waiting"|"active"|"ended" }
//     players: { 1: {connected: true}, 2: {connected: true|absent} }
//     actions_p1: [...]    ← Checkpoint 3
//     actions_p2: [...]    ← Checkpoint 3

import {
  ref,
  set,
  get,
  onValue,
  off,
  serverTimestamp,
  onDisconnect,
  type Database,
  type DataSnapshot,
} from "firebase/database";
import type { Player } from "./types.js";
import { getFirebaseDb } from "./firebase.js";
import { logInfo, logWarn } from "./logger.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O for readability
const CODE_LENGTH = 4;

export type GameStatus = "waiting" | "active" | "ended";

export class FirebaseTransport {
  private db: Database;
  private gameCode: string | null = null;
  private localPlayer: Player | null = null;
  private statusListenerPath: string | null = null;
  private statusUnsubscribe: (() => void) | null = null;

  // Fires when the game transitions to "active" (both players connected).
  onGameActive: (() => void) | null = null;

  // Fires if the opponent disconnects mid-game.
  onOpponentDisconnect: (() => void) | null = null;

  constructor() {
    this.db = getFirebaseDb();
  }

  getLocalPlayer(): Player | null {
    return this.localPlayer;
  }

  getGameCode(): string | null {
    return this.gameCode;
  }

  // Create a new game. Returns the generated lobby code.
  // The caller becomes player 1.
  async createGame(): Promise<string> {
    const code = this.generateCode();
    this.gameCode = code;
    this.localPlayer = 1;

    await set(ref(this.db, `games/${code}/meta`), {
      createdAt: serverTimestamp(),
      status: "waiting",
    });
    await set(ref(this.db, `games/${code}/players/1`), { connected: true });

    // Auto-cleanup: if this client disconnects while waiting,
    // mark our slot as disconnected. (Not deletion — the opponent
    // sees the disconnect and can decide what to do.)
    onDisconnect(ref(this.db, `games/${code}/players/1/connected`)).set(false);

    this.listenForGameActive(code);
    logInfo(`[Firebase] Game ${code} created, waiting for opponent`);
    return code;
  }

  // Join an existing game by code. Returns true on success,
  // or an error message.
  async joinGame(code: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const upperCode = code.toUpperCase();

    // Check meta exists
    const metaSnap = await get(ref(this.db, `games/${upperCode}/meta`));
    if (!metaSnap.exists()) {
      return { ok: false, error: "Game not found" };
    }
    const meta = metaSnap.val() as { status: GameStatus };
    if (meta.status !== "waiting") {
      return { ok: false, error: "Game is not accepting joiners" };
    }

    // Check player 2 slot is empty
    const p2Snap = await get(ref(this.db, `games/${upperCode}/players/2`));
    if (p2Snap.exists()) {
      return { ok: false, error: "Game is full" };
    }

    this.gameCode = upperCode;
    this.localPlayer = 2;

    await set(ref(this.db, `games/${upperCode}/players/2`), { connected: true });
    await set(ref(this.db, `games/${upperCode}/meta/status`), "active");

    onDisconnect(ref(this.db, `games/${upperCode}/players/2/connected`)).set(
      false,
    );

    this.listenForOpponentDisconnect(upperCode, 1);
    logInfo(`[Firebase] Joined game ${upperCode} as player 2`);
    return { ok: true };
  }

  // Permanently leave the game (cleanup local listeners).
  // Does NOT delete server data — that happens via onDisconnect handlers
  // or by the creator's manual cancel.
  disconnect(): void {
    if (this.statusUnsubscribe) {
      this.statusUnsubscribe();
      this.statusUnsubscribe = null;
    }
    this.statusListenerPath = null;
    this.gameCode = null;
    this.localPlayer = null;
  }

  // Cancel a "waiting" game (creator only) — removes the game node.
  async cancelGame(): Promise<void> {
    if (!this.gameCode || this.localPlayer !== 1) return;
    await set(ref(this.db, `games/${this.gameCode}`), null);
    this.disconnect();
  }

  // ---- private ----

  private generateCode(): string {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
    }
    return code;
  }

  // Player 1: listen for status flipping to "active"
  private listenForGameActive(code: string): void {
    const path = `games/${code}/meta/status`;
    const statusRef = ref(this.db, path);
    this.statusListenerPath = path;

    const handler = (snap: DataSnapshot) => {
      const status = snap.val() as GameStatus | null;
      if (status === "active") {
        logInfo("[Firebase] Game became active");
        // Switch listener: now watch for opponent disconnect
        this.unsubscribeStatusListener();
        this.listenForOpponentDisconnect(code, 2);
        if (this.onGameActive) this.onGameActive();
      }
    };
    onValue(statusRef, handler);
    this.statusUnsubscribe = () => off(statusRef, "value", handler);
  }

  // Watch the opponent's `connected` flag — fires onOpponentDisconnect
  // if it ever transitions to false.
  private listenForOpponentDisconnect(
    code: string,
    opponent: Player,
  ): void {
    const path = `games/${code}/players/${opponent}/connected`;
    const connRef = ref(this.db, path);
    this.statusListenerPath = path;

    const handler = (snap: DataSnapshot) => {
      const connected = snap.val();
      if (connected === false) {
        logWarn("[Firebase] Opponent disconnected");
        if (this.onOpponentDisconnect) this.onOpponentDisconnect();
      }
    };
    onValue(connRef, handler);
    this.statusUnsubscribe = () => off(connRef, "value", handler);
  }

  private unsubscribeStatusListener(): void {
    if (this.statusUnsubscribe) {
      this.statusUnsubscribe();
      this.statusUnsubscribe = null;
    }
  }
}
