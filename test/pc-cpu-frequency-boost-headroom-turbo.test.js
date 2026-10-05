import {
  CPU_FREQUENCY_HEADROOM_TRIGGERS,
  CPU_FREQUENCY_HEADROOM_TURBO_ID,
  CPU_FREQUENCY_HEADROOM_TURBO_VERSION,
  runCpuFrequencyBoostHeadroomTurbo
} from '../pc/engines/cpu-frequency/turbos/boost-headroom/turbo.js';

function snapshot(requestedFrequencyMHz, observedFrequencyMHz, utilizationPercent = 50,
  temperatureC = 50, maxFrequencyMHz = 5000, baseFrequencyMHz = 2500, overrides = {}) {
  return {
    engine: 'system-facts',
    cpu: {
      requestedFrequencyMHz,
      observedFrequencyMHz,
      utilizationPercent,
      temperatureC,
      maxFrequencyMHz,
      baseFrequencyMHz
    },
    ...overrides
  };
}

describe('CPU-frequency boost-headroom turbo', () => {
  test('publishes immutable identity and supported triggers', () => {
    expect(CPU_FREQUENCY_HEADROOM_TURBO_ID).toBe('cpu-frequency.boost-headroom');
    expect(CPU_FREQUENCY_HEADROOM_TURBO_VERSION).toBe(1);
    expect(CPU_FREQUENCY_HEADROOM_TRIGGERS).toEqual([
      'system.facts.request', 'workload.changed', 'health.interval'
    ]);
    expect(Object.isFrozen(CPU_FREQUENCY_HEADROOM_TRIGGERS)).toBe(true);
  });

  test('classifies satisfied, variable, under-load shortfall, and thermal limits', () => {
    const satisfied = runCpuFrequencyBoostHeadroomTurbo([
      snapshot(2500, 2500), snapshot(3000, 3200)
    ], { trigger: 'system.facts.request', now: () => 0 });
    expect(satisfied).toMatchObject({ sampleCount: 2, observedCount: 2,
      unknownCount: 0, invalidCount: 0, thermalCount: 0, shortfallCount: 0,
      satisfiedCount: 2, averageHeadroom: 0, state: 'request-satisfied',
      confidence: 1, recommendations: ['no-change'], actions: [] });

    const variable = runCpuFrequencyBoostHeadroomTurbo([
      snapshot(3000, 2600, 40, 50), snapshot(3000, 2900, 40, 50)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(variable).toMatchObject({ shortfallCount: 1, satisfiedCount: 0,
      averageHeadroom: 0.0833, state: 'variable-headroom',
      recommendations: ['observe-requested-frequency-stability'] });

    const underLoad = runCpuFrequencyBoostHeadroomTurbo([
      snapshot(3000, 2600, 90, 50), snapshot(3200, 2700, 95, 50)
    ], { trigger: 'workload.changed', now: () => 0 });
    expect(underLoad).toMatchObject({ shortfallCount: 2, shortfallUnderLoadCount: 2,
      thermalShortfallCount: 0, state: 'boost-shortfall-under-load',
      recommendations: ['review-documented-boost-control'] });

    const thermal = runCpuFrequencyBoostHeadroomTurbo([
      snapshot(3000, 2600, 90, 90), snapshot(3200, 2700, 95, 100)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(thermal).toMatchObject({ thermalCount: 2, thermalShortfallCount: 2,
      shortfallUnderLoadCount: 2, state: 'thermal-limited',
      recommendations: ['review-thermal-limits-before-frequency-control'] });
    expect(Object.isFrozen(satisfied)).toBe(true);
    expect(Object.isFrozen(satisfied.actions)).toBe(true);
  });

  test('handles sparse evidence, clamping, and conservative sensor states', () => {
    const empty = runCpuFrequencyBoostHeadroomTurbo([], {
      trigger: 'health.interval', now: () => 0
    });
    expect(empty).toMatchObject({ sampleCount: 0, observedCount: 0, unknownCount: 0,
      invalidCount: 0, averageHeadroom: null, state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-frequency-samples'] });

    const insufficient = runCpuFrequencyBoostHeadroomTurbo([snapshot(3000, 2900)], {
      trigger: 'health.interval', now: () => 0
    });
    expect(insufficient).toMatchObject({ sampleCount: 1, state: 'insufficient-data', confidence: 0.5 });

    const bounded = runCpuFrequencyBoostHeadroomTurbo([
      snapshot(3000, 2600, 90), snapshot(3000, 3000), snapshot(3000, 3000)
    ], { trigger: 'health.interval', windowSize: 2, minimumSamples: 2, now: () => 0 });
    expect(bounded).toMatchObject({ sampleCount: 2, observedCount: 2, shortfallCount: 0 });

    const unknown = runCpuFrequencyBoostHeadroomTurbo([
      snapshot(null, null, null, NaN, null, null), snapshot(0, -1, 'bad', 200)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(unknown).toMatchObject({ observedCount: 0, unknownCount: 2, invalidCount: 0,
      averageHeadroom: null, state: 'no-observation', confidence: 0,
      recommendations: ['request-boost-headroom-observation'] });

    const normalized = runCpuFrequencyBoostHeadroomTurbo([
      snapshot(3000, 3400, 120, -120, null, null),
      snapshot(3000, 1000, -10, 151, null, null)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(normalized).toMatchObject({ observedCount: 2, thermalCount: 0,
      shortfallCount: 1, averageHeadroom: 0.3334 });

    const finalState = runCpuFrequencyBoostHeadroomTurbo([
      snapshot(3000, 2900, 50, 50, null, null),
      snapshot(3000, 2950, 50, 50, null, null)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(finalState).toMatchObject({ observedCount: 2, satisfiedCount: 0,
      shortfallCount: 0, state: 'request-satisfied' });
  });

  test('rejects out-of-range frequency evidence before recommendations', () => {
    const invalid = runCpuFrequencyBoostHeadroomTurbo([
      snapshot(5200, 3000, 50, 50, 5000, 2500),
      snapshot(3000, 2500, 50, 50, 2000, 2500),
      snapshot(3000, 2500, 50, 50, 5000, 3000)
    ], { trigger: 'health.interval', now: () => 0 });
    expect(invalid).toMatchObject({ observedCount: 1, unknownCount: 0, invalidCount: 2,
      state: 'invalid-frequency-evidence', recommendations: ['review-frequency-sensor-range'] });
  });

  test('rejects malformed inputs, limits, thresholds, snapshots, and clocks', () => {
    expect(() => runCpuFrequencyBoostHeadroomTurbo(null, { trigger: 'health.interval' }))
      .toThrow('samples must be an array');
    expect(() => runCpuFrequencyBoostHeadroomTurbo([], { trigger: 'bad' }))
      .toThrow('Unsupported CPU-frequency boost-headroom trigger: bad');
    expect(() => runCpuFrequencyBoostHeadroomTurbo()).toThrow(
      'Unsupported CPU-frequency boost-headroom trigger: unknown'
    );
    expect(() => runCpuFrequencyBoostHeadroomTurbo([], {
      trigger: 'health.interval', windowSize: 1
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuFrequencyBoostHeadroomTurbo([], {
      trigger: 'health.interval', windowSize: 65
    })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runCpuFrequencyBoostHeadroomTurbo([], {
      trigger: 'health.interval', windowSize: 2, minimumSamples: 3
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runCpuFrequencyBoostHeadroomTurbo([], {
      trigger: 'health.interval', minimumSamples: 0
    })).toThrow('minimumSamples must fit inside the window');
    expect(() => runCpuFrequencyBoostHeadroomTurbo([], {
      trigger: 'health.interval', headroomThreshold: -0.1
    })).toThrow('headroomThreshold must be between 0 and 1');
    expect(() => runCpuFrequencyBoostHeadroomTurbo([], {
      trigger: 'health.interval', headroomThreshold: 1.1
    })).toThrow('headroomThreshold must be between 0 and 1');
    expect(() => runCpuFrequencyBoostHeadroomTurbo([], {
      trigger: 'health.interval', highUtilizationThreshold: -1
    })).toThrow('highUtilizationThreshold must be between 0 and 100');
    expect(() => runCpuFrequencyBoostHeadroomTurbo([], {
      trigger: 'health.interval', highUtilizationThreshold: 101
    })).toThrow('highUtilizationThreshold must be between 0 and 100');
    expect(() => runCpuFrequencyBoostHeadroomTurbo([], {
      trigger: 'health.interval', thermalTemperatureThreshold: -101
    })).toThrow('thermalTemperatureThreshold must be between -100 and 150');
    expect(() => runCpuFrequencyBoostHeadroomTurbo([], {
      trigger: 'health.interval', thermalTemperatureThreshold: 151
    })).toThrow('thermalTemperatureThreshold must be between -100 and 150');
    for (const option of ['thermalCountThreshold', 'shortfallCountThreshold']) {
      expect(() => runCpuFrequencyBoostHeadroomTurbo([], {
        trigger: 'health.interval', [option]: 0
      })).toThrow(`${option} must be an integer from 1 to 64`);
      expect(() => runCpuFrequencyBoostHeadroomTurbo([], {
        trigger: 'health.interval', [option]: 65
      })).toThrow(`${option} must be an integer from 1 to 64`);
    }
    expect(() => runCpuFrequencyBoostHeadroomTurbo([], {
      trigger: 'health.interval', now: () => NaN
    })).toThrow('clock must return a number');
    expect(() => runCpuFrequencyBoostHeadroomTurbo([null, null], {
      trigger: 'health.interval'
    })).toThrow('snapshot must be an object');
    expect(() => runCpuFrequencyBoostHeadroomTurbo([
      { engine: 'other' }, snapshot(3000, 3000)
    ], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runCpuFrequencyBoostHeadroomTurbo([
      snapshot(3000, 3000, 50, 50, 5000, 2500, { cpu: null }), snapshot(3000, 3000)
    ], { trigger: 'health.interval' })).toThrow('requires a CPU section');
  });
});
