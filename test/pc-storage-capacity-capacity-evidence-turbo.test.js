import {
  STORAGE_CAPACITY_CAPACITY_EVIDENCE_TURBO_ID,
  runStorageCapacityCapacityEvidenceTurbo
} from '../pc/engines/storage-capacity/turbos/capacity-evidence/turbo.js';

const complete = (mount = '/') => ({ mount, totalBytes: 1000, freeBytes: 500 });
const facts = (storage, environment = 'interactive') => ({ engine: 'system-facts', environment, storage });

describe('storage-capacity capacity-evidence turbo', () => {
  test('detects sustained evidence gaps without probing or repair', () => {
    const result = runStorageCapacityCapacityEvidenceTurbo([
      facts([complete(), { mount: '/data', totalBytes: 1000 }]),
      facts([complete(), { mount: '/data', freeBytes: 500 }])
    ], { trigger: 'workload.changed', minimumSamples: 2, evidenceThreshold: 0.75, persistenceThreshold: 2, now: () => 0 });
    expect(result.turbo).toBe(STORAGE_CAPACITY_CAPACITY_EVIDENCE_TURBO_ID);
    expect(result.state).toBe('capacity-evidence-gap-sustained');
    expect(result.gapSampleCount).toBe(2);
    expect(result.evidenceRatio).toBe(0.5);
    expect(result.recommendations).toEqual(['request-complete-capacity-facts']);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes observed, complete, empty, and incomplete samples', () => {
    const observed = runStorageCapacityCapacityEvidenceTurbo([
      facts([complete(), { mount: '/data', totalBytes: 1000 }]), facts([complete(), complete('/data')])
    ], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const completeResult = runStorageCapacityCapacityEvidenceTurbo([
      facts([complete()]), facts([complete()])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const empty = runStorageCapacityCapacityEvidenceTurbo([facts([]), facts([])], { trigger: 'install.preflight', now: () => 0 });
    const incomplete = runStorageCapacityCapacityEvidenceTurbo([
      facts([complete()], 'unknown'), facts([complete()], 'unknown')
    ], { trigger: 'health.interval', now: () => 0 });
    expect(observed.state).toBe('capacity-evidence-gap-observed');
    expect(completeResult.state).toBe('complete-capacity-evidence');
    expect(empty.state).toBe('no-storage');
    expect(incomplete.state).toBe('incomplete-capacity-evidence');
  });

  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runStorageCapacityCapacityEvidenceTurbo([
      facts([complete()]), facts([{ mount: '/', totalBytes: 1000 }])
    ], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runStorageCapacityCapacityEvidenceTurbo([], { trigger: 'install.preflight', now: () => 0 });
    expect(bounded.sampleCount).toBe(1);
    expect(bounded.evidenceRatio).toBe(0);
    expect(bounded.state).toBe('capacity-evidence-gap-observed');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
  });

  test('rejects invalid triggers, snapshots, bounds, thresholds, and clocks', () => {
    expect(() => runStorageCapacityCapacityEvidenceTurbo()).toThrow();
    expect(() => runStorageCapacityCapacityEvidenceTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runStorageCapacityCapacityEvidenceTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageCapacityCapacityEvidenceTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageCapacityCapacityEvidenceTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageCapacityCapacityEvidenceTurbo([facts({})], { trigger: 'health.interval' })).toThrow();
    expect(() => runStorageCapacityCapacityEvidenceTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow();
    expect(() => runStorageCapacityCapacityEvidenceTurbo([], { trigger: 'health.interval', windowSize: 1, minimumSamples: 2 })).toThrow();
    expect(() => runStorageCapacityCapacityEvidenceTurbo([], { trigger: 'health.interval', evidenceThreshold: 1.1 })).toThrow();
    expect(() => runStorageCapacityCapacityEvidenceTurbo([], { trigger: 'health.interval', persistenceThreshold: 0 })).toThrow();
    expect(() => runStorageCapacityCapacityEvidenceTurbo([], { trigger: 'health.interval', now: () => Number.NaN })).toThrow();
  });
});
