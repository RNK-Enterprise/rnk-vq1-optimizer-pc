/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Bounded process-resource rates from two explicit telemetry samples. It never
 * starts, stops, reprioritizes, or limits a process.
 */

export const PROCESS_RATE_VERSION = 1;

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function number(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function validPid(value) { return Number.isInteger(value) && value > 0; }
function rows(snapshot) { return Array.isArray(snapshot?.processes) ? snapshot.processes.filter(record).slice(0, 512) : []; }
function validateInterval(value) {
  if (!Number.isFinite(value) || value < 1 || value > 24 * 60 * 60 * 1000) throw new RangeError('Process rate interval is out of range');
  return value;
}
function sameIdentity(previous, current) {
  const previousName = text(previous.name);
  const currentName = text(current.name);
  const previousPath = text(previous.path);
  const currentPath = text(current.path);
  return previousName === currentName && previousPath === currentPath;
}
function rate(current, previous, elapsedMs) {
  if (current === null || previous === null) return { value: null, state: 'observation-required' };
  if (current < previous) return { value: null, state: 'counter-reset' };
  return { value: (current - previous) / (elapsedMs / 1000), state: 'measured' };
}
function rowRate(current, previous, elapsedMs) {
  if (!previous) return { ioRead: null, ioWrite: null, cpu: null, state: 'observation-required' };
  if (!sameIdentity(previous, current)) return { ioRead: null, ioWrite: null, cpu: null, state: 'identity-changed' };
  const ioRead = rate(number(current.ioReadBytes), number(previous.ioReadBytes), elapsedMs);
  const ioWrite = rate(number(current.ioWriteBytes), number(previous.ioWriteBytes), elapsedMs);
  const cpu = rate(number(current.cpuSeconds), number(previous.cpuSeconds), elapsedMs);
  const reset = [ioRead, ioWrite, cpu].some((item) => item.state === 'counter-reset');
  const measured = [ioRead, ioWrite, cpu].some((item) => item.state === 'measured');
  return { ioRead: ioRead.value, ioWrite: ioWrite.value, cpu: cpu.value === null ? null : cpu.value * 100, state: reset ? 'counter-reset' : measured ? 'measured' : 'observation-required' };
}

export function compareProcessResourceSnapshots(previous, current, { intervalMs = 1000, maxEntries = 512 } = {}) {
  if (!record(current)) throw new TypeError('Process rate current snapshot is required');
  if (previous !== null && previous !== undefined && !record(previous)) throw new TypeError('Process rate previous snapshot is invalid');
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 512) throw new RangeError('Process rate maxEntries is out of range');
  const elapsedMs = validateInterval(intervalMs);
  const old = new Map(rows(previous).filter((item) => validPid(item.pid)).map((item) => [item.pid, item]));
  const processes = rows(current).filter((item) => validPid(item.pid)).map((item) => {
    const previousProcess = old.get(item.pid);
    const calculated = rowRate(item, previousProcess, elapsedMs);
    const memoryBytes = number(item.memoryBytes);
    const previousMemory = number(previousProcess?.memoryBytes);
    const memoryDeltaBytes = memoryBytes === null || previousMemory === null || !sameIdentity(previousProcess, item) ? null : memoryBytes - previousMemory;
    return Object.freeze({
      pid: item.pid,
      name: text(item.name) || 'unknown',
      path: text(item.path),
      role: text(item.role)?.toLowerCase() || 'unknown',
      cpuPercent: calculated.cpu,
      ioReadBytesPerSecond: calculated.ioRead,
      ioWriteBytesPerSecond: calculated.ioWrite,
      ioBytesPerSecond: calculated.ioRead === null || calculated.ioWrite === null ? null : calculated.ioRead + calculated.ioWrite,
      memoryBytes,
      memoryDeltaBytes,
      gpuMemoryBytes: number(item.gpuMemoryBytes),
      state: calculated.state
    });
  }).slice(0, maxEntries);
  const measured = processes.filter((item) => item.state === 'measured');
  const reset = processes.some((item) => item.state === 'counter-reset');
  return Object.freeze({ version: PROCESS_RATE_VERSION, available: measured.length > 0, intervalMs: elapsedMs, processes: Object.freeze(processes), measuredCount: measured.length, resetCount: processes.filter((item) => item.state === 'counter-reset').length, state: !previous || !processes.length ? 'observation-required' : reset ? 'counter-reset' : measured.length ? 'rate-ready' : 'observation-required', mutation: 'none' });
}

export function createProcessResourceMonitor({ collectSample, intervalMs = 5000, now = Date.now, onReport = () => {}, onError = () => {}, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
  if (typeof collectSample !== 'function') throw new TypeError('Process rate monitor requires a sample collector');
  const interval = validateInterval(intervalMs);
  if (typeof now !== 'function' || typeof onReport !== 'function' || typeof onError !== 'function') throw new TypeError('Process rate monitor clock and callbacks must be callable');
  if (typeof setIntervalImpl !== 'function' || typeof clearIntervalImpl !== 'function') throw new TypeError('Process rate monitor timer functions must be callable');
  let previous = null;
  let timer = null;
  let running = false;

  async function collect() {
    const timestamp = now();
    if (!Number.isFinite(timestamp)) throw new TypeError('Process rate monitor clock must return a number');
    const sample = await collectSample();
    const rateReport = compareProcessResourceSnapshots(previous, sample, { intervalMs: interval });
    previous = sample;
    const report = Object.freeze({ version: PROCESS_RATE_VERSION, timestamp, rate: rateReport });
    await onReport(report);
    return report;
  }
  function start() {
    if (running) return Object.freeze({ started: false, reason: 'already-running' });
    running = true;
    timer = setIntervalImpl(() => { collect().catch(onError); }, interval);
    return Object.freeze({ started: true, intervalMs: interval });
  }
  function stop() {
    if (!running) return Object.freeze({ stopped: false, reason: 'not-running' });
    clearIntervalImpl(timer);
    timer = null;
    running = false;
    previous = null;
    return Object.freeze({ stopped: true });
  }
  return Object.freeze({ version: PROCESS_RATE_VERSION, intervalMs: interval, collect, start, stop, isRunning: () => running });
}
