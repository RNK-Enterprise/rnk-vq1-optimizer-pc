import {
  POWER_PROFILE_CONTROL_LIBRARY_ID,
  POWER_PROFILE_CONTROL_LIBRARY_VERSION,
  buildPowerProfileControlEnvelope,
  buildPowerProfileControlPlan,
  createPowerProfileControlLibrary,
  mergePowerProfileControlReports
} from '../pc/engines/power-profile/turbos/control-boundary/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  const comparisonCount = overrides.comparisonCount ?? Math.max(0, sampleCount - 1);
  return {
    turbo: 'power-profile.control-boundary', state: 'stable-control', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, observedCount: sampleCount,
    unknownCount: 0, enabledCount: sampleCount, disabledCount: 0, comparisonCount,
    controlChangeCount: 0, enabledToDisabledCount: 0, disabledToEnabledCount: 0,
    finalControl: 'enabled', confidence: 1, ...overrides
  };
}

describe('power-profile control-boundary library', () => {
  test('publishes identity and merges capability evidence', () => {
    const merged = mergePowerProfileControlReports([
      report({ sampleCount: 2, comparisonCount: 1 }),
      report({ state: 'control-drift-sustained', sampleCount: 4, observedCount: 3,
        unknownCount: 1, enabledCount: 2, disabledCount: 2, comparisonCount: 3,
        controlChangeCount: 2, enabledToDisabledCount: 1, disabledToEnabledCount: 1,
        finalControl: 'disabled', confidence: 0.75 })
    ]);
    expect(POWER_PROFILE_CONTROL_LIBRARY_ID).toBe('power-profile.control-boundary.library');
    expect(POWER_PROFILE_CONTROL_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'control-drift-sustained',
      sampleCount: 6, observedCount: 5, unknownCount: 1, enabledCount: 4,
      disabledCount: 2, comparisonCount: 4, controlChangeCount: 2,
      enabledToDisabledCount: 1, disabledToEnabledCount: 1, finalControl: 'disabled',
      confidence: 0.8333, recommendations: ['review-power-profile-capability-drift'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('merges every state and builds every state plan', () => {
    expect(mergePowerProfileControlReports([])).toMatchObject({ state: 'insufficient-data',
      confidence: 0, finalControl: 'unknown', recommendations: ['collect-more-control-samples'] });
    expect(mergePowerProfileControlReports([report({ sampleCount: 0, observedCount: 0,
      unknownCount: 0, enabledCount: 0, disabledCount: 0, comparisonCount: 0,
      finalControl: 'unknown', confidence: 0 })]).confidence).toBe(0);
    expect(mergePowerProfileControlReports([report({ state: 'control-drift-observed',
      comparisonCount: 1, controlChangeCount: 1 })]).recommendations)
      .toEqual(['observe-power-profile-capability-stability']);
    expect(mergePowerProfileControlReports([report({ state: 'control-disabled',
      enabledCount: 0, disabledCount: 4, finalControl: 'disabled' })]).recommendations)
      .toEqual(['preserve-disabled-power-profile-control']);
    expect(mergePowerProfileControlReports([report({ state: 'capability-unknown', sampleCount: 1,
      observedCount: 0, unknownCount: 1, enabledCount: 0, disabledCount: 0,
      comparisonCount: 0, finalControl: 'unknown', confidence: 0 })]).recommendations)
      .toEqual(['request-explicit-power-profile-capability']);
    expect(mergePowerProfileControlReports([report({ state: 'insufficient-data', sampleCount: 1,
      observedCount: 0, unknownCount: 1, enabledCount: 0, disabledCount: 0,
      comparisonCount: 0, finalControl: 'unknown', confidence: 0 })]).state).toBe('insufficient-data');
    const states = [
      ['control-drift-sustained', 'capability-review', 750],
      ['control-drift-observed', 'capability-observation', 1000],
      ['control-disabled', 'disabled-preservation', 10000],
      ['capability-unknown', 'evidence-bootstrap', 2000],
      ['insufficient-data', 'sample-bootstrap', 2000],
      ['stable-control', 'stable-observation', 5000]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'capability-unknown' || state === 'insufficient-data';
      const sampleCount = state === 'insufficient-data' ? 0 : (empty ? 1 : 4);
      const observedCount = empty ? 0 : sampleCount;
      expect(buildPowerProfileControlPlan(report({ state, sampleCount, observedCount,
        unknownCount: sampleCount - observedCount, enabledCount: empty ? 0 : sampleCount,
        disabledCount: 0, comparisonCount: Math.max(0, sampleCount - 1),
        finalControl: empty ? 'unknown' : 'enabled', confidence: observedCount / Math.max(1, sampleCount) }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildPowerProfileControlPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildPowerProfileControlPlan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      enabledCount: 0, disabledCount: 0, comparisonCount: 0, finalControl: 'unknown', confidence: 0 }), 'other'))
      .toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildPowerProfileControlEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope).toMatchObject({ library: POWER_PROFILE_CONTROL_LIBRARY_ID, libraryVersion: 1,
      trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createPowerProfileControlLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(POWER_PROFILE_CONTROL_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      enabledCount: 0, disabledCount: 0, comparisonCount: 0, finalControl: 'unknown', confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, controls, triggers, and clocks', () => {
    expect(() => mergePowerProfileControlReports(null)).toThrow('reports must be an array');
    expect(() => mergePowerProfileControlReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergePowerProfileControlReports([null])).toThrow('report must be an object');
    expect(() => mergePowerProfileControlReports([report({ turbo: 'other' })]))
      .toThrow('requires a control-boundary turbo report');
    expect(() => mergePowerProfileControlReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergePowerProfileControlReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergePowerProfileControlReports([report({ sampleCount: 65 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergePowerProfileControlReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergePowerProfileControlReports([report({ persistenceThreshold: 65 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'unknownCount', 'enabledCount', 'disabledCount']) {
      expect(() => mergePowerProfileControlReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount');
    }
    expect(() => mergePowerProfileControlReports([report({ comparisonCount: 4 })]))
      .toThrow('comparisonCount must fit inside the sample window');
    expect(() => mergePowerProfileControlReports([report({ comparisonCount: 1, controlChangeCount: 2 })]))
      .toThrow('control-change count must fit inside comparisonCount');
    for (const field of ['enabledToDisabledCount', 'disabledToEnabledCount']) {
      expect(() => mergePowerProfileControlReports([report({ controlChangeCount: 1, [field]: 2 })]))
        .toThrow('must fit inside controlChangeCount');
    }
    expect(() => mergePowerProfileControlReports([report({ finalControl: 'other' })]))
      .toThrow('finalControl must be enabled, disabled, or unknown');
    expect(() => mergePowerProfileControlReports([report({ finalControl: null })]))
      .toThrow('finalControl must be enabled, disabled, or unknown');
    expect(() => mergePowerProfileControlReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildPowerProfileControlEnvelope(report())).toThrow('trigger is required');
    expect(() => buildPowerProfileControlEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
