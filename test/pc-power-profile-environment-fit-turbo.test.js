import {
  POWER_PROFILE_ENVIRONMENT_TRIGGERS,
  POWER_PROFILE_ENVIRONMENT_TURBO_ID,
  POWER_PROFILE_ENVIRONMENT_TURBO_VERSION,
  runPowerProfileEnvironmentFitTurbo
} from '../pc/engines/power-profile/turbos/environment-fit/turbo.js';

function facts(environment = 'interactive', active = 'balanced') {
  return { engine: 'system-facts', environment, powerProfile: { active } };
}

describe('power-profile environment-fit turbo', () => {
  test('publishes identity and detects sustained profile mismatch', () => {
    expect(POWER_PROFILE_ENVIRONMENT_TURBO_ID).toBe('power-profile.environment-fit');
    expect(POWER_PROFILE_ENVIRONMENT_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(POWER_PROFILE_ENVIRONMENT_TRIGGERS)).toBe(true);
    const result = runPowerProfileEnvironmentFitTurbo([
      facts('headless', 'balanced'), facts('headless', 'powersave')
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(result).toMatchObject({
      turbo: POWER_PROFILE_ENVIRONMENT_TURBO_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      sampleCount: 2,
      minimumSamples: 2,
      mismatchThreshold: 2,
      environmentUnknownCount: 0,
      profileUnknownCount: 0,
      customCount: 0,
      mismatchCount: 2,
      alignedCount: 0,
      knownCount: 2,
      comparisonCount: 1,
      fitChangeCount: 0,
      environmentChangeCount: 0,
      profileChangeCount: 1,
      finalEnvironment: 'headless',
      finalProfile: 'powersave',
      finalTarget: 'performance',
      state: 'profile-mismatch-sustained',
      confidence: 1,
      recommendations: ['review-profile-fit-without-switching'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes aligned, observed, custom, unknown, and insufficient states', () => {
    expect(runPowerProfileEnvironmentFitTurbo([facts(), facts()], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'profile-aligned', alignedCount: 2, confidence: 1 });
    expect(runPowerProfileEnvironmentFitTurbo([facts('headless', 'balanced')], {
      trigger: 'health.interval', minimumSamples: 1, now: () => 0
    })).toMatchObject({ state: 'profile-mismatch-observed', mismatchCount: 1 });
    expect(runPowerProfileEnvironmentFitTurbo([facts('interactive', 'vendor-custom'), facts('interactive', 'custom')], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'custom-profile-review', customCount: 2 });
    expect(runPowerProfileEnvironmentFitTurbo([facts('other', 'balanced'), facts('other', 'performance')], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'environment-unknown', environmentUnknownCount: 2, confidence: 0 });
    expect(runPowerProfileEnvironmentFitTurbo([facts('interactive', null), facts('interactive', '')], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'profile-unknown', profileUnknownCount: 2, confidence: 0 });
    expect(runPowerProfileEnvironmentFitTurbo([], { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0,
        finalEnvironment: 'unknown', finalProfile: 'unknown', finalTarget: null });
  });

  test('tracks explicit environment and profile transitions', () => {
    const result = runPowerProfileEnvironmentFitTurbo([
      facts('interactive', 'balanced'), facts('headless', 'performance')
    ], { trigger: 'install.preflight', now: () => 0 });
    expect(result).toMatchObject({ state: 'profile-aligned', fitChangeCount: 0,
      environmentChangeCount: 1, profileChangeCount: 1, comparisonCount: 1 });
    expect(runPowerProfileEnvironmentFitTurbo([facts('other', null), facts('interactive', 'balanced')], {
      trigger: 'health.interval', minimumSamples: 1, now: () => 0
    })).toMatchObject({ state: 'profile-aligned', environmentUnknownCount: 1,
      profileUnknownCount: 1, knownCount: 1, confidence: 0.5 });
    expect(runPowerProfileEnvironmentFitTurbo([facts('other', 'balanced'), facts('interactive', null)], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'profile-unknown', environmentUnknownCount: 1,
      profileUnknownCount: 1, knownCount: 0, confidence: 0 });
  });

  test('rejects invalid triggers, bounds, snapshots, and clocks', () => {
    expect(() => runPowerProfileEnvironmentFitTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported power-profile environment-fit trigger: bad');
    expect(() => runPowerProfileEnvironmentFitTurbo()).toThrow('Unsupported power-profile environment-fit trigger: unknown');
    expect(() => runPowerProfileEnvironmentFitTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runPowerProfileEnvironmentFitTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runPowerProfileEnvironmentFitTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runPowerProfileEnvironmentFitTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runPowerProfileEnvironmentFitTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runPowerProfileEnvironmentFitTurbo([], { trigger: 'health.interval', windowSize: 4, mismatchThreshold: 0 }))
      .toThrow('mismatchThreshold must be an integer from 1 to 4');
    expect(() => runPowerProfileEnvironmentFitTurbo([], { trigger: 'health.interval', windowSize: 4, mismatchThreshold: 5 }))
      .toThrow('mismatchThreshold must be an integer from 1 to 4');
    expect(() => runPowerProfileEnvironmentFitTurbo([null], { trigger: 'health.interval' }))
      .toThrow('snapshot must be an object');
    expect(() => runPowerProfileEnvironmentFitTurbo([{ engine: 'other' }], { trigger: 'health.interval' }))
      .toThrow('requires a system-facts snapshot');
    expect(() => runPowerProfileEnvironmentFitTurbo([{ engine: 'system-facts', powerProfile: null }], {
      trigger: 'health.interval'
    })).toThrow('requires a profile object');
    expect(() => runPowerProfileEnvironmentFitTurbo([], { trigger: 'health.interval', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
