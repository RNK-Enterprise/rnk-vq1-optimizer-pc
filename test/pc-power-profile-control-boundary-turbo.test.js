import {
  POWER_PROFILE_CONTROL_TRIGGERS,
  POWER_PROFILE_CONTROL_TURBO_ID,
  POWER_PROFILE_CONTROL_TURBO_VERSION,
  runPowerProfileControlBoundaryTurbo
} from '../pc/engines/power-profile/turbos/control-boundary/turbo.js';

function facts(control = true, overrides = {}) {
  return {
    engine: 'system-facts',
    powerProfile: { active: 'balanced' },
    capabilities: { powerProfileControl: control },
    ...overrides
  };
}

describe('power-profile control-boundary turbo', () => {
  test('publishes identity and detects sustained capability drift', () => {
    expect(POWER_PROFILE_CONTROL_TURBO_ID).toBe('power-profile.control-boundary');
    expect(POWER_PROFILE_CONTROL_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(POWER_PROFILE_CONTROL_TRIGGERS)).toBe(true);
    const result = runPowerProfileControlBoundaryTurbo([
      facts(true), facts(false), facts(true)
    ], { trigger: 'install.preflight', now: () => 0 });
    expect(result).toMatchObject({
      turbo: POWER_PROFILE_CONTROL_TURBO_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      sampleCount: 3,
      observedCount: 3,
      unknownCount: 0,
      enabledCount: 2,
      disabledCount: 1,
      comparisonCount: 2,
      controlChangeCount: 2,
      enabledToDisabledCount: 1,
      disabledToEnabledCount: 1,
      finalControl: 'enabled',
      state: 'control-drift-sustained',
      confidence: 1,
      recommendations: ['review-power-profile-capability-drift'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes stable, observed, disabled, unknown, and insufficient states', () => {
    expect(runPowerProfileControlBoundaryTurbo([facts(true), facts(true)], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'stable-control', controlChangeCount: 0 });
    expect(runPowerProfileControlBoundaryTurbo([facts(true), facts(false)], {
      trigger: 'system.facts.request', persistenceThreshold: 2, now: () => 0
    })).toMatchObject({ state: 'control-drift-observed', disabledCount: 1, controlChangeCount: 1,
      recommendations: ['observe-power-profile-capability-stability'] });
    expect(runPowerProfileControlBoundaryTurbo([facts(false), facts(false)], {
      trigger: 'system.facts.request', persistenceThreshold: 2, now: () => 0
    })).toMatchObject({ recommendations: ['preserve-disabled-power-profile-control'] });
    expect(runPowerProfileControlBoundaryTurbo([
      facts(undefined, { capabilities: undefined }), facts(undefined, { capabilities: null })
    ], { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ state: 'capability-unknown', observedCount: 0, unknownCount: 2, confidence: 0 });
    expect(runPowerProfileControlBoundaryTurbo([], { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0, finalControl: 'unknown' });
  });

  test('preserves explicit boolean boundaries and active-profile evidence', () => {
    expect(runPowerProfileControlBoundaryTurbo([facts('yes', {
      powerProfile: { active: '' }
    })], { trigger: 'system.facts.request', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ state: 'capability-unknown', observedCount: 0, finalControl: 'unknown' });
    expect(runPowerProfileControlBoundaryTurbo([facts(false, {
      powerProfile: { active: null }
    })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ state: 'control-disabled', disabledCount: 1, finalControl: 'disabled' });
  });

  test('rejects invalid triggers, bounds, snapshots, and clocks', () => {
    expect(() => runPowerProfileControlBoundaryTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported power-profile control-boundary trigger: bad');
    expect(() => runPowerProfileControlBoundaryTurbo()).toThrow('Unsupported power-profile control-boundary trigger: unknown');
    expect(() => runPowerProfileControlBoundaryTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runPowerProfileControlBoundaryTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runPowerProfileControlBoundaryTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runPowerProfileControlBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runPowerProfileControlBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runPowerProfileControlBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 }))
      .toThrow('persistenceThreshold must be an integer from 1 to 4');
    expect(() => runPowerProfileControlBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 }))
      .toThrow('persistenceThreshold must be an integer from 1 to 4');
    expect(() => runPowerProfileControlBoundaryTurbo([null], { trigger: 'health.interval' }))
      .toThrow('snapshot must be an object');
    expect(() => runPowerProfileControlBoundaryTurbo([{ engine: 'other' }], { trigger: 'health.interval' }))
      .toThrow('requires a system-facts snapshot');
    expect(() => runPowerProfileControlBoundaryTurbo([{ engine: 'system-facts', powerProfile: null }], {
      trigger: 'health.interval'
    })).toThrow('requires a profile object');
    expect(() => runPowerProfileControlBoundaryTurbo([], { trigger: 'health.interval', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
