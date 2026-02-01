import { PATTERNS } from './patterns.js';
//#region Canvas Setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const CELL_SIZE = 10;
const COLS = canvas.width / CELL_SIZE;
const ROWS = canvas.height / CELL_SIZE;
//#endregion
//#region Grid State
let grid = createEmptyGrid();
let isRunning = false;
let animationId = null;
let selectedPattern = null;
function createEmptyGrid() {
    return Array(ROWS).fill(null).map(() => Array(COLS).fill(false));
}
//#endregion
//#region Rendering
function drawGrid() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            if (grid[row][col]) {
                ctx.fillStyle = '#00ff00';
                ctx.fillRect(col * CELL_SIZE, row * CELL_SIZE, CELL_SIZE - 1, CELL_SIZE - 1);
            }
        }
    }
    // Grid lines (optional)
    ctx.strokeStyle = '#222';
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
//#region Game Logic
function computeNextGeneration() {
    const newGrid = createEmptyGrid();
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            const neighbors = countNeighbors(row, col);
            const isAlive = grid[row][col];
            // Conway's rules:
            if (isAlive && (neighbors === 2 || neighbors === 3)) {
                newGrid[row][col] = true; // Survives
            }
            else if (!isAlive && neighbors === 3) {
                newGrid[row][col] = true; // Birth
            }
            else {
                newGrid[row][col] = false; // Dies or stays dead
            }
        }
    }
    grid = newGrid;
}
function countNeighbors(row, col) {
    let count = 0;
    // Check all 8 neighbors
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0)
                continue; // Skip the cell itself
            const newRow = row + dr;
            const newCol = col + dc;
            // Check if neighbor is in grid and alive
            if (newRow >= 0 && newRow < ROWS &&
                newCol >= 0 && newCol < COLS &&
                grid[newRow][newCol]) {
                count++;
            }
        }
    }
    return count;
}
//#endregion
//#region Pattern Placement
function placePattern(startRow, startCol, pattern) {
    for (const [rowOffset, colOffset] of pattern.cells) {
        const row = startRow + rowOffset;
        const col = startCol + colOffset;
        if (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
            grid[row][col] = true;
        }
    }
}
//#endregion
//#region Animation
function animate() {
    if (!isRunning)
        return;
    computeNextGeneration();
    drawGrid();
    setTimeout(() => {
        animationId = requestAnimationFrame(animate);
    }, 100); // 100ms between generations = ~10 FPS
}
//#endregion
//#region Event Handlers
// Click handler: place pattern or toggle cell
canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const col = Math.floor(x / CELL_SIZE);
    const row = Math.floor(y / CELL_SIZE);
    if (selectedPattern) {
        // Place pattern
        placePattern(row, col, selectedPattern);
    }
    else {
        // Toggle single cell
        if (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
            grid[row][col] = !grid[row][col];
        }
    }
    drawGrid();
});
// Button event handlers
document.getElementById('startBtn').addEventListener('click', () => {
    isRunning = true;
    animate();
});
document.getElementById('pauseBtn').addEventListener('click', () => {
    isRunning = false;
    if (animationId !== null) {
        cancelAnimationFrame(animationId);
    }
});
document.getElementById('resetBtn').addEventListener('click', () => {
    isRunning = false;
    if (animationId !== null) {
        cancelAnimationFrame(animationId);
    }
    grid = createEmptyGrid();
    drawGrid();
});
// Pattern selection handlers
document.querySelectorAll('.pattern-btn').forEach((btn, index) => {
    btn.addEventListener('click', () => {
        // Remove active class from all buttons
        document.querySelectorAll('.pattern-btn').forEach(b => b.classList.remove('active'));
        // Toggle selection
        if (selectedPattern === PATTERNS[index]) {
            selectedPattern = null; // Deselect
        }
        else {
            selectedPattern = PATTERNS[index];
            btn.classList.add('active'); // Mark as active
        }
    });
});
//#endregion
//#region Initialization
drawGrid();
console.log('Pattern Clash - Ready!');
//#endregion
//# sourceMappingURL=main.js.map