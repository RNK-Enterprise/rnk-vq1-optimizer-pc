import { SHADER_VALIDITY_DRIFT_TRIGGERS, SHADER_VALIDITY_DRIFT_TURBO_ID,
  SHADER_VALIDITY_DRIFT_TURBO_VERSION, runShaderValidityDriftTurbo } from '../pc/engines/shader-cache/turbos/validity-drift/turbo.js';

function facts(valid, overrides = {}) {
  return { engine: 'system-facts', environment: 'interactive', shaderCaches: [{ name: 'gpu', valid }], ...overrides };
}
describe('shader-cache validity-drift turbo', () => {
  test('publishes identity and detects sustained validity drift', () => {
    expect(SHADER_VALIDITY_DRIFT_TURBO_ID).toBe('shader-cache.validity-drift'); expect(SHADER_VALIDITY_DRIFT_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(SHADER_VALIDITY_DRIFT_TRIGGERS)).toBe(true);
    const result = runShaderValidityDriftTurbo([facts(true), facts(false), facts(true)], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: SHADER_VALIDITY_DRIFT_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      cacheCount: 1, validCount: 1, staleCount: 0, unknownCount: 0, comparisonCount: 2, changeCount: 2,
      finalEnvironment: 'interactive', state: 'validity-drift-sustained', confidence: 1, recommendations: ['review-validity-drift-without-cache-mutation'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes validity states and empty evidence', () => {
    expect(runShaderValidityDriftTurbo([facts(true), facts(true)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stable-validity' });
    expect(runShaderValidityDriftTurbo([facts(true), facts(false)], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'validity-drift-observed', changeCount: 1 });
    expect(runShaderValidityDriftTurbo([facts(false), facts(false)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stale-review', staleCount: 1 });
    expect(runShaderValidityDriftTurbo([facts(undefined)], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'observation-required', unknownCount: 1 });
    expect(runShaderValidityDriftTurbo([facts(true, { shaderCaches: [] }), facts(true, { shaderCaches: [] })], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-caches', cacheCount: 0, confidence: 0.5 });
    expect(runShaderValidityDriftTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });
  test('normalizes rows and environments', () => {
    expect(runShaderValidityDriftTurbo([facts(true, { environment: 'other', shaderCaches: [null, { valid: true }] })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalEnvironment: 'unknown', cacheCount: 1, validCount: 1, state: 'stable-validity', confidence: 1 });
  });
  test('rejects invalid triggers, bounds, snapshots, lists, and clocks', () => {
    expect(() => runShaderValidityDriftTurbo([], { trigger: 'bad' })).toThrow('Unsupported shader-cache validity-drift trigger: bad');
    expect(() => runShaderValidityDriftTurbo()).toThrow('Unsupported shader-cache validity-drift trigger: unknown');
    expect(() => runShaderValidityDriftTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runShaderValidityDriftTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runShaderValidityDriftTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runShaderValidityDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runShaderValidityDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runShaderValidityDriftTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runShaderValidityDriftTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runShaderValidityDriftTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runShaderValidityDriftTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runShaderValidityDriftTurbo([{ engine: 'system-facts', shaderCaches: null }], { trigger: 'health.interval' })).toThrow('requires a shader-cache list');
    expect(() => runShaderValidityDriftTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
