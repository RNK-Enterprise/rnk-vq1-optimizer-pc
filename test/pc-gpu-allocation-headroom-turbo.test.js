import {
  GPU_ALLOCATION_HEADROOM_TRIGGERS,
  GPU_ALLOCATION_HEADROOM_TURBO_ID,
  runGpuAllocationHeadroomTurbo
} from '../pc/engines/gpu-memory/turbos/allocation-headroom/turbo.js';

const trigger = 'health.interval';
const stamp = 1760000000000;
const snapshot = (gpus, capabilities) => ({ engine: 'system-facts', gpus, capabilities });
const gpu = (used, capacity = 100) => ({ vramBytes: capacity, vramUsedBytes: used });

describe('gpu-memory allocation-headroom turbo', () => {
  test('exposes immutable identity and reports an empty bounded window', () => {
    const report = runGpuAllocationHeadroomTurbo([], { trigger, now: () => stamp });

    expect(GPU_ALLOCATION_HEADROOM_TURBO_ID).toBe('gpu-memory.allocation-headroom');
    expect(Object.isFrozen(GPU_ALLOCATION_HEADROOM_TRIGGERS)).toBe(true);
    expect(report).toMatchObject({
      turbo: GPU_ALLOCATION_HEADROOM_TURBO_ID,
      trigger,
      sampleCount: 0,
      state: 'insufficient-data',
      confidence: 0,
      minimumHeadroom: null
    });
    expect(Object.isFrozen(report)).toBe(true);
    expect(report.actions).toEqual([]);
  });

  test('classifies healthy, observed, and sustained low or critical headroom', () => {
    const healthy = runGpuAllocationHeadroomTurbo([
      snapshot([gpu(50)]), snapshot([gpu(60)])
    ], { trigger, now: () => stamp });
    const lowObserved = runGpuAllocationHeadroomTurbo([
      snapshot([gpu(85)])
    ], { trigger, minimumSamples: 1, persistenceThreshold: 2, now: () => stamp });
    const lowSustained = runGpuAllocationHeadroomTurbo([
      snapshot([gpu(85)]), snapshot([gpu(90)])
    ], { trigger, now: () => stamp });
    const criticalObserved = runGpuAllocationHeadroomTurbo([
      snapshot([gpu(98)])
    ], { trigger, minimumSamples: 1, persistenceThreshold: 2, now: () => stamp });
    const critical = runGpuAllocationHeadroomTurbo([
      snapshot([gpu(98)]), snapshot([gpu(99)])
    ], { trigger, now: () => stamp });

    expect(healthy).toMatchObject({
      state: 'healthy-headroom',
      minimumHeadroom: 40,
      lowCount: 0,
      criticalCount: 0,
      recommendations: ['no-change']
    });
    expect(lowObserved).toMatchObject({
      state: 'low-headroom-observed',
      lowCount: 1,
      minimumHeadroom: 15,
      recommendations: ['observe-next-vram-headroom-sample']
    });
    expect(lowSustained).toMatchObject({
      state: 'low-headroom-sustained',
      lowCount: 2,
      recommendations: ['review-vram-allocation-pressure', 'hold-unapproved-memory-policy']
    });
    expect(criticalObserved).toMatchObject({
      state: 'critical-headroom-observed',
      criticalCount: 1,
      recommendations: ['observe-next-vram-headroom-sample']
    });
    expect(critical).toMatchObject({
      state: 'critical-headroom-sustained',
      criticalCount: 2,
      minimumHeadroom: 1,
      recommendations: ['protect-vram-headroom', 'hold-unapproved-memory-policy']
    });
  });

  test('handles invalid, incomplete, no-GPU, and disabled-observation evidence', () => {
    const invalid = runGpuAllocationHeadroomTurbo([
      snapshot([gpu(120)]), snapshot([gpu(120)])
    ], { trigger, now: () => stamp });
    const incomplete = runGpuAllocationHeadroomTurbo([
      snapshot([{ vramBytes: 100 }]), snapshot([{ vramBytes: -1, vramUsedBytes: 2 }])
    ], { trigger, now: () => stamp });
    const noGpu = runGpuAllocationHeadroomTurbo([
      snapshot([]), snapshot([null])
    ], { trigger, now: () => stamp });
    const disabled = runGpuAllocationHeadroomTurbo([
      snapshot([gpu(20)], { gpuMemoryObservation: false }),
      snapshot([gpu(30)], { gpuMemoryObservation: false })
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
      recommendations: ['request-vram-headroom-observation']
    });
  });

  test('supports custom bands and saturates confidence', () => {
    const report = runGpuAllocationHeadroomTurbo([
      snapshot([gpu(70)]), snapshot([gpu(70)]), snapshot([gpu(70)])
    ], { trigger, criticalThreshold: 15, lowThreshold: 35, minimumSamples: 2, now: () => stamp });

    expect(report).toMatchObject({
      state: 'low-headroom-sustained',
      criticalThreshold: 15,
      lowThreshold: 35,
      confidence: 1
    });
  });

  test('rejects malformed snapshots, triggers, bounds, thresholds, and clocks', () => {
    expect(() => runGpuAllocationHeadroomTurbo('bad', { trigger })).toThrow(TypeError);
    expect(() => runGpuAllocationHeadroomTurbo([null], { trigger })).toThrow(TypeError);
    expect(() => runGpuAllocationHeadroomTurbo()).toThrow('Unsupported');
    expect(() => runGpuAllocationHeadroomTurbo([{}], { trigger })).toThrow('system-facts');
    expect(() => runGpuAllocationHeadroomTurbo([
      { engine: 'system-facts', gpus: null }
    ], { trigger })).toThrow('GPU list');
    expect(() => runGpuAllocationHeadroomTurbo([], { trigger: 'unsupported' })).toThrow('Unsupported');
    expect(() => runGpuAllocationHeadroomTurbo([], { trigger, windowSize: 0 })).toThrow(RangeError);
    expect(() => runGpuAllocationHeadroomTurbo([], { trigger, windowSize: 65 })).toThrow(RangeError);
    expect(() => runGpuAllocationHeadroomTurbo([], { trigger, minimumSamples: 0 })).toThrow(RangeError);
    expect(() => runGpuAllocationHeadroomTurbo([], { trigger, minimumSamples: 3, windowSize: 2 }))
      .toThrow(RangeError);
    expect(() => runGpuAllocationHeadroomTurbo([], { trigger, criticalThreshold: -1 }))
      .toThrow(RangeError);
    expect(() => runGpuAllocationHeadroomTurbo([], { trigger, lowThreshold: 101 }))
      .toThrow(RangeError);
    expect(() => runGpuAllocationHeadroomTurbo([], {
      trigger, criticalThreshold: 20, lowThreshold: 20
    })).toThrow('lowThreshold must exceed');
    expect(() => runGpuAllocationHeadroomTurbo([], { trigger, persistenceThreshold: 0 }))
      .toThrow(RangeError);
    expect(() => runGpuAllocationHeadroomTurbo([], { trigger, persistenceThreshold: 65 }))
      .toThrow(RangeError);
    expect(() => runGpuAllocationHeadroomTurbo([], { trigger, now: () => Number.NaN }))
      .toThrow('clock');
  });
});
