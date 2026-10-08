/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Hash-verification turbo. It compares supplied SHA-256 evidence and never
 * marks an unavailable hash as verified.
 */

export const DOWNLOAD_GUARD_HASH_VERIFICATION_TURBO_ID = 'download-guard.hash-verification';
export const DOWNLOAD_GUARD_HASH_VERIFICATION_TURBO_VERSION = 1;
const TRIGGERS = Object.freeze(['install.preflight', 'system.facts.request', 'workload.changed', 'health.interval']);
function validHash(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value); }
function requireTrigger(trigger) { if (!TRIGGERS.includes(trigger)) throw new Error(`Unsupported download-guard hash-verification trigger: ${trigger || 'unknown'}`); return trigger; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Download-guard hash-verification clock must return a number'); return timestamp; }
export function runDownloadGuardHashVerificationTurbo(samples = [], { trigger, now = Date.now } = {}) { requireTrigger(trigger); if (!Array.isArray(samples)) throw new TypeError('Download-guard hash-verification samples must be an array'); const timestamp = requireClock(now); const selected = samples.slice(-64); const usable = selected.filter((sample) => validHash(sample?.expectedSha256) && validHash(sample?.observedSha256)); const mismatch = usable.filter((sample) => sample.expectedSha256.toLowerCase() !== sample.observedSha256.toLowerCase()).length; const state = !selected.length ? 'insufficient-data' : !usable.length ? 'unavailable' : mismatch ? 'mismatch' : 'verified'; const recommendations = state === 'mismatch' ? ['refuse-hash-mismatch'] : state === 'unavailable' ? ['hash-unavailable'] : state === 'insufficient-data' ? ['collect-hash-evidence'] : ['hash-verified']; return Object.freeze({ protocolVersion: 1, turbo: DOWNLOAD_GUARD_HASH_VERIFICATION_TURBO_ID, turboVersion: DOWNLOAD_GUARD_HASH_VERIFICATION_TURBO_VERSION, trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: selected.length, usableCount: usable.length, mismatchCount: mismatch, state, recommendations: Object.freeze(recommendations), actions: Object.freeze([]) }); }
