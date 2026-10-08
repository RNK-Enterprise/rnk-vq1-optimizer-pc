/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Wait-burst turbo. It observes bounded disk wait pressure without changing
 * queues, services, mounts, files, or transport state.
 */

export const DISK_IO_WAIT_BURST_TURBO_ID = 'disk-io.wait-burst';
export const DISK_IO_WAIT_BURST_TURBO_VERSION = 1;
export const DISK_IO_WAIT_BURST_TRIGGERS = Object.freeze([
  'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function percent(value) { if (!Number.isFinite(value)) return null; return Math.min(100, Math.max(0, value)); }
function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('Wait-burst snapshot must be an object');
  if (snapshot.engine !== 'system-facts') throw new Error('Wait-burst requires a system-facts snapshot');
  if (!Array.isArray(snapshot.storage)) throw new TypeError('Wait-burst snapshot requires a storage list');
  return snapshot;
}
function requireTrigger(trigger) { if (!DISK_IO_WAIT_BURST_TRIGGERS.includes(trigger)) throw new Error(`Unsupported wait-burst trigger: ${trigger || 'unknown'}`); return trigger; }
function requireWindowSize(value) { if (!Number.isInteger(value) || value < 1 || value > 64) throw new RangeError('Wait-burst windowSize must be an integer from 1 to 64'); return value; }
function requireMinimumSamples(value, windowSize) { if (!Number.isInteger(value) || value < 1 || value > windowSize) throw new RangeError('Wait-burst minimumSamples must fit inside the window'); return value; }
function requireCount(name, value) { if (!Number.isInteger(value) || value < 1 || value > 64) throw new RangeError(`Wait-burst ${name} must be an integer from 1 to 64`); return value; }
function requireThreshold(value) { if (!Number.isFinite(value) || value < 0 || value > 100) throw new RangeError('Wait-burst waitThreshold must be between 0 and 100'); return value; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Wait-burst clock must return a number'); return timestamp; }
function environmentKnown(snapshot) { return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown'; }
function aggregate(snapshot, waitThreshold) {
  const source = requireSnapshot(snapshot); const rows = source.storage.filter(isRecord).map((item) => percent(item.ioWaitPercent));
  if (!environmentKnown(source)) return Object.freeze({ state: 'incomplete', diskCount: rows.length, maximumWaitPercent: null, pressured: false });
  if (rows.length === 0) return Object.freeze({ state: 'no-disks', diskCount: 0, maximumWaitPercent: null, pressured: false });
  if (rows.some((value) => value === null)) return Object.freeze({ state: 'incomplete', diskCount: rows.length, maximumWaitPercent: null, pressured: false });
  const maximumWaitPercent = Math.max(...rows);
  return Object.freeze({ state: 'observed', diskCount: rows.length, maximumWaitPercent, pressured: maximumWaitPercent >= waitThreshold });
}
function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, pressureSampleCount, persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.some((item) => item.state === 'no-disks')) return 'no-disks';
  if (incompleteCount > 0) return 'incomplete-wait-evidence';
  if (pressureSampleCount >= persistenceThreshold) return 'wait-burst-sustained';
  if (pressureSampleCount > 0) return 'wait-burst-observed';
  return 'stable-wait';
}
function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-wait-samples']);
  if (state === 'no-disks') return Object.freeze(['no-disk-io-review']);
  if (state === 'incomplete-wait-evidence') return Object.freeze(['request-disk-io-observation']);
  if (state === 'wait-burst-sustained') return Object.freeze(['protect-services', 'review-disk-contention']);
  if (state === 'wait-burst-observed') return Object.freeze(['observe-next-wait-sample']);
  return Object.freeze(['no-change']);
}
function confidence(sampleCount, observedCount, minimumSamples) { if (sampleCount === 0) return 0; return Math.round((observedCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000; }
export function runDiskIoWaitBurstTurbo(samples = [], { trigger, windowSize = 16, minimumSamples = 2, waitThreshold = 30, persistenceThreshold = 2, now = Date.now } = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Wait-burst samples must be an array');
  const boundedWindow = requireWindowSize(windowSize); const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow); const requiredThreshold = requireThreshold(waitThreshold); const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow); const timestamp = requireClock(now); const evidence = selected.map((sample) => aggregate(sample, requiredThreshold));
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length; const noDiskCount = evidence.filter((item) => item.state === 'no-disks').length; const observedCount = evidence.filter((item) => item.state === 'observed').length; const pressureSampleCount = evidence.filter((item) => item.state === 'observed' && item.pressured).length;
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, pressureSampleCount, requiredPersistence); const latest = evidence.at(-1) || Object.freeze({ diskCount: 0, maximumWaitPercent: null });
  return Object.freeze({ protocolVersion: 1, turbo: DISK_IO_WAIT_BURST_TURBO_ID, turboVersion: DISK_IO_WAIT_BURST_TURBO_VERSION, trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples, waitThreshold: requiredThreshold, persistenceThreshold: requiredPersistence, diskCount: latest.diskCount, maximumWaitPercent: latest.maximumWaitPercent, observedCount, incompleteCount, noDiskCount, pressureSampleCount, state, confidence: confidence(selected.length, observedCount, requiredSamples), recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
