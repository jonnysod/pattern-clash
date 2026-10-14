// Small modal asking for the public leaderboard name. Built on demand and
// removed afterwards, so it needs no markup in index.html and leaves no
// listeners behind. Resolves to the entered name, or null if cancelled.

import { isValidPlayerName } from "./leaderboardBoards.js";

export function promptPlayerName(current: string | null): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.style.cssText = `
      position: fixed; inset: 0; z-index: 2000;
      background: rgba(0, 0, 0, 0.75);
      display: flex; justify-content: center; align-items: center;
    `;
    const panel = document.createElement("div");
    panel.style.cssText = `
      background: #2a2a2a; padding: 28px 32px; border-radius: 10px;
      width: 340px; text-align: center; color: #ddd;
    `;
    panel.innerHTML = `
      <h3 style="margin: 0 0 8px 0; color: #ffcc44">Your highscore name</h3>
      <p style="margin: 0 0 16px 0; font-size: 13px; color: #999">
        Shown publicly in the global highscores.
      </p>
    `;
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 16;
    input.value = current ?? "";
    input.style.cssText = `
      width: 100%; box-sizing: border-box; padding: 8px 10px; font-size: 16px;
      background: #1a1a1a; color: #fff; border: 1px solid #555; border-radius: 5px;
    `;
    const hint = document.createElement("p");
    hint.style.cssText = "margin: 8px 0 0 0; font-size: 12px; color: #999; min-height: 16px;";
    hint.textContent = "3–16 characters: letters, digits, space, - and _";

    const buttons = document.createElement("div");
    buttons.style.cssText = "display: flex; gap: 10px; justify-content: center; margin-top: 18px;";
    const ok = document.createElement("button");
    ok.textContent = "Save";
    ok.style.cssText = `
      padding: 8px 22px; font-size: 15px; font-weight: bold; cursor: pointer;
      background: #00ff00; color: #1a1a1a; border: none; border-radius: 5px;
    `;
    const cancel = document.createElement("button");
    cancel.textContent = "Not now";
    cancel.style.cssText = `
      padding: 8px 16px; font-size: 14px; cursor: pointer;
      background: transparent; color: #aaa; border: 1px solid #555; border-radius: 5px;
    `;
    buttons.append(ok, cancel);
    panel.append(input, hint, buttons);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
    input.focus();
    input.select();

    const finish = (value: string | null): void => {
      backdrop.remove();
      resolve(value);
    };
    const submit = (): void => {
      const name = input.value.trim();
      if (!isValidPlayerName(name)) {
        hint.style.color = "#ff6666";
        input.focus();
        return;
      }
      finish(name);
    };
    ok.addEventListener("click", submit);
    cancel.addEventListener("click", () => finish(null));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      else if (e.key === "Escape") finish(null);
    });
  });
}
