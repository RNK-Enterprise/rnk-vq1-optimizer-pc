/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Duplicate-review turbo. It refuses to turn duplicate evidence into a delete
 * decision and keeps hash absence visible for user review.
 */

export const DOWNLOAD_GUARD_DUPLICATE_REVIEW_TURBO_ID = 'download-guard.duplicate-review';
export const DOWNLOAD_GUARD_DUPLICATE_REVIEW_TURBO_VERSION = 1;
const TRIGGERS = Object.freeze(['install.preflight', 'system.facts.request', 'workload.changed', 'health.interval']);
function requireTrigger(trigger) { if (!TRIGGERS.includes(trigger)) throw new Error(`Unsupported download-guard duplicate-review trigger: ${trigger || 'unknown'}`); return trigger; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Download-guard duplicate-review clock must return a number'); return timestamp; }
export function runDownloadGuardDuplicateReviewTurbo(samples = [], { trigger, now = Date.now } = {}) { requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Download-guard duplicate-review samples must be an array'); const timestamp = requireClock(now); const selected = samples.slice(-64); const duplicateCount = selected.reduce((sum, sample) => sum + (Number.isInteger(sample?.duplicateCandidates) && sample.duplicateCandidates >= 0 ? sample.duplicateCandidates : 0), 0); const hashMissing = selected.some((sample) => sample?.hashStatus === 'missing'); const state = !selected.length ? 'insufficient-data' : duplicateCount ? 'duplicates-found' : hashMissing ? 'hash-review' : 'no-duplicates'; const recommendations = state === 'duplicates-found' ? ['review-duplicates-before-action'] : state === 'hash-review' ? ['verify-hash-when-available'] : state === 'insufficient-data' ? ['collect-duplicate-evidence'] : ['no-change']; return Object.freeze({ protocolVersion: 1, turbo: DOWNLOAD_GUARD_DUPLICATE_REVIEW_TURBO_ID, turboVersion: DOWNLOAD_GUARD_DUPLICATE_REVIEW_TURBO_VERSION, trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, duplicateCount, state, recommendations: Object.freeze(recommendations), actions: Object.freeze([]) }); }
