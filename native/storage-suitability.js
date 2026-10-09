/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Canonical physical-storage admission gate. Free space is never sufficient
 * placement evidence by itself; the volume must resolve to a physical disk
 * whose platform health and SMART evidence are safe.
 */

export const STORAGE_SUITABILITY_VERSION = 1;
export const STORAGE_SUITABILITY_STATES = Object.freeze(['HEALTHY', 'DEGRADED', 'FAILED', 'UNKNOWN']);

const HEALTH_ALIASES = Object.freeze({
  healthy: 'HEALTHY', ok: 'HEALTHY', online: 'HEALTHY', passed: 'HEALTHY', pass: 'HEALTHY',
  degraded: 'DEGRADED', warning: 'DEGRADED', predictivefailure: 'DEGRADED',
  failed: 'FAILED', unhealthy: 'FAILED', offline: 'FAILED', critical: 'FAILED', fail: 'FAILED'
});
const HARD_FAILURE_FIELDS = Object.freeze([
  'recentBadBlocks', 'badBlocks', 'controllerReset', 'ntfsFlushFailure',
  'surpriseRemoval', 'hardFailure', 'failed', 'failure'
]);

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function integer(value) { return Number.isInteger(value) && value >= 0 ? value : null; }
function mount(value) {
  const normalized = text(value);
  if (!normalized) return null;
  if (normalized === '/') return '/';
  return /^[A-Za-z]:$/.test(normalized) ? normalized.toUpperCase() : normalized.replace(/[\\/]$/, '').toLowerCase() || null;
}
function normalizeHealth(value) {
  if (record(value)) return normalizeHealth(value.health ?? value.state ?? value.status);
  const normalized = text(value)?.toLowerCase().replace(/[\s_-]/g, '');
  return HEALTH_ALIASES[normalized] || 'UNKNOWN';
}
function physicalPath(value) {
  const normalized = text(value);
  if (!normalized) return null;
  if (/^\\\\\.\\PhysicalDrive\d+$/u.test(normalized)) return normalized;
  if (/^PhysicalDrive\d+$/u.test(normalized)) return `\\\\.\\${normalized}`;
  return normalized.toLowerCase();
}
function identityOf(value = {}) {
  const source = record(value) ? value : {};
  return Object.freeze({
    mount: mount(source.mount ?? source.driveLetter ?? source.volume),
    volumeId: text(source.volumeId ?? source.uniqueId ?? source.objectId ?? source.volumeGuid ?? source.device),
    diskNumber: integer(source.physicalDiskNumber ?? source.diskNumber ?? source.DiskNumber ?? source.Number),
    physicalDevicePath: physicalPath(source.physicalDevicePath ?? source.physicalDevice ?? source.devicePath ?? source.physicalDisk)
  });
}
function samePhysical(left, right) {
  if (left.diskNumber !== null && right.diskNumber !== null && left.diskNumber === right.diskNumber) return true;
  return left.physicalDevicePath !== null && right.physicalDevicePath !== null && left.physicalDevicePath === right.physicalDevicePath;
}
function hardFailureReasons(value) {
  const rows = Array.isArray(value) ? value : [value];
  return [...new Set(rows.flatMap((row) => {
    if (!record(row)) return [];
    return HARD_FAILURE_FIELDS.filter((field) => row[field] === true).map((field) => field);
  }))];
}
function reasonForIdentity(volumeIdentity, diskIdentity, drives) {
  if (!volumeIdentity.mount) return 'VOLUME_IDENTITY_UNRESOLVED';
  if (!volumeIdentity.volumeId) return 'VOLUME_IDENTITY_UNRESOLVED';
  if (volumeIdentity.diskNumber === null && !volumeIdentity.physicalDevicePath) return 'PHYSICAL_DISK_IDENTITY_UNRESOLVED';
  if (!diskIdentity) return drives.length ? 'PHYSICAL_DISK_NOT_FOUND' : 'PHYSICAL_DISK_EVIDENCE_UNAVAILABLE';
  if (diskIdentity.diskNumber === null && !diskIdentity.physicalDevicePath) return 'PHYSICAL_DISK_IDENTITY_UNRESOLVED';
  return null;
}
function findDisk(volumeIdentity, physicalDisk, drives) {
  if (record(physicalDisk)) return physicalDisk;
  return drives.find((item) => samePhysical(volumeIdentity, identityOf(item))) || null;
}
function healthState(healths, identityReason, failureReasons) {
  if (failureReasons.length || healths.includes('FAILED')) return 'FAILED';
  if (identityReason) return 'UNKNOWN';
  if (healths.includes('DEGRADED')) return 'DEGRADED';
  if (healths.length === 0 || healths.includes('UNKNOWN')) return 'UNKNOWN';
  return 'HEALTHY';
}

