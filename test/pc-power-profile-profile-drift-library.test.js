import {
  POWER_PROFILE_DRIFT_LIBRARY_ID,
  POWER_PROFILE_DRIFT_LIBRARY_VERSION,
  buildPowerProfileDriftEnvelope,
  buildPowerProfileDriftPlan,
  createPowerProfileDriftLibrary,
  mergePowerProfileDriftReports
} from '../pc/engines/power-profile/turbos/profile-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  const comparisonCount = overrides.comparisonCount ?? Math.max(0, sampleCount - 1);
  return {
    turbo: 'power-profile.profile-drift', state: 'stable-profile', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, observedCount: sampleCount,
    unknownCount: 0, controlDisabledCount: 0, comparisonCount,
    activeChangeCount: 0, availabilityChangeCount: 0, controlChangeCount: 0,
    finalProfile: 'balanced', confidence: 1, ...overrides
  };
}

describe('power-profile profile-drift library', () => {
  test('publishes identity and merges bounded profile evidence', () => {
    const merged = mergePowerProfileDriftReports([
      report({ sampleCount: 2, comparisonCount: 1, observedCount: 2 }),
      report({ state: 'profile-drift-sustained', sampleCount: 4, observedCount: 3,
        unknownCount: 1, controlDisabledCount: 1, comparisonCount: 3,
        activeChangeCount: 2, availabilityChangeCount: 1, controlChangeCount: 1,
        finalProfile: 'performance', confidence: 0.75 })
    ]);
    expect(POWER_PROFILE_DRIFT_LIBRARY_ID).toBe('power-profile.profile-drift.library');
    expect(POWER_PROFILE_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'profile-drift-sustained',
      sampleCount: 6, observedCount: 5, unknownCount: 1, controlDisabledCount: 1,
      comparisonCount: 4, activeChangeCount: 2, availabilityChangeCount: 1,
      controlChangeCount: 1, finalProfile: 'performance', confidence: 0.8333,
      recommendations: ['review-profile-drift-without-switching'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('merges every state and builds every state plan', () => {
    expect(mergePowerProfileDriftReports([])).toMatchObject({ state: 'insufficient-data',
      confidence: 0, finalProfile: 'unknown', recommendations: ['collect-more-profile-samples'] });
    expect(mergePowerProfileDriftReports([report({ sampleCount: 0, observedCount: 0,
      unknownCount: 0, comparisonCount: 0, finalProfile: 'unknown', confidence: 0 })]).confidence).toBe(0);
    expect(mergePowerProfileDriftReports([report({ state: 'control-disabled', controlDisabledCount: 1 })])
      .recommendations).toEqual(['preserve-power-profile-control-boundary']);
    expect(mergePowerProfileDriftReports([report({ state: 'availability-drift', availabilityChangeCount: 1,
      comparisonCount: 1 })]).recommendations).toEqual(['observe-available-profile-stability']);
    expect(mergePowerProfileDriftReports([report({ state: 'profile-drift-observed', activeChangeCount: 1,
      comparisonCount: 1 })]).recommendations).toEqual(['observe-active-profile-stability']);
    expect(mergePowerProfileDriftReports([report({ state: 'profile-unknown', sampleCount: 1,
      observedCount: 0, unknownCount: 1, comparisonCount: 0, finalProfile: 'unknown', confidence: 0 })])
      .recommendations).toEqual(['request-active-profile-observation']);
    expect(mergePowerProfileDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, comparisonCount: 0, finalProfile: 'unknown', confidence: 0 })]).state)
      .toBe('insufficient-data');
    const states = [
      ['control-disabled', 'control-preservation', 10000],
      ['profile-drift-sustained', 'profile-review', 750],
      ['availability-drift', 'availability-observation', 1500],
      ['profile-drift-observed', 'profile-observation', 1500],
      ['profile-unknown', 'observation-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['stable-profile', 'stable-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'profile-unknown' || state === 'insufficient-data';
      const sampleCount = state === 'insufficient-data' ? 0 : (empty ? 1 : 4);
      const observedCount = empty ? 0 : sampleCount;
      expect(buildPowerProfileDriftPlan(report({ state, sampleCount, observedCount,
        unknownCount: sampleCount - observedCount, comparisonCount: Math.max(0, sampleCount - 1),
        finalProfile: empty ? 'unknown' : 'balanced', confidence: observedCount / Math.max(1, sampleCount) }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildPowerProfileDriftPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildPowerProfileDriftPlan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      comparisonCount: 0, finalProfile: 'unknown', confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildPowerProfileDriftEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: POWER_PROFILE_DRIFT_LIBRARY_ID, libraryVersion: 1,
      trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createPowerProfileDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(POWER_PROFILE_DRIFT_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      comparisonCount: 0, finalProfile: 'unknown', confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, profiles, triggers, and clocks', () => {
    expect(() => mergePowerProfileDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergePowerProfileDriftReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergePowerProfileDriftReports([null])).toThrow('report must be an object');
    expect(() => mergePowerProfileDriftReports([report({ turbo: 'other' })]))
      .toThrow('requires a profile-drift turbo report');
    expect(() => mergePowerProfileDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergePowerProfileDriftReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergePowerProfileDriftReports([report({ sampleCount: 65 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergePowerProfileDriftReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergePowerProfileDriftReports([report({ persistenceThreshold: 65 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'unknownCount', 'controlDisabledCount']) {
      expect(() => mergePowerProfileDriftReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    }
    expect(() => mergePowerProfileDriftReports([report({ comparisonCount: 4 })]))
      .toThrow('comparisonCount must fit inside the sample window');
    for (const field of ['activeChangeCount', 'availabilityChangeCount', 'controlChangeCount']) {
      expect(() => mergePowerProfileDriftReports([report({ comparisonCount: 1, [field]: 2 })]))
        .toThrow('must fit inside comparisonCount');
    }
    expect(() => mergePowerProfileDriftReports([report({ finalProfile: 'other' })]))
      .toThrow('finalProfile must be a normalized profile');
    expect(() => mergePowerProfileDriftReports([report({ finalProfile: null })]))
      .toThrow('finalProfile must be a normalized profile');
    expect(() => mergePowerProfileDriftReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildPowerProfileDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildPowerProfileDriftEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
