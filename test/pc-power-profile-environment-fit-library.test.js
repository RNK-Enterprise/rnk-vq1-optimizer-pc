import {
  POWER_PROFILE_ENVIRONMENT_LIBRARY_ID,
  POWER_PROFILE_ENVIRONMENT_LIBRARY_VERSION,
  buildPowerProfileEnvironmentEnvelope,
  buildPowerProfileEnvironmentPlan,
  createPowerProfileEnvironmentLibrary,
  mergePowerProfileEnvironmentReports
} from '../pc/engines/power-profile/turbos/environment-fit/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  const comparisonCount = overrides.comparisonCount ?? Math.max(0, sampleCount - 1);
  return {
    turbo: 'power-profile.environment-fit', state: 'profile-aligned', sampleCount,
    minimumSamples: 2, mismatchThreshold: 2, environmentUnknownCount: 0,
    profileUnknownCount: 0, customCount: 0, mismatchCount: 0, alignedCount: sampleCount,
    knownCount: sampleCount, comparisonCount, fitChangeCount: 0,
    environmentChangeCount: 0, profileChangeCount: 0, finalEnvironment: 'interactive',
    finalProfile: 'balanced', finalTarget: 'balanced', confidence: 1, ...overrides
  };
}

describe('power-profile environment-fit library', () => {
  test('publishes identity and merges profile-fit evidence', () => {
    const merged = mergePowerProfileEnvironmentReports([
      report({ sampleCount: 2, comparisonCount: 1 }),
      report({ state: 'profile-mismatch-sustained', sampleCount: 4, mismatchCount: 3,
        alignedCount: 1, knownCount: 4, comparisonCount: 3, fitChangeCount: 2,
        environmentChangeCount: 1, profileChangeCount: 2, finalEnvironment: 'headless',
        finalProfile: 'balanced', finalTarget: 'performance', confidence: 1 })
    ]);
    expect(POWER_PROFILE_ENVIRONMENT_LIBRARY_ID).toBe('power-profile.environment-fit.library');
    expect(POWER_PROFILE_ENVIRONMENT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'profile-mismatch-sustained',
      sampleCount: 6, mismatchCount: 3, alignedCount: 3, knownCount: 6,
      comparisonCount: 4, fitChangeCount: 2, environmentChangeCount: 1, profileChangeCount: 2,
      finalEnvironment: 'headless', finalProfile: 'balanced', finalTarget: 'performance',
      confidence: 1, recommendations: ['review-profile-fit-without-switching'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('merges every state and builds every state plan', () => {
    expect(mergePowerProfileEnvironmentReports([])).toMatchObject({ state: 'insufficient-data',
      confidence: 0, finalEnvironment: 'unknown', finalProfile: 'unknown', finalTarget: null,
      recommendations: ['collect-more-environment-profile-samples'] });
    expect(mergePowerProfileEnvironmentReports([report({ sampleCount: 0, alignedCount: 0,
      knownCount: 0, comparisonCount: 0, finalEnvironment: 'unknown', finalProfile: 'unknown',
      finalTarget: null, confidence: 0 })]).confidence).toBe(0);
    expect(mergePowerProfileEnvironmentReports([report({ state: 'profile-mismatch-observed',
      mismatchCount: 1, alignedCount: 3, comparisonCount: 1 })]).recommendations)
      .toEqual(['observe-profile-fit-stability']);
    expect(mergePowerProfileEnvironmentReports([report({ state: 'custom-profile-review', customCount: 1 })])
      .recommendations).toEqual(['review-user-owned-custom-profile']);
    expect(mergePowerProfileEnvironmentReports([report({ state: 'environment-unknown',
      environmentUnknownCount: 1, knownCount: 0, alignedCount: 0, finalEnvironment: 'unknown',
      finalTarget: null, confidence: 0 })]).recommendations).toEqual(['request-environment-profile']);
    expect(mergePowerProfileEnvironmentReports([report({ state: 'profile-unknown',
      profileUnknownCount: 1, knownCount: 0, alignedCount: 0, finalProfile: 'unknown',
      finalTarget: null, confidence: 0 })]).recommendations)
      .toEqual(['request-active-profile-observation']);
    expect(mergePowerProfileEnvironmentReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergePowerProfileEnvironmentReports([report({ state: 'insufficient-data', sampleCount: 1,
      alignedCount: 0, knownCount: 0, comparisonCount: 0, finalEnvironment: 'unknown',
      finalProfile: 'unknown', finalTarget: null, confidence: 0 })]).state).toBe('insufficient-data');
    const states = [
      ['profile-mismatch-sustained', 'fit-review', 1000],
      ['profile-mismatch-observed', 'fit-observation', 1500],
      ['custom-profile-review', 'custom-review', 2000],
      ['environment-unknown', 'environment-bootstrap', 2000],
      ['profile-unknown', 'profile-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 1500],
      ['profile-aligned', 'stable-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = ['environment-unknown', 'profile-unknown', 'insufficient-data'].includes(state);
      const sampleCount = state === 'insufficient-data' ? 0 : (empty ? 1 : 4);
      const knownCount = empty ? 0 : sampleCount;
      expect(buildPowerProfileEnvironmentPlan(report({ state, sampleCount,
        environmentUnknownCount: state === 'environment-unknown' ? sampleCount : 0,
        profileUnknownCount: state === 'profile-unknown' ? sampleCount : 0,
        customCount: state === 'custom-profile-review' ? sampleCount : 0,
        mismatchCount: state.includes('mismatch') ? sampleCount : 0,
        alignedCount: state === 'profile-aligned' ? sampleCount : 0,
        knownCount, comparisonCount: Math.max(0, sampleCount - 1),
        finalEnvironment: empty ? 'unknown' : 'interactive', finalProfile: empty ? 'unknown' : 'balanced',
        finalTarget: empty ? null : 'balanced', confidence: knownCount / Math.max(1, sampleCount) }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildPowerProfileEnvironmentPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildPowerProfileEnvironmentPlan(report({ sampleCount: 0, alignedCount: 0, knownCount: 0,
      comparisonCount: 0, finalEnvironment: 'unknown', finalProfile: 'unknown', finalTarget: null, confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildPowerProfileEnvironmentEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: POWER_PROFILE_ENVIRONMENT_LIBRARY_ID, libraryVersion: 1,
      trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createPowerProfileEnvironmentLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(POWER_PROFILE_ENVIRONMENT_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, alignedCount: 0, knownCount: 0,
      comparisonCount: 0, finalEnvironment: 'unknown', finalProfile: 'unknown', finalTarget: null, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, names, triggers, and clocks', () => {
    expect(() => mergePowerProfileEnvironmentReports(null)).toThrow('reports must be an array');
    expect(() => mergePowerProfileEnvironmentReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergePowerProfileEnvironmentReports([null])).toThrow('report must be an object');
    expect(() => mergePowerProfileEnvironmentReports([report({ turbo: 'other' })]))
      .toThrow('requires an environment-fit turbo report');
    expect(() => mergePowerProfileEnvironmentReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergePowerProfileEnvironmentReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergePowerProfileEnvironmentReports([report({ sampleCount: 65 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergePowerProfileEnvironmentReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergePowerProfileEnvironmentReports([report({ mismatchThreshold: 65 })]))
      .toThrow('mismatchThreshold must be from 1 to 64');
    for (const field of ['environmentUnknownCount', 'profileUnknownCount', 'customCount', 'mismatchCount', 'alignedCount', 'knownCount']) {
      expect(() => mergePowerProfileEnvironmentReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    }
    expect(() => mergePowerProfileEnvironmentReports([report({ comparisonCount: 4 })]))
      .toThrow('comparisonCount must fit inside the sample window');
    for (const field of ['fitChangeCount', 'environmentChangeCount', 'profileChangeCount']) {
      expect(() => mergePowerProfileEnvironmentReports([report({ comparisonCount: 1, [field]: 2 })]))
        .toThrow('must fit inside comparisonCount');
    }
    expect(() => mergePowerProfileEnvironmentReports([report({ finalEnvironment: 'other' })]))
      .toThrow('finalEnvironment must be normalized');
    expect(() => mergePowerProfileEnvironmentReports([report({ finalProfile: 'other' })]))
      .toThrow('finalProfile must be normalized');
    expect(() => mergePowerProfileEnvironmentReports([report({ finalTarget: 'powersave' })]))
      .toThrow('finalTarget must be a known target or null');
    expect(() => mergePowerProfileEnvironmentReports([report({ finalTarget: 1 })]))
      .toThrow('finalTarget must be a known target or null');
    expect(() => mergePowerProfileEnvironmentReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildPowerProfileEnvironmentEnvelope(report())).toThrow('trigger is required');
    expect(() => buildPowerProfileEnvironmentEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
