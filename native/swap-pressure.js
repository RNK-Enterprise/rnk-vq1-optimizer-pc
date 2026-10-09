/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Cross-platform swap observation. Swap is system-managed pressure evidence,
 * never a cleanup target or an inferred authorization to change virtual
 * memory.
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

function swapFacts(allocatedBytes, currentBytes) {
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

export function parseLinuxSwapOutput(output) {
  const lines = String(output || '').split(/\r?\n/);
  const line = lines.find((candidate) => /^\s*Swap:\s/.test(candidate));
  if (!line) return null;
  const fields = line.trim().split(/\s+/);
  if (fields.length < 3 || fields[0] !== 'Swap:') return null;
  const allocatedBytes = nonNegative(fields[1]);
  const currentBytes = nonNegative(fields[2]);
  if (allocatedBytes === null || currentBytes === null) return null;
  return swapFacts(allocatedBytes, currentBytes);
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

const SWAP_UNITS = Object.freeze({ '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 });

function darwinSwapValue(output, label) {
  const match = String(output || '').match(new RegExp(`${label}\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)\\s*([A-Z]?)(?![A-Za-z])`, 'i'));
  if (!match) return null;
  const multiplier = SWAP_UNITS[match[2].toUpperCase()];
  const value = Number(match[1]) * multiplier;
  return Number.isFinite(value) ? value : null;
}

export function parseDarwinSwapOutput(output) {
  const allocatedBytes = darwinSwapValue(output, 'total');
  const currentBytes = darwinSwapValue(output, 'used');
  if (allocatedBytes === null || currentBytes === null) return null;
  return swapFacts(allocatedBytes, currentBytes);
}

export async function collectDarwinSwapPressure({ commandRunner } = {}) {
  if (!commandRunner || typeof commandRunner.run !== 'function') return emptySwapPressure();
  try {
    const result = await commandRunner.run('sysctl', ['-n', 'vm.swapusage'], { timeoutMs: 2500, maxOutputBytes: 4096 });
    if (result?.code !== 0) return emptySwapPressure();
    return parseDarwinSwapOutput(result.stdout) || emptySwapPressure();
  } catch {
    return emptySwapPressure();
  }
}
