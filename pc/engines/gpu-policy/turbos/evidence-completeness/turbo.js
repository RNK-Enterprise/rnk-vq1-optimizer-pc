/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * GPU evidence-completeness turbo. It measures bounded vendor, model, and
 * driver evidence without changing GPU policy, files, or opening transport.
 */

export const GPU_EVIDENCE_COMPLETENESS_TURBO_ID = 'gpu-policy.evidence-completeness';
export const GPU_EVIDENCE_COMPLETENESS_TURBO_VERSION = 1;
export const GPU_EVIDENCE_COMPLETENESS_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

const EMPTY_ARRAY = Object.freeze([]);
const FIELDS = Object.freeze(['vendor', 'model', 'driver']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function requireSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new TypeError('GPU evidence-completeness snapshot must be an object');
  if (snapshot.engine !== 'system-facts') {
    throw new Error('GPU evidence-completeness requires a system-facts snapshot');
  }
  if (!Array.isArray(snapshot.gpus)) {
    throw new TypeError('GPU evidence-completeness snapshot requires a GPU list');
  }
  return snapshot;
}

function requireTrigger(trigger) {
  if (!GPU_EVIDENCE_COMPLETENESS_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported GPU evidence-completeness trigger: ${trigger || 'unknown'}`);
  }
  return trigger;
}

function requireWindowSize(windowSize) {
  if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 64) {
    throw new RangeError('GPU evidence-completeness windowSize must be an integer from 1 to 64');
  }
  return windowSize;
}

function requireMinimumSamples(minimumSamples, windowSize) {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1 || minimumSamples > windowSize) {
    throw new RangeError('GPU evidence-completeness minimumSamples must fit inside the window');
  }
  return minimumSamples;
}

function requireCount(name, value) {
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new RangeError(`GPU evidence-completeness ${name} must be an integer from 1 to 64`);
  }
  return value;
}

function evidenceOf(snapshot) {
  const source = requireSnapshot(snapshot);
  const records = source.gpus.filter(isRecord);
  if (records.length === 0) {
    return Object.freeze({
      state: 'no-gpu',
      gpuCount: 0,
      completeCount: 0,
      missingFields: Object.freeze([]),
      signature: 'no-gpu'
    });
  }
  const missingFields = FIELDS.filter((field) => records.some((gpu) => text(gpu[field]) === null));
  const completeCount = records.filter((gpu) => FIELDS.every((field) => text(gpu[field]) !== null)).length;
  const state = missingFields.length === 0 ? 'complete' : 'incomplete';
  return Object.freeze({
    state,
    gpuCount: records.length,
    completeCount,
    missingFields: Object.freeze(missingFields),
    signature: missingFields.length === 0 ? 'complete' : missingFields.join('|')
  });
}

function transitionCount(evidence) {
  let transitions = 0;
  for (let index = 1; index < evidence.length; index += 1) {
    const previous = evidence[index - 1].signature;
    const current = evidence[index].signature;
    if (previous !== 'no-gpu' && current !== 'no-gpu' && previous !== current) transitions += 1;
  }
  return transitions;
}

function usable(evidence) {
  return evidence.filter((item) => item.state === 'complete' || item.state === 'incomplete');
}

function stateFor(sampleCount, minimumSamples, evidence, incompleteCount, transitions,
  persistenceThreshold) {
  if (sampleCount < minimumSamples) return 'insufficient-data';
  if (evidence.every((item) => item.state === 'no-gpu')) return 'no-gpu';
  if (evidence.some((item) => item.state === 'no-gpu')) return 'inventory-boundary-drift';
  if (transitions >= persistenceThreshold) return 'completeness-drift';
  if (incompleteCount >= persistenceThreshold) return 'incomplete-evidence-persistent';
  if (incompleteCount > 0) return 'incomplete-evidence-observed';
  return 'complete-evidence-stable';
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-gpu-evidence-samples']);
  if (state === 'no-gpu') return Object.freeze(['no-change', 'keep-gpu-controls-disabled']);
  if (state === 'inventory-boundary-drift') {
    return Object.freeze(['review-gpu-inventory-boundary', 'hold-unapproved-gpu-policy']);
  }
  if (state === 'completeness-drift') {
    return Object.freeze(['review-gpu-evidence-source-stability', 'hold-unapproved-gpu-policy']);
  }
  if (state === 'incomplete-evidence-persistent') {
    return Object.freeze(['request-complete-gpu-evidence', 'hold-unapproved-gpu-policy']);
  }
  if (state === 'incomplete-evidence-observed') {
    return Object.freeze(['observe-next-gpu-evidence-sample']);
  }
  return Object.freeze(['no-change']);
}

function confidence(sampleCount, usableCount, minimumSamples) {
  if (sampleCount === 0) return 0;
  const sampleConfidence = Math.min(1, sampleCount / minimumSamples);
  return Math.round((usableCount / sampleCount) * sampleConfidence * 10000) / 10000;
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('GPU evidence-completeness clock must return a number');
  }
  return timestamp;
}

export function runGpuEvidenceCompletenessTurbo(samples = [], {
  trigger,
  windowSize = 16,
  minimumSamples = 2,
  persistenceThreshold = 2,
  now = Date.now
} = {}) {
  requireTrigger(trigger);
  if (!Array.isArray(samples)) throw new TypeError('GPU evidence-completeness samples must be an array');
  const boundedWindow = requireWindowSize(windowSize);
  const requiredSamples = requireMinimumSamples(minimumSamples, boundedWindow);
  const requiredPersistence = requireCount('persistenceThreshold', persistenceThreshold);
  const selected = samples.slice(-boundedWindow);
  const timestamp = requireClock(now);
  const evidence = selected.map(evidenceOf);
  const usableEvidence = usable(evidence);
  const incompleteCount = evidence.filter((item) => item.state === 'incomplete').length;
  const noGpuCount = evidence.filter((item) => item.state === 'no-gpu').length;
  const completeCount = evidence.filter((item) => item.state === 'complete').length;
  const transitions = transitionCount(evidence);
  const missingFields = [...new Set(evidence.flatMap((item) => item.missingFields))].sort();
  const state = stateFor(selected.length, requiredSamples, evidence, incompleteCount, transitions,
    requiredPersistence);
  return Object.freeze({
    protocolVersion: 1,
    turbo: GPU_EVIDENCE_COMPLETENESS_TURBO_ID,
    turboVersion: GPU_EVIDENCE_COMPLETENESS_TURBO_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    sampleCount: selected.length,
    minimumSamples: requiredSamples,
    persistenceThreshold: requiredPersistence,
    usableCount: usableEvidence.length,
    completeCount,
    incompleteCount,
    noGpuCount,
    transitionCount: transitions,
    missingFields: Object.freeze(missingFields),
    state,
    confidence: confidence(selected.length, usableEvidence.length, requiredSamples),
    recommendations: recommendations(state),
    actions: EMPTY_ARRAY
  });
}
