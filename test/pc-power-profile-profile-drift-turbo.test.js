import {
  POWER_PROFILE_DRIFT_TURBO_ID,
  POWER_PROFILE_DRIFT_TURBO_VERSION,
  POWER_PROFILE_DRIFT_TRIGGERS,
  runPowerProfileDriftTurbo
} from '../pc/engines/power-profile/turbos/profile-drift/turbo.js';

function facts(active = 'balanced', available = ['powersave', 'balanced', 'performance'], overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    capabilities: { powerProfileControl: true },
    powerProfile: { active, available },
    ...overrides
  };
}

describe('power-profile profile-drift turbo', () => {
  test('publishes identity and detects sustained active-profile drift', () => {
    expect(POWER_PROFILE_DRIFT_TURBO_ID).toBe('power-profile.profile-drift');
    expect(POWER_PROFILE_DRIFT_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(POWER_PROFILE_DRIFT_TRIGGERS)).toBe(true);
    const result = runPowerProfileDriftTurbo([
      facts('balanced'), facts('performance'), facts('powersave')
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({
      turbo: POWER_PROFILE_DRIFT_TURBO_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      sampleCount: 3,
      observedCount: 3,
      unknownCount: 0,
      comparisonCount: 2,
      activeChangeCount: 2,
      availabilityChangeCount: 0,
      controlChangeCount: 0,
      finalProfile: 'powersave',
      state: 'profile-drift-sustained',
      confidence: 1,
      recommendations: ['review-profile-drift-without-switching'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes stable, observed, availability, control, and unknown states', () => {
    expect(runPowerProfileDriftTurbo([facts(), facts()], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'stable-profile', activeChangeCount: 0, availabilityChangeCount: 0 });
    expect(runPowerProfileDriftTurbo([facts('balanced'), facts('performance')], {
      trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0
    })).toMatchObject({ state: 'profile-drift-observed', activeChangeCount: 1 });
    expect(runPowerProfileDriftTurbo([
      facts('balanced', ['balanced']), facts('balanced', ['balanced', 'performance']), facts('balanced', ['performance'])
    ], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 }))
      .toMatchObject({ state: 'availability-drift', availabilityChangeCount: 2 });
    expect(runPowerProfileDriftTurbo([
      facts('balanced'), facts('balanced', undefined, { capabilities: { powerProfileControl: false } })
    ], { trigger: 'system.facts.request', now: () => 0 }))
      .toMatchObject({ state: 'control-disabled', controlDisabledCount: 1, controlChangeCount: 1 });
    expect(runPowerProfileDriftTurbo([
      facts(null, 'balanced'), facts('', 'balanced')
    ], { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ state: 'profile-unknown', observedCount: 0, unknownCount: 2, confidence: 0 });
    expect(runPowerProfileDriftTurbo([], { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0, finalProfile: 'unknown' });
  });

  test('normalizes bounded availability and environment evidence', () => {
    const result = runPowerProfileDriftTurbo([facts('custom-work', [null, '', ' BALANCED ', 'balanced'], {
      environment: 'other', capabilities: undefined
    })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 });
    expect(result).toMatchObject({ sampleCount: 1, observedCount: 1, state: 'stable-profile', confidence: 1 });
    expect(runPowerProfileDriftTurbo([facts('balanced', 'balanced')], {
      trigger: 'workload.changed', minimumSamples: 1, now: () => 0
    })).toMatchObject({ state: 'stable-profile' });
  });

  test('rejects invalid triggers, windows, snapshots, and clocks', () => {
    expect(() => runPowerProfileDriftTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported power-profile profile-drift trigger: bad');
    expect(() => runPowerProfileDriftTurbo()).toThrow('Unsupported power-profile profile-drift trigger: unknown');
    expect(() => runPowerProfileDriftTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runPowerProfileDriftTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runPowerProfileDriftTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runPowerProfileDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runPowerProfileDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runPowerProfileDriftTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 }))
      .toThrow('persistenceThreshold must be an integer from 1 to 4');
    expect(() => runPowerProfileDriftTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 }))
      .toThrow('persistenceThreshold must be an integer from 1 to 4');
    expect(() => runPowerProfileDriftTurbo([null], { trigger: 'health.interval' }))
      .toThrow('snapshot must be an object');
    expect(() => runPowerProfileDriftTurbo([{ engine: 'other' }], { trigger: 'health.interval' }))
      .toThrow('requires a system-facts snapshot');
    expect(() => runPowerProfileDriftTurbo([facts('balanced', undefined, { powerProfile: null })], {
      trigger: 'health.interval'
    })).toThrow('requires a profile object');
    expect(() => runPowerProfileDriftTurbo([], { trigger: 'health.interval', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
