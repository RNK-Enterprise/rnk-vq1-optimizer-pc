/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Throughput-skew turbo. It observes bounded read/write imbalance without
 * reprioritizing queues, changing services, or writing storage.
 */

export const DISK_IO_THROUGHPUT_SKEW_TURBO_ID = 'disk-io.throughput-skew';
export const DISK_IO_THROUGHPUT_SKEW_TURBO_VERSION = 1;
export const DISK_IO_THROUGHPUT_SKEW_TRIGGERS = Object.freeze(['install.preflight', 'system.facts.request', 'workload.changed', 'health.interval']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function nonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function skew(readRate, writeRate) { const maximum = Math.max(readRate, writeRate); if (maximum === 0) return 0; return Math.round((Math.abs(readRate - writeRate) / maximum) * 10000) / 100; }
function requireSnapshot(snapshot) { if (!isRecord(snapshot)) throw new TypeError('Throughput-skew snapshot must be an object'); if (snapshot.engine !== 'system-facts') throw new Error('Throughput-skew requires a system-facts snapshot'); if (!Array.isArray(snapshot.storage)) throw new TypeError('Throughput-skew snapshot requires a storage list'); return snapshot; }
function requireTrigger(trigger) { if (!DISK_IO_THROUGHPUT_SKEW_TRIGGERS.includes(trigger)) throw new Error(`Unsupported throughput-skew trigger: ${trigger || 'unknown'}`); return trigger; }
function requireWindowSize(value) { if (!Number.isInteger(value) || value < 1 || value > 64) throw new RangeError('Throughput-skew windowSize must be an integer from 1 to 64'); return value; }
function requireMinimumSamples(value, size) { if (!Number.isInteger(value) || value < 1 || value > size) throw new RangeError('Throughput-skew minimumSamples must fit inside the window'); return value; }
function requireCount(name, value) { if (!Number.isInteger(value) || value < 1 || value > 64) throw new RangeError(`Throughput-skew ${name} must be an integer from 1 to 64`); return value; }
function requireThreshold(value) { if (!Number.isFinite(value) || value < 0 || value > 100) throw new RangeError('Throughput-skew skewThreshold must be between 0 and 100'); return value; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Throughput-skew clock must return a number'); return timestamp; }
function environmentKnown(snapshot) { return ENVIRONMENTS.includes(snapshot.environment) && snapshot.environment !== 'unknown'; }
function aggregate(snapshot, skewThreshold) {
  const source = requireSnapshot(snapshot); const rows = source.storage.filter(isRecord).map((item) => { const readRate = nonNegative(item.readBytesPerSecond); const writeRate = nonNegative(item.writeBytesPerSecond); return readRate === null || writeRate === null ? null : skew(readRate, writeRate); });
  if (!environmentKnown(source)) return Object.freeze({ state: 'incomplete', diskCount: rows.length, maximumSkewPercent: null, skewed: false });
  if (rows.length === 0) return Object.freeze({ state: 'no-disks', diskCount: 0, maximumSkewPercent: null, skewed: false });
  if (rows.some((value) => value === null)) return Object.freeze({ state: 'incomplete', diskCount: rows.length, maximumSkewPercent: null, skewed: false });
  const maximumSkewPercent = Math.max(...rows); return Object.freeze({ state: 'observed', diskCount: rows.length, maximumSkewPercent, skewed: maximumSkewPercent >= skewThreshold });
}
function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, skewSampleCount, persistenceThreshold) { if (sampleCount < minimumSamples) return 'insufficient-data'; if (evidence.some((item) => item.state === 'no-disks')) return 'no-disks'; if (incompleteCount > 0) return 'incomplete-throughput-evidence'; if (skewSampleCount >= persistenceThreshold) return 'throughput-skew-sustained'; if (skewSampleCount > 0) return 'throughput-skew-observed'; return 'balanced-throughput'; }
function recommendations(state) { if (state === 'insufficient-data') return Object.freeze(['collect-more-throughput-samples']); if (state === 'no-disks') return Object.freeze(['no-disk-io-review']); if (state === 'incomplete-throughput-evidence') return Object.freeze(['request-throughput-observation']); if (state === 'throughput-skew-sustained') return Object.freeze(['review-read-write-contention', 'hold-queue-policy-change']); if (state === 'throughput-skew-observed') return Object.freeze(['observe-throughput-balance']); return Object.freeze(['no-change']); }
function confidence(sampleCount, observedCount, minimumSamples) { if (sampleCount === 0) return 0; return Math.round((observedCount / sampleCount) * Math.min(1, sampleCount / minimumSamples) * 10000) / 10000; }
export function runDiskIoThroughputSkewTurbo(samples = [], { trigger, windowSize = 16, minimumSamples = 2, skewThreshold = 60, persistenceThreshold = 2, now = Date.now } = {}) {
  requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Throughput-skew samples must be an array'); const boundedWindow = requireWindowSize(windowSize); const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow); const requiredThreshold = requireThreshold(skewThreshold); const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold); const selected = samples.slice(-boundedWindow); const timestamp = requireClock(now); const evidence = selected.map((sample) => aggregate(sample, requiredThreshold)); const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length; const noDiskCount = evidence.filter((item) => item.state === 'no-disks').length; const observedCount = evidence.filter((item) => item.state === 'observed').length; const skewSampleCount = evidence.filter((item) => item.state === 'observed' && item.skewed).length; const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, skewSampleCount, requiredPersistence); const latest = evidence.at(-1) || Object.freeze({ diskCount: 0, maximumSkewPercent: null });
  return Object.freeze({ protocolVersion: 1, turbo: DISK_IO_THROUGHPUT_SKEW_TURBO_ID, turboVersion: DISK_IO_THROUGHPUT_SKEW_TURBO_VERSION, trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, minimumSamples: requiredSamples, skewThreshold: requiredThreshold, persistenceThreshold: requiredPersistence, diskCount: latest.diskCount, maximumSkewPercent: latest.maximumSkewPercent, observedCount, incompleteCount, noDiskCount, skewSampleCount, state, confidence: confidence(selected.length, observedCount, requiredSamples), recommendations: recommendations(state), actions: EMPTY_ARRAY });
}
