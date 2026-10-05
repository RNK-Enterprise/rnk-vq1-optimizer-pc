import {
  GPU_EVIDENCE_COMPLETENESS_TRIGGERS,
  GPU_EVIDENCE_COMPLETENESS_TURBO_ID,
  runGpuEvidenceCompletenessTurbo
} from '../pc/engines/gpu-policy/turbos/evidence-completeness/turbo.js';

const trigger = 'health.interval';
const stamp = 1760000000000;
const snapshot = (gpus) => ({ engine: 'system-facts', gpus });
const complete = { vendor: 'nvidia', model: 'adapter', driver: 'nvidia' };
const missingVendor = { vendor: '', model: 'adapter', driver: 'nvidia' };
const missingModel = { vendor: 'nvidia', model: null, driver: 'nvidia' };
const missingDriver = { vendor: 'nvidia', model: 'adapter', driver: 610 };

describe('gpu-policy evidence-completeness turbo', () => {
  test('exposes immutable identity and reports an empty window conservatively', () => {
    const report = runGpuEvidenceCompletenessTurbo([], { trigger, now: () => stamp });

    expect(GPU_EVIDENCE_COMPLETENESS_TURBO_ID).toBe('gpu-policy.evidence-completeness');
    expect(Object.isFrozen(GPU_EVIDENCE_COMPLETENESS_TRIGGERS)).toBe(true);
    expect(report).toMatchObject({
      turbo: GPU_EVIDENCE_COMPLETENESS_TURBO_ID,
      trigger,
      sampleCount: 0,
      state: 'insufficient-data',
      confidence: 0,
      missingFields: []
    });
    expect(Object.isFrozen(report)).toBe(true);
    expect(report.actions).toEqual([]);
  });

  test('classifies complete, persistent incomplete, and observed evidence', () => {
    const stable = runGpuEvidenceCompletenessTurbo([
      snapshot([complete]), snapshot([complete])
    ], { trigger, now: () => stamp });
    const persistent = runGpuEvidenceCompletenessTurbo([
      snapshot([missingVendor]), snapshot([missingVendor])
    ], { trigger, now: () => stamp });
    const observed = runGpuEvidenceCompletenessTurbo([
      snapshot([missingModel]), snapshot([missingModel])
    ], { trigger, persistenceThreshold: 3, now: () => stamp });

    expect(stable).toMatchObject({
      state: 'complete-evidence-stable',
      completeCount: 2,
      incompleteCount: 0,
      usableCount: 2,
      missingFields: []
    });
    expect(persistent).toMatchObject({
      state: 'incomplete-evidence-persistent',
      incompleteCount: 2,
      missingFields: ['vendor'],
      recommendations: ['request-complete-gpu-evidence', 'hold-unapproved-gpu-policy']
    });
    expect(observed).toMatchObject({
      state: 'incomplete-evidence-observed',
      incompleteCount: 2,
      recommendations: ['observe-next-gpu-evidence-sample']
    });
  });

  test('detects missing-field drift and mixed complete records', () => {
    const drift = runGpuEvidenceCompletenessTurbo([
      snapshot([missingVendor]),
      snapshot([missingModel]),
      snapshot([missingVendor])
    ], { trigger, now: () => stamp });
    const mixed = runGpuEvidenceCompletenessTurbo([
      snapshot([complete, missingModel]),
      snapshot([complete, missingDriver]),
      snapshot([complete, missingModel])
    ], { trigger, persistenceThreshold: 2, now: () => stamp });

    expect(drift).toMatchObject({
      state: 'completeness-drift',
      transitionCount: 2,
      missingFields: ['model', 'vendor'],
      recommendations: ['review-gpu-evidence-source-stability', 'hold-unapproved-gpu-policy']
    });
    expect(mixed).toMatchObject({
      state: 'completeness-drift',
      completeCount: 0,
      incompleteCount: 3,
      usableCount: 3,
      missingFields: ['driver', 'model']
    });
  });

  test('handles no-GPU posture, inventory boundaries, and bounded confidence', () => {
    const noGpu = runGpuEvidenceCompletenessTurbo([
      snapshot([]), snapshot([null])
    ], { trigger, now: () => stamp });
    const boundary = runGpuEvidenceCompletenessTurbo([
      snapshot([]), snapshot([complete])
    ], { trigger, now: () => stamp });
    const bounded = runGpuEvidenceCompletenessTurbo([
      snapshot([complete]), snapshot([complete]), snapshot([complete])
    ], { trigger, minimumSamples: 2, now: () => stamp });

    expect(noGpu).toMatchObject({
      state: 'no-gpu',
      noGpuCount: 2,
      usableCount: 0,
      recommendations: ['no-change', 'keep-gpu-controls-disabled']
    });
    expect(boundary).toMatchObject({
      state: 'inventory-boundary-drift',
      noGpuCount: 1,
      recommendations: ['review-gpu-inventory-boundary', 'hold-unapproved-gpu-policy']
    });
    expect(bounded.confidence).toBe(1);
  });

  test('rejects malformed snapshots, triggers, bounds, and clocks', () => {
    expect(() => runGpuEvidenceCompletenessTurbo('bad', { trigger })).toThrow(TypeError);
    expect(() => runGpuEvidenceCompletenessTurbo([null], { trigger })).toThrow(TypeError);
    expect(() => runGpuEvidenceCompletenessTurbo()).toThrow('Unsupported');
    expect(() => runGpuEvidenceCompletenessTurbo([{}], { trigger })).toThrow('system-facts');
    expect(() => runGpuEvidenceCompletenessTurbo([
      { engine: 'system-facts', gpus: null }
    ], { trigger })).toThrow('GPU list');
    expect(() => runGpuEvidenceCompletenessTurbo([], { trigger: 'unsupported' })).toThrow('Unsupported');
    expect(() => runGpuEvidenceCompletenessTurbo([], { trigger, windowSize: 0 })).toThrow(RangeError);
    expect(() => runGpuEvidenceCompletenessTurbo([], { trigger, windowSize: 65 })).toThrow(RangeError);
    expect(() => runGpuEvidenceCompletenessTurbo([], { trigger, minimumSamples: 0 })).toThrow(RangeError);
    expect(() => runGpuEvidenceCompletenessTurbo([], { trigger, minimumSamples: 3, windowSize: 2 }))
      .toThrow(RangeError);
    expect(() => runGpuEvidenceCompletenessTurbo([], { trigger, persistenceThreshold: 0 }))
      .toThrow(RangeError);
    expect(() => runGpuEvidenceCompletenessTurbo([], { trigger, persistenceThreshold: 65 }))
      .toThrow(RangeError);
    expect(() => runGpuEvidenceCompletenessTurbo([], { trigger, now: () => Number.NaN }))
      .toThrow('clock');
  });
});
