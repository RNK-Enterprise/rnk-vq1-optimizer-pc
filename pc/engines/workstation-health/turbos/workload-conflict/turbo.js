/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Workload-conflict turbo. It identifies gaming/build or gaming/AI overlap
 * from declared workload evidence without changing priorities or affinity.
 */

export const WORKSTATION_WORKLOAD_CONFLICT_TURBO_ID = 'workstation-health.workload-conflict';
export const WORKSTATION_WORKLOAD_CONFLICT_TURBO_VERSION = 1;
export const WORKSTATION_WORKLOAD_CONFLICT_TRIGGERS = Object.freeze(['system.facts.request', 'workload.changed', 'health.interval']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) { if (!isRecord(report)) throw new TypeError('Workstation workload-conflict report must be an object'); if (report.engine !== 'workstation-health') throw new Error('Workstation workload-conflict requires workstation-health reports'); return report; }
function requireTrigger(trigger) { if (!WORKSTATION_WORKLOAD_CONFLICT_TRIGGERS.includes(trigger)) throw new Error(`Unsupported workstation-health workload-conflict trigger: ${trigger || 'unknown'}`); return trigger; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Workstation workload-conflict clock must return a number'); return timestamp; }
function evidence(report) { const workload = report.workload; return Object.freeze({ observed: isRecord(workload) && Array.isArray(workload.activeClasses), conflict: workload?.contentionRisk === true, foregroundClass: typeof workload?.foregroundClass === 'string' ? workload.foregroundClass : null }); }
function recommendations(state) { if (state === 'conflict-observed') return Object.freeze(['review-gaming-build-workload-policy']); if (state === 'observation-required') return Object.freeze(['request-workload-declaration']); if (state === 'insufficient-data') return Object.freeze(['collect-more-workload-samples']); return Object.freeze(['no-change']); }
export function runWorkstationWorkloadConflictTurbo(samples = [], { trigger, windowSize = 16, minimumSamples = 2, now = Date.now } = {}) { requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Workstation workload-conflict samples must be an array'); if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) throw new RangeError('Workstation workload-conflict windowSize must be from 1 to 64'); if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) throw new RangeError('Workstation workload-conflict minimumSamples must fit inside the window'); const selected = samples.slice(-windowSize).map(requireReport); const values = selected.map(evidence); const state = selected.length < minimumSamples ? 'insufficient-data' : values.some((item) => !item.observed) ? 'observation-required' : values.some((item) => item.conflict) ? 'conflict-observed' : 'no-conflict'; const confidence = selected.length ? Math.round((values.filter((item) => item.observed).length / selected.length) * Math.min(1, selected.length / minimumSamples) * 10000) / 10000 : 0; return Object.freeze({ protocolVersion: 1, turbo: WORKSTATION_WORKLOAD_CONFLICT_TURBO_ID, turboVersion: WORKSTATION_WORKLOAD_CONFLICT_TURBO_VERSION, trigger, generatedAt: new Date(requireClock(now)).toISOString(), sampleCount: selected.length, minimumSamples, conflictCount: values.filter((item) => item.conflict).length, observedCount: values.filter((item) => item.observed).length, finalForegroundClass: values.at(-1)?.foregroundClass ?? null, state, confidence, recommendations: recommendations(state), actions: EMPTY_ARRAY }); }
