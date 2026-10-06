import { SHADER_REBUILD_EVIDENCE_TRIGGERS, SHADER_REBUILD_EVIDENCE_TURBO_ID,
  SHADER_REBUILD_EVIDENCE_TURBO_VERSION, runShaderRebuildEvidenceTurbo } from '../pc/engines/shader-cache/turbos/rebuild-evidence/turbo.js';

function facts(valid, rebuildDocumented, overrides = {}) {
  return { engine: 'system-facts', environment: 'interactive', shaderCaches: [{ valid, rebuildDocumented }], ...overrides };
}
describe('shader-cache rebuild-evidence turbo', () => {
  test('publishes identity and detects sustained evidence drift', () => {
    expect(SHADER_REBUILD_EVIDENCE_TURBO_ID).toBe('shader-cache.rebuild-evidence'); expect(SHADER_REBUILD_EVIDENCE_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(SHADER_REBUILD_EVIDENCE_TRIGGERS)).toBe(true);
    const result = runShaderRebuildEvidenceTurbo([facts(false, false), facts(false, true), facts(false, false)], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: SHADER_REBUILD_EVIDENCE_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      cacheCount: 1, staleCount: 1, documentedCount: 0, undocumentedCount: 1, unknownEvidenceCount: 0, comparisonCount: 2, changeCount: 2,
      finalEnvironment: 'interactive', state: 'rebuild-evidence-drift-sustained', confidence: 1, recommendations: ['review-rebuild-evidence-drift-without-mutation'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes evidence states and empty evidence', () => {
    expect(runShaderRebuildEvidenceTurbo([facts(true, false), facts(true, false)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-stale-caches' });
    expect(runShaderRebuildEvidenceTurbo([facts(false, false)], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'rebuild-evidence-required', undocumentedCount: 1 });
    expect(runShaderRebuildEvidenceTurbo([facts(false, true)], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'rebuild-evidence-observed', documentedCount: 1 });
    expect(runShaderRebuildEvidenceTurbo([facts(false, false), facts(false, true)], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'rebuild-evidence-drift-observed', changeCount: 1 });
    expect(runShaderRebuildEvidenceTurbo([facts(undefined, undefined)], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'observation-required', unknownEvidenceCount: 1 });
    expect(runShaderRebuildEvidenceTurbo([facts(true, false, { shaderCaches: [] }), facts(true, false, { shaderCaches: [] })], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-caches', cacheCount: 0, confidence: 0.5 });
    expect(runShaderRebuildEvidenceTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });
  test('normalizes rows and environments', () => {
    expect(runShaderRebuildEvidenceTurbo([facts(false, true, { environment: 'other', shaderCaches: [null, { valid: false, rebuildDocumented: true }] })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalEnvironment: 'unknown', cacheCount: 1, staleCount: 1, documentedCount: 1, state: 'rebuild-evidence-observed', confidence: 1 });
  });
  test('rejects invalid triggers, bounds, snapshots, lists, and clocks', () => {
    expect(() => runShaderRebuildEvidenceTurbo([], { trigger: 'bad' })).toThrow('Unsupported shader-cache rebuild-evidence trigger: bad');
    expect(() => runShaderRebuildEvidenceTurbo()).toThrow('Unsupported shader-cache rebuild-evidence trigger: unknown');
    expect(() => runShaderRebuildEvidenceTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runShaderRebuildEvidenceTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runShaderRebuildEvidenceTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runShaderRebuildEvidenceTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runShaderRebuildEvidenceTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runShaderRebuildEvidenceTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runShaderRebuildEvidenceTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runShaderRebuildEvidenceTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runShaderRebuildEvidenceTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runShaderRebuildEvidenceTurbo([{ engine: 'system-facts', shaderCaches: null }], { trigger: 'health.interval' })).toThrow('requires a shader-cache list');
    expect(() => runShaderRebuildEvidenceTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
