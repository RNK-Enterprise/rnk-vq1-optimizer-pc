import {
  DISPLAY_PIPELINE_LIBRARY_ID,
  DISPLAY_PIPELINE_LIBRARY_VERSION,
  buildDisplayPipelineEnvelope,
  classifyDisplayPipeline,
  compareDisplayPipeline,
  createDisplayPipelineLibrary
} from '../pc/engines/display-pipeline/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    displayPresent: true,
    refreshRateHz: 144,
    resolutionWidth: 1920,
    resolutionHeight: 1080,
    hdr: true,
    vrr: false,
    ...overrides
  };
}

describe('Display-pipeline library', () => {
  test('classifies complete display evidence and bounded fields', () => {
    expect(classifyDisplayPipeline(facts())).toMatchObject({
      library: DISPLAY_PIPELINE_LIBRARY_ID,
      libraryVersion: DISPLAY_PIPELINE_LIBRARY_VERSION,
      displayPresent: true, refreshRateHz: 144, resolutionWidth: 1920,
      resolutionHeight: 1080, pixelCount: 2073600, hdr: true, vrr: false,
      observationEnabled: true, state: 'observe', recommendations: ['no-change']
    });
    expect(classifyDisplayPipeline(facts({ displayPresent: 'yes', refreshRateHz: -1,
      resolutionWidth: 0, resolutionHeight: 1.5, hdr: 'yes', vrr: null })))
      .toMatchObject({ displayPresent: null, refreshRateHz: null, resolutionWidth: null,
        resolutionHeight: null, pixelCount: null, hdr: null, vrr: null,
        state: 'observation-required' });
  });

  test('preserves no-display, disabled, incomplete, and unknown states', () => {
    expect(classifyDisplayPipeline(facts({ environment: 'headless' })).recommendations)
      .toEqual(['keep-display-controls-disabled']);
    expect(classifyDisplayPipeline(facts({ displayPresent: false })).recommendations)
      .toEqual(['keep-display-controls-disabled']);
    expect(classifyDisplayPipeline(facts({ capabilities: { displayObservation: false } }))
      .recommendations).toEqual(['keep-display-observation-disabled']);
    expect(classifyDisplayPipeline(facts({ displayPresent: undefined })).recommendations)
      .toEqual(['request-display-pipeline-observation']);
    expect(classifyDisplayPipeline(facts({ environment: 'other', displayPresent: undefined }))
      .recommendations).toEqual(['request-environment-profile']);
    expect(classifyDisplayPipeline(facts({ capabilities: { displayObservation: true } }))
      .observationEnabled).toBe(true);
  });

  test('compares display snapshots and builds immutable local facades', () => {
    expect(compareDisplayPipeline(facts(), facts({ refreshRateHz: 120 })))
      .toMatchObject({ changed: true, stateChanged: false, refreshChanged: true, resolutionChanged: false });
    expect(compareDisplayPipeline(facts(), facts({ resolutionWidth: 1280 })))
      .toMatchObject({ changed: true, stateChanged: false, refreshChanged: false, resolutionChanged: true });
    expect(compareDisplayPipeline(facts(), facts({ hdr: false, vrr: true })))
      .toMatchObject({ changed: false, hdrChanged: true, vrrChanged: true });
    expect(compareDisplayPipeline(facts(), facts())).toMatchObject({ changed: false });
    const envelope = buildDisplayPipelineEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createDisplayPipelineLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyDisplayPipeline(null)).toThrow('facts must be an object');
    expect(() => classifyDisplayPipeline({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => buildDisplayPipelineEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildDisplayPipelineEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createDisplayPipelineLibrary(null)).toThrow('options must be an object');
    expect(() => createDisplayPipelineLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
