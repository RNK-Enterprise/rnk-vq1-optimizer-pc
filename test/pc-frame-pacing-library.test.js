import {
  FRAME_PACING_LIBRARY_ID,
  FRAME_PACING_LIBRARY_VERSION,
  buildFramePacingEnvelope,
  classifyFramePacing,
  compareFramePacing,
  createFramePacingLibrary
} from '../pc/engines/frame-pacing/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    fps: 55,
    targetFps: 60,
    frameTimeMs: 18,
    frameTimeVarianceMs: 2,
    droppedFramePercent: 1,
    ...overrides
  };
}

describe('Frame-pacing library', () => {
  test('classifies normal, elevated, and bounded timing evidence', () => {
    expect(classifyFramePacing(facts())).toMatchObject({
      library: FRAME_PACING_LIBRARY_ID,
      libraryVersion: FRAME_PACING_LIBRARY_VERSION,
      fps: 55, targetFps: 60, targetGap: 5, frameTimeMs: 18,
      frameTimeVarianceMs: 2, droppedFramePercent: 1, level: 'normal',
      observationEnabled: true, recommendations: ['no-change']
    });
    expect(classifyFramePacing(facts({
      frameTimeVarianceMs: 6, droppedFramePercent: 6
    }))).toMatchObject({ level: 'elevated', droppedFramePercent: 6 });
    expect(classifyFramePacing(facts({
      fps: -1, targetFps: 0, frameTimeMs: -2, frameTimeVarianceMs: -3, droppedFramePercent: Number.NaN
    }))).toMatchObject({ fps: null, targetFps: null, frameTimeMs: null,
      frameTimeVarianceMs: null, droppedFramePercent: null, targetGap: null, level: 'unknown' });
  });

  test('separates headless, disabled, high, and unknown display states', () => {
    expect(classifyFramePacing(facts({ environment: 'headless' })).recommendations)
      .toEqual(['keep-display-controls-disabled']);
    expect(classifyFramePacing(facts({ capabilities: { displayObservation: false } }))
      .recommendations).toEqual(['keep-frame-observation-disabled']);
    expect(classifyFramePacing(facts({ frameTimeVarianceMs: 12, droppedFramePercent: 10 }))
      .recommendations).toEqual(['protect-foreground', 'hold-unapproved-display-policy']);
    expect(classifyFramePacing(facts({ frameTimeVarianceMs: undefined, droppedFramePercent: undefined }))
      .recommendations).toEqual(['request-frame-pacing-observation']);
    expect(classifyFramePacing(facts({ environment: 'other', frameTimeVarianceMs: undefined,
      droppedFramePercent: undefined })).recommendations).toEqual(['request-environment-profile']);
    expect(classifyFramePacing(facts({ capabilities: { displayObservation: true } }))
      .observationEnabled).toBe(true);
  });

  test('compares timing snapshots and builds immutable local facades', () => {
    expect(compareFramePacing(facts(), facts({ frameTimeVarianceMs: 3 })))
      .toMatchObject({ changed: true, levelChanged: false, varianceChanged: true, droppedChanged: false });
    expect(compareFramePacing(facts(), facts({ droppedFramePercent: 2 })))
      .toMatchObject({ changed: true, levelChanged: false, varianceChanged: false, droppedChanged: true });
    expect(compareFramePacing(facts(), facts({ fps: 60 })))
      .toMatchObject({ changed: false, targetGapChanged: true });
    expect(compareFramePacing(facts(), facts())).toMatchObject({ changed: false, targetGapChanged: false });
    const envelope = buildFramePacingEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createFramePacingLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyFramePacing(null)).toThrow('facts must be an object');
    expect(() => classifyFramePacing({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => buildFramePacingEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildFramePacingEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createFramePacingLibrary(null)).toThrow('options must be an object');
    expect(() => createFramePacingLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
