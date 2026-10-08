/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Resource-pressure turbo. It identifies bounded CPU, memory, GPU, and
 * thermal pressure in reports without applying workload controls.
 */

export const WORKSTATION_RESOURCE_PRESSURE_TURBO_ID = 'workstation-health.resource-pressure';
export const WORKSTATION_RESOURCE_PRESSURE_TURBO_VERSION = 1;
export const WORKSTATION_RESOURCE_PRESSURE_TRIGGERS = Object.freeze(['system.facts.request', 'workload.changed', 'health.interval']);
const EMPTY_ARRAY = Object.freeze([]);
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) { if (!isRecord(report)) throw new TypeError('Workstation resource-pressure report must be an object'); if (report.engine !== 'workstation-health') throw new Error('Workstation resource-pressure requires workstation-health reports'); return report; }
function requireTrigger(trigger) { if (!WORKSTATION_RESOURCE_PRESSURE_TRIGGERS.includes(trigger)) throw new Error(`Unsupported workstation-health resource-pressure trigger: ${trigger || 'unknown'}`); return trigger; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Workstation resource-pressure clock must return a number'); return timestamp; }
function rank(value) { return value === 'critical' || value === 'emergency' ? 2 : value === 'warning' ? 1 : 0; }
function pressure(report) { const resources = report.resources || {}; const levels = [resources.memoryPressure, resources.thermalState]; const numeric = [resources.cpuLoadPercent, resources.gpuLoadPercent].filter((value) => Number.isFinite(value)).map((value) => value >= 95 ? 2 : value >= 80 ? 1 : 0); return Math.max(...levels.map(rank), ...numeric, 0); }
function label(value) { return value === 2 ? 'critical' : value === 1 ? 'warning' : 'normal'; }
function recommendations(state) { if (state === 'critical-pressure') return Object.freeze(['review-thermal-and-resource-pressure']); if (state === 'pressure-observed') return Object.freeze(['observe-next-resource-sample']); if (state === 'observation-required') return Object.freeze(['request-resource-observation']); if (state === 'insufficient-data') return Object.freeze(['collect-more-resource-samples']); return Object.freeze(['no-change']); }
export function runWorkstationResourcePressureTurbo(samples = [], { trigger, windowSize = 16, minimumSamples = 2, now = Date.now } = {}) { requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Workstation resource-pressure samples must be an array'); if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) throw new RangeError('Workstation resource-pressure windowSize must be from 1 to 64'); if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) throw new RangeError('Workstation resource-pressure minimumSamples must fit inside the window'); const selected = samples.slice(-windowSize).map(requireReport); const values = selected.map(pressure); const maximum = values.length ? Math.max(...values) : 0; const state = selected.length < minimumSamples ? 'insufficient-data' : selected.some((report) => !isRecord(report.resources)) ? 'observation-required' : maximum === 2 ? 'critical-pressure' : maximum === 1 ? 'pressure-observed' : 'stable-resources'; const confidence = selected.length ? Math.round((selected.filter((report) => isRecord(report.resources)).length / selected.length) * Math.min(1, selected.length / minimumSamples) * 10000) / 10000 : 0; return Object.freeze({ protocolVersion: 1, turbo: WORKSTATION_RESOURCE_PRESSURE_TURBO_ID, turboVersion: WORKSTATION_RESOURCE_PRESSURE_TURBO_VERSION, trigger, generatedAt: new Date(requireClock(now)).toISOString(), sampleCount: selected.length, minimumSamples, maximumPressure: label(maximum), criticalCount: values.filter((value) => value === 2).length, warningCount: values.filter((value) => value === 1).length, state, confidence, recommendations: recommendations(state), actions: EMPTY_ARRAY }); }
