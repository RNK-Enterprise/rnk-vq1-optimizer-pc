import {
  STORAGE_HEALTH_LIBRARY_ID,
  STORAGE_HEALTH_LIBRARY_VERSION,
  buildStorageHealthEnvelope,
  classifyStorageHealth,
  compareStorageHealth,
  createStorageHealthLibrary
} from '../pc/engines/storage-health/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    storage: [
      { mount: ' / ', device: '/dev/nvme0n1', usedPercent: 40, health: 'healthy', readOnly: false },
      { mount: '/data', device: '/dev/sdb1', usedPercent: 50, health: 'healthy', readOnly: true }
    ],
    ...overrides
  };
}

describe('Storage-health library', () => {
  test('classifies normal, elevated, high, and bounded storage evidence', () => {
    expect(classifyStorageHealth(facts())).toMatchObject({
      library: STORAGE_HEALTH_LIBRARY_ID,
      libraryVersion: STORAGE_HEALTH_LIBRARY_VERSION,
      storageCount: 2, mounts: ['/', '/data'], devices: ['/dev/nvme0n1', '/dev/sdb1'],
      maximumUsedPercent: 50, degradedCount: 0, failedCount: 0, unknownHealthCount: 0,
      readOnlyCount: 1, level: 'normal', state: 'observe', recommendations: ['no-change']
    });
    expect(classifyStorageHealth(facts({ storage: [
      { mount: '/', device: 'x', usedPercent: 80, health: 'degraded' }
    ] }))).toMatchObject({ level: 'elevated', state: 'watch', recommendations: ['observe-storage-headroom'] });
    expect(classifyStorageHealth(facts({ storage: [
      { mount: '/', device: 'x', usedPercent: 120, health: 'healthy' }
    ] }))).toMatchObject({ maximumUsedPercent: 100, level: 'high', state: 'capacity-review' });
  });

  test('preserves failed, unknown, empty, and unknown-environment states', () => {
    expect(classifyStorageHealth(facts({ storage: [
      { mount: '/', device: 'x', usedPercent: 20, health: 'failed' }
    ] })).recommendations).toEqual(['protect-data', 'request-user-approved-storage-review']);
    expect(classifyStorageHealth(facts({ storage: [
      { mount: null, device: null, usedPercent: undefined, health: null, readOnly: 'yes' }
    ] }))).toMatchObject({ mounts: [], devices: [], maximumUsedPercent: null,
      unknownHealthCount: 1, level: 'unknown', state: 'observation-required',
      recommendations: ['request-storage-health-observation'] });
    expect(classifyStorageHealth(facts({ storage: [] })).recommendations)
      .toEqual(['no-storage-health-review']);
    expect(classifyStorageHealth(facts({ environment: 'other', storage: [] })).recommendations)
      .toEqual(['request-environment-profile']);
    expect(classifyStorageHealth(facts({ storage: [{ mount: '/', device: 'x', usedPercent: 95,
      health: 'unsupported' }] })).recommendations)
      .toEqual(['review-free-space-before-workload']);
  });

  test('compares storage snapshots and builds immutable local facades', () => {
    expect(compareStorageHealth(facts(), facts({ storage: [
      { mount: '/', device: 'x', usedPercent: 80, health: 'healthy' },
      { mount: '/data', device: 'y', usedPercent: 50, health: 'healthy', readOnly: false }
    ] }))).toMatchObject({ changed: true, levelChanged: true, failedChanged: false,
      countChanged: false, capacityChanged: true, readOnlyChanged: true });
    expect(compareStorageHealth(facts(), facts({ storage: [
      { mount: '/', device: 'x', usedPercent: 40, health: 'failed' },
      { mount: '/data', device: 'y', usedPercent: 50, health: 'healthy', readOnly: true }
    ] }))).toMatchObject({ changed: true, failedChanged: true });
    expect(compareStorageHealth(facts(), facts({ storage: [] })))
      .toMatchObject({ changed: true, countChanged: true });
    expect(compareStorageHealth(facts(), facts())).toMatchObject({ changed: false });
    const envelope = buildStorageHealthEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createStorageHealthLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyStorageHealth(null)).toThrow('facts must be an object');
    expect(() => classifyStorageHealth({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyStorageHealth({ ...facts(), storage: null }))
      .toThrow('requires a storage list');
    expect(() => buildStorageHealthEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildStorageHealthEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createStorageHealthLibrary(null)).toThrow('options must be an object');
    expect(() => createStorageHealthLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
