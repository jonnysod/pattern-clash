// UI for the global leaderboards: the Highscores page (menu entry) and the
// submit flow run when a bot game or puzzle ends.

import type { DOMRefs } from "./domRefs.js";
import { LEADERBOARD_BOARDS, puzzleBoard } from "./leaderboardBoards.js";
import type { LeaderboardBoard } from "./leaderboardBoards.js";
import type { PuzzleDefinition } from "./types.js";
import type { BoardStanding } from "./leaderboard.js";
import {
  fetchBest,
  fetchSolvedCount,
  fetchStanding,
  getPlayerName,
  markSolved,
  setPlayerName,
  submitScore,
} from "./leaderboard.js";
import { promptPlayerName } from "./namePrompt.js";
import { logWarn } from "./logger.js";

const OWN_COLOR = "#66ccff";

function formatScore(board: LeaderboardBoard, score: number): string {
  // Bot boards hold a difference; the sign is part of the information.
  return board.group === "bot" && score > 0 ? `+${score}` : String(score);
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

//#region Submit flow
// Asks for a name the first time, then enters the score and reports the
// outcome in `status`. Never throws: a failed submit only shows a note, the
// game result itself is unaffected.
export async function recordHighscore(
  board: LeaderboardBoard,
  score: number,
  status: HTMLElement,
): Promise<void> {
  const show = (text: string): void => {
    status.textContent = text;
    status.style.display = "block";
  };
  try {
    let name = getPlayerName();
    if (!name) {
      name = await promptPlayerName(null);
      if (!name) {
        show("Not entered in the global highscores (no name set).");
        return;
      }
      await setPlayerName(name);
    }
    if (board.kind === "solved") {
      await markSolved(board);
      const count = await fetchSolvedCount(board);
      show(`🌍 Solved by ${count} player${count === 1 ? "" : "s"} worldwide`);
      return;
    }
    const result = await submitScore(board, name, score);
    const standing = await fetchStanding(board, 1);
    const parts: string[] = [];
    // Puzzles already say "New best!" in the local result line above.
    if (result === "new-best" && board.group === "bot") parts.push("New personal best");
    const world = standing.top[0];
    if (world) {
      const where = board.group === "bot" ? ` on ${board.title}` : "";
      parts.push(`World best ${formatScore(board, world.score)}${where}`);
    }
    if (standing.own) parts.push(`Your rank #${standing.own.rank}`);
    show(`🌍 ${parts.join(" · ")}`);
  } catch (err) {
    logWarn("[Highscores] submit failed", err);
    show("Global highscores unavailable right now.");
  }
}
//#endregion

//#region Tutorial: line under each puzzle in the selection list
// "You 71 · World 64" for scored puzzles, "✓ Solved · by 12 players" for
// pass/fail ones. Your value is local and shows at once; the world value is
// fetched afterwards and filled in when it arrives.
export function fillPuzzleHighscore(
  puzzle: PuzzleDefinition,
  localBest: number | null,
  solvedLocally: boolean,
  el: HTMLElement,
): void {
  const board = puzzleBoard(puzzle);
  if (board.kind === "solved") {
    const render = (count: number | null): void => {
      // No count yet, or nobody entered it: say nothing rather than "by 0".
      const by = count ? `by ${count} player${count === 1 ? "" : "s"}` : "";
      el.textContent = solvedLocally
        ? `✓ Solved${by ? ` · ${by}` : ""}`
        : count
          ? `Solved ${by}`
          : "";
    };
    render(null);
    fetchSolvedCount(board).then(render, (err) => {
      logWarn("[Highscores] solved count failed", err);
    });
    return;
  }
  // world: undefined = loading, null = nobody entered yet ("World –"),
  // "error" = couldn't load (offline) — then the world part is left out
  // rather than looking like an empty board.
  const render = (world: number | null | undefined | "error"): void => {
    const parts: string[] = [];
    if (solvedLocally && localBest !== null) parts.push(`You ${localBest}`);
    if (world === undefined) parts.push("World …");
    else if (world === null) parts.push("World –");
    else if (world !== "error") parts.push(`World ${world}`);
    el.textContent = parts.join(" · ");
  };
  render(undefined);
  fetchBest(board).then(render, (err) => {
    logWarn("[Highscores] world best failed", err);
    render("error");
  });
}
//#endregion

//#region Highscores page — vs Bot, one column per difficulty
const BOT_BOARDS = LEADERBOARD_BOARDS.filter((b) => b.group === "bot");

export class HighscoresView {
  private dom: DOMRefs;
  // Ignore responses from an earlier opening of the page.
  private requestSeq = 0;

  onBack: (() => void) | null = null;

  constructor(dom: DOMRefs) {
    this.dom = dom;
    dom.highscoresBackBtn.addEventListener("click", () => {
      this.hide();
      this.onBack?.();
    });
    dom.highscoresRenameBtn.addEventListener("click", () => void this.rename());
  }

  show(): void {
    this.dom.highscoresOverlay.style.display = "flex";
    this.renderName();
    void this.renderColumns();
  }

  hide(): void {
    this.dom.highscoresOverlay.style.display = "none";
  }

  private renderName(): void {
    this.dom.highscoresName.textContent = getPlayerName() ?? "— (set on first entry)";
  }

  private async renderColumns(): Promise<void> {
    const seq = ++this.requestSeq;
    const grid = this.dom.highscoresContent;
    grid.style.cssText = `
      display: grid; grid-template-columns: repeat(${BOT_BOARDS.length}, 1fr);
      gap: 14px; min-height: 280px;
    `;
    grid.innerHTML = "";
    const cells = BOT_BOARDS.map((board) => {
      const column = document.createElement("div");
      column.style.cssText = "min-width: 0;"; // lets long names ellipsize
      column.innerHTML = `
        <div style="font-weight: bold; color: #ffcc44; margin-bottom: 8px; font-size: 14px">
          ${escapeHtml(board.title.replace("vs Bot · ", ""))}
        </div>
        <div style="color: #888; font-size: 13px">Loading…</div>`;
      grid.appendChild(column);
      return column;
    });

    await Promise.all(
      BOT_BOARDS.map(async (board, i) => {
        const column = cells[i]!;
        const body = column.lastElementChild as HTMLElement;
        try {
          const standing = await fetchStanding(board);
          if (seq !== this.requestSeq) return;
          body.outerHTML = this.columnBody(board, standing);
        } catch (err) {
          if (seq !== this.requestSeq) return;
          logWarn(`[Highscores] load failed: ${board.id}`, err);
          body.outerHTML = `<div style="color: #ff8888; font-size: 13px">Unavailable</div>`;
        }
      }),
    );
  }

  private columnBody(board: LeaderboardBoard, standing: BoardStanding): string {
    const { top, own } = standing;
    if (top.length === 0) {
      return `<div style="color: #888; font-size: 13px">No entries yet</div>`;
    }
    // Competition ranking: ties share a rank.
    let rank = 0;
    const rows = top.map((entry, i) => {
      if (i === 0 || entry.score !== top[i - 1]!.score) rank = i + 1;
      const mine = own?.entry.uid === entry.uid;
      const color = mine ? OWN_COLOR : "#ddd";
      const name = escapeHtml(entry.name);
      return `
        <div style="display: flex; gap: 6px; font-size: 13px; line-height: 1.7; color: ${color}">
          <span style="width: 22px; text-align: right; color: ${mine ? OWN_COLOR : "#888"}">${rank}.</span>
          <span title="${name}" style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${name}</span>
          <span style="font-variant-numeric: tabular-nums">${formatScore(board, entry.score)}</span>
        </div>`;
    });
    const ownInTop = own !== null && top.some((e) => e.uid === own.entry.uid);
    const ownLine =
      own === null
        ? `You: –`
        : ownInTop
          ? ""
          : `You: #${own.rank} ${formatScore(board, own.entry.score)}`;
    return `
      <div>${rows.join("")}</div>
      <div style="margin-top: 8px; font-size: 13px; color: ${OWN_COLOR}">${ownLine}</div>`;
  }

  private async rename(): Promise<void> {
    const name = await promptPlayerName(getPlayerName());
    if (!name) return;
    try {
      await setPlayerName(name);
    } catch (err) {
      logWarn("[Highscores] rename failed", err);
    }
    this.renderName();
    void this.renderColumns();
  }
}
//#endregion
