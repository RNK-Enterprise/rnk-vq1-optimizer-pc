import {
  POWER_PROFILE_AVAILABILITY_LIBRARY_ID,
  POWER_PROFILE_AVAILABILITY_LIBRARY_VERSION,
  buildPowerProfileAvailabilityEnvelope,
  buildPowerProfileAvailabilityPlan,
  createPowerProfileAvailabilityLibrary,
  mergePowerProfileAvailabilityReports
} from '../pc/engines/power-profile/turbos/availability-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'power-profile.availability-drift', state: 'stable-availability', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, missingActiveThreshold: 1,
    observedCount: sampleCount, unknownCount: 0, comparisonCount: Math.max(0, sampleCount - 1),
    availabilityChangeCount: 0, addedCount: 0, removedCount: 0, missingActiveCount: 0,
    finalAvailable: ['balanced'], confidence: 1, ...overrides
  };
}

describe('power-profile availability-drift library', () => {
  test('publishes identity and merges bounded availability evidence', () => {
    const merged = mergePowerProfileAvailabilityReports([
      report({ sampleCount: 2, comparisonCount: 1, observedCount: 2 }),
      report({ state: 'availability-drift-sustained', sampleCount: 4, observedCount: 3,
        unknownCount: 1, comparisonCount: 3, availabilityChangeCount: 2,
        addedCount: 2, removedCount: 1, missingActiveCount: 1,
        finalAvailable: ['performance'], confidence: 0.75 })
    ]);
    expect(POWER_PROFILE_AVAILABILITY_LIBRARY_ID).toBe('power-profile.availability-drift.library');
    expect(POWER_PROFILE_AVAILABILITY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'availability-drift-sustained',
      sampleCount: 6, observedCount: 5, unknownCount: 1, comparisonCount: 4,
      availabilityChangeCount: 2, addedCount: 2, removedCount: 1, missingActiveCount: 1,
      finalAvailable: ['performance'], confidence: 0.8333,
      recommendations: ['review-profile-availability-drift'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('merges every state and builds every state plan', () => {
    expect(mergePowerProfileAvailabilityReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0, finalAvailable: [],
      recommendations: ['collect-more-available-profile-samples']
    });
    expect(mergePowerProfileAvailabilityReports([report({ sampleCount: 0, observedCount: 0,
      unknownCount: 0, comparisonCount: 0, finalAvailable: [], confidence: 0 })]).confidence).toBe(0);
    expect(mergePowerProfileAvailabilityReports([report({ state: 'no-availability', sampleCount: 1,
      observedCount: 0, unknownCount: 1, comparisonCount: 0, finalAvailable: [], confidence: 0 })])
      .recommendations).toEqual(['request-available-profile-observation']);
    expect(mergePowerProfileAvailabilityReports([report({ state: 'active-not-advertised', missingActiveCount: 1 })])
      .recommendations).toEqual(['review-active-profile-membership']);
    expect(mergePowerProfileAvailabilityReports([report({ state: 'availability-drift-observed',
      comparisonCount: 1, availabilityChangeCount: 1 })]).recommendations)
      .toEqual(['observe-profile-availability-stability']);
    expect(mergePowerProfileAvailabilityReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergePowerProfileAvailabilityReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, comparisonCount: 0, finalAvailable: [], confidence: 0 })]).state)
      .toBe('insufficient-data');
    const states = [
      ['active-not-advertised', 'membership-review', 750],
      ['availability-drift-sustained', 'availability-review', 1000],
      ['availability-drift-observed', 'availability-observation', 1500],
      ['no-availability', 'observation-bootstrap', 5000],
      ['insufficient-data', 'sample-bootstrap', 2000],
      ['stable-availability', 'stable-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-availability' || state === 'insufficient-data';
      const sampleCount = state === 'insufficient-data' ? 0 : (empty ? 1 : 4);
      const observedCount = empty ? 0 : sampleCount;
      expect(buildPowerProfileAvailabilityPlan(report({ state, sampleCount, observedCount,
        unknownCount: sampleCount - observedCount, comparisonCount: Math.max(0, sampleCount - 1),
        finalAvailable: empty ? [] : ['balanced'], confidence: observedCount / Math.max(1, sampleCount) }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildPowerProfileAvailabilityPlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildPowerProfileAvailabilityPlan(report({ sampleCount: 0, observedCount: 0,
      unknownCount: 0, comparisonCount: 0, finalAvailable: [], confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildPowerProfileAvailabilityEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: POWER_PROFILE_AVAILABILITY_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createPowerProfileAvailabilityLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(POWER_PROFILE_AVAILABILITY_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      comparisonCount: 0, finalAvailable: [], confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, counts, names, triggers, and clocks', () => {
    expect(() => mergePowerProfileAvailabilityReports(null)).toThrow('reports must be an array');
    expect(() => mergePowerProfileAvailabilityReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergePowerProfileAvailabilityReports([null])).toThrow('report must be an object');
    expect(() => mergePowerProfileAvailabilityReports([report({ turbo: 'other' })]))
      .toThrow('requires an availability-drift turbo report');
    expect(() => mergePowerProfileAvailabilityReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergePowerProfileAvailabilityReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergePowerProfileAvailabilityReports([report({ sampleCount: 65 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergePowerProfileAvailabilityReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergePowerProfileAvailabilityReports([report({ persistenceThreshold: 65 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergePowerProfileAvailabilityReports([report({ missingActiveThreshold: 0 })]))
      .toThrow('missingActiveThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'unknownCount', 'missingActiveCount']) {
      expect(() => mergePowerProfileAvailabilityReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergePowerProfileAvailabilityReports([report({ comparisonCount: 4 })]))
      .toThrow('comparisonCount must fit inside the sample window');
    expect(() => mergePowerProfileAvailabilityReports([report({ comparisonCount: 1, availabilityChangeCount: 2 })]))
      .toThrow('availabilityChangeCount must fit inside comparisonCount');
    expect(() => mergePowerProfileAvailabilityReports([report({ addedCount: -1 })]))
      .toThrow('added count must be from 0 to 4096');
    expect(() => mergePowerProfileAvailabilityReports([report({ removedCount: 4097 })]))
      .toThrow('removed count must be from 0 to 4096');
    expect(() => mergePowerProfileAvailabilityReports([report({ finalAvailable: null })]))
      .toThrow('finalAvailable must contain up to 64 names');
    expect(() => mergePowerProfileAvailabilityReports([report({ finalAvailable: Array.from({ length: 65 }, () => 'x') })]))
      .toThrow('finalAvailable must contain up to 64 names');
    expect(() => mergePowerProfileAvailabilityReports([report({ finalAvailable: [''] })]))
      .toThrow('finalAvailable must contain up to 64 names');
    expect(() => mergePowerProfileAvailabilityReports([report({ finalAvailable: [1] })]))
      .toThrow('finalAvailable must contain up to 64 names');
    expect(() => mergePowerProfileAvailabilityReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildPowerProfileAvailabilityEnvelope(report())).toThrow('trigger is required');
    expect(() => buildPowerProfileAvailabilityEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createPowerProfileAvailabilityLibrary()).not.toThrow();
  });
});
