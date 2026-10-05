import {
  DISK_IO_LIBRARY_ID,
  DISK_IO_LIBRARY_VERSION,
  buildDiskIoEnvelope,
  classifyDiskIo,
  compareDiskIo,
  createDiskIoLibrary
} from '../pc/engines/disk-io/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    storage: [
      { mount: ' / ', device: '/dev/nvme0n1', readBytesPerSecond: 100, writeBytesPerSecond: 50, ioWaitPercent: 2 },
      { mount: '/data', device: '/dev/sdb1', readBytesPerSecond: 25, writeBytesPerSecond: 75, ioWaitPercent: 4 }
    ],
    ...overrides
  };
}

describe('Disk-I/O library', () => {
  test('aggregates normal, elevated, high, and bounded disk evidence', () => {
    expect(classifyDiskIo(facts())).toMatchObject({
      library: DISK_IO_LIBRARY_ID,
      libraryVersion: DISK_IO_LIBRARY_VERSION,
      diskCount: 2, mounts: ['/', '/data'], devices: ['/dev/nvme0n1', '/dev/sdb1'],
      totalReadBytesPerSecond: 125, totalWriteBytesPerSecond: 125,
      maximumIoWaitPercent: 4, level: 'normal', recommendations: ['no-change']
    });
    expect(classifyDiskIo(facts({ storage: [
      { mount: '/', device: 'x', readBytesPerSecond: 1, writeBytesPerSecond: 2, ioWaitPercent: 10 }
    ] }))).toMatchObject({ level: 'elevated', recommendations: ['observe-next-sample', 'review-disk-contention'] });
    expect(classifyDiskIo(facts({ environment: 'headless', storage: [
      { mount: '/', device: 'x', readBytesPerSecond: 1, writeBytesPerSecond: 2, ioWaitPercent: 120 }
    ] }))).toMatchObject({ maximumIoWaitPercent: 100, level: 'high', recommendations: ['protect-services', 'review-disk-contention'] });
  });

  test('preserves empty, unknown, and unknown-environment states', () => {
    expect(classifyDiskIo(facts({ storage: [] })).recommendations)
      .toEqual(['no-disk-io-review']);
    expect(classifyDiskIo(facts({ storage: [{ mount: null, device: null }] })))
      .toMatchObject({ diskCount: 1, mounts: [], devices: [], totalReadBytesPerSecond: null,
        totalWriteBytesPerSecond: null, maximumIoWaitPercent: null, level: 'unknown',
        recommendations: ['request-disk-io-observation'] });
    expect(classifyDiskIo(facts({ environment: 'other', storage: [] })).recommendations)
      .toEqual(['request-environment-profile']);
    expect(classifyDiskIo(facts({ storage: [{ readBytesPerSecond: 1, writeBytesPerSecond: 1, ioWaitPercent: 0 }] }))
      .recommendations).toEqual(['no-change']);
  });

  test('compares disk snapshots and builds immutable local facades', () => {
    expect(compareDiskIo(facts(), facts({ storage: [
      { readBytesPerSecond: 200, writeBytesPerSecond: 50, ioWaitPercent: 2 },
      { readBytesPerSecond: 25, writeBytesPerSecond: 75, ioWaitPercent: 4 }
    ] }))).toMatchObject({ changed: true, levelChanged: false, readChanged: true, writeChanged: false, waitChanged: false });
    expect(compareDiskIo(facts(), facts({ storage: [
      { readBytesPerSecond: 100, writeBytesPerSecond: 60, ioWaitPercent: 2 },
      { readBytesPerSecond: 25, writeBytesPerSecond: 75, ioWaitPercent: 4 }
    ] }))).toMatchObject({ changed: true, levelChanged: false, readChanged: false, writeChanged: true, waitChanged: false });
    expect(compareDiskIo(facts(), facts({ storage: [
      { readBytesPerSecond: 100, writeBytesPerSecond: 50, ioWaitPercent: 3 },
      { readBytesPerSecond: 25, writeBytesPerSecond: 75, ioWaitPercent: 5 }
    ] }))).toMatchObject({ changed: true, levelChanged: false, readChanged: false, writeChanged: false, waitChanged: true });
    expect(compareDiskIo(facts(), facts())).toMatchObject({ changed: false, diskCountChanged: false });
    const envelope = buildDiskIoEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createDiskIoLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyDiskIo(null)).toThrow('facts must be an object');
    expect(() => classifyDiskIo({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyDiskIo({ ...facts(), storage: null }))
      .toThrow('requires a storage list');
    expect(() => buildDiskIoEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildDiskIoEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createDiskIoLibrary(null)).toThrow('options must be an object');
    expect(() => createDiskIoLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
