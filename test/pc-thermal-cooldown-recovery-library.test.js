import { THERMAL_COOLDOWN_RECOVERY_LIBRARY_ID, THERMAL_COOLDOWN_RECOVERY_LIBRARY_VERSION,
  buildThermalCooldownRecoveryEnvelope, buildThermalCooldownRecoveryPlan, createThermalCooldownRecoveryLibrary,
  mergeThermalCooldownRecoveryReports } from '../pc/engines/thermal/turbos/cooldown-recovery/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'thermal.cooldown-recovery', state: 'stable-temperature', sampleCount, minimumSamples: 2, persistenceThreshold: 2,
    observedCount: sampleCount, unknownCount: 0, comparisonCount: Math.max(0, sampleCount - 1), changedCount: 0, recoveryCount: 0, reboundCount: 0,
    finalTemperatureCelsius: 55, finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('thermal cooldown-recovery library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeThermalCooldownRecoveryReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'cooldown-recovery-sustained', recoveryCount: 2, finalTemperatureCelsius: 70, finalEnvironment: 'headless' })]);
    expect(THERMAL_COOLDOWN_RECOVERY_LIBRARY_ID).toBe('thermal.cooldown-recovery.library'); expect(THERMAL_COOLDOWN_RECOVERY_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'cooldown-recovery-sustained', sampleCount: 6, observedCount: 6, unknownCount: 0, comparisonCount: 4, recoveryCount: 2, reboundCount: 0, finalTemperatureCelsius: 70, finalEnvironment: 'headless', recommendations: ['observe-cooldown-recovery'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeThermalCooldownRecoveryReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-cooldown-samples'] });
    expect(mergeThermalCooldownRecoveryReports([report({ state: 'thermal-rebound-sustained', reboundCount: 2 })]).recommendations).toEqual(['review-thermal-rebound-without-mutation']);
    expect(mergeThermalCooldownRecoveryReports([report({ state: 'cooldown-recovery-observed', recoveryCount: 1 })]).recommendations).toEqual(['observe-cooldown-stability']);
    expect(mergeThermalCooldownRecoveryReports([report({ state: 'thermal-rebound-observed', reboundCount: 1 })]).recommendations).toEqual(['observe-thermal-rebound-stability']);
    expect(mergeThermalCooldownRecoveryReports([report({ state: 'observation-required', observedCount: 3, unknownCount: 1, confidence: 0.75 })]).recommendations).toEqual(['request-complete-cooldown-observation']);
    expect(mergeThermalCooldownRecoveryReports([report({ state: 'recovery-unknown', sampleCount: 2, observedCount: 0, unknownCount: 2, confidence: 0, finalTemperatureCelsius: null })]).recommendations).toEqual(['request-cooldown-observation']);
    expect(mergeThermalCooldownRecoveryReports([report({ state: 'insufficient-data', sampleCount: 1, observedCount: 0, unknownCount: 1, comparisonCount: 0, confidence: 0, finalTemperatureCelsius: null })]).state).toBe('insufficient-data');
    expect(mergeThermalCooldownRecoveryReports([report()])).toMatchObject({ state: 'stable-temperature', recommendations: ['no-change'] });
    for (const [state, mode, intervalMs, sampleCount, confidence] of [['cooldown-recovery-sustained', 'cooldown-review', 1000, 4, 1], ['thermal-rebound-sustained', 'rebound-review', 750, 4, 1], ['cooldown-recovery-observed', 'cooldown-observation', 1500, 4, 1], ['thermal-rebound-observed', 'rebound-observation', 1500, 4, 1], ['observation-required', 'evidence-bootstrap', 2000, 4, 0.75], ['recovery-unknown', 'evidence-bootstrap', 2000, 4, 0], ['insufficient-data', 'evidence-bootstrap', 2000, 0, 0], ['stable-temperature', 'stable-observation', 5000, 4, 1]]) {
      expect(buildThermalCooldownRecoveryPlan(report({ state, sampleCount, observedCount: state === 'recovery-unknown' || state === 'insufficient-data' ? 0 : sampleCount, unknownCount: state === 'recovery-unknown' ? sampleCount : 0, confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildThermalCooldownRecoveryPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildThermalCooldownRecoveryPlan(report({ sampleCount: 0, observedCount: 0, unknownCount: 0, comparisonCount: 0, confidence: 0, finalTemperatureCelsius: null }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildThermalCooldownRecoveryEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createThermalCooldownRecoveryLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(THERMAL_COOLDOWN_RECOVERY_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeThermalCooldownRecoveryReports(null)).toThrow('reports must be an array');
    expect(() => mergeThermalCooldownRecoveryReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeThermalCooldownRecoveryReports([null])).toThrow('report must be an object');
    expect(() => mergeThermalCooldownRecoveryReports([report({ turbo: 'other' })])).toThrow('requires a cooldown-recovery turbo report');
    expect(() => mergeThermalCooldownRecoveryReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeThermalCooldownRecoveryReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeThermalCooldownRecoveryReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeThermalCooldownRecoveryReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeThermalCooldownRecoveryReports([report({ observedCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeThermalCooldownRecoveryReports([report({ finalTemperatureCelsius: 'bad' })])).toThrow('final temperature must be numeric or null');
    expect(() => mergeThermalCooldownRecoveryReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeThermalCooldownRecoveryReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildThermalCooldownRecoveryEnvelope(report())).toThrow('trigger is required');
    expect(() => buildThermalCooldownRecoveryEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
