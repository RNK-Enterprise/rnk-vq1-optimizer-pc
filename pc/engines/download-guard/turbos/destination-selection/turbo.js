/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Destination-selection turbo. It verifies that a target was observed and
 * makes redirection visible without moving or opening a download.
 */

import { assessStorageTarget } from '../../../../../native/storage-suitability.js';

export const DOWNLOAD_GUARD_DESTINATION_SELECTION_TURBO_ID = 'download-guard.destination-selection';
export const DOWNLOAD_GUARD_DESTINATION_SELECTION_TURBO_VERSION = 1;
const TRIGGERS = Object.freeze(['install.preflight', 'system.facts.request', 'workload.changed', 'health.interval']);
function requireTrigger(trigger) { if (!TRIGGERS.includes(trigger)) throw new Error(`Unsupported download-guard destination-selection trigger: ${trigger || 'unknown'}`); return trigger; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Download-guard destination-selection clock must return a number'); return timestamp; }
export function runDownloadGuardDestinationSelectionTurbo(samples = [], { trigger, now = Date.now } = {}) { requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Download-guard destination-selection samples must be an array'); const timestamp = requireClock(now); const selected = samples.slice(-64); const observed = selected.filter((sample) => typeof sample?.targetMount === 'string' && sample.targetMount.trim()); const safeObserved = observed.filter((sample) => (sample.targetSuitability || assessStorageTarget({ targetMount: sample.targetMount, volumes: sample.storage || [], drives: sample.drives || [], hardFailureEvidence: sample.hardFailureEvidence || [] }))?.admission === 'ALLOW'); const redirected = safeObserved.filter((sample) => sample.redirected === true).length; const finalTarget = safeObserved.at(-1)?.targetMount || null; const state = !selected.length || !observed.length ? 'observation-required' : !safeObserved.length ? 'storage-safety-review' : redirected ? 'redirect-required' : 'destination-selected'; const recommendations = state === 'redirect-required' ? ['review-suggested-destination'] : state === 'storage-safety-review' ? ['resolve-physical-storage-health-before-placement'] : state === 'observation-required' ? ['collect-destination-evidence'] : ['review-selected-destination']; return Object.freeze({ protocolVersion: 1, turbo: DOWNLOAD_GUARD_DESTINATION_SELECTION_TURBO_ID, turboVersion: DOWNLOAD_GUARD_DESTINATION_SELECTION_TURBO_VERSION, trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, observedCount: observed.length, safeObservedCount: safeObserved.length, redirectedCount: redirected, finalTarget, state, recommendations: Object.freeze(recommendations), actions: Object.freeze([]) }); }
