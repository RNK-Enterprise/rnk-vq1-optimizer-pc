/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Disk-I/O library. It aggregates bounded device observations for review and
 * never changes mounts, queues, files, or storage policy.
 */

export const DISK_IO_LIBRARY_ID = 'disk-io-library';
export const DISK_IO_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

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
  if (!isRecord(facts)) throw new TypeError('Disk-I/O library facts must be an object');
  if (facts.protocolVersion !== 1 || facts.engine !== 'system-facts') {
    throw new Error('Disk-I/O library requires normalized system facts');
  }
  if (!Array.isArray(facts.storage)) throw new TypeError('Disk-I/O library requires a storage list');
  return facts;
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

function recommendations(environment, count, level) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (count === 0) return Object.freeze(['no-disk-io-review']);
  if (level === 'unknown') return Object.freeze(['request-disk-io-observation']);
  if (level === 'high') return Object.freeze(['protect-services', 'review-disk-contention']);
  if (level === 'elevated') return Object.freeze(['observe-next-sample', 'review-disk-contention']);
  return Object.freeze(['no-change']);
}

export function classifyDiskIo(facts) {
  const source = requireFacts(facts);
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
    library: DISK_IO_LIBRARY_ID,
    libraryVersion: DISK_IO_LIBRARY_VERSION,
    environment,
    diskCount: disks.length,
    mounts: Object.freeze(disks.map((disk) => disk.mount).filter(Boolean)),
    devices: Object.freeze(disks.map((disk) => disk.device).filter(Boolean)),
    totalReadBytesPerSecond: readRate,
    totalWriteBytesPerSecond: writeRate,
    maximumIoWaitPercent: waitPercent,
    level,
    recommendations: recommendations(environment, disks.length, level)
  });
}

export function compareDiskIo(previous, current) {
  const before = classifyDiskIo(previous);
  const after = classifyDiskIo(current);
  const levelChanged = before.level !== after.level;
  const readChanged = before.totalReadBytesPerSecond !== after.totalReadBytesPerSecond;
  const writeChanged = before.totalWriteBytesPerSecond !== after.totalWriteBytesPerSecond;
  const waitChanged = before.maximumIoWaitPercent !== after.maximumIoWaitPercent;
  return Object.freeze({
    changed: levelChanged || readChanged || writeChanged || waitChanged,
    levelChanged,
    readChanged,
    writeChanged,
    waitChanged,
    diskCountChanged: before.diskCount !== after.diskCount
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Disk-I/O library clock must return a number');
  return timestamp;
}

export function buildDiskIoEnvelope(facts, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Disk-I/O library trigger is required');
  }
  return Object.freeze({
    library: DISK_IO_LIBRARY_ID,
    libraryVersion: DISK_IO_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    classification: classifyDiskIo(facts)
  });
}

export function createDiskIoLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('Disk-I/O library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: DISK_IO_LIBRARY_ID,
    version: DISK_IO_LIBRARY_VERSION,
    classify: classifyDiskIo,
    compare: compareDiskIo,
    envelope: (facts, envelopeOptions = {}) => buildDiskIoEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
