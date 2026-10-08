/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Space-preflight turbo. It checks a bounded download size against observed
 * free space and never starts or redirects a download.
 */

export const DOWNLOAD_GUARD_SPACE_PREFLIGHT_TURBO_ID = 'download-guard.space-preflight';
export const DOWNLOAD_GUARD_SPACE_PREFLIGHT_TURBO_VERSION = 1;
const TRIGGERS = Object.freeze(['install.preflight', 'system.facts.request', 'workload.changed', 'health.interval']);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function sizeOf(sample) { const value = sample?.downloadSizeBytes ?? sample?.download?.sizeBytes; return Number.isFinite(value) && value >= 0 ? value : null; }
function requireTrigger(trigger) { if (!TRIGGERS.includes(trigger)) throw new Error(`Unsupported download-guard space-preflight trigger: ${trigger || 'unknown'}`); return trigger; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Download-guard space-preflight clock must return a number'); return timestamp; }
export function runDownloadGuardSpacePreflightTurbo(samples = [], { trigger, safetyMarginBytes = 512 * 1024 ** 2, now = Date.now } = {}) { requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Download-guard space-preflight samples must be an array'); const timestamp = requireClock(now); const selected = samples.slice(-64); const rows = selected.flatMap((sample) => Array.isArray(sample?.storage) ? sample.storage.filter(isRecord) : []); const size = selected.map(sizeOf).find((value) => value !== null) ?? null; const requiredBytes = size === null ? null : size + Math.max(0, Number.isFinite(safetyMarginBytes) ? safetyMarginBytes : 0); const available = rows.filter((row) => Number.isFinite(row.freeBytes) && row.freeBytes >= requiredBytes); const state = size === null || !rows.length ? 'observation-required' : available.length ? 'enough-space' : 'space-shortfall'; const recommendations = state === 'enough-space' ? ['download-space-available'] : state === 'space-shortfall' ? ['choose-another-volume'] : ['collect-download-and-storage-evidence']; return Object.freeze({ protocolVersion: 1, turbo: DOWNLOAD_GUARD_SPACE_PREFLIGHT_TURBO_ID, turboVersion: DOWNLOAD_GUARD_SPACE_PREFLIGHT_TURBO_VERSION, trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, sizeBytes: size, requiredBytes, eligibleMounts: Object.freeze(available.map((row) => row.mount).filter((mount) => typeof mount === 'string')), state, recommendations: Object.freeze(recommendations), actions: Object.freeze([]) }); }
