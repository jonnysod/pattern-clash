# Pattern Clash

A competitive, browser-based strategy game built on Conway's Game of Life. Two players buy patterns, place them on a shared grid, and try to send cells across into the opponent's endzone. After five rounds, whoever has the most points wins.

🎮 **[Play it live](https://jonnysod.github.io/pattern-clash/)** — works in any modern browser, no install needed.

![Pattern Clash gameplay](docs/gameplay.gif)

## How to play

Each of five rounds has three phases:

1. **Buy** — Spend your budget on Conway patterns (Glider, LWSS, Glider Gun, …). Unspent budget carries over.
2. **Place** — Players alternate placing cards in their own zone. Opponent's cards stay face-down until played.
3. **Simulate** — 150 generations at 12 fps. Cells crossing the opponent's endzone score points.

Highest score after round 5 wins. Draws are possible.

## Tech

TypeScript · Canvas 2D · Firebase Realtime Database (online multiplayer) · Vitest

No bundler — native ES modules with an import map. A single `SyncManager` interface drives both local hotseat and online mode from the same UI code.

Built side-by-side with Claude as a development partner.

## Local setup

```bash
git clone https://github.com/jonnysod/pattern-clash.git
cd pattern-clash
npm install
npm run watch   # TypeScript compiler in watch mode
```

Open `index.html` with the **Live Server** extension in VSCode. Run tests with `npm test`.

## Forking & online play

If you fork this repo, online multiplayer defaults to my Firebase project. To use your own:

1. Create a free Firebase project and enable Realtime Database
2. Replace the config in `src/firebase.ts` with your own
3. Deploy `security-rules.json` via the Firebase Console

Local hotseat works without any of this.

## License

MIT — see [LICENSE](LICENSE).