export function assessStorageSuitability({ volume, physicalDisk = null, drives = [], hardFailureEvidence = [] } = {}) {
  const volumeIdentity = identityOf(volume);
  const driveRows = Array.isArray(drives) ? drives.filter(record).slice(0, 64) : [];
  const disk = findDisk(volumeIdentity, physicalDisk, driveRows)
    || (record(volume) && (volume.diskHealth || volume.diskOperationalStatus || volume.smart)
      ? { ...volume, health: volume.diskHealth, operationalStatus: volume.diskOperationalStatus }
      : null);
  const diskIdentity = disk ? identityOf(disk) : null;
  const identityReason = reasonForIdentity(volumeIdentity, diskIdentity, driveRows);
  const failureReasons = [...new Set([
    ...hardFailureReasons(hardFailureEvidence),
    ...hardFailureReasons(volume?.hardFailureEvidence),
    ...hardFailureReasons(disk?.hardFailureEvidence)
  ])];
  const healths = [
    normalizeHealth(volume?.health ?? volume?.healthStatus),
    normalizeHealth(disk?.health ?? disk?.healthStatus ?? disk?.operationalStatus),
    normalizeHealth(disk?.smart)
  ];
  const state = healthState(healths, identityReason, failureReasons);
  const reasons = Object.freeze([
    ...(identityReason ? [identityReason] : []),
    ...failureReasons.map((item) => `HARD_FAILURE_${item.toUpperCase()}`),
    ...(healths.includes('FAILED') ? ['PHYSICAL_HEALTH_FAILED'] : []),
    ...(healths.includes('DEGRADED') ? ['PHYSICAL_HEALTH_DEGRADED'] : []),
    ...(healths.includes('UNKNOWN') && state === 'UNKNOWN' && !identityReason ? ['PHYSICAL_HEALTH_UNKNOWN'] : [])
  ]);
  const writable = volume?.writable !== false && volume?.readOnly !== true;
  return Object.freeze({
    version: STORAGE_SUITABILITY_VERSION,
    state,
    eligible: state === 'HEALTHY' && writable,
    admission: state === 'HEALTHY' && writable ? 'ALLOW' : 'DENY',
    mount: volumeIdentity.mount,
    volumeIdentity,
    physicalDiskIdentity: diskIdentity,
    health: Object.freeze({ volume: healths[0], disk: healths[1], smart: healths[2] }),
    writable,
    reasons,
    source: Object.freeze({ volume: volume?.source || null, disk: disk?.source || null, smart: disk?.smart?.source || null })
  });
}

export function assessStorageTarget({ targetMount, volumes = [], drives = [], hardFailureEvidence = [] } = {}) {
  const requested = mount(targetMount);
  const volumeRows = Array.isArray(volumes) ? volumes.filter(record) : [];
  const volume = volumeRows.find((item) => mount(item.mount ?? item.driveLetter) === requested) || null;
  if (!volume) {
    return Object.freeze({ version: STORAGE_SUITABILITY_VERSION, state: 'UNKNOWN', eligible: false, admission: 'DENY', mount: requested, reasons: Object.freeze(['VOLUME_NOT_OBSERVED']) });
  }
  return assessStorageSuitability({ volume, drives, hardFailureEvidence });
}

export function storageSuitabilityForPath(targetPath, options = {}) {
  const value = text(targetPath);
  const windows = /^[A-Za-z]:/u.exec(value || '');
  const targetMount = windows ? `${windows[0][0].toUpperCase()}:` : options.pathImpl?.parse?.(value || '')?.root || null;
  return assessStorageTarget({ ...options, targetMount });
}
