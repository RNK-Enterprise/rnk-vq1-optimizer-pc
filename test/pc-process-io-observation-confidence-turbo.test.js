import {
  PROCESS_IO_OBSERVATION_CONFIDENCE_TURBO_ID,
  runProcessIoObservationConfidenceTurbo
} from '../pc/engines/process-io/turbos/observation-confidence/turbo.js';

const complete = { ioReadBytesPerSecond: 100, ioWriteBytesPerSecond: 50, ioWaitPercent: 2 };
const facts = (processes, environment = 'interactive', capabilities = { processIoObservation: true }) => ({
  engine: 'system-facts', environment, capabilities, processes
});

describe('process-io observation-confidence turbo', () => {
  test('detects sustained low metric completeness', () => {
    const result = runProcessIoObservationConfidenceTurbo([
      facts([{ ioReadBytesPerSecond: 100 }]),
      facts([{ ioWriteBytesPerSecond: 50 }])
    ], { trigger: 'workload.changed', minimumSamples: 2, completenessThreshold: 0.8,
      persistenceThreshold: 2, now: () => 0 });

    expect(result.turbo).toBe(PROCESS_IO_OBSERVATION_CONFIDENCE_TURBO_ID);
    expect(result.state).toBe('low-confidence-sustained');
    expect(result.lowConfidenceCount).toBe(2);
    expect(result.latestObservationRate).toBe(0);
    expect(result.confidence).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('distinguishes observed, complete, disabled, empty, and incomplete samples', () => {
    const observed = runProcessIoObservationConfidenceTurbo([
      facts([{ ...complete }, { ioReadBytesPerSecond: 100 }]),
      facts([{ ...complete }, { ...complete }])
    ], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 });
    const completeResult = runProcessIoObservationConfidenceTurbo([
      facts([{ ...complete }]), facts([{ ...complete }])
    ], { trigger: 'system.facts.request', now: () => 0 });
    const disabled = runProcessIoObservationConfidenceTurbo([
      facts([{ ...complete }], 'interactive', { processIoObservation: false }),
      facts([{ ...complete }], 'interactive', { processIoObservation: false })
    ], { trigger: 'install.preflight', now: () => 0 });
    const empty = runProcessIoObservationConfidenceTurbo([facts([]), facts([])], {
      trigger: 'system.facts.request', now: () => 0
    });
    const incomplete = runProcessIoObservationConfidenceTurbo([
      facts([{ ...complete }], 'unknown'), facts([{ ...complete }], 'other')
    ], { trigger: 'health.interval', now: () => 0 });

    expect(observed.state).toBe('low-confidence-observed');
    expect(completeResult.state).toBe('complete-observation');
    expect(disabled.state).toBe('observation-disabled');
    expect(empty.state).toBe('no-processes');
    expect(incomplete.state).toBe('incomplete-confidence-evidence');
  });

  test('bounds samples and reports insufficient evidence', () => {
    const bounded = runProcessIoObservationConfidenceTurbo([
      facts([{ ...complete }]), facts([{ ioReadBytesPerSecond: 100 }])
    ], { trigger: 'system.facts.request', windowSize: 1, minimumSamples: 1, now: () => 0 });
    const insufficient = runProcessIoObservationConfidenceTurbo([], {
      trigger: 'install.preflight', now: () => 0
    });

    expect(bounded.sampleCount).toBe(1);
    expect(bounded.latestObservationRate).toBe(0);
    expect(bounded.state).toBe('low-confidence-observed');
    expect(insufficient.state).toBe('insufficient-data');
    expect(insufficient.confidence).toBe(0);
  });

  test('rejects invalid triggers, snapshots, bounds, thresholds, and clocks', () => {
    expect(() => runProcessIoObservationConfidenceTurbo()).toThrow();
    expect(() => runProcessIoObservationConfidenceTurbo([], { trigger: 'bad' })).toThrow();
    expect(() => runProcessIoObservationConfidenceTurbo('bad', { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessIoObservationConfidenceTurbo([{}], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessIoObservationConfidenceTurbo([null], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessIoObservationConfidenceTurbo([facts({})], { trigger: 'health.interval' })).toThrow();
    expect(() => runProcessIoObservationConfidenceTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow();
    expect(() => runProcessIoObservationConfidenceTurbo([], {
      trigger: 'health.interval', windowSize: 1, minimumSamples: 2
    })).toThrow();
    expect(() => runProcessIoObservationConfidenceTurbo([], {
      trigger: 'health.interval', completenessThreshold: 2
    })).toThrow();
    expect(() => runProcessIoObservationConfidenceTurbo([], {
      trigger: 'health.interval', persistenceThreshold: 0
    })).toThrow();
    expect(() => runProcessIoObservationConfidenceTurbo([], {
      trigger: 'health.interval', now: () => Number.NaN
    })).toThrow();
  });
});
