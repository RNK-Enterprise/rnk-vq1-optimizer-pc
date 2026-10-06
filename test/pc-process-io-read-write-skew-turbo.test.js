import {
  PROCESS_IO_READ_WRITE_SKEW_TURBO_ID,
  runProcessIoReadWriteSkewTurbo
} from '../pc/engines/process-io/turbos/read-write-skew/turbo.js';

const facts = (processes, environment = 'interactive', capabilities = { processIoObservation: true }) => ({
  engine: 'system-facts', environment, capabilities, processes
});

describe('process-io read-write-skew turbo', () => {
  test('detects sustained read-direction skew', () => {
    const result = runProcessIoReadWriteSkewTurbo([
      facts([{ ioReadBytesPerSecond: 300, ioWriteBytesPerSecond: 100 }]),
      facts([{ ioReadBytesPerSecond: 450, ioWriteBytesPerSecond: 100 }])
    ], { trigger: 'workload.changed', minimumSamples: 2, persistenceThreshold: 2, now: () => 0 });

    expect(result.turbo).toBe(PROCESS_IO_READ_WRITE_SKEW_TURBO_ID);
    expect(result.state).toBe('read-skew-sustained');
    expect(result.readSkewCount).toBe(2);
    expect(result.writeSkewCount).toBe(0);
    expect(result.totalReadBytesPerSecond).toBe(450);
    expect(result.confidence).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes observed, balanced, write, disabled, empty, and incomplete samples', () => {
    const observed = runProcessIoReadWriteSkewTurbo([
      facts([{ ioReadBytesPerSecond: 200, ioWriteBytesPerSecond: 100 }]),
      facts([{ ioReadBytesPerSecond: 100, ioWriteBytesPerSecond: 100 }])
    ], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const write = runProcessIoReadWriteSkewTurbo([
      facts([{ ioReadBytesPerSecond: 100, ioWriteBytesPerSecond: 300 }]),
      facts([{ ioReadBytesPerSecond: 100, ioWriteBytesPerSecond: 250 }])
    ], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const balanced = runProcessIoReadWriteSkewTurbo([
      facts([{ ioReadBytesPerSecond: 100, ioWriteBytesPerSecond: 100 }]),
      facts([{ ioReadBytesPerSecond: 0, ioWriteBytesPerSecond: 0 }])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const disabled = runProcessIoReadWriteSkewTurbo([
      facts([{ ioReadBytesPerSecond: 100, ioWriteBytesPerSecond: 10 }], 'interactive', { processIoObservation: false }),
      facts([{ ioReadBytesPerSecond: 100, ioWriteBytesPerSecond: 10 }], 'interactive', { processIoObservation: false })
    ], { trigger: 'install.preflight', now: () => 0 });
    const empty = runProcessIoReadWriteSkewTurbo([facts([]), facts([])], {
      trigger: 'system.facts.request', now: () => 0
    });
    const incomplete = runProcessIoReadWriteSkewTurbo([
      facts([{ ioReadBytesPerSecond: 100 }], 'unknown'), facts([{ ioWriteBytesPerSecond: 100 }])
    ], { trigger: 'health.interval', now: () => 0 });

    expect(observed.state).toBe('io-skew-observed');
    expect(write.state).toBe('write-skew-sustained');
    expect(write.writeSkewCount).toBe(2);
    expect(balanced.state).toBe('balanced-io');
    expect(disabled.state).toBe('observation-disabled');
    expect(empty.state).toBe('no-processes');
    expect(incomplete.state).toBe('incomplete-read-write-evidence');
  });

  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runProcessIoReadWriteSkewTurbo([
      facts([{ ioReadBytesPerSecond: 300, ioWriteBytesPerSecond: 100 }]),
      facts([{ ioReadBytesPerSecond: 100, ioWriteBytesPerSecond: 100 }])
    ], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runProcessIoReadWriteSkewTurbo([], {
      trigger: 'install.preflight', now: () => 0
    });

    expect(bounded.sampleCount).toBe(1);
    expect(bounded.readSkewCount).toBe(0);
    expect(bounded.state).toBe('balanced-io');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
  });

  test('rejects invalid triggers, snapshots, bounds, ratios, and clocks', () => {
    expect(() => runProcessIoReadWriteSkewTurbo()).toThrow();
    expect(() => runProcessIoReadWriteSkewTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runProcessIoReadWriteSkewTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessIoReadWriteSkewTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessIoReadWriteSkewTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessIoReadWriteSkewTurbo([facts({})], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessIoReadWriteSkewTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow();
    expect(() => runProcessIoReadWriteSkewTurbo([], {
      trigger: 'health.interval', windowSize: 1, minimumSamples: 2
    })).toThrow();
    expect(() => runProcessIoReadWriteSkewTurbo([], {
      trigger: 'health.interval', skewRatio: 0
    })).toThrow();
    expect(() => runProcessIoReadWriteSkewTurbo([], {
      trigger: 'health.interval', persistenceThreshold: 0
    })).toThrow();
    expect(() => runProcessIoReadWriteSkewTurbo([], {
      trigger: 'health.interval', now: () => Number.NaN
    })).toThrow();
  });
});
