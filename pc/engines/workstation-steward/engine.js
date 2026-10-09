/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Workstation-steward orchestration engine. It turns bounded cross-platform host evidence
 * into reviewable plans for resources, storage, files, downloads, media, and
 * user questions. It never mutates the host or grants the planner authority.
 */

import { assessStorageSuitability } from '../../../native/storage-suitability.js';

export const WORKSTATION_STEWARD_ENGINE_ID = 'workstation-steward';
export const WORKSTATION_STEWARD_ENGINE_VERSION = 1;
export const WORKSTATION_STEWARD_TRIGGERS = Object.freeze([
  'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
]);
const EMPTY = Object.freeze([]);
const PROTECTED_DEFAULTS = Object.freeze(['repositories', 'credentials', 'models', 'wsl', 'active-runtimes', 'user-files']);
const PLATFORMS = Object.freeze(['win32', 'linux', 'darwin', 'unknown']);

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function nonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function list(value, limit = 64) { return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()).slice(0, limit) : []; }
function rows(value) { return Array.isArray(value) ? value.filter(record).slice(0, 256) : []; }
function requireTrigger(trigger) { if (!WORKSTATION_STEWARD_TRIGGERS.includes(trigger)) throw new Error(`Unsupported workstation-steward trigger: ${trigger || 'unknown'}`); return trigger; }
function requireFacts(facts) { if (!record(facts)) throw new TypeError('Workstation-steward facts must be an object'); if (!['system-facts', 'workstation-steward-input'].includes(facts.engine)) throw new Error('Workstation-steward requires system-facts or workstation-steward-input facts'); return facts; }
function requireTimestamp(value) { if (!Number.isFinite(value)) throw new TypeError('Workstation-steward clock must return a number'); return value; }
function platformOf(value) { const normalized = text(value)?.toLowerCase(); return PLATFORMS.includes(normalized) ? normalized : 'unknown'; }
function capabilities(platform) { return Object.freeze({ observation: 'supported-by-schema', processPriority: ['win32', 'linux', 'darwin'].includes(platform) ? 'platform-adapter-review' : 'unsupported', ioPriority: ['win32', 'linux'].includes(platform) ? 'platform-adapter-review' : 'unsupported', cpuHardCap: ['win32', 'linux'].includes(platform) ? 'platform-adapter-review' : 'unsupported', memoryHardCap: ['win32', 'linux'].includes(platform) ? 'platform-adapter-review' : 'unsupported', gpuHardCap: 'unsupported', fileMove: 'preview-and-approval-required', historyPersistence: 'append-only-caller-owned', mediaPanel: 'https-allowlist-review' }); }
function budgetCapabilities(platform) { return Object.freeze({ cpuPercent: ['win32', 'linux'].includes(platform) ? 'hard-limit-adapter' : 'unsupported', memoryBytes: ['win32', 'linux'].includes(platform) ? 'hard-limit-adapter' : 'unsupported', ioBytesPerSecond: 'priority-only', gpuPercent: 'observation-only' }); }
function unsupportedBudgetDimensions(platform) { return Object.freeze(Object.entries(budgetCapabilities(platform)).filter(([, state]) => state !== 'hard-limit-adapter').map(([dimension]) => dimension)); }
function protectedPaths(source) { return Object.freeze([...new Set([...PROTECTED_DEFAULTS, ...list(source.protectedPaths)])]); }
function driveRows(source) { const drives = source.drives || source.driveHealth?.drives; return Array.isArray(drives) ? drives.filter(record).slice(0, 64) : []; }
function storage(source) {
  const drives = driveRows(source);
  const hardFailureEvidence = Array.isArray(source.hardFailureEvidence) ? source.hardFailureEvidence : [];
  return Object.freeze(rows(source.storage).map((row) => {
    const normalized = { mount: text(row.mount), freeBytes: nonNegative(row.freeBytes), totalBytes: nonNegative(row.totalBytes), kind: text(row.kind)?.toLowerCase() || 'unknown', volumeId: text(row.volumeId ?? row.uniqueId ?? row.device), physicalDiskNumber: Number.isInteger(row.physicalDiskNumber) && row.physicalDiskNumber >= 0 ? row.physicalDiskNumber : null, physicalDevicePath: text(row.physicalDevicePath), health: text(row.health)?.toLowerCase() || 'unknown', smart: text(row.smart)?.toLowerCase() || 'unknown', smartEvidence: row.smart, hardFailureEvidence: row.hardFailureEvidence, system: row.system === true, writable: row.writable !== false };
    return Object.freeze({ ...normalized, storageSuitability: assessStorageSuitability({ volume: { ...normalized, smart: row.smart }, drives, hardFailureEvidence }) });
  }));
}
function processes(source) { return Object.freeze(rows(source.processes).map((row) => Object.freeze({ pid: Number.isInteger(row.pid) && row.pid > 0 ? row.pid : null, name: text(row.name) || 'unknown', cpuPercent: nonNegative(row.cpuPercent), memoryBytes: nonNegative(row.memoryBytes), ioBytesPerSecond: nonNegative(row.ioBytesPerSecond), gpuPercent: nonNegative(row.gpuPercent), foreground: row.foreground === true, protected: row.protected === true, role: text(row.role)?.toLowerCase() || 'unknown' }))); }
function game(processList, source) { const declared = record(source.game) ? source.game : {}; const candidate = processList.find((item) => item.foreground && (item.role === 'game' || item.role === 'gaming')) || processList.find((item) => item.role === 'game' || item.role === 'gaming'); return Object.freeze({ detected: declared.detected === true || Boolean(candidate), name: text(declared.name) || candidate?.name || null, pid: Number.isInteger(declared.pid) ? declared.pid : candidate?.pid || null, confidence: declared.detected === true ? 1 : candidate ? 0.8 : 0 }); }
function resourcePlan(processList, activeGame, source, platform) { const requested = record(source.resourceBudget) ? source.resourceBudget : {}; const budget = Object.freeze({ cpuPercent: nonNegative(requested.cpuPercent) ?? 50, memoryBytes: nonNegative(requested.memoryBytes) ?? 8 * 1024 ** 3, ioBytesPerSecond: nonNegative(requested.ioBytesPerSecond) ?? 50 * 1024 ** 2, gpuPercent: nonNegative(requested.gpuPercent) ?? 35 }); const unsupported = unsupportedBudgetDimensions(platform); const actions = activeGame.detected ? processList.filter((item) => !item.foreground && !item.protected && item.role !== 'system' && item.pid).map((item) => Object.freeze({ type: 'budget-process', pid: item.pid, name: item.name, budget, enforcement: 'hard-where-supported', unsupportedDimensions: unsupported, reversible: true, requiresApproval: true, reason: 'background workload must yield to the detected foreground game' })) : EMPTY; return Object.freeze({ budget, capabilities: budgetCapabilities(platform), enforcement: actions.length ? 'approved-native-plan-required' : 'observation-only', actions: Object.freeze(actions), restore: activeGame.detected ? 'on-game-exit' : 'manual-review' }); }
function filePlan(source, storageRows) { const entries = rows(source.files); const duplicateGroups = new Map(); const incomplete = []; const large = []; entries.forEach((entry) => { const hash = text(entry.sha256)?.toLowerCase(); if (hash) duplicateGroups.set(hash, [...(duplicateGroups.get(hash) || []), text(entry.path)].filter(Boolean)); if (entry.complete === false || /\.(part|crdownload|tmp)$/i.test(text(entry.path) || '')) incomplete.push(text(entry.path)); if ((nonNegative(entry.sizeBytes) || 0) >= 2 * 1024 ** 3) large.push(text(entry.path)); }); const safe = storageRows.filter((row) => row.mount && row.writable && !row.system && row.freeBytes !== null && row.storageSuitability?.admission === 'ALLOW'); const targetRow = safe.sort((a, b) => b.freeBytes - a.freeBytes)[0] || null; return Object.freeze({ duplicateGroups: Object.freeze([...duplicateGroups.entries()].filter(([, paths]) => paths.length > 1).map(([sha256, paths]) => Object.freeze({ sha256, paths: Object.freeze(paths) }))), incomplete: Object.freeze(incomplete.filter(Boolean)), large: Object.freeze(large.filter(Boolean)), suggestedTarget: targetRow?.mount || null, suggestedTargetSuitability: targetRow?.storageSuitability || null, storageSafetyState: storageRows.length && !safe.length ? 'storage-safety-review' : null, moveRequiresPreview: Boolean(targetRow) }); }
function downloadPlan(source, storageRows) { const downloads = rows(source.downloads); return Object.freeze(downloads.map((download) => { const sizeBytes = nonNegative(download.sizeBytes); const requested = text(download.destinationMount); const requestedRow = storageRows.find((row) => row.mount?.toLowerCase() === requested?.toLowerCase()); const safeStorageRows = storageRows.filter((row) => row.storageSuitability?.admission === 'ALLOW' && row.writable && row.freeBytes !== null); const safeRows = safeStorageRows.filter((row) => sizeBytes !== null && row.freeBytes >= sizeBytes); const target = requestedRow?.storageSuitability?.admission === 'ALLOW' && sizeBytes !== null && requestedRow.freeBytes >= sizeBytes ? requestedRow : safeRows.sort((a, b) => b.freeBytes - a.freeBytes)[0] || null; const enough = Boolean(target && sizeBytes !== null && target.freeBytes >= sizeBytes); const state = sizeBytes === null ? 'observation-required' : !target && storageRows.length && !safeStorageRows.length ? 'storage-safety-review' : enough ? target.mount?.toLowerCase() === requested?.toLowerCase() ? 'allow' : 'redirect' : 'insufficient-space'; return Object.freeze({ name: text(download.name) || 'unnamed-download', sizeBytes, requestedMount: requested, targetMount: target?.mount || null, targetSuitability: target?.storageSuitability || null, state, bandwidthBytesPerSecond: nonNegative(download.bandwidthBytesPerSecond), hashStatus: /^[a-f0-9]{64}$/i.test(text(download.sha256) || '') ? 'available' : 'missing' }); })); }
function mediaPlan(source) { const media = rows(source.media); const counts = media.reduce((result, item) => { const kind = text(item.type)?.toLowerCase() || 'unknown'; result[kind] = (result[kind] || 0) + 1; return result; }, {}); return Object.freeze({ itemCount: media.length, counts: Object.freeze(counts), totalBytes: media.reduce((sum, item) => sum + (nonNegative(item.sizeBytes) || 0), 0), localOnly: true, panel: 'url-review-only' }); }

export function runWorkstationStewardEngine(facts, { trigger, now = Date.now } = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireTimestamp(now());
  const platform = platformOf(source.platform || source.os?.platform);
  const storageRows = storage(source);
  const processList = processes(source);
  const activeGame = game(processList, source);
  const hasEvidence = storageRows.length > 0 || processList.length > 0 || record(source.memory) || record(source.cpu);
  return Object.freeze({ protocolVersion: 1, engine: WORKSTATION_STEWARD_ENGINE_ID, engineVersion: WORKSTATION_STEWARD_ENGINE_VERSION, trigger, generatedAt: new Date(timestamp).toISOString(), platform, capabilities: capabilities(platform), state: hasEvidence ? 'plan-ready' : 'observation-required', protectedPaths: protectedPaths(source), game: activeGame, resources: resourcePlan(processList, activeGame, source, platform), storage: storageRows, files: filePlan(source, storageRows), downloads: downloadPlan(source, storageRows), media: mediaPlan(source), history: Object.freeze({ suppliedSamples: rows(source.history).length, persistence: 'append-only-caller-owned' }), assistant: Object.freeze({ mode: 'facts-to-plan', actions: EMPTY }), actions: EMPTY });
}
