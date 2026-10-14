// Global leaderboards: reading, submitting, renaming. Board definitions live
// in leaderboardBoards.ts; access control in security-rules.json.
//
// Trust model (variant B): entries are keyed by the browser's anonymous
// uid, so one browser holds at most one entry per board. Scores are still
// computed by the client and can be faked — the rules bound the shape and
// range, not the honesty. Bad entries are removed by hand in the console.

import {
  endBefore,
  get,
  limitToFirst,
  limitToLast,
  orderByChild,
  query,
  ref,
  serverTimestamp,
  set,
  startAfter,
  update,
} from "firebase/database";
import { ensureAnonymousUid, getFirebaseDb } from "./firebase.js";
import { LEADERBOARD_BOARDS, isBetter } from "./leaderboardBoards.js";
import type { LeaderboardBoard } from "./leaderboardBoards.js";
import { logWarn } from "./logger.js";

const NAME_STORAGE_KEY = "pattern-clash:playerName:v1";

export interface LeaderboardEntry {
  uid: string;
  name: string;
  score: number;
}

export interface BoardStanding {
  top: LeaderboardEntry[];
  // The viewer's own entry and 1-based rank (ties share a rank), or null.
  own: { entry: LeaderboardEntry; rank: number } | null;
}

export type SubmitResult = "new-best" | "not-best";

//#region Player name (local)
export function getPlayerName(): string | null {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storePlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_STORAGE_KEY, name);
  } catch {
    // Without storage the name is asked again next time — acceptable.
  }
}
//#endregion

function boardPath(board: LeaderboardBoard): string {
  return board.kind === "solved"
    ? `puzzleSolved/${board.id}`
    : `leaderboards/${board.id}`;
}

// Enter a score if it beats the browser's existing entry on this board.
// The rules don't enforce "only improve" — worsening your own entry hurts
// nobody — so the check lives here.
export async function submitScore(
  board: LeaderboardBoard,
  name: string,
  score: number,
): Promise<SubmitResult> {
  const uid = await ensureAnonymousUid();
  const db = getFirebaseDb();
  const own = ref(db, `${boardPath(board)}/${uid}`);
  const existing = await get(own);
  if (existing.exists() && !isBetter(board, score, existing.val().score)) {
    return "not-best";
  }
  await set(own, { name, score, at: serverTimestamp() });
  return "new-best";
}

export async function markSolved(board: LeaderboardBoard): Promise<void> {
  const uid = await ensureAnonymousUid();
  await set(ref(getFirebaseDb(), `${boardPath(board)}/${uid}`), true);
}

// Top `limit` entries plus the viewer's own place.
export async function fetchStanding(
  board: LeaderboardBoard,
  limit = 10,
): Promise<BoardStanding> {
  const db = getFirebaseDb();
  const boardRef = ref(db, boardPath(board));
  const byScore = orderByChild("score");
  const topSnap = await get(
    query(
      boardRef,
      byScore,
      board.higherIsBetter ? limitToLast(limit) : limitToFirst(limit),
    ),
  );
  const top: LeaderboardEntry[] = [];
  topSnap.forEach((child) => {
    const v = child.val();
    top.push({ uid: child.key!, name: v.name, score: v.score });
  });
  top.sort((a, b) => (board.higherIsBetter ? b.score - a.score : a.score - b.score));

  const uid = await ensureAnonymousUid();
  const ownSnap = await get(ref(db, `${boardPath(board)}/${uid}`));
  if (!ownSnap.exists()) return { top, own: null };
  const entry: LeaderboardEntry = { uid, ...ownSnap.val() };
  // Rank = number of strictly better entries + 1.
  const betterSnap = await get(
    query(
      boardRef,
      byScore,
      board.higherIsBetter ? startAfter(entry.score) : endBefore(entry.score),
    ),
  );
  return { top, own: { entry, rank: betterSnap.size + 1 } };
}

// The best score on a board, or null if it has no entries. Reading is
// public, so this doesn't sign in — just looking shouldn't mint an identity.
export async function fetchBest(board: LeaderboardBoard): Promise<number | null> {
  const snap = await get(
    query(
      ref(getFirebaseDb(), boardPath(board)),
      orderByChild("score"),
      board.higherIsBetter ? limitToLast(1) : limitToFirst(1),
    ),
  );
  let best: number | null = null;
  snap.forEach((child) => {
    best = child.val().score;
  });
  return best;
}

// How many browsers solved a pass/fail puzzle. Public read, no sign-in.
export async function fetchSolvedCount(board: LeaderboardBoard): Promise<number> {
  const snap = await get(ref(getFirebaseDb(), boardPath(board)));
  return snap.size;
}

// Store the name locally and carry it into every existing own entry, so a
// rename shows up on all boards at once rather than on the next record.
export async function setPlayerName(name: string): Promise<void> {
  storePlayerName(name);
  const uid = await ensureAnonymousUid();
  const db = getFirebaseDb();
  const changes: Record<string, string> = {};
  for (const board of LEADERBOARD_BOARDS) {
    if (board.kind !== "score") continue;
    try {
      const own = await get(ref(db, `${boardPath(board)}/${uid}`));
      if (own.exists()) changes[`${boardPath(board)}/${uid}/name`] = name;
    } catch (err) {
      logWarn(`[Leaderboard] rename: could not read ${board.id}`, err);
    }
  }
  if (Object.keys(changes).length > 0) await update(ref(db), changes);
}
