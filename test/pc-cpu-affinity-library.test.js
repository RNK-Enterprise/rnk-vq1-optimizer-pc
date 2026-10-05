import {
  CPU_AFFINITY_LIBRARY_ID,
  CPU_AFFINITY_LIBRARY_VERSION,
  buildCpuAffinityEnvelope,
  classifyCpuAffinity,
  compareCpuAffinity,
  createCpuAffinityLibrary
} from '../pc/engines/cpu-affinity/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    cpu: { logicalCpus: 8, physicalCpus: 4, affinityCpus: [3, 1, 1], isolatedCpus: [7] },
    ...overrides
  };
}

describe('CPU-affinity library', () => {
  test('normalizes explicit affinity and topology', () => {
    const result = classifyCpuAffinity(facts());
    expect(result).toMatchObject({
      library: CPU_AFFINITY_LIBRARY_ID,
      libraryVersion: CPU_AFFINITY_LIBRARY_VERSION,
      logicalCpus: 8,
      physicalCpus: 4,
      affinityCpus: [1, 3],
      isolatedCpus: [7],
      affinityCount: 2,
      isolatedCount: 1,
      state: 'explicit',
      recommendations: ['review-user-owned-affinity']
    });
  });

  test('handles default, empty, and unknown affinity states', () => {
    expect(classifyCpuAffinity(facts({ cpu: { logicalCpus: 8, physicalCpus: 4 } }))).toMatchObject({
      affinityCpus: null,
      isolatedCpus: null,
      state: 'default',
      recommendations: ['preserve-default-affinity']
    });
    expect(classifyCpuAffinity(facts({ cpu: {
      logicalCpus: 8, physicalCpus: 4, affinityCpus: [], isolatedCpus: undefined
    }}))).toMatchObject({
      state: 'explicit-empty',
      recommendations: ['review-empty-affinity-list']
    });
    expect(classifyCpuAffinity(facts({
      environment: 'unknown',
      cpu: { logicalCpus: undefined, physicalCpus: undefined, affinityCpus: ['x'], isolatedCpus: null }
    }))).toMatchObject({
      logicalCpus: null,
      physicalCpus: null,
      affinityCpus: [],
      isolatedCpus: null,
      state: 'unknown',
      recommendations: ['request-cpu-topology-observation']
    });
    expect(classifyCpuAffinity(facts({
      environment: 'headless',
      cpu: { logicalCpus: 8, physicalCpus: 4, affinityCpus: [0], isolatedCpus: [1] }
    })).recommendations).toEqual(['preserve-service-affinity']);
  });

  test('compares affinity lists and builds immutable facades', () => {
    expect(compareCpuAffinity(facts(), facts({ cpu: {
      logicalCpus: 8, physicalCpus: 4, affinityCpus: [2], isolatedCpus: [7]
    } }))).toEqual({
      changed: true,
      affinityChanged: true,
      isolatedChanged: false,
      previousState: 'explicit',
      currentState: 'explicit'
    });
    expect(compareCpuAffinity(facts(), facts({ cpu: {
      logicalCpus: 8, physicalCpus: 4, affinityCpus: [3, 1, 1], isolatedCpus: [2]
    } }))).toMatchObject({
      changed: true,
      affinityChanged: false,
      isolatedChanged: true
    });
    const envelope = buildCpuAffinityEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createCpuAffinityLibrary({ now: () => 1000 });
    expect(library.id).toBe(CPU_AFFINITY_LIBRARY_ID);
    expect(library.version).toBe(CPU_AFFINITY_LIBRARY_VERSION);
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(library.emptyRecommendations).toEqual([]);
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('filters malformed lists and rejects invalid inputs', () => {
    expect(classifyCpuAffinity(facts({ cpu: {
      logicalCpus: 4, physicalCpus: 2, affinityCpus: [3, -1, 1.5, 1], isolatedCpus: [0, null]
    } })).affinityCpus).toEqual([1, 3]);
    expect(() => classifyCpuAffinity(null)).toThrow('facts must be an object');
    expect(() => classifyCpuAffinity({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyCpuAffinity({ ...facts(), cpu: null })).toThrow('requires CPU facts');
    expect(() => buildCpuAffinityEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildCpuAffinityEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createCpuAffinityLibrary(null)).toThrow('options must be an object');
    expect(() => createCpuAffinityLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
