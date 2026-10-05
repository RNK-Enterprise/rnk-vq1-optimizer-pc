import {
  STORAGE_CAPACITY_LIBRARY_ID,
  STORAGE_CAPACITY_LIBRARY_VERSION,
  buildStorageCapacityEnvelope,
  classifyStorageCapacity,
  compareStorageCapacity,
  createStorageCapacityLibrary
} from '../pc/engines/storage-capacity/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    storage: [
      { mount: ' / ', totalBytes: 1000, freeBytes: 500 },
      { mount: '/data', totalBytes: 2000, freeBytes: 600 }
    ],
    ...overrides
  };
}

describe('Storage-capacity library', () => {
  test('aggregates normal, elevated, and bounded capacity evidence', () => {
    expect(classifyStorageCapacity(facts())).toMatchObject({
      library: STORAGE_CAPACITY_LIBRARY_ID,
      libraryVersion: STORAGE_CAPACITY_LIBRARY_VERSION,
      storageCount: 2, mounts: ['/', '/data'], totalBytes: 3000, freeBytes: 1100,
      minimumFreePercent: 30, level: 'normal', recommendations: ['no-change']
    });
    expect(classifyStorageCapacity(facts({ storage: [
      { mount: '/', totalBytes: 1000, freeBytes: 200 }
    ] }))).toMatchObject({ minimumFreePercent: 20, level: 'elevated',
      recommendations: ['observe-storage-headroom'] });
    expect(classifyStorageCapacity(facts({ storage: [
      { mount: '/', totalBytes: 1000, freeBytes: 2000 }
    ] }))).toMatchObject({ freeBytes: 1000, minimumFreePercent: 100, level: 'normal' });
  });

  test('preserves high, unknown, empty, and unknown-environment states', () => {
    expect(classifyStorageCapacity(facts({ storage: [
      { mount: '/', totalBytes: 1000, freeBytes: 100 }
    ] })).recommendations).toEqual(['review-free-space-before-workload']);
    expect(classifyStorageCapacity(facts({ storage: [
      { mount: null, totalBytes: 0, freeBytes: 0 },
      { mount: '/unknown', totalBytes: null, freeBytes: null }
    ] }))).toMatchObject({ mounts: ['/unknown'], totalBytes: 0, freeBytes: 0,
      minimumFreePercent: null, level: 'unknown', recommendations: ['request-storage-capacity-observation'] });
    expect(classifyStorageCapacity(facts({ storage: [] })).recommendations)
      .toEqual(['no-storage-capacity-review']);
    expect(classifyStorageCapacity(facts({ environment: 'other', storage: [] })).recommendations)
      .toEqual(['request-environment-profile']);
  });

  test('compares capacity snapshots and builds immutable local facades', () => {
    expect(compareStorageCapacity(facts(), facts({ storage: [
      { mount: '/', totalBytes: 1000, freeBytes: 200 },
      { mount: '/data', totalBytes: 2000, freeBytes: 600 }
    ] }))).toMatchObject({ changed: true, levelChanged: true, freeChanged: true,
      totalChanged: false, countChanged: false, minimumFreeChanged: true });
    expect(compareStorageCapacity(facts(), facts({ storage: [
      { mount: '/', totalBytes: 2000, freeBytes: 1000 },
      { mount: '/data', totalBytes: 2000, freeBytes: 600 }
    ] }))).toMatchObject({ changed: true, levelChanged: false, freeChanged: true, totalChanged: true });
    expect(compareStorageCapacity(facts(), facts({ storage: [] })))
      .toMatchObject({ changed: true, countChanged: true });
    expect(compareStorageCapacity(facts(), facts())).toMatchObject({ changed: false });
    const envelope = buildStorageCapacityEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createStorageCapacityLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyStorageCapacity(null)).toThrow('facts must be an object');
    expect(() => classifyStorageCapacity({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyStorageCapacity({ ...facts(), storage: null }))
      .toThrow('requires a storage list');
    expect(() => buildStorageCapacityEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildStorageCapacityEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createStorageCapacityLibrary(null)).toThrow('options must be an object');
    expect(() => createStorageCapacityLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
