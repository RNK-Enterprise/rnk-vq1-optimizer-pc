/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Mode-selection turbo. It detects stable or changing workload modes from a
 * bounded observation window and does not select an OS action.
 */

export const WORKLOAD_POLICY_MODE_SELECTION_TURBO_ID = 'workload-policy.mode-selection';
export const WORKLOAD_POLICY_MODE_SELECTION_TURBO_VERSION = 1;
const TRIGGERS = Object.freeze(['system.facts.request', 'workload.changed', 'health.interval']);
const MODES = Object.freeze(['developer', 'gaming', 'gaming-build', 'idle', 'unknown']);

function modeOf(value) {
  if (typeof value === 'string') return MODES.includes(value) ? value : 'unknown';
  if (!value || typeof value !== 'object') return 'unknown';
  if (MODES.includes(value.mode)) return value.mode;
  return MODES.includes(value.workload?.mode) ? value.workload.mode : 'unknown';
}
function requireTrigger(trigger) { if (!TRIGGERS.includes(trigger)) throw new Error(`Unsupported workload-policy mode-selection trigger: ${trigger || 'unknown'}`); return trigger; }
function requireWindow(value) { if (!Number.isInteger(value) || value < 1 || value > 64) throw new RangeError('Workload-policy mode-selection windowSize must be from 1 to 64'); return value; }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Workload-policy mode-selection clock must return a number'); return timestamp; }
function confidence(count, known) { return count ? Math.round((known / count) * 10000) / 10000 : 0; }

export function runWorkloadPolicyModeSelectionTurbo(samples = [], { trigger, windowSize = 16, now = Date.now } = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('Workload-policy mode-selection samples must be an array');
  const selected = samples.slice(-requireWindow(windowSize));
  const timestamp = requireClock(now);
  const modes = selected.map(modeOf);
  const changes = modes.slice(1).filter((mode, index) => mode !== modes[index]).length;
  const known = modes.filter((mode) => mode !== 'unknown').length;
  const finalMode = modes.at(-1) || 'unknown';
  const state = !modes.length ? 'insufficient-data' : known !== modes.length ? 'observation-required' : changes ? 'mode-changed' : 'stable-mode';
  const recommendations = state === 'mode-changed' ? ['review-mode-transition'] : state === 'observation-required' ? ['collect-workload-mode'] : state === 'insufficient-data' ? ['collect-workload-mode'] : ['no-change'];
  return Object.freeze({ protocolVersion: 1, turbo: WORKLOAD_POLICY_MODE_SELECTION_TURBO_ID, turboVersion: WORKLOAD_POLICY_MODE_SELECTION_TURBO_VERSION, trigger, generatedAt: new Date(timestamp).toISOString(), sampleCount: modes.length, knownCount: known, changeCount: changes, finalMode, state, confidence: confidence(modes.length, known), recommendations: Object.freeze(recommendations), actions: Object.freeze([]) });
}
