import {
  GPU_CAPACITY_SKEW_TRIGGERS,
  GPU_CAPACITY_SKEW_TURBO_ID,
  runGpuCapacitySkewTurbo
} from '../pc/engines/gpu-memory/turbos/capacity-skew/turbo.js';

const trigger = 'health.interval';
const stamp = 1760000000000;
const snapshot = (gpus, capabilities) => ({ engine: 'system-facts', gpus, capabilities });
const gpu = (capacity) => ({ vramBytes: capacity, vramUsedBytes: 0 });

describe('gpu-memory capacity-skew turbo', () => {
  test('exposes immutable identity and reports an empty bounded window', () => {
    const report = runGpuCapacitySkewTurbo([], { trigger, now: () => stamp });

    expect(GPU_CAPACITY_SKEW_TURBO_ID).toBe('gpu-memory.capacity-skew');
    expect(Object.isFrozen(GPU_CAPACITY_SKEW_TRIGGERS)).toBe(true);
    expect(report).toMatchObject({
      turbo: GPU_CAPACITY_SKEW_TURBO_ID,
      trigger,
      sampleCount: 0,
      state: 'insufficient-data',
      confidence: 0,
      maximumSkew: null
    });
    expect(Object.isFrozen(report)).toBe(true);
    expect(report.actions).toEqual([]);
  });

  test('classifies balanced, observed skew, and sustained capacity skew', () => {
    const balanced = runGpuCapacitySkewTurbo([
      snapshot([gpu(100), gpu(100)]), snapshot([gpu(100), gpu(100)])
    ], { trigger, now: () => stamp });
    const observed = runGpuCapacitySkewTurbo([
      snapshot([gpu(100), gpu(200)])
    ], { trigger, minimumSamples: 1, persistenceThreshold: 2, now: () => stamp });
    const sustained = runGpuCapacitySkewTurbo([
      snapshot([gpu(100), gpu(200)]), snapshot([gpu(100), gpu(200)])
    ], { trigger, now: () => stamp });

    expect(balanced).toMatchObject({
      state: 'balanced-capacity',
      balancedCount: 2,
      skewCount: 0,
      maximumSkew: 0,
      recommendations: ['no-change']
    });
    expect(observed).toMatchObject({
      state: 'capacity-skew-observed',
      skewCount: 1,
      maximumSkew: 50,
      recommendations: ['observe-next-vram-capacity-sample']
    });
    expect(sustained).toMatchObject({
      state: 'sustained-capacity-skew',
      skewCount: 2,
      recommendations: ['review-multi-gpu-capacity-layout', 'hold-unapproved-memory-policy']
    });
  });

  test('handles invalid, incomplete, no-GPU, and disabled-observation evidence', () => {
    const invalid = runGpuCapacitySkewTurbo([
      snapshot([gpu(0)]), snapshot([gpu(0)])
    ], { trigger, now: () => stamp });
    const incomplete = runGpuCapacitySkewTurbo([
      snapshot([{ vramUsedBytes: 1 }]), snapshot([{ vramBytes: -1 }])
    ], { trigger, now: () => stamp });
    const noGpu = runGpuCapacitySkewTurbo([
      snapshot([]), snapshot([null])
    ], { trigger, now: () => stamp });
    const disabled = runGpuCapacitySkewTurbo([
      snapshot([gpu(100)], { gpuMemoryObservation: false }),
      snapshot([gpu(200)], { gpuMemoryObservation: false })
    ], { trigger, now: () => stamp });

    expect(invalid).toMatchObject({ state: 'invalid-vram-evidence', invalidCount: 2 });
    expect(incomplete).toMatchObject({
      state: 'incomplete-vram-evidence', incompleteCount: 2
    });
    expect(noGpu).toMatchObject({
      state: 'no-gpu', noGpuCount: 2,
      recommendations: ['no-change', 'keep-gpu-memory-controls-disabled']
    });
    expect(disabled).toMatchObject({
      state: 'no-observation', observedCount: 0,
      recommendations: ['request-vram-capacity-observation']
    });
  });

  test('supports a custom skew band and saturates confidence', () => {
    const report = runGpuCapacitySkewTurbo([
      snapshot([gpu(100), gpu(120)]), snapshot([gpu(100), gpu(120)]),
      snapshot([gpu(100), gpu(120)])
    ], { trigger, skewThreshold: 10, minimumSamples: 2, now: () => stamp });

    expect(report).toMatchObject({
      state: 'sustained-capacity-skew',
      skewThreshold: 10,
      confidence: 1
    });
  });

  test('rejects malformed snapshots, triggers, bounds, thresholds, and clocks', () => {
    expect(() => runGpuCapacitySkewTurbo('bad', { trigger })).toThrow(TypeError);
    expect(() => runGpuCapacitySkewTurbo([null], { trigger })).toThrow(TypeError);
    expect(() => runGpuCapacitySkewTurbo()).toThrow('Unsupported');
    expect(() => runGpuCapacitySkewTurbo([{}], { trigger })).toThrow('system-facts');
    expect(() => runGpuCapacitySkewTurbo([
      { engine: 'system-facts', gpus: null }
    ], { trigger })).toThrow('GPU list');
    expect(() => runGpuCapacitySkewTurbo([], { trigger: 'unsupported' })).toThrow('Unsupported');
    expect(() => runGpuCapacitySkewTurbo([], { trigger, windowSize: 0 })).toThrow(RangeError);
    expect(() => runGpuCapacitySkewTurbo([], { trigger, windowSize: 65 })).toThrow(RangeError);
    expect(() => runGpuCapacitySkewTurbo([], { trigger, minimumSamples: 0 })).toThrow(RangeError);
    expect(() => runGpuCapacitySkewTurbo([], { trigger, minimumSamples: 3, windowSize: 2 }))
      .toThrow(RangeError);
    expect(() => runGpuCapacitySkewTurbo([], { trigger, skewThreshold: -1 })).toThrow(RangeError);
    expect(() => runGpuCapacitySkewTurbo([], { trigger, skewThreshold: 101 })).toThrow(RangeError);
    expect(() => runGpuCapacitySkewTurbo([], { trigger, persistenceThreshold: 0 }))
      .toThrow(RangeError);
    expect(() => runGpuCapacitySkewTurbo([], { trigger, persistenceThreshold: 65 }))
      .toThrow(RangeError);
    expect(() => runGpuCapacitySkewTurbo([], { trigger, now: () => Number.NaN }))
      .toThrow('clock');
  });
});
