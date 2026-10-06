import {
  PROCESS_IO_CONTENTION_BURST_TURBO_ID,
  runProcessIoContentionBurstTurbo
} from '../pc/engines/process-io/turbos/contention-burst/turbo.js';

const facts = (processes, environment = 'interactive', capabilities = { processIoObservation: true }) => ({
  engine: 'system-facts', environment, capabilities, processes
});

describe('process-io contention-burst turbo', () => {
  test('detects sustained I/O contention without applying a throttle', () => {
    const result = runProcessIoContentionBurstTurbo([
      facts([{ name: 'game', ioReadBytesPerSecond: 100, ioWriteBytesPerSecond: 20, ioWaitPercent: 35 }]),
      facts([{ name: 'game', ioReadBytesPerSecond: 200, ioWriteBytesPerSecond: 40, ioWaitPercent: 45 }])
    ], { trigger: 'workload.changed', minimumSamples: 2, persistenceThreshold: 2, now: () => 0 });

    expect(result.turbo).toBe(PROCESS_IO_CONTENTION_BURST_TURBO_ID);
    expect(result.state).toBe('contention-sustained');
    expect(result.contentionCount).toBe(2);
    expect(result.maximumWaitPercent).toBe(45);
    expect(result.totalReadBytesPerSecond).toBe(200);
    expect(result.confidence).toBe(1);
    expect(result.actions).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes observed, stable, disabled, empty, and incomplete samples', () => {
    const observed = runProcessIoContentionBurstTurbo([
      facts([{ ioWaitPercent: 30 }]), facts([{ ioWaitPercent: 2 }])
    ], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const stable = runProcessIoContentionBurstTurbo([
      facts([{ ioWaitPercent: 2 }]), facts([{ ioWaitPercent: 9 }])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const disabled = runProcessIoContentionBurstTurbo([
      facts([{ ioWaitPercent: 40 }], 'interactive', { processIoObservation: false }),
      facts([{ ioWaitPercent: 40 }], 'interactive', { processIoObservation: false })
    ], { trigger: 'install.preflight', now: () => 0 });
    const empty = runProcessIoContentionBurstTurbo([facts([]), facts([])], {
      trigger: 'system.facts.request', now: () => 0
    });
    const incomplete = runProcessIoContentionBurstTurbo([
      facts([{ name: 'game' }], 'unknown'), facts([{ name: 'game' }])
    ], { trigger: 'health.interval', now: () => 0 });

    expect(observed.state).toBe('contention-observed');
    expect(stable.state).toBe('stable-contention');
    expect(disabled.state).toBe('observation-disabled');
    expect(empty.state).toBe('no-processes');
    expect(incomplete.state).toBe('incomplete-contention-evidence');
  });

  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runProcessIoContentionBurstTurbo([
      facts([{ ioWaitPercent: 50 }]), facts([{ ioWaitPercent: 2 }])
    ], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runProcessIoContentionBurstTurbo([], {
      trigger: 'install.preflight', now: () => 0
    });

    expect(bounded.sampleCount).toBe(1);
    expect(bounded.maximumWaitPercent).toBe(2);
    expect(bounded.state).toBe('stable-contention');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
  });

  test('rejects invalid triggers, snapshots, bounds, thresholds, and clocks', () => {
    expect(() => runProcessIoContentionBurstTurbo()).toThrow();
    expect(() => runProcessIoContentionBurstTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runProcessIoContentionBurstTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessIoContentionBurstTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessIoContentionBurstTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessIoContentionBurstTurbo([facts({})], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessIoContentionBurstTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow();
    expect(() => runProcessIoContentionBurstTurbo([], {
      trigger: 'health.interval', windowSize: 1, minimumSamples: 2
    })).toThrow();
    expect(() => runProcessIoContentionBurstTurbo([], {
      trigger: 'health.interval', contentionThreshold: 101
    })).toThrow();
    expect(() => runProcessIoContentionBurstTurbo([], {
      trigger: 'health.interval', persistenceThreshold: 0
    })).toThrow();
    expect(() => runProcessIoContentionBurstTurbo([], {
      trigger: 'health.interval', now: () => Number.NaN
    })).toThrow();
  });
});
