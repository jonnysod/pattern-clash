// Simple log-level system
// Default: "info" — shows only game lifecycle and errors
// Switch to "debug" at runtime: (window as any).setLogLevel("debug")

export type LogLevel = "info" | "debug";

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
  console.log(`[Log] Level set to: ${level}`);
}

export function logInfo(...args: unknown[]): void {
  console.log(...args);
}

export function logDebug(...args: unknown[]): void {
  if (currentLevel === "debug") {
    console.log(...args);
  }
}

export function logWarn(...args: unknown[]): void {
  console.warn(...args);
}

// Expose level switch on window for runtime debugging
if (typeof window !== "undefined") {
  (window as any).setLogLevel = setLogLevel;
}
