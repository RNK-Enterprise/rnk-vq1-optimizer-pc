/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Cleanup-audit turbo. It records bounded cleanup evidence and recovered
 * bytes without initiating cleanup.
 */

export const WORKSTATION_CLEANUP_AUDIT_TURBO_ID = 'workstation-health.cleanup-audit';
export const WORKSTATION_CLEANUP_AUDIT_TURBO_VERSION = 1;
export const WORKSTATION_CLEANUP_AUDIT_TRIGGERS = Object.freeze(['system.facts.request', 'workload.changed', 'health.interval']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) { if (!isRecord(report)) throw new TypeError('Workstation cleanup-audit report must be an object'); if (report.engine !== 'workstation-health') throw new Error('Workstation cleanup-audit requires workstation-health reports'); return report; }
function requireTrigger(trigger) { if (!WORKSTATION_CLEANUP_AUDIT_TRIGGERS.includes(trigger)) throw new Error(`Unsupported workstation-health cleanup-audit trigger: ${trigger || 'unknown'}`); return trigger; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Workstation cleanup-audit clock must return a number'); return timestamp; }
function evidence(report) { const cleanup = report.cleanup; return Object.freeze({ observed: isRecord(cleanup), performed: cleanup?.performed === true, recoveredBytes: Number.isFinite(cleanup?.recoveredBytes) && cleanup.recoveredBytes >= 0 ? cleanup.recoveredBytes : 0, actionCount: Number.isInteger(cleanup?.actionCount) && cleanup.actionCount >= 0 ? cleanup.actionCount : 0 }); }
function recommendations(state) { if (state === 'recovery-observed') return Object.freeze(['record-cleanup-recovery']); if (state === 'cleanup-not-observed') return Object.freeze(['request-cleanup-audit-evidence']); if (state === 'insufficient-data') return Object.freeze(['collect-more-cleanup-audit-samples']); return Object.freeze(['no-change']); }
export function runWorkstationCleanupAuditTurbo(samples = [], { trigger, windowSize = 16, minimumSamples = 2, now = Date.now } = {}) { requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Workstation cleanup-audit samples must be an array'); if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) throw new RangeError('Workstation cleanup-audit windowSize must be from 1 to 64'); if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) throw new RangeError('Workstation cleanup-audit minimumSamples must fit inside the window'); const selected = samples.slice(-windowSize).map(requireReport); const values = selected.map(evidence); const state = selected.length < minimumSamples ? 'insufficient-data' : values.some((item) => !item.observed) ? 'cleanup-not-observed' : values.some((item) => item.performed) ? 'recovery-observed' : 'no-cleanup'; const confidence = selected.length ? Math.round((values.filter((item) => item.observed).length / selected.length) * Math.min(1, selected.length / minimumSamples) * 10000) / 10000 : 0; return Object.freeze({ protocolVersion: 1, turbo: WORKSTATION_CLEANUP_AUDIT_TURBO_ID, turboVersion: WORKSTATION_CLEANUP_AUDIT_TURBO_VERSION, trigger, generatedAt: new Date(requireClock(now)).toISOString(), sampleCount: selected.length, minimumSamples, performedCount: values.filter((item) => item.performed).length, recoveredBytes: values.reduce((sum, item) => sum + item.recoveredBytes, 0), actionCount: values.reduce((sum, item) => sum + item.actionCount, 0), state, confidence, recommendations: recommendations(state), actions: EMPTY_ARRAY }); }
