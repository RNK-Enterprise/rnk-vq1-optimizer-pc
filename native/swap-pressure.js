/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Linux swap observation. Swap is system-managed pressure evidence, never a
 * cleanup target or an inferred authorization to change virtual memory.
 */

function emptySwapPressure() {
  return {
    available: false,
    systemManaged: true,
    files: Object.freeze([]),
    allocatedBytes: null,
    currentBytes: null,
    pressurePercent: null,
    cleanup: 'never'
  };
}

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function parseLinuxSwapOutput(output) {
  const lines = String(output || '').split(/\r?\n/);
  const line = lines.find((candidate) => /^\s*Swap:\s/.test(candidate));
  if (!line) return null;
  const fields = line.trim().split(/\s+/);
  if (fields.length < 3 || fields[0] !== 'Swap:') return null;
  const allocatedBytes = nonNegative(fields[1]);
  const currentBytes = nonNegative(fields[2]);
  if (allocatedBytes === null || currentBytes === null) return null;
  return Object.freeze({
    available: true,
    systemManaged: true,
    files: Object.freeze([]),
    allocatedBytes,
    currentBytes,
    pressurePercent: allocatedBytes > 0 ? Math.min(100, (currentBytes / allocatedBytes) * 100) : null,
    cleanup: 'never'
  });
}

export async function collectLinuxSwapPressure({ commandRunner } = {}) {
  if (!commandRunner || typeof commandRunner.run !== 'function') return emptySwapPressure();
  try {
    const result = await commandRunner.run('free', ['-b'], { timeoutMs: 2500, maxOutputBytes: 4096 });
    if (result?.code !== 0) return emptySwapPressure();
    return parseLinuxSwapOutput(result.stdout) || emptySwapPressure();
  } catch {
    return emptySwapPressure();
  }
}
