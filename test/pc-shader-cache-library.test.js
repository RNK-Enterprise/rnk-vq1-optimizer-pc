import {
  SHADER_CACHE_LIBRARY_ID,
  SHADER_CACHE_LIBRARY_VERSION,
  buildShaderCacheEnvelope,
  classifyShaderCache,
  compareShaderCache,
  createShaderCacheLibrary
} from '../pc/engines/shader-cache/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    shaderCaches: [
      { name: 'gpu-a', sizeBytes: 100, valid: true, systemOwned: true },
      { name: 'gpu-b', sizeBytes: 200, valid: false, systemOwned: false }
    ],
    ...overrides
  };
}

describe('Shader-cache library', () => {
  test('classifies valid, stale, and bounded ownership evidence', () => {
    expect(classifyShaderCache(facts())).toMatchObject({
      library: SHADER_CACHE_LIBRARY_ID,
      libraryVersion: SHADER_CACHE_LIBRARY_VERSION,
      environment: 'interactive',
      shaderCacheCount: 2,
      names: ['gpu-a', 'gpu-b'],
      validCount: 1,
      staleCount: 1,
      unknownCount: 0,
      systemOwnedCount: 1,
      totalBytes: 300,
      state: 'rebuild-review',
      confidence: 1,
      recommendations: ['review-driver-documented-rebuild-path']
    });
    expect(classifyShaderCache(facts({ shaderCaches: [
      { name: 'gpu-a', sizeBytes: 50, valid: true, systemOwned: true }
    ] }))).toMatchObject({
      validCount: 1, staleCount: 0, unknownCount: 0, state: 'observe',
      confidence: 1, recommendations: ['no-change']
    });
  });

  test('preserves observation, empty, profile, and incomplete states', () => {
    expect(classifyShaderCache(facts({ shaderCaches: [
      { name: 'unknown', sizeBytes: 10, systemOwned: false }
    ] }))).toMatchObject({
      validCount: 0, staleCount: 0, unknownCount: 1, systemOwnedCount: 0,
      totalBytes: 10, state: 'observation-required', confidence: 0.7,
      recommendations: ['request-shader-cache-observation']
    });
    expect(classifyShaderCache(facts({ shaderCaches: [] }))).toMatchObject({
      shaderCacheCount: 0, totalBytes: 0, state: 'no-shader-caches', confidence: 0.2,
      recommendations: ['no-shader-cache-review']
    });
    expect(classifyShaderCache(facts({ environment: 'other', shaderCaches: [] }))).toMatchObject({
      environment: 'unknown', state: 'profile-required', confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(classifyShaderCache(facts({ shaderCaches: [
      null, { name: '', sizeBytes: -1, valid: false, systemOwned: true }
    ] }))).toMatchObject({
      shaderCacheCount: 1, names: [], validCount: 0, staleCount: 1,
      unknownCount: 0, systemOwnedCount: 1, totalBytes: 0, confidence: 0.7
    });
  });

  test('compares snapshots and builds immutable local facades', () => {
    expect(compareShaderCache(facts(), facts())).toMatchObject({
      changed: false, stateChanged: false, countChanged: false, validChanged: false,
      staleChanged: false, unknownChanged: false, bytesChanged: false, ownershipChanged: false
    });
    expect(compareShaderCache(facts({ shaderCaches: [
      { name: 'gpu-a', sizeBytes: 100, valid: true, systemOwned: true }
    ] }), facts({ shaderCaches: [
      { name: 'gpu-a', sizeBytes: 200, valid: true, systemOwned: false }
    ] }))).toMatchObject({
      changed: true, stateChanged: false, countChanged: false, validChanged: false,
      staleChanged: false, unknownChanged: false, bytesChanged: true, ownershipChanged: true
    });
    expect(compareShaderCache(facts(), facts({ shaderCaches: [
      { name: 'gpu-a', sizeBytes: 100, valid: true, systemOwned: true }
    ] }))).toMatchObject({
      changed: true, stateChanged: true, countChanged: true, validChanged: false,
      staleChanged: true, unknownChanged: false, bytesChanged: true, ownershipChanged: false
    });
    expect(compareShaderCache(facts({ shaderCaches: [
      { name: 'gpu-a', sizeBytes: 100, valid: true, systemOwned: true },
      { name: 'gpu-b', sizeBytes: 100, systemOwned: false }
    ] }), facts({ shaderCaches: [
      { name: 'gpu-a', sizeBytes: 100, valid: true, systemOwned: true },
      { name: 'gpu-b', sizeBytes: 100, valid: false, systemOwned: false }
    ] }))).toMatchObject({
      changed: true, stateChanged: true, countChanged: false, validChanged: false,
      staleChanged: true, unknownChanged: true, bytesChanged: false, ownershipChanged: false
    });
    const envelope = buildShaderCacheEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createShaderCacheLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyShaderCache(null)).toThrow('facts must be an object');
    expect(() => classifyShaderCache({ ...facts(), protocolVersion: 2 }))
      .toThrow('requires normalized system facts');
    expect(() => classifyShaderCache({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyShaderCache({ ...facts(), shaderCaches: null }))
      .toThrow('requires a shader-cache list');
    expect(() => buildShaderCacheEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildShaderCacheEnvelope(facts(), { trigger: '' }))
      .toThrow('trigger is required');
    expect(() => buildShaderCacheEnvelope(facts(), { trigger: 1 }))
      .toThrow('trigger is required');
    expect(() => buildShaderCacheEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createShaderCacheLibrary(null)).toThrow('options must be an object');
    expect(() => createShaderCacheLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
