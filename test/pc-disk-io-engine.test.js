import {
  DISK_IO_ENGINE_ID,
  DISK_IO_ENGINE_VERSION,
  DISK_IO_TRIGGERS,
  runDiskIoEngine
} from '../pc/engines/disk-io/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    storage: [
      { mount: '/', device: '/dev/nvme0n1', readBytesPerSecond: 100, writeBytesPerSecond: 50, ioWaitPercent: 2 },
      { mount: '/data', device: '/dev/sdb1', readBytesPerSecond: 200, writeBytesPerSecond: 25, ioWaitPercent: 4 }
    ],
    ...overrides
  };
}

describe('Disk-I/O engine', () => {
  test('publishes identity and triggers', () => {
    expect(DISK_IO_ENGINE_ID).toBe('disk-io');
    expect(DISK_IO_ENGINE_VERSION).toBe(1);
    expect(DISK_IO_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(DISK_IO_TRIGGERS)).toBe(true);
  });

  test('aggregates normal disk I/O without changes', () => {
    const result = runDiskIoEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: DISK_IO_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      diskCount: 2,
      mounts: ['/', '/data'],
      devices: ['/dev/nvme0n1', '/dev/sdb1'],
      totalReadBytesPerSecond: 300,
      totalWriteBytesPerSecond: 75,
      maximumIoWaitPercent: 4,
      level: 'normal',
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('classifies elevated and high disk wait', () => {
    expect(runDiskIoEngine(facts({ storage: [
      { mount: '/', readBytesPerSecond: 1, writeBytesPerSecond: 2, ioWaitPercent: 10 }
    ] }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      level: 'elevated',
      state: 'watch',
      recommendations: ['observe-next-sample', 'review-disk-contention']
    });
    expect(runDiskIoEngine(facts({
      environment: 'headless',
      storage: [{ mount: '/', readBytesPerSecond: 1, writeBytesPerSecond: 2, ioWaitPercent: 30 }]
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      level: 'high',
      state: 'protect-services',
      recommendations: ['protect-services', 'review-disk-contention']
    });
  });

  test('reports unknown, empty, malformed, and bounded disk facts', () => {
    expect(runDiskIoEngine(facts({ storage: [{}] }), {
      trigger: 'system.facts.request',
      now: () => 0
    })).toMatchObject({
      diskCount: 1,
      mounts: [],
      devices: [],
      totalReadBytesPerSecond: null,
      totalWriteBytesPerSecond: null,
      maximumIoWaitPercent: null,
      level: 'unknown',
      state: 'observation-required',
      confidence: 0.4,
      recommendations: ['request-disk-io-observation']
    });
    expect(runDiskIoEngine(facts({ storage: [null, {
      mount: '', device: '', readBytesPerSecond: -1, writeBytesPerSecond: -2, ioWaitPercent: 120
    }] }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      diskCount: 1,
      totalReadBytesPerSecond: null,
      totalWriteBytesPerSecond: null,
      maximumIoWaitPercent: 100,
      level: 'high'
    });
    expect(runDiskIoEngine(facts({
      environment: 'headless',
      storage: []
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      diskCount: 0,
      state: 'no-disks',
      confidence: 0.2,
      recommendations: ['no-disk-io-review']
    });
  });

  test('requires facts, storage list, triggers, and a clock', () => {
    expect(runDiskIoEngine(facts({
      environment: 'other',
      storage: []
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(() => runDiskIoEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runDiskIoEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runDiskIoEngine(facts({ storage: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require a storage list');
    expect(() => runDiskIoEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported disk-I/O trigger: bad');
    expect(() => runDiskIoEngine(facts(), {}))
      .toThrow('Unsupported disk-I/O trigger: unknown');
    expect(() => runDiskIoEngine())
      .toThrow('Unsupported disk-I/O trigger: unknown');
    expect(() => runDiskIoEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Disk-I/O clock must return a number');
  });
});
