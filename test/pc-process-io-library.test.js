import {
  PROCESS_IO_LIBRARY_ID,
  PROCESS_IO_LIBRARY_VERSION,
  buildProcessIoEnvelope,
  classifyProcessIo,
  compareProcessIo,
  createProcessIoLibrary
} from '../pc/engines/process-io/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    processes: [
      { name: ' game ', ioReadBytesPerSecond: 100, ioWriteBytesPerSecond: 50, ioWaitPercent: 2 },
      { name: 'worker', ioReadBytesPerSecond: 25, ioWriteBytesPerSecond: 75, ioWaitPercent: 4 }
    ],
    ...overrides
  };
}

describe('Process-I/O library', () => {
  test('aggregates normal, elevated, and bounded I/O evidence', () => {
    expect(classifyProcessIo(facts())).toMatchObject({
      library: PROCESS_IO_LIBRARY_ID,
      libraryVersion: PROCESS_IO_LIBRARY_VERSION,
      processCount: 2, names: ['game', 'worker'], totalReadBytesPerSecond: 125,
      totalWriteBytesPerSecond: 125, maximumIoWaitPercent: 4, level: 'normal',
      observationEnabled: true, recommendations: ['no-change']
    });
    expect(classifyProcessIo(facts({ processes: [
      { name: 'busy', ioReadBytesPerSecond: 1, ioWriteBytesPerSecond: 2, ioWaitPercent: 10 }
    ] }))).toMatchObject({ level: 'elevated', maximumIoWaitPercent: 10 });
    expect(classifyProcessIo(facts({ processes: [
      { name: 'busy', ioReadBytesPerSecond: 1, ioWriteBytesPerSecond: 2, ioWaitPercent: 120 }
    ] }))).toMatchObject({ level: 'high', maximumIoWaitPercent: 100 });
  });

  test('preserves empty, unknown, disabled, and headless states', () => {
    expect(classifyProcessIo(facts({ processes: [] })).recommendations)
      .toEqual(['no-process-io-review']);
    expect(classifyProcessIo(facts({ processes: [{ name: null }] }))).toMatchObject({
      processCount: 1, names: [], totalReadBytesPerSecond: null,
      totalWriteBytesPerSecond: null, maximumIoWaitPercent: null, level: 'unknown',
      recommendations: ['request-process-io-observation']
    });
    expect(classifyProcessIo(facts({ capabilities: { processIoObservation: false } }))
      .recommendations).toEqual(['keep-process-io-observation-disabled']);
    expect(classifyProcessIo(facts({ environment: 'headless', processes: [
      { ioReadBytesPerSecond: 1, ioWriteBytesPerSecond: 1, ioWaitPercent: 30 }
    ] })).recommendations).toEqual(['protect-services', 'review-storage-contention']);
    expect(classifyProcessIo(facts({ environment: 'other', processes: [] })).recommendations)
      .toEqual(['request-environment-profile']);
    expect(classifyProcessIo(facts({ capabilities: { processIoObservation: true } }))
      .observationEnabled).toBe(true);
  });

  test('compares I/O snapshots and builds immutable local facades', () => {
    expect(compareProcessIo(facts(), facts({ processes: [
      { ioReadBytesPerSecond: 200, ioWriteBytesPerSecond: 50, ioWaitPercent: 2 },
      { ioReadBytesPerSecond: 25, ioWriteBytesPerSecond: 75, ioWaitPercent: 4 }
    ] }))).toMatchObject({ changed: true, levelChanged: false, readChanged: true, writeChanged: false, waitChanged: false });
    expect(compareProcessIo(facts(), facts({ processes: [
      { ioReadBytesPerSecond: 100, ioWriteBytesPerSecond: 60, ioWaitPercent: 2 },
      { ioReadBytesPerSecond: 25, ioWriteBytesPerSecond: 75, ioWaitPercent: 4 }
    ] }))).toMatchObject({ changed: true, levelChanged: false, readChanged: false, writeChanged: true, waitChanged: false });
    expect(compareProcessIo(facts(), facts({ processes: [
      { ioReadBytesPerSecond: 100, ioWriteBytesPerSecond: 50, ioWaitPercent: 3 },
      { ioReadBytesPerSecond: 25, ioWriteBytesPerSecond: 75, ioWaitPercent: 5 }
    ] }))).toMatchObject({ changed: true, levelChanged: false, readChanged: false, writeChanged: false, waitChanged: true });
    expect(compareProcessIo(facts(), facts())).toMatchObject({ changed: false });
    const envelope = buildProcessIoEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createProcessIoLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyProcessIo(null)).toThrow('facts must be an object');
    expect(() => classifyProcessIo({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyProcessIo({ ...facts(), processes: null }))
      .toThrow('requires a process list');
    expect(() => buildProcessIoEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildProcessIoEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createProcessIoLibrary(null)).toThrow('options must be an object');
    expect(() => createProcessIoLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
