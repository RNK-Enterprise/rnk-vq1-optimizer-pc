import { BATTERY_HEALTH_BOUNDARY_TRIGGERS, BATTERY_HEALTH_BOUNDARY_TURBO_ID,
  BATTERY_HEALTH_BOUNDARY_TURBO_VERSION, runBatteryHealthBoundaryTurbo } from '../pc/engines/battery/turbos/health-boundary/turbo.js';

function facts(health, present = true, overrides = {}) {
  return { engine: 'system-facts', environment: 'interactive', battery: { health, present }, ...overrides };
}
describe('battery health-boundary turbo', () => {
  test('publishes identity and protects explicit failed health', () => {
    expect(BATTERY_HEALTH_BOUNDARY_TURBO_ID).toBe('battery.health-boundary');
    expect(BATTERY_HEALTH_BOUNDARY_TURBO_VERSION).toBe(1); expect(Object.isFrozen(BATTERY_HEALTH_BOUNDARY_TRIGGERS)).toBe(true);
    const result = runBatteryHealthBoundaryTurbo([facts('healthy'), facts('degraded'), facts('failed')], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: BATTERY_HEALTH_BOUNDARY_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      observedCount: 3, unknownCount: 0, comparisonCount: 2, changedCount: 2, degradationCount: 2, finalHealth: 'failed',
      finalPresent: true, finalEnvironment: 'interactive', state: 'protect-health', confidence: 1,
      recommendations: ['protect-power', 'request-user-approved-battery-review'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes health states and degradation movement', () => {
    expect(runBatteryHealthBoundaryTurbo([facts('healthy'), facts('healthy')], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stable-health' });
    expect(runBatteryHealthBoundaryTurbo([facts('healthy'), facts('degraded'), facts('healthy')], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'health-drift-observed', changedCount: 2, degradationCount: 1 });
    expect(runBatteryHealthBoundaryTurbo([facts('healthy'), facts('degraded'), facts('failed')], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'protect-health' });
    expect(runBatteryHealthBoundaryTurbo([facts('healthy'), facts('degraded'), facts('failed'), facts('degraded')], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'health-degradation-sustained', degradationCount: 2 });
    expect(runBatteryHealthBoundaryTurbo([facts('unknown', false), facts('healthy', false)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-battery', finalPresent: false });
    expect(runBatteryHealthBoundaryTurbo([facts(undefined), facts(null)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'health-unknown', observedCount: 0, confidence: 0 });
    expect(runBatteryHealthBoundaryTurbo([facts('healthy'), facts(undefined)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'observation-required', unknownCount: 1 });
    expect(runBatteryHealthBoundaryTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });
  test('normalizes health and environment evidence', () => {
    expect(runBatteryHealthBoundaryTurbo([facts(' HEALTHY ', true, { environment: 'other' })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalHealth: 'healthy', finalEnvironment: 'unknown', state: 'stable-health', confidence: 1 });
    expect(runBatteryHealthBoundaryTurbo([facts('vendor-health', 'yes')], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalHealth: 'unknown', finalPresent: null, state: 'health-unknown' });
  });
  test('rejects invalid triggers, bounds, snapshots, and clocks', () => {
    expect(() => runBatteryHealthBoundaryTurbo([], { trigger: 'bad' })).toThrow('Unsupported battery health-boundary trigger: bad');
    expect(() => runBatteryHealthBoundaryTurbo()).toThrow('Unsupported battery health-boundary trigger: unknown');
    expect(() => runBatteryHealthBoundaryTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runBatteryHealthBoundaryTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runBatteryHealthBoundaryTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runBatteryHealthBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runBatteryHealthBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runBatteryHealthBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runBatteryHealthBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runBatteryHealthBoundaryTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runBatteryHealthBoundaryTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runBatteryHealthBoundaryTurbo([{ engine: 'system-facts', battery: null }], { trigger: 'health.interval' })).toThrow('requires a battery object');
    expect(() => runBatteryHealthBoundaryTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
