import {
  DISPLAY_PIPELINE_ENGINE_ID,
  DISPLAY_PIPELINE_ENGINE_VERSION,
  DISPLAY_PIPELINE_TRIGGERS,
  runDisplayPipelineEngine
} from '../pc/engines/display-pipeline/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    capabilities: { displayObservation: true },
    displayPresent: true,
    refreshRateHz: 144,
    resolutionWidth: 1920,
    resolutionHeight: 1080,
    hdr: true,
    vrr: true,
    ...overrides
  };
}

describe('Display-pipeline engine', () => {
  test('publishes identity and triggers', () => {
    expect(DISPLAY_PIPELINE_ENGINE_ID).toBe('display-pipeline');
    expect(DISPLAY_PIPELINE_ENGINE_VERSION).toBe(1);
    expect(DISPLAY_PIPELINE_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(DISPLAY_PIPELINE_TRIGGERS)).toBe(true);
  });

  test('reports a complete display pipeline without changes', () => {
    const result = runDisplayPipelineEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: DISPLAY_PIPELINE_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      displayPresent: true,
      refreshRateHz: 144,
      resolutionWidth: 1920,
      resolutionHeight: 1080,
      pixelCount: 2073600,
      hdr: true,
      vrr: true,
      observationEnabled: true,
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('reports disabled, no-display, and headless states', () => {
    expect(runDisplayPipelineEngine(facts({
      capabilities: { displayObservation: false }
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      observationEnabled: false,
      state: 'observation-disabled',
      recommendations: ['keep-display-observation-disabled']
    });
    expect(runDisplayPipelineEngine(facts({
      displayPresent: false
    }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      state: 'no-display',
      recommendations: ['keep-display-controls-disabled']
    });
    expect(runDisplayPipelineEngine(facts({
      environment: 'headless',
      displayPresent: true
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      state: 'no-display',
      recommendations: ['keep-display-controls-disabled']
    });
  });

  test('requests incomplete display evidence', () => {
    expect(runDisplayPipelineEngine(facts({
      refreshRateHz: undefined,
      resolutionHeight: undefined,
      hdr: undefined,
      vrr: undefined
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      refreshRateHz: null,
      resolutionHeight: null,
      pixelCount: null,
      hdr: null,
      vrr: null,
      state: 'observation-required',
      confidence: 0.6,
      recommendations: ['request-display-pipeline-observation']
    });
    expect(runDisplayPipelineEngine(facts({
      displayPresent: undefined
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      displayPresent: null,
      state: 'observation-required',
      confidence: 0.8
    });
  });

  test('requires a known environment and bounds invalid display facts', () => {
    expect(runDisplayPipelineEngine(facts({
      environment: 'other',
      displayPresent: undefined,
      refreshRateHz: undefined,
      resolutionWidth: undefined,
      resolutionHeight: undefined
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(runDisplayPipelineEngine(facts({
      refreshRateHz: 0,
      resolutionWidth: 0,
      resolutionHeight: 1,
      hdr: 'yes',
      vrr: 1
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      refreshRateHz: null,
      resolutionWidth: null,
      resolutionHeight: 1,
      hdr: null,
      vrr: null,
      state: 'observation-required'
    });
    expect(() => runDisplayPipelineEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runDisplayPipelineEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runDisplayPipelineEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported display-pipeline trigger: bad');
    expect(() => runDisplayPipelineEngine(facts(), {}))
      .toThrow('Unsupported display-pipeline trigger: unknown');
    expect(() => runDisplayPipelineEngine())
      .toThrow('Unsupported display-pipeline trigger: unknown');
    expect(() => runDisplayPipelineEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Display-pipeline clock must return a number');
  });
});
