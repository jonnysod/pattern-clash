import { PATTERNS, type Pattern } from "./patterns.js";

//#region Canvas Setup
const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const CELL_SIZE = 10;
const COLS = canvas.width / CELL_SIZE;
const ROWS = canvas.height / CELL_SIZE;

// Zonen-Definitionen
const ZONE_LEFT_END = Math.floor(COLS * 0.25); // Linke 25%
const ZONE_RIGHT_START = Math.floor(COLS * 0.75); // Rechte 25%
// Neutrale Zone: ZONE_LEFT_END bis ZONE_RIGHT_START
//#endregion

//#region Preview Canvas Setup
const previewCanvas1 = document.getElementById(
  "previewCanvas1",
) as HTMLCanvasElement;
const previewCtx1 = previewCanvas1.getContext("2d")!;

const previewCanvas2 = document.getElementById(
  "previewCanvas2",
) as HTMLCanvasElement;
const previewCtx2 = previewCanvas2.getContext("2d")!;

const PREVIEW_CELL_SIZE = 10;
const PREVIEW_COLS = previewCanvas1.width / PREVIEW_CELL_SIZE;
const PREVIEW_ROWS = previewCanvas1.height / PREVIEW_CELL_SIZE;
//#endregion

//#region Grid State
let grid: boolean[][] = createEmptyGrid();
let isRunning = false;
let animationId: number | null = null;
let selectedPattern: Pattern | null = null;
let currentRotation = 0; // 0, 90, 180, 270
let currentPlayer: 1 | 2 = 1; // Aktueller Spieler (nur für Platzierung relevant)

function createEmptyGrid(): boolean[][] {
  return Array(ROWS)
    .fill(null)
    .map(() => Array(COLS).fill(false));
}
//#endregion

//#region Rendering
function drawGrid(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Zeichne Zonen-Hintergrundfarben
  // Linke Zone (Spieler 1) - Bläulich
  ctx.fillStyle = "#001a33";
  ctx.fillRect(0, 0, ZONE_LEFT_END * CELL_SIZE, canvas.height);

  // Neutrale Zone - Schwarz
  ctx.fillStyle = "#000000";
  ctx.fillRect(
    ZONE_LEFT_END * CELL_SIZE,
    0,
    (ZONE_RIGHT_START - ZONE_LEFT_END) * CELL_SIZE,
    canvas.height
  );

  // Rechte Zone (Spieler 2) - Rötlich
  ctx.fillStyle = "#330000";
  ctx.fillRect(
    ZONE_RIGHT_START * CELL_SIZE,
    0,
    (COLS - ZONE_RIGHT_START) * CELL_SIZE,
    canvas.height
  );

  // Zeichne lebende Zellen (alle grün)
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (grid[row]![col]) {
        ctx.fillStyle = "#00ff00";
        ctx.fillRect(
          col * CELL_SIZE,
          row * CELL_SIZE,
          CELL_SIZE - 1,
          CELL_SIZE - 1,
        );
      }
    }
  }

  // Grid lines
  ctx.strokeStyle = "#222";
  for (let i = 0; i <= ROWS; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * CELL_SIZE);
    ctx.lineTo(canvas.width, i * CELL_SIZE);
    ctx.stroke();
  }
  for (let i = 0; i <= COLS; i++) {
    ctx.beginPath();
    ctx.moveTo(i * CELL_SIZE, 0);
    ctx.lineTo(i * CELL_SIZE, canvas.height);
    ctx.stroke();
  }

  // Trennlinien zwischen Zonen (dicker und heller)
  ctx.strokeStyle = "#666";
  ctx.lineWidth = 3;
  
  // Linke Trennlinie
  ctx.beginPath();
  ctx.moveTo(ZONE_LEFT_END * CELL_SIZE, 0);
  ctx.lineTo(ZONE_LEFT_END * CELL_SIZE, canvas.height);
  ctx.stroke();

  // Rechte Trennlinie
  ctx.beginPath();
  ctx.moveTo(ZONE_RIGHT_START * CELL_SIZE, 0);
  ctx.lineTo(ZONE_RIGHT_START * CELL_SIZE, canvas.height);
  ctx.stroke();

  ctx.lineWidth = 1; // Reset line width
}
//#endregion

