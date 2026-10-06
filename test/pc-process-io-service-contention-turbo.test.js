import {
  PROCESS_IO_SERVICE_CONTENTION_TURBO_ID,
  runProcessIoServiceContentionTurbo
} from '../pc/engines/process-io/turbos/service-contention/turbo.js';

const facts = (processes, environment = 'interactive', capabilities = { processIoObservation: true }) => ({
  engine: 'system-facts', environment, capabilities, processes
});

describe('process-io service-contention turbo', () => {
  test('detects sustained service contention', () => {
    const result = runProcessIoServiceContentionTurbo([
      facts([{ role: 'service', ioWaitPercent: 35 }]),
      facts([{ service: true, ioWaitPercent: 45 }])
    ], { trigger: 'workload.changed', minimumSamples: 2, persistenceThreshold: 2, now: () => 0 });

    expect(result.turbo).toBe(PROCESS_IO_SERVICE_CONTENTION_TURBO_ID);
    expect(result.state).toBe('service-contention-sustained');
    expect(result.contentionCount).toBe(2);
    expect(result.serviceCount).toBe(1);
    expect(result.maximumServiceWaitPercent).toBe(45);
    expect(result.confidence).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes observed, clear, no-service, disabled, empty, and incomplete samples', () => {
    const observed = runProcessIoServiceContentionTurbo([
      facts([{ service: true, ioWaitPercent: 35 }]), facts([{ service: true, ioWaitPercent: 5 }])
    ], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const clear = runProcessIoServiceContentionTurbo([
      facts([{ service: true, ioWaitPercent: 5 }]), facts([{ service: true, ioWaitPercent: 10 }])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const noServices = runProcessIoServiceContentionTurbo([
      facts([{ name: 'app', ioWaitPercent: 5 }]), facts([{ name: 'app', ioWaitPercent: 5 }])
    ], { trigger: 'install.preflight', now: () => 0 });
    const disabled = runProcessIoServiceContentionTurbo([
      facts([{ service: true, ioWaitPercent: 40 }], 'interactive', { processIoObservation: false }),
      facts([{ service: true, ioWaitPercent: 40 }], 'interactive', { processIoObservation: false })
    ], { trigger: 'health.interval', now: () => 0 });
    const empty = runProcessIoServiceContentionTurbo([facts([]), facts([])], {
      trigger: 'system.facts.request', now: () => 0
    });
    const incomplete = runProcessIoServiceContentionTurbo([
      facts([{ service: true }], 'unknown'), facts([{ service: true }])
    ], { trigger: 'health.interval', now: () => 0 });

    expect(observed.state).toBe('service-contention-observed');
    expect(clear.state).toBe('service-contention-clear');
    expect(noServices.state).toBe('no-services');
    expect(disabled.state).toBe('observation-disabled');
    expect(empty.state).toBe('no-processes');
    expect(incomplete.state).toBe('incomplete-service-evidence');
  });

  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runProcessIoServiceContentionTurbo([
      facts([{ service: true, ioWaitPercent: 45 }]), facts([{ service: true, ioWaitPercent: 5 }])
    ], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runProcessIoServiceContentionTurbo([], {
      trigger: 'install.preflight', now: () => 0
    });

    expect(bounded.sampleCount).toBe(1);
    expect(bounded.maximumServiceWaitPercent).toBe(5);
    expect(bounded.state).toBe('service-contention-clear');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
  });

  test('rejects invalid triggers, snapshots, bounds, thresholds, and clocks', () => {
    expect(() => runProcessIoServiceContentionTurbo()).toThrow();
    expect(() => runProcessIoServiceContentionTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runProcessIoServiceContentionTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessIoServiceContentionTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessIoServiceContentionTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessIoServiceContentionTurbo([facts({})], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessIoServiceContentionTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow();
    expect(() => runProcessIoServiceContentionTurbo([], {
      trigger: 'health.interval', windowSize: 1, minimumSamples: 2
    })).toThrow();
    expect(() => runProcessIoServiceContentionTurbo([], {
      trigger: 'health.interval', contentionThreshold: 101
    })).toThrow();
    expect(() => runProcessIoServiceContentionTurbo([], {
      trigger: 'health.interval', persistenceThreshold: 0
    })).toThrow();
    expect(() => runProcessIoServiceContentionTurbo([], {
      trigger: 'health.interval', now: () => Number.NaN
    })).toThrow();
  });
});
