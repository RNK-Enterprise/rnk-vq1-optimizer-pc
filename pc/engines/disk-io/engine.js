/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Disk-I/O engine. It aggregates bounded device throughput and wait evidence
 * without changing mounts, queues, files, or transport state.
 */

export const DISK_IO_ENGINE_ID = 'disk-io';
export const DISK_IO_ENGINE_VERSION = 1;
export const DISK_IO_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function percent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Disk-I/O facts must be an object');
  if (facts.engine !== 'system-facts') throw new Error('Disk-I/O requires system-facts facts');
  if (!Array.isArray(facts.storage)) throw new TypeError('Disk-I/O facts require a storage list');
  return facts;
}

function requireTrigger(trigger) {
  if (!DISK_IO_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported disk-I/O trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Disk-I/O clock must return a number');
  return timestamp;
}

function maximum(rows, selector) {
  const values = rows.map(selector).filter((value) => value !== null);
  return values.length === 0 ? null : Math.max(...values);
}

function sum(rows, selector) {
  const values = rows.map(selector).filter((value) => value !== null);
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
}

function levelFor(waitPercent, readRate, writeRate) {
  if (waitPercent === null && readRate === null && writeRate === null) return 'unknown';
  if (waitPercent !== null && waitPercent >= 30) return 'high';
  if (waitPercent !== null && waitPercent >= 10) return 'elevated';
  return 'normal';
}

function operatingState(environment, count, level) {
  if (environment === 'unknown') return 'profile-required';
  if (count === 0) return 'no-disks';
  if (level === 'unknown') return 'observation-required';
  if (level === 'high') return 'protect-services';
  if (level === 'elevated') return 'watch';
  return 'observe';
}

function recommendations(environment, count, level) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-disk-io-review']);
  if (level === 'unknown') return Object.freeze(['request-disk-io-observation']);
  if (level === 'high') return Object.freeze(['protect-services', 'review-disk-contention']);
  if (level === 'elevated') return Object.freeze(['observe-next-sample', 'review-disk-contention']);
  return Object.freeze(['no-change']);
}

function confidence(environment, count, waitPercent, readRate, writeRate) {
  let score = 0;
  if (environment !== 'unknown') score += 0.2;
  if (count > 0) score += 0.2;
  if (waitPercent !== null) score += 0.2;
  if (readRate !== null) score += 0.2;
  if (writeRate !== null) score += 0.2;
  return Math.round(score * 10000) / 10000;
}

export function runDiskIoEngine(facts, {
  trigger,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const disks = source.storage.filter(isRecord).map((item) => ({
    mount: text(item.mount),
    device: text(item.device),
    readRate: nonNegative(item.readBytesPerSecond),
    writeRate: nonNegative(item.writeBytesPerSecond),
    waitPercent: percent(item.ioWaitPercent)
  }));
  const readRate = sum(disks, (disk) => disk.readRate);
  const writeRate = sum(disks, (disk) => disk.writeRate);
  const waitPercent = maximum(disks, (disk) => disk.waitPercent);
  const level = levelFor(waitPercent, readRate, writeRate);
  return Object.freeze({
    protocolVersion: 1,
    engine: DISK_IO_ENGINE_ID,
    engineVersion: DISK_IO_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    environment,
    diskCount: disks.length,
    mounts: Object.freeze(disks.map((disk) => disk.mount).filter(Boolean)),
    devices: Object.freeze(disks.map((disk) => disk.device).filter(Boolean)),
    totalReadBytesPerSecond: readRate,
    totalWriteBytesPerSecond: writeRate,
    maximumIoWaitPercent: waitPercent,
    level,
    state: operatingState(environment, disks.length, level),
    confidence: confidence(environment, disks.length, waitPercent, readRate, writeRate),
    recommendations: recommendations(environment, disks.length, level),
    actions: EMPTY_ARRAY
  });
}