//#region Preview Rendering
function drawPreview(pattern: Pattern | null, player: 1 | 2): void {
  const previewCtx = player === 1 ? previewCtx1 : previewCtx2;
  const previewCanvas = player === 1 ? previewCanvas1 : previewCanvas2;

  // Clear preview
  previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

  // Draw grid lines
  previewCtx.strokeStyle = "#222";
  for (let i = 0; i <= PREVIEW_ROWS; i++) {
    previewCtx.beginPath();
    previewCtx.moveTo(0, i * PREVIEW_CELL_SIZE);
    previewCtx.lineTo(previewCanvas.width, i * PREVIEW_CELL_SIZE);
    previewCtx.stroke();
  }
  for (let i = 0; i <= PREVIEW_COLS; i++) {
    previewCtx.beginPath();
    previewCtx.moveTo(i * PREVIEW_CELL_SIZE, 0);
    previewCtx.lineTo(i * PREVIEW_CELL_SIZE, previewCanvas.height);
    previewCtx.stroke();
  }

  if (!pattern) {
    return;
  }

  // Wende Spieler-spezifische Transformation an
  const playerPattern = getPatternForPlayer(pattern, player);

  // Calculate pattern bounds for centering
  const rows = playerPattern.cells.map(([r]) => r);
  const cols = playerPattern.cells.map(([, c]) => c);
  const patternHeight = Math.max(...rows) - Math.min(...rows) + 1;
  const patternWidth = Math.max(...cols) - Math.min(...cols) + 1;

  // Center the pattern
  const offsetRow =
    Math.floor((PREVIEW_ROWS - patternHeight) / 2) - Math.min(...rows);
  const offsetCol =
    Math.floor((PREVIEW_COLS - patternWidth) / 2) - Math.min(...cols);

  // Draw pattern cells - IMMER GRÜN
  previewCtx.fillStyle = "#00ff00";
  for (const [row, col] of playerPattern.cells) {
    const drawRow = row + offsetRow;
    const drawCol = col + offsetCol;
    previewCtx.fillRect(
      drawCol * PREVIEW_CELL_SIZE,
      drawRow * PREVIEW_CELL_SIZE,
      PREVIEW_CELL_SIZE - 1,
      PREVIEW_CELL_SIZE - 1,
    );
  }
}
//#endregion

//#region Game Logic
function computeNextGeneration(): void {
  const newGrid: boolean[][] = createEmptyGrid();

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const neighbors = countNeighbors(row, col);
      const isAlive = grid[row]![col];

      // Conway's rules - gilt für ALLE Zellen gleich
      if (isAlive && (neighbors === 2 || neighbors === 3)) {
        newGrid[row]![col] = true; // Survives
      } else if (!isAlive && neighbors === 3) {
        newGrid[row]![col] = true; // Birth
      } else {
        newGrid[row]![col] = false; // Dies or stays dead
      }
    }
  }

  grid = newGrid;
}

function countNeighbors(row: number, col: number): number {
  let count = 0;

  // Check all 8 neighbors
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue; // Skip the cell itself

      const newRow = row + dr;
      const newCol = col + dc;

      // Check if neighbor is in grid and alive
      if (
        newRow >= 0 &&
        newRow < ROWS &&
        newCol >= 0 &&
        newCol < COLS &&
        grid[newRow]![newCol]
      ) {
        count++;
      }
    }
  }

  return count;
}
//#endregion

//#region Pattern Placement
function isValidPlacement(col: number, player: 1 | 2): boolean {
  if (player === 1) {
    // Spieler 1: Linke Zone oder Neutrale Zone
    return col < ZONE_LEFT_END;
  } else {
    // Spieler 2: Rechte Zone oder Neutrale Zone
    return col >= ZONE_RIGHT_START;
  }
}

function placePattern(
  startRow: number,
  startCol: number,
  pattern: Pattern,
): boolean {
  // Validiere, ob Pattern in erlaubter Zone platziert wird
  if (!isValidPlacement(startCol, currentPlayer)) {
    // Visuelles Feedback bei ungültiger Platzierung
    flashInvalidPlacement(startCol, startRow);
    return false;
  }

  for (const [rowOffset, colOffset] of pattern.cells) {
    const row = startRow + rowOffset;
    const col = startCol + colOffset;

    if (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
      grid[row]![col] = true;
    }
  }
  return true;
}

function flashInvalidPlacement(col: number, row: number): void {
  // Kurzes rotes Flash als Feedback
  ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
  ctx.fillRect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE * 3, CELL_SIZE * 3);
  setTimeout(() => drawGrid(), 100);
}
//#endregion

//#region Pattern Rotation
function rotatePattern(pattern: Pattern, degrees: number): Pattern {
  const rotations = degrees / 90;
  let cells = pattern.cells;

  for (let i = 0; i < rotations; i++) {
    // Rotate 90° clockwise: (row, col) -> (col, -row)
    cells = cells.map(([row, col]) => [col, -row]);
  }

  return {
    name: pattern.name,
    cells: cells,
  };
}

function mirrorPatternHorizontally(pattern: Pattern): Pattern {
  // Spiegele Pattern horizontal für Spieler 2
  return {
    name: pattern.name,
    cells: pattern.cells.map(([row, col]) => [row, -col]),
  };
}

function getPatternForPlayer(pattern: Pattern, player: 1 | 2): Pattern {
  if (player === 2) {
    // Spieler 2: Spiegele Patterns horizontal (wandern nach links)
    return mirrorPatternHorizontally(pattern);
  }
  return pattern;
}
//#endregion

//#region Animation
function animate(): void {
  if (!isRunning) return;

  computeNextGeneration();
  drawGrid();

  setTimeout(() => {
    animationId = requestAnimationFrame(animate);
  }, 100); // 100ms between generations = ~10 FPS
}
//#endregion

