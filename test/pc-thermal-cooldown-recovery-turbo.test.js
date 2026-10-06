import { THERMAL_COOLDOWN_RECOVERY_TRIGGERS, THERMAL_COOLDOWN_RECOVERY_TURBO_ID,
  THERMAL_COOLDOWN_RECOVERY_TURBO_VERSION, runThermalCooldownRecoveryTurbo } from '../pc/engines/thermal/turbos/cooldown-recovery/turbo.js';

function facts(temperature, overrides = {}) {
  return { engine: 'system-facts', environment: 'interactive', thermal: { temperatureCelsius: temperature, criticalCelsius: 100 }, ...overrides };
}
describe('thermal cooldown-recovery turbo', () => {
  test('publishes identity and detects sustained cooling recovery', () => {
    expect(THERMAL_COOLDOWN_RECOVERY_TURBO_ID).toBe('thermal.cooldown-recovery'); expect(THERMAL_COOLDOWN_RECOVERY_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(THERMAL_COOLDOWN_RECOVERY_TRIGGERS)).toBe(true);
    const result = runThermalCooldownRecoveryTurbo([facts(90), facts(80), facts(70)], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: THERMAL_COOLDOWN_RECOVERY_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      observedCount: 3, unknownCount: 0, comparisonCount: 2, changedCount: 2, recoveryCount: 2, reboundCount: 0,
      finalTemperatureCelsius: 70, finalEnvironment: 'interactive', state: 'cooldown-recovery-sustained', confidence: 1,
      recommendations: ['observe-cooldown-recovery'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes recovery, rebound, stable, and evidence states', () => {
    expect(runThermalCooldownRecoveryTurbo([facts(70), facts(70)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stable-temperature' });
    expect(runThermalCooldownRecoveryTurbo([facts(70), facts(65)], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'cooldown-recovery-observed', recoveryCount: 1 });
    expect(runThermalCooldownRecoveryTurbo([facts(50), facts(60), facts(70)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'thermal-rebound-sustained', reboundCount: 2 });
    expect(runThermalCooldownRecoveryTurbo([facts(50), facts(60)], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'thermal-rebound-observed', reboundCount: 1 });
    expect(runThermalCooldownRecoveryTurbo([facts(50), facts(undefined)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'observation-required', unknownCount: 1 });
    expect(runThermalCooldownRecoveryTurbo([facts(undefined), facts(null)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'recovery-unknown', observedCount: 0, confidence: 0 });
    expect(runThermalCooldownRecoveryTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, finalTemperatureCelsius: null, confidence: 0 });
  });
  test('normalizes temperature and environment evidence', () => {
    expect(runThermalCooldownRecoveryTurbo([facts(120, { environment: 'other' })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalTemperatureCelsius: 120, finalEnvironment: 'unknown', state: 'stable-temperature', confidence: 1 });
    expect(runThermalCooldownRecoveryTurbo([facts(-10)], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalTemperatureCelsius: null, state: 'recovery-unknown' });
  });
  test('rejects invalid triggers, bounds, snapshots, and clocks', () => {
    expect(() => runThermalCooldownRecoveryTurbo([], { trigger: 'bad' })).toThrow('Unsupported thermal cooldown-recovery trigger: bad');
    expect(() => runThermalCooldownRecoveryTurbo()).toThrow('Unsupported thermal cooldown-recovery trigger: unknown');
    expect(() => runThermalCooldownRecoveryTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runThermalCooldownRecoveryTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runThermalCooldownRecoveryTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runThermalCooldownRecoveryTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runThermalCooldownRecoveryTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runThermalCooldownRecoveryTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runThermalCooldownRecoveryTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runThermalCooldownRecoveryTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runThermalCooldownRecoveryTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runThermalCooldownRecoveryTurbo([{ engine: 'system-facts', thermal: null }], { trigger: 'health.interval' })).toThrow('requires a thermal object');
    expect(() => runThermalCooldownRecoveryTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
