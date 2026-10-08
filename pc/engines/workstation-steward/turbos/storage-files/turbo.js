/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 * Storage-files turbo for bounded SMART, benchmark, placement, duplicate,
 * incomplete-download, and protected-path evidence.
 */

export const WORKSTATION_STEWARD_STORAGE_FILES_TURBO_ID = 'workstation-steward.storage-files';
export const WORKSTATION_STEWARD_STORAGE_FILES_TURBO_VERSION = 1;
const TRIGGERS = Object.freeze(['install.preflight', 'system.facts.request', 'workload.changed', 'health.interval']);
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function nonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function requireTrigger(trigger) { if (!TRIGGERS.includes(trigger)) throw new Error(`Unsupported workstation-steward storage-files trigger: ${trigger || 'unknown'}`); return trigger; }
function clock(now) { const value = now(); if (!Number.isFinite(value)) throw new TypeError('Workstation-steward storage-files clock must return a number'); return value; }
function pathProtected(path, protectedPaths) { const candidate = text(path)?.toLowerCase().replaceAll('\\', '/') || ''; return protectedPaths.some((root) => { const normalized = text(root)?.toLowerCase().replaceAll('\\', '/').replace(/\/$/, ''); return normalized && (candidate === normalized || candidate.startsWith(`${normalized}/`)); }); }
function groups(entries) { const grouped = new Map(); entries.forEach((entry) => { const hash = text(entry.sha256)?.toLowerCase(); if (hash) grouped.set(hash, [...(grouped.get(hash) || []), text(entry.path)].filter(Boolean)); }); return Object.freeze([...grouped.entries()].filter(([, paths]) => paths.length > 1).map(([sha256, paths]) => Object.freeze({ sha256, paths: Object.freeze(paths) }))); }

export function runWorkstationStewardStorageFilesTurbo(sample = {}, { trigger, protectedPaths = [], now = Date.now } = {}) {
  requireTrigger(trigger);
  if (!record(sample)) throw new TypeError('Workstation-steward storage-files sample must be an object');
  const timestamp = clock(now);
  const volumes = Array.isArray(sample.volumes) ? sample.volumes.filter(record).slice(0, 64) : [];
  const entries = Array.isArray(sample.files) ? sample.files.filter(record).slice(0, 512) : [];
  const downloads = Array.isArray(sample.downloads) ? sample.downloads.filter(record).slice(0, 128) : [];
  const duplicates = groups(entries);
  const incomplete = Object.freeze([...new Set([...entries.filter((item) => item.complete === false || /\.(part|crdownload|tmp)$/i.test(text(item.path) || '')).map((item) => text(item.path)), ...downloads.filter((item) => item.complete === false).map((item) => text(item.path || item.name))].filter(Boolean))]);
  const target = volumes.filter((item) => item.writable !== false && item.system !== true && nonNegative(item.freeBytes) !== null).sort((a, b) => b.freeBytes - a.freeBytes)[0] || null;
  const benchmarked = volumes.some((item) => record(item.benchmark) && nonNegative(item.benchmark.readBytesPerSecond) !== null && nonNegative(item.benchmark.writeBytesPerSecond) !== null);
  const placements = Object.freeze(entries.filter((item) => nonNegative(item.sizeBytes) >= 2 * 1024 ** 3 && !pathProtected(item.path, protectedPaths) && target).map((item) => Object.freeze({ path: text(item.path), targetMount: text(target.mount), state: 'move-preview', reversible: true, requiresApproval: true })));
  const state = !volumes.length && !entries.length && !downloads.length ? 'observation-required' : incomplete.length ? 'incomplete-review' : duplicates.length ? 'duplicate-review' : placements.length ? 'placement-review' : benchmarked ? 'evidence-ready' : 'observation-review';
  return Object.freeze({ protocolVersion: 1, turbo: WORKSTATION_STEWARD_STORAGE_FILES_TURBO_ID, turboVersion: 1, trigger, generatedAt: new Date(timestamp).toISOString(), volumeCount: volumes.length, fileCount: entries.length, downloadCount: downloads.length, smart: Object.freeze(volumes.map((item) => Object.freeze({ mount: text(item.mount), health: text(item.health) || 'unknown', smart: text(item.smart) || 'unknown' }))), benchmarked, duplicates, incomplete, placements, protectedPaths: Object.freeze(protectedPaths.filter((item) => typeof item === 'string')), targetMount: text(target?.mount), state, actions: Object.freeze([]) });
}
