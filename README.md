# Pattern Clash

A competitive, browser-based strategy game built on Conway's Game of Life. Two players buy patterns, place them on a shared grid, and try to send cells across into the opponent's endzone. After five rounds, whoever has the most points wins.

🎮 **[Play it live](https://jonnysod.github.io/pattern-clash/)** — works in any modern browser, no install needed.

<!-- TODO: Replace with gameplay GIF -->
![Pattern Clash gameplay](docs/gameplay.gif)

## Features

- **5-phase rounds**: Buy → Place → Simulate, repeated five times
- **Two-player local hotseat** (one device) and **online multiplayer** (no signup, just share a 4-letter code)
- **Budget system**: 90 points to start, +50 each subsequent phase, save up or spend now
- **13 patterns**: Spaceships (Glider, LWSS, MWSS, HWSS), Glider Guns, Oscillators, Still Lifes
- **Anti-sniffing in online mode**: the opponent's purchased patterns stay hidden until they're actually played

## How to play

Each round has three sub-phases:

1. **Buy phase.** Spend your budget on patterns. Cheaper patterns (Blinker, Block) for cheap board control; expensive ones (Glider Gun, HWSS) for serious offense. Up to 10 slots per phase, max 3 copies of any pattern. You don't have to spend everything — saving budget for the next round is a valid strategy.
2. **Place phase.** Players take turns placing their purchased patterns inside their own zone. You see your own cards face-up and your opponent's face-down — you'll only know what they bought when they place it.
3. **Simulation.** 150 generations of Conway's rules at 12 fps. Cells crossing into the opponent's endzone score points. Then back to step 1.

After five rounds, highest score wins. Draws are possible.

## Tech

- **TypeScript**, no bundler — uses native ES modules and an import map
- **Canvas 2D** for the grid and animations
- **Firebase Realtime Database** for online multiplayer (lockstep sync via per-player action streams)
- **Vitest** for unit tests on game logic

The architecture deliberately keeps Conway logic, sync, and UI in separate layers — there's a single `SyncManager` interface with a local (loopback) and an online (Firebase) implementation, so the entire UI controller works identically in both modes.

Original idea and design by me. Built side-by-side with Claude as a development partner — for design discussions, code review, and a lot of back-and-forth pair programming.

## Local setup

```bash
git clone https://github.com/jonnysod/pattern-clash.git
cd pattern-clash
npm install
npm run watch       # TypeScript compiler in watch mode
```

Then open `index.html` in a browser. The simplest way is the **Live Server** extension in VSCode — it auto-reloads on changes.

To run the test suite:

```bash
npm test            # watch mode
npm run test:run    # single run
```

## Forking & online play

If you fork this repo and host your own version, online multiplayer will — by default — connect to my Firebase project. That means your players would share lobby codes and storage quota with mine, which neither of us probably wants.

To run online play on your own infrastructure:

1. Create a free Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable Realtime Database (any region works; pick one near you)
3. Replace the config in `src/firebase.ts` with your own project's web config
4. Deploy the rules from `security-rules.json` in the Firebase Console under **Realtime Database → Rules**

Local hotseat mode works without any of this.

## License

MIT — see [LICENSE](LICENSE).