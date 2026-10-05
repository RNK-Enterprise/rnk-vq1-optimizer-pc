import {
  SHADER_CACHE_ENGINE_ID,
  SHADER_CACHE_ENGINE_VERSION,
  SHADER_CACHE_TRIGGERS,
  runShaderCacheEngine
} from '../pc/engines/shader-cache/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    shaderCaches: [
      { name: 'nvidia-shader', sizeBytes: 100, valid: true, systemOwned: true },
      { name: 'app-shader', sizeBytes: 200, valid: true, systemOwned: false }
    ],
    ...overrides
  };
}

describe('Shader-cache engine', () => {
  test('publishes identity and triggers', () => {
    expect(SHADER_CACHE_ENGINE_ID).toBe('shader-cache');
    expect(SHADER_CACHE_ENGINE_VERSION).toBe(1);
    expect(SHADER_CACHE_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(SHADER_CACHE_TRIGGERS)).toBe(true);
  });

  test('reports valid shader caches without changes', () => {
    const result = runShaderCacheEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: SHADER_CACHE_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      shaderCacheCount: 2,
      names: ['nvidia-shader', 'app-shader'],
      validCount: 2,
      staleCount: 0,
      unknownCount: 0,
      systemOwnedCount: 1,
      totalBytes: 300,
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('flags stale caches for a documented rebuild review', () => {
    expect(runShaderCacheEngine(facts({ shaderCaches: [
      { name: 'shader', sizeBytes: 100, valid: false, systemOwned: true }
    ] }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      validCount: 0,
      staleCount: 1,
      state: 'rebuild-review',
      recommendations: ['review-driver-documented-rebuild-path']
    });
  });

  test('reports unknown, empty, and malformed shader-cache facts', () => {
    expect(runShaderCacheEngine(facts({ shaderCaches: [{}] }), {
      trigger: 'health.interval',
      now: () => 0
    })).toMatchObject({
      shaderCacheCount: 1,
      names: [],
      validCount: 0,
      staleCount: 0,
      unknownCount: 1,
      systemOwnedCount: 0,
      totalBytes: 0,
      state: 'observation-required',
      confidence: 0.4,
      recommendations: ['request-shader-cache-observation']
    });
    expect(runShaderCacheEngine(facts({ shaderCaches: [null, {
      name: '', sizeBytes: -1, valid: 'yes', systemOwned: 1
    }] }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      shaderCacheCount: 1,
      totalBytes: 0,
      unknownCount: 1,
      systemOwnedCount: 0
    });
    expect(runShaderCacheEngine(facts({
      environment: 'headless',
      shaderCaches: []
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      shaderCacheCount: 0,
      state: 'no-shader-caches',
      confidence: 0.2,
      recommendations: ['no-shader-cache-review']
    });
  });

  test('requires a known environment, facts, cache list, triggers, and clock', () => {
    expect(runShaderCacheEngine(facts({
      environment: 'other',
      shaderCaches: []
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(() => runShaderCacheEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runShaderCacheEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runShaderCacheEngine(facts({ shaderCaches: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require a shader-cache list');
    expect(() => runShaderCacheEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported shader-cache trigger: bad');
    expect(() => runShaderCacheEngine(facts(), {}))
      .toThrow('Unsupported shader-cache trigger: unknown');
    expect(() => runShaderCacheEngine())
      .toThrow('Unsupported shader-cache trigger: unknown');
    expect(() => runShaderCacheEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Shader-cache clock must return a number');
  });
});
