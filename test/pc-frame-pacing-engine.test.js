import {
  FRAME_PACING_ENGINE_ID,
  FRAME_PACING_ENGINE_VERSION,
  FRAME_PACING_TRIGGERS,
  runFramePacingEngine
} from '../pc/engines/frame-pacing/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    capabilities: { displayObservation: true },
    fps: 60,
    targetFps: 60,
    frameTimeMs: 16.67,
    frameTimeVarianceMs: 1,
    droppedFramePercent: 0,
    ...overrides
  };
}

describe('Frame-pacing engine', () => {
  test('publishes identity and triggers', () => {
    expect(FRAME_PACING_ENGINE_ID).toBe('frame-pacing');
    expect(FRAME_PACING_ENGINE_VERSION).toBe(1);
    expect(FRAME_PACING_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(FRAME_PACING_TRIGGERS)).toBe(true);
  });

  test('reports stable pacing without changing display controls', () => {
    const result = runFramePacingEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: FRAME_PACING_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      fps: 60,
      targetFps: 60,
      targetGap: 0,
      frameTimeMs: 16.67,
      frameTimeVarianceMs: 1,
      droppedFramePercent: 0,
      level: 'normal',
      observationEnabled: true,
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('classifies elevated and high jitter or dropped frames', () => {
    expect(runFramePacingEngine(facts({
      frameTimeVarianceMs: 5,
      droppedFramePercent: 2,
      fps: 55,
      targetFps: 60
    }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      targetGap: 5,
      level: 'elevated',
      state: 'watch',
      recommendations: ['observe-next-sample', 'review-frame-jitter']
    });
    expect(runFramePacingEngine(facts({
      frameTimeVarianceMs: 12,
      droppedFramePercent: 10
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      level: 'high',
      state: 'protect-foreground',
      recommendations: ['protect-foreground', 'hold-unapproved-display-policy']
    });
  });

  test('handles disabled observation and headless environments', () => {
    expect(runFramePacingEngine(facts({
      capabilities: { displayObservation: false }
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      observationEnabled: false,
      state: 'observation-disabled',
      recommendations: ['keep-frame-observation-disabled']
    });
    expect(runFramePacingEngine(facts({
      environment: 'headless'
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      state: 'no-display',
      recommendations: ['keep-display-controls-disabled']
    });
  });

  test('reports unknown observations and environments conservatively', () => {
    expect(runFramePacingEngine(facts({
      environment: 'other',
      fps: undefined,
      targetFps: undefined,
      frameTimeMs: undefined,
      frameTimeVarianceMs: undefined,
      droppedFramePercent: undefined
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      fps: null,
      targetFps: null,
      targetGap: null,
      level: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(runFramePacingEngine(facts({
      frameTimeMs: undefined,
      frameTimeVarianceMs: undefined,
      droppedFramePercent: undefined
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      level: 'unknown',
      state: 'observation-required',
      confidence: 0.2,
      recommendations: ['request-frame-pacing-observation']
    });
  });

  test('bounds measurements and rejects malformed inputs', () => {
    expect(runFramePacingEngine(facts({
      fps: -1,
      targetFps: 0,
      frameTimeMs: -1,
      frameTimeVarianceMs: 20,
      droppedFramePercent: 120
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      fps: null,
      targetFps: null,
      targetGap: null,
      frameTimeMs: null,
      frameTimeVarianceMs: 20,
      droppedFramePercent: 100,
      level: 'high'
    });
    expect(() => runFramePacingEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runFramePacingEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runFramePacingEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported frame-pacing trigger: bad');
    expect(() => runFramePacingEngine(facts(), {}))
      .toThrow('Unsupported frame-pacing trigger: unknown');
    expect(() => runFramePacingEngine())
      .toThrow('Unsupported frame-pacing trigger: unknown');
    expect(() => runFramePacingEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Frame-pacing clock must return a number');
  });
});
