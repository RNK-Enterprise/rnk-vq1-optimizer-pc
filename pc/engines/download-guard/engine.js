/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Download-guard engine. It preflights a download against observed volumes,
 * identifies safer placement, and reports duplicate or hash review needs.
 * It never downloads, moves, deletes, or overwrites a file.
 */

export const DOWNLOAD_GUARD_ENGINE_ID = 'download-guard';
export const DOWNLOAD_GUARD_ENGINE_VERSION = 1;
export const DOWNLOAD_GUARD_TRIGGERS = Object.freeze([
  'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);
const MAX_MARGIN_BYTES = 2 * 1024 ** 3;

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function nonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function mountOf(value) { const normalized = text(value); return normalized === '/' ? '/' : normalized?.replace(/[\\/]$/, '').toLowerCase() || null; }
function list(value, limit = 32) { return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()).slice(0, limit) : []; }
function pathMatches(path, prefix) { const normalizedPath = path.toLowerCase().replaceAll('\\', '/'); const normalizedPrefix = prefix.toLowerCase().replaceAll('\\', '/').replace(/\/$/, ''); return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`); }

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Download-guard facts must be an object');
  if (!['system-facts', 'download-guard-input'].includes(facts.engine)) throw new Error('Download-guard requires system-facts or download-guard-input facts');
  return facts;
}
function requireTrigger(trigger) { if (!DOWNLOAD_GUARD_TRIGGERS.includes(trigger)) throw new Error(`Unsupported download-guard trigger: ${trigger || 'unknown'}`); return trigger; }
function requireClock(timestamp) { if (!Number.isFinite(timestamp)) throw new TypeError('Download-guard clock must return a number'); return timestamp; }
function storageRows(source) { const rows = Array.isArray(source.storage) ? source.storage.filter(isRecord) : []; const pressure = isRecord(source.storagePressure) ? source.storagePressure : {}; return rows.length ? rows : pressure.mount ? [pressure] : []; }
function normalizeStorage(source) { return storageRows(source).map((row) => Object.freeze({ mount: mountOf(row.mount), freeBytes: nonNegative(row.freeBytes), totalBytes: nonNegative(row.totalBytes), kind: text(row.kind)?.toLowerCase() || 'unknown', writable: row.writable !== false, protected: row.protected === true, system: row.system === true })); }
function downloadOf(source) { const download = isRecord(source.download) ? source.download : {}; const sizeBytes = nonNegative(download.sizeBytes); const safetyMarginBytes = Math.min(MAX_MARGIN_BYTES, nonNegative(download.safetyMarginBytes ?? source.safetyMarginBytes) ?? 512 * 1024 ** 2); return Object.freeze({ name: text(download.name), path: text(download.path), sizeBytes, partial: download.partial === true, destinationMount: mountOf(download.destinationMount || source.destinationMount || source.preferredMount), safetyMarginBytes, duplicateCandidates: Number.isInteger(download.duplicateCandidates) && download.duplicateCandidates >= 0 ? download.duplicateCandidates : 0, hashAvailable: typeof download.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(download.sha256) }); }
function systemMount(source, rows) { const explicit = mountOf(source.systemMount); const marked = rows.find((row) => row.system && row.mount); return explicit || marked?.mount || rows.find((row) => row.mount === 'c:')?.mount || rows.find((row) => row.mount === '/')?.mount || null; }
function usable(row, requiredBytes) { return Boolean(row?.mount && row.writable && !row.protected && row.freeBytes !== null && row.freeBytes >= requiredBytes); }
function chooseTarget(rows, download, system) {
  const requested = download.destinationMount ? rows.find((row) => row.mount === download.destinationMount) : null;
  if (requested && usable(requested, download.sizeBytes + download.safetyMarginBytes)) return Object.freeze({ row: requested, redirected: false });
  const available = rows.filter((row) => usable(row, download.sizeBytes + download.safetyMarginBytes));
  const nonSystem = available.filter((row) => row.mount !== system).sort((a, b) => b.freeBytes - a.freeBytes);
  const fallback = [...nonSystem, ...available.filter((row) => row.mount === system), ...available.filter((row) => row.mount !== system && !nonSystem.includes(row))][0] || null;
  return Object.freeze({ row: fallback, redirected: Boolean(fallback && requested && fallback.mount !== requested.mount) });
}
function stateFor(download, target, targetPath, protectedPaths) {
  if (download.sizeBytes === null) return 'observation-required';
  if (targetPath && protectedPaths.some((prefix) => pathMatches(targetPath, prefix))) return 'protected-target';
  if (download.partial) return 'incomplete-review';
  if (download.duplicateCandidates > 0) return 'duplicate-review';
  if (!target?.row) return 'insufficient-space';
  return target.redirected ? 'redirect' : 'allow';
}
function hashRecommendation(download) { return download.hashAvailable ? 'verify-hash-after-download' : 'verify-hash-when-available'; }
function recommendations(state, download, target) {
  if (state === 'protected-target') return Object.freeze(['refuse-protected-target']);
  if (state === 'observation-required') return Object.freeze(['collect-download-size']);
  if (state === 'incomplete-review') return Object.freeze(['review-incomplete-download']);
  if (state === 'duplicate-review') return Object.freeze(['review-duplicate-candidates']);
  if (state === 'insufficient-space') return Object.freeze(['choose-volume-or-free-space']);
  if (state === 'redirect') return Object.freeze([`use-${target.row.mount}-instead`, hashRecommendation(download)]);
  return Object.freeze([hashRecommendation(download)]);
}

export function runDownloadGuardEngine(facts, { trigger, now = Date.now } = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const rows = normalizeStorage(source);
  const download = downloadOf(source);
  const system = systemMount(source, rows);
  const protectedPaths = list(source.protectedPaths);
  const targetPath = text(source.targetPath || source.download?.path);
  const target = chooseTarget(rows, download, system);
  const state = stateFor(download, target, targetPath, protectedPaths);
  const requiredBytes = download.sizeBytes === null ? null : download.sizeBytes + download.safetyMarginBytes;
  const targetFreeBytes = target.row?.freeBytes ?? null;
  return Object.freeze({ protocolVersion: 1, engine: DOWNLOAD_GUARD_ENGINE_ID, engineVersion: DOWNLOAD_GUARD_ENGINE_VERSION, trigger, generatedAt: new Date(timestamp).toISOString(), state, systemMount: system, requestedMount: download.destinationMount, targetMount: target.row?.mount || null, targetKind: target.row?.kind || null, targetFreeBytes, download, requiredBytes, storage: Object.freeze(rows), protectedPaths: Object.freeze(protectedPaths), redirected: target.redirected, hashStatus: download.hashAvailable ? 'available' : 'missing', recommendations: recommendations(state, download, target), actions: EMPTY_ARRAY });
}
