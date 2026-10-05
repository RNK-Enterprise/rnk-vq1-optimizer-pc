import {
  GPU_OBSERVATION_BOUNDARY_TRIGGERS,
  GPU_OBSERVATION_BOUNDARY_TURBO_ID,
  runGpuObservationBoundaryTurbo
} from '../pc/engines/gpu-policy/turbos/observation-boundary/turbo.js';

const trigger = 'health.interval';
const stamp = 1760000000000;
const snapshot = (gpus, capabilities) => ({ engine: 'system-facts', gpus, capabilities });
const gpu = { vendor: 'nvidia', model: 'adapter' };

describe('gpu-policy observation-boundary turbo', () => {
  test('exposes immutable identity and reports an empty window conservatively', () => {
    const report = runGpuObservationBoundaryTurbo([], { trigger, now: () => stamp });

    expect(GPU_OBSERVATION_BOUNDARY_TURBO_ID).toBe('gpu-policy.observation-boundary');
    expect(Object.isFrozen(GPU_OBSERVATION_BOUNDARY_TRIGGERS)).toBe(true);
    expect(report).toMatchObject({
      turbo: GPU_OBSERVATION_BOUNDARY_TURBO_ID,
      trigger,
      sampleCount: 0,
      state: 'insufficient-data',
      confidence: 0,
      transitionCount: 0
    });
    expect(Object.isFrozen(report)).toBe(true);
    expect(report.actions).toEqual([]);
  });

  test('classifies stable enabled, persistent disabled, and observed boundaries', () => {
    const enabled = runGpuObservationBoundaryTurbo([
      snapshot([gpu], { gpuObservation: true }),
      snapshot([gpu], { gpuObservation: true })
    ], { trigger, now: () => stamp });
    const disabled = runGpuObservationBoundaryTurbo([
      snapshot([gpu], { gpuObservation: false }),
      snapshot([gpu], { gpuObservation: false })
    ], { trigger, now: () => stamp });
    const observed = runGpuObservationBoundaryTurbo([
      snapshot([gpu], { gpuObservation: true }),
      snapshot([gpu], { gpuObservation: false })
    ], { trigger, persistenceThreshold: 2, now: () => stamp });

    expect(enabled).toMatchObject({
      state: 'observation-enabled-stable',
      enabledCount: 2,
      disabledCount: 0,
      observedCount: 2
    });
    expect(disabled).toMatchObject({
      state: 'observation-disabled-persistent',
      enabledCount: 0,
      disabledCount: 2,
      recommendations: ['keep-gpu-observation-disabled']
    });
    expect(observed).toMatchObject({
      state: 'observation-boundary-observed',
      transitionCount: 1,
      recommendations: ['observe-next-gpu-observation-sample']
    });
  });

  test('detects sustained flips, no-GPU posture, and mixed inventory boundaries', () => {
    const sustained = runGpuObservationBoundaryTurbo([
      snapshot([gpu], { gpuObservation: true }),
      snapshot([gpu], { gpuObservation: false }),
      snapshot([gpu], { gpuObservation: true })
    ], { trigger, minimumSamples: 2, now: () => stamp });
    const noGpu = runGpuObservationBoundaryTurbo([
      snapshot([]), snapshot([null])
    ], { trigger, now: () => stamp });
    const mixedInventory = runGpuObservationBoundaryTurbo([
      snapshot([]), snapshot([gpu], { gpuObservation: true })
    ], { trigger, now: () => stamp });

    expect(sustained).toMatchObject({
      state: 'sustained-observation-boundary-drift',
      transitionCount: 2,
      recommendations: ['review-gpu-observation-stability', 'hold-unapproved-gpu-policy']
    });
    expect(noGpu).toMatchObject({
      state: 'no-gpu',
      noGpuCount: 2,
      recommendations: ['no-change', 'keep-gpu-controls-disabled']
    });
    expect(mixedInventory).toMatchObject({
      state: 'observation-boundary-drift',
      noGpuCount: 1,
      recommendations: ['review-gpu-observation-boundary', 'hold-unapproved-gpu-policy']
    });
  });

  test('reports unknown capability evidence and bounded confidence', () => {
    const unknown = runGpuObservationBoundaryTurbo([
      snapshot([gpu]),
      snapshot([gpu], { gpuObservation: 'unknown' })
    ], { trigger, now: () => stamp });
    const saturated = runGpuObservationBoundaryTurbo([
      snapshot([gpu], { gpuObservation: true }),
      snapshot([gpu], { gpuObservation: true }),
      snapshot([gpu], { gpuObservation: true })
    ], { trigger, minimumSamples: 2, now: () => stamp });

    expect(unknown).toMatchObject({
      state: 'observation-unknown',
      unknownCount: 2,
      recommendations: ['request-gpu-observation-capability-evidence']
    });
    expect(saturated.confidence).toBe(1);
  });

  test('rejects malformed snapshots, triggers, bounds, and clocks', () => {
    expect(() => runGpuObservationBoundaryTurbo('bad', { trigger })).toThrow(TypeError);
    expect(() => runGpuObservationBoundaryTurbo([null], { trigger })).toThrow(TypeError);
    expect(() => runGpuObservationBoundaryTurbo()).toThrow('Unsupported');
    expect(() => runGpuObservationBoundaryTurbo([{}], { trigger })).toThrow('system-facts');
    expect(() => runGpuObservationBoundaryTurbo([
      { engine: 'system-facts', gpus: null }
    ], { trigger })).toThrow('GPU list');
    expect(() => runGpuObservationBoundaryTurbo([], { trigger: 'unsupported' })).toThrow('Unsupported');
    expect(() => runGpuObservationBoundaryTurbo([], { trigger, windowSize: 0 })).toThrow(RangeError);
    expect(() => runGpuObservationBoundaryTurbo([], { trigger, windowSize: 65 })).toThrow(RangeError);
    expect(() => runGpuObservationBoundaryTurbo([], { trigger, minimumSamples: 0 })).toThrow(RangeError);
    expect(() => runGpuObservationBoundaryTurbo([], { trigger, minimumSamples: 3, windowSize: 2 }))
      .toThrow(RangeError);
    expect(() => runGpuObservationBoundaryTurbo([], { trigger, persistenceThreshold: 0 }))
      .toThrow(RangeError);
    expect(() => runGpuObservationBoundaryTurbo([], { trigger, persistenceThreshold: 65 }))
      .toThrow(RangeError);
    expect(() => runGpuObservationBoundaryTurbo([], { trigger, now: () => Number.NaN }))
      .toThrow('clock');
  });
});
