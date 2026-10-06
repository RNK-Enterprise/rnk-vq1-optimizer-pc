import { SHADER_OWNERSHIP_BOUNDARY_TRIGGERS, SHADER_OWNERSHIP_BOUNDARY_TURBO_ID,
  SHADER_OWNERSHIP_BOUNDARY_TURBO_VERSION, runShaderOwnershipBoundaryTurbo } from '../pc/engines/shader-cache/turbos/ownership-boundary/turbo.js';

function facts(systemOwned, userOwned = false, overrides = {}) {
  return { engine: 'system-facts', environment: 'interactive', shaderCaches: [{ systemOwned, userOwned }], ...overrides };
}
describe('shader-cache ownership-boundary turbo', () => {
  test('publishes identity and detects sustained ownership drift', () => {
    expect(SHADER_OWNERSHIP_BOUNDARY_TURBO_ID).toBe('shader-cache.ownership-boundary'); expect(SHADER_OWNERSHIP_BOUNDARY_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(SHADER_OWNERSHIP_BOUNDARY_TRIGGERS)).toBe(true);
    const result = runShaderOwnershipBoundaryTurbo([facts(true), facts(false, true), facts(true)], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: SHADER_OWNERSHIP_BOUNDARY_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      cacheCount: 1, systemOwnedCount: 1, userOwnedCount: 0, unknownOwnershipCount: 0, comparisonCount: 2, changeCount: 2,
      finalEnvironment: 'interactive', state: 'ownership-drift-sustained', confidence: 1, recommendations: ['review-cache-ownership-drift-without-mutation'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes ownership states and empty evidence', () => {
    expect(runShaderOwnershipBoundaryTurbo([facts(true), facts(true)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stable-ownership' });
    expect(runShaderOwnershipBoundaryTurbo([facts(true), facts(false, true)], { trigger: 'workload.changed', now: () => 0 })).toMatchObject({ state: 'user-owned-review', userOwnedCount: 1 });
    expect(runShaderOwnershipBoundaryTurbo([facts(false, true), facts(true)], { trigger: 'workload.changed', now: () => 0 })).toMatchObject({ state: 'ownership-drift-observed', changeCount: 1 });
    expect(runShaderOwnershipBoundaryTurbo([facts(false), facts(false)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'ownership-required', unknownOwnershipCount: 1 });
    expect(runShaderOwnershipBoundaryTurbo([facts(true, false, { shaderCaches: [] }), facts(true, false, { shaderCaches: [] })], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-caches', cacheCount: 0, confidence: 0.5 });
    expect(runShaderOwnershipBoundaryTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });
  test('normalizes rows and environments', () => {
    expect(runShaderOwnershipBoundaryTurbo([facts(true, false, { environment: 'other', shaderCaches: [null, { systemOwned: true }] })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalEnvironment: 'unknown', cacheCount: 1, systemOwnedCount: 1, state: 'stable-ownership', confidence: 1 });
  });
  test('rejects invalid triggers, bounds, snapshots, lists, and clocks', () => {
    expect(() => runShaderOwnershipBoundaryTurbo([], { trigger: 'bad' })).toThrow('Unsupported shader-cache ownership-boundary trigger: bad');
    expect(() => runShaderOwnershipBoundaryTurbo()).toThrow('Unsupported shader-cache ownership-boundary trigger: unknown');
    expect(() => runShaderOwnershipBoundaryTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runShaderOwnershipBoundaryTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runShaderOwnershipBoundaryTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runShaderOwnershipBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runShaderOwnershipBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runShaderOwnershipBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runShaderOwnershipBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runShaderOwnershipBoundaryTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runShaderOwnershipBoundaryTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runShaderOwnershipBoundaryTurbo([{ engine: 'system-facts', shaderCaches: null }], { trigger: 'health.interval' })).toThrow('requires a shader-cache list');
    expect(() => runShaderOwnershipBoundaryTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