//#region Event Handlers
// Click handler: place pattern or toggle cell
canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const col = Math.floor(x / CELL_SIZE);
  const row = Math.floor(y / CELL_SIZE);

  if (selectedPattern) {
    // Place rotated and player-specific pattern
    const playerPattern = getPatternForPlayer(selectedPattern, currentPlayer);
    const rotated = rotatePattern(playerPattern, currentRotation);
    placePattern(row, col, rotated);
  } else {
    // Toggle single cell (with zone validation)
    if (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
      if (isValidPlacement(col, currentPlayer)) {
        grid[row]![col] = !grid[row]![col];
      } else {
        flashInvalidPlacement(col, row);
      }
    }
  }
  drawGrid();
});

// Button event handlers
document.getElementById("startBtn")!.addEventListener("click", () => {
  isRunning = true;
  animate();
});

document.getElementById("pauseBtn")!.addEventListener("click", () => {
  isRunning = false;
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
  }
});

document.getElementById("resetBtn")!.addEventListener("click", () => {
  isRunning = false;
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
  }
  grid = createEmptyGrid();
  drawGrid();
});

// Player selection handlers
const player1Btn = document.getElementById("player1Btn")!;
const player2Btn = document.getElementById("player2Btn")!;

player1Btn.addEventListener("click", () => {
  currentPlayer = 1;
  player1Btn.style.fontWeight = "bold";
  player1Btn.style.opacity = "1";
  player2Btn.style.fontWeight = "normal";
  player2Btn.style.opacity = "0.6";
});

player2Btn.addEventListener("click", () => {
  currentPlayer = 2;
  player2Btn.style.fontWeight = "bold";
  player2Btn.style.opacity = "1";
  player1Btn.style.fontWeight = "normal";
  player1Btn.style.opacity = "0.6";
});

// Pattern selection handlers für Spieler 1
document.querySelectorAll(".player1-pattern").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentPlayer = 1; // Auto-select Spieler 1
    player1Btn.style.fontWeight = "bold";
    player1Btn.style.opacity = "1";
    player2Btn.style.fontWeight = "normal";
    player2Btn.style.opacity = "0.6";

    const patternIndex = parseInt(btn.getAttribute("data-pattern")!);
    if (selectedPattern === PATTERNS[patternIndex]) {
      selectedPattern = null;
      currentRotation = 0;
    } else {
      selectedPattern = PATTERNS[patternIndex]!;
      currentRotation = 0;
    }
    drawPreview(selectedPattern, 1);
  });
});

// Pattern selection handlers für Spieler 2
document.querySelectorAll(".player2-pattern").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentPlayer = 2; // Auto-select Spieler 2
    player2Btn.style.fontWeight = "bold";
    player2Btn.style.opacity = "1";
    player1Btn.style.fontWeight = "normal";
    player1Btn.style.opacity = "0.6";

    const patternIndex = parseInt(btn.getAttribute("data-pattern")!);
    if (selectedPattern === PATTERNS[patternIndex]) {
      selectedPattern = null;
      currentRotation = 0;
    } else {
      selectedPattern = PATTERNS[patternIndex]!;
      currentRotation = 0;
    }
    drawPreview(selectedPattern, 2);
  });
});

// Rotation button handlers für Spieler 1
document.getElementById("rotateLeft1")!.addEventListener("click", () => {
  if (!selectedPattern || currentPlayer !== 1) return;
  currentRotation = (currentRotation - 90 + 360) % 360;
  const playerPattern = getPatternForPlayer(selectedPattern, 1);
  const rotated = rotatePattern(playerPattern, currentRotation);
  drawPreview(rotated, 1);
});

document.getElementById("rotateRight1")!.addEventListener("click", () => {
  if (!selectedPattern || currentPlayer !== 1) return;
  currentRotation = (currentRotation + 90) % 360;
  const playerPattern = getPatternForPlayer(selectedPattern, 1);
  const rotated = rotatePattern(playerPattern, currentRotation);
  drawPreview(rotated, 1);
});

// Rotation button handlers für Spieler 2
document.getElementById("rotateLeft2")!.addEventListener("click", () => {
  if (!selectedPattern || currentPlayer !== 2) return;
  currentRotation = (currentRotation - 90 + 360) % 360;
  const playerPattern = getPatternForPlayer(selectedPattern, 2);
  const rotated = rotatePattern(playerPattern, currentRotation);
  drawPreview(rotated, 2);
});

document.getElementById("rotateRight2")!.addEventListener("click", () => {
  if (!selectedPattern || currentPlayer !== 2) return;
  currentRotation = (currentRotation + 90) % 360;
  const playerPattern = getPatternForPlayer(selectedPattern, 2);
  const rotated = rotatePattern(playerPattern, currentRotation);
  drawPreview(rotated, 2);
});
//#endregion

//#region Initialization
drawGrid();
drawPreview(null, 1); // Initialize empty preview Spieler 1
drawPreview(null, 2); // Initialize empty preview Spieler 2
console.log("Pattern Clash - Ready!");
//#endregion
