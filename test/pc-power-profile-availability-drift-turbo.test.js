import {
  POWER_PROFILE_AVAILABILITY_TRIGGERS,
  POWER_PROFILE_AVAILABILITY_TURBO_ID,
  POWER_PROFILE_AVAILABILITY_TURBO_VERSION,
  runPowerProfileAvailabilityDriftTurbo
} from '../pc/engines/power-profile/turbos/availability-drift/turbo.js';

function facts(active = null, available = ['balanced']) {
  return {
    engine: 'system-facts',
    environment: 'headless',
    powerProfile: { active, available }
  };
}

describe('power-profile availability-drift turbo', () => {
  test('publishes identity and detects sustained availability drift', () => {
    expect(POWER_PROFILE_AVAILABILITY_TURBO_ID).toBe('power-profile.availability-drift');
    expect(POWER_PROFILE_AVAILABILITY_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(POWER_PROFILE_AVAILABILITY_TRIGGERS)).toBe(true);
    const result = runPowerProfileAvailabilityDriftTurbo([
      facts(null, ['balanced']), facts(null, ['balanced', 'performance']), facts(null, ['performance'])
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({
      turbo: POWER_PROFILE_AVAILABILITY_TURBO_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      sampleCount: 3,
      observedCount: 3,
      unknownCount: 0,
      comparisonCount: 2,
      availabilityChangeCount: 2,
      addedCount: 1,
      removedCount: 1,
      missingActiveCount: 0,
      finalAvailable: ['performance'],
      state: 'availability-drift-sustained',
      confidence: 1,
      recommendations: ['review-profile-availability-drift'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes stable, observed, missing-active, empty, and insufficient states', () => {
    expect(runPowerProfileAvailabilityDriftTurbo([facts(null), facts(null)], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'stable-availability', availabilityChangeCount: 0 });
    expect(runPowerProfileAvailabilityDriftTurbo([
      facts(null, ['balanced']), facts(null, ['balanced', 'powersave'])
    ], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 }))
      .toMatchObject({ state: 'availability-drift-observed', availabilityChangeCount: 1 });
    expect(runPowerProfileAvailabilityDriftTurbo([facts('performance', ['balanced'])], {
      trigger: 'health.interval', minimumSamples: 1, now: () => 0
    })).toMatchObject({ state: 'active-not-advertised', missingActiveCount: 1 });
    expect(runPowerProfileAvailabilityDriftTurbo([facts(null, []), facts(null, [])], {
      trigger: 'health.interval', now: () => 0
    })).toMatchObject({ state: 'no-availability', observedCount: 0, unknownCount: 2, confidence: 0 });
    expect(runPowerProfileAvailabilityDriftTurbo([], { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0, finalAvailable: [] });
  });

  test('normalizes duplicate labels and non-array availability', () => {
    expect(runPowerProfileAvailabilityDriftTurbo([facts(' BALANCED ', [null, '', ' BALANCED ', 'balanced'])], {
      trigger: 'workload.changed', minimumSamples: 1, now: () => 0
    })).toMatchObject({ observedCount: 1, state: 'stable-availability', finalAvailable: ['balanced'] });
    expect(runPowerProfileAvailabilityDriftTurbo([facts(null, 'balanced')], {
      trigger: 'workload.changed', minimumSamples: 1, now: () => 0
    })).toMatchObject({ observedCount: 0, state: 'no-availability' });
  });

  test('rejects invalid triggers, bounds, snapshots, and clocks', () => {
    expect(() => runPowerProfileAvailabilityDriftTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported power-profile availability-drift trigger: bad');
    expect(() => runPowerProfileAvailabilityDriftTurbo()).toThrow('Unsupported power-profile availability-drift trigger: unknown');
    expect(() => runPowerProfileAvailabilityDriftTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runPowerProfileAvailabilityDriftTurbo([], { trigger: 'health.interval', windowSize: 1 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runPowerProfileAvailabilityDriftTurbo([], { trigger: 'health.interval', windowSize: 65 }))
      .toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runPowerProfileAvailabilityDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runPowerProfileAvailabilityDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 }))
      .toThrow('minimumSamples must fit inside the window');
    expect(() => runPowerProfileAvailabilityDriftTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 }))
      .toThrow('persistenceThreshold must be an integer from 1 to 4');
    expect(() => runPowerProfileAvailabilityDriftTurbo([], { trigger: 'health.interval', windowSize: 4, missingActiveThreshold: 5 }))
      .toThrow('missingActiveThreshold must be an integer from 1 to 4');
    expect(() => runPowerProfileAvailabilityDriftTurbo([null], { trigger: 'health.interval' }))
      .toThrow('snapshot must be an object');
    expect(() => runPowerProfileAvailabilityDriftTurbo([{ engine: 'other' }], { trigger: 'health.interval' }))
      .toThrow('requires a system-facts snapshot');
    expect(() => runPowerProfileAvailabilityDriftTurbo([{ engine: 'system-facts', powerProfile: null }], {
      trigger: 'health.interval'
    })).toThrow('requires a profile object');
    expect(() => runPowerProfileAvailabilityDriftTurbo([], { trigger: 'health.interval', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
