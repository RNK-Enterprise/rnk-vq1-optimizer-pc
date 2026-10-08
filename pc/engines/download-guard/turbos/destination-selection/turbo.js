/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Destination-selection turbo. It verifies that a target was observed and
 * makes redirection visible without moving or opening a download.
 */

export const DOWNLOAD_GUARD_DESTINATION_SELECTION_TURBO_ID = 'download-guard.destination-selection';
export const DOWNLOAD_GUARD_DESTINATION_SELECTION_TURBO_VERSION = 1;
const TRIGGERS = Object.freeze(['install.preflight', 'system.facts.request', 'workload.changed', 'health.interval']);
function requireTrigger(trigger) { if (!TRIGGERS.includes(trigger)) throw new Error(`Unsupported download-guard destination-selection trigger: ${trigger || 'unknown'}`); return trigger; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Download-guard destination-selection clock must return a number'); return timestamp; }
export function runDownloadGuardDestinationSelectionTurbo(samples = [], { trigger, now = Date.now } = {}) { requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Download-guard destination-selection samples must be an array'); const timestamp = requireClock(now); const selected = samples.slice(-64); const observed = selected.filter((sample) => typeof sample?.targetMount === 'string' && sample.targetMount.trim()); const redirected = observed.filter((sample) => sample.redirected === true).length; const finalTarget = observed.at(-1)?.targetMount || null; const state = !selected.length || !observed.length ? 'observation-required' : redirected ? 'redirect-required' : 'destination-selected'; const recommendations = state === 'redirect-required' ? ['review-suggested-destination'] : state === 'observation-required' ? ['collect-destination-evidence'] : ['review-selected-destination']; return Object.freeze({ protocolVersion: 1, turbo: DOWNLOAD_GUARD_DESTINATION_SELECTION_TURBO_ID, turboVersion: DOWNLOAD_GUARD_DESTINATION_SELECTION_TURBO_VERSION, trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, observedCount: observed.length, redirectedCount: redirected, finalTarget, state, recommendations: Object.freeze(recommendations), actions: Object.freeze([]) }); }
