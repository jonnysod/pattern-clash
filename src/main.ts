import { PATTERNS, type Pattern } from "./patterns.js";

//#region Canvas Setup
const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const CELL_SIZE = 10;
const COLS = canvas.width / CELL_SIZE;
const ROWS = canvas.height / CELL_SIZE;
//#endregion

//#region Preview Canvas Setup
const previewCanvas = document.getElementById(
  "previewCanvas",
) as HTMLCanvasElement;
const previewCtx = previewCanvas.getContext("2d")!;
const previewName = document.getElementById("preview-name")!;

const PREVIEW_CELL_SIZE = 10;
const PREVIEW_COLS = previewCanvas.width / PREVIEW_CELL_SIZE;
const PREVIEW_ROWS = previewCanvas.height / PREVIEW_CELL_SIZE;
//#endregion

//#region Grid State
let grid: boolean[][] = createEmptyGrid();
let isRunning = false;
let animationId: number | null = null;
let selectedPattern: Pattern | null = null;
let currentRotation = 0; // 0, 90, 180, 270

function createEmptyGrid(): boolean[][] {
  return Array(ROWS)
    .fill(null)
    .map(() => Array(COLS).fill(false));
}
//#endregion

//#region Rendering
function drawGrid(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

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

  // Grid lines (optional)
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
}
//#endregion

//#region Preview Rendering
function drawPreview(pattern: Pattern | null): void {
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
    previewName.textContent = "None";
    return;
  }

  // Calculate pattern bounds for centering
  const rows = pattern.cells.map(([r]) => r);
  const cols = pattern.cells.map(([, c]) => c);
  const patternHeight = Math.max(...rows) - Math.min(...rows) + 1;
  const patternWidth = Math.max(...cols) - Math.min(...cols) + 1;

  // Center the pattern
  const offsetRow =
    Math.floor((PREVIEW_ROWS - patternHeight) / 2) - Math.min(...rows);
  const offsetCol =
    Math.floor((PREVIEW_COLS - patternWidth) / 2) - Math.min(...cols);

  // Draw pattern cells
  previewCtx.fillStyle = "#00ff00";
  for (const [row, col] of pattern.cells) {
    const drawRow = row + offsetRow;
    const drawCol = col + offsetCol;
    previewCtx.fillRect(
      drawCol * PREVIEW_CELL_SIZE,
      drawRow * PREVIEW_CELL_SIZE,
      PREVIEW_CELL_SIZE - 1,
      PREVIEW_CELL_SIZE - 1,
    );
  }

  // Update name
  previewName.textContent = pattern.name;
}
//#endregion

//#region Game Logic
function computeNextGeneration(): void {
  const newGrid: boolean[][] = createEmptyGrid();

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const neighbors = countNeighbors(row, col);
      const isAlive = grid[row]![col];

      // Conway's rules:
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
function placePattern(
  startRow: number,
  startCol: number,
  pattern: Pattern,
): void {
  for (const [rowOffset, colOffset] of pattern.cells) {
    const row = startRow + rowOffset;
    const col = startCol + colOffset;

    if (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
      grid[row]![col] = true;
    }
  }
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
    // Place rotated pattern
    const rotated = rotatePattern(selectedPattern, currentRotation);
    placePattern(row, col, rotated);
  } else {
    // Toggle single cell
    if (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
      grid[row]![col] = !grid[row]![col];
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

// Pattern selection handlers
document.querySelectorAll(".pattern-btn").forEach((btn, index) => {
  btn.addEventListener("click", () => {
    if (selectedPattern === PATTERNS[index]) {
      selectedPattern = null;
      currentRotation = 0; // Reset rotation
    } else {
      selectedPattern = PATTERNS[index]!;
      currentRotation = 0; // Reset rotation on new pattern
    }

    drawPreview(selectedPattern);
  });
});

// Rotation button handlers
document.getElementById("rotateLeft")!.addEventListener("click", () => {
  if (!selectedPattern) return;
  currentRotation = (currentRotation - 90 + 360) % 360;
  const rotated = rotatePattern(
    PATTERNS[PATTERNS.indexOf(selectedPattern)]!,
    currentRotation,
  );
  drawPreview(rotated);
});

document.getElementById("rotateRight")!.addEventListener("click", () => {
  if (!selectedPattern) return;
  currentRotation = (currentRotation + 90) % 360;
  const rotated = rotatePattern(
    PATTERNS[PATTERNS.indexOf(selectedPattern)]!,
    currentRotation,
  );
  drawPreview(rotated);
});
//#endregion

//#region Initialization
drawGrid();
drawPreview(null); // Initialize empty preview
console.log("Pattern Clash - Ready!");
//#endregion
