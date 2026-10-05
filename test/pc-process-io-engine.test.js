import {
  PROCESS_IO_ENGINE_ID,
  PROCESS_IO_ENGINE_VERSION,
  PROCESS_IO_TRIGGERS,
  runProcessIoEngine
} from '../pc/engines/process-io/engine.js';

function facts(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'interactive',
    capabilities: { processIoObservation: true },
    processes: [
      { name: 'foreground-app', ioReadBytesPerSecond: 100, ioWriteBytesPerSecond: 50, ioWaitPercent: 2 },
      { name: 'service', ioReadBytesPerSecond: 200, ioWriteBytesPerSecond: 25, ioWaitPercent: 4 }
    ],
    ...overrides
  };
}

describe('Process-I/O engine', () => {
  test('publishes identity and triggers', () => {
    expect(PROCESS_IO_ENGINE_ID).toBe('process-io');
    expect(PROCESS_IO_ENGINE_VERSION).toBe(1);
    expect(PROCESS_IO_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(PROCESS_IO_TRIGGERS)).toBe(true);
  });

  test('aggregates normal process I/O without changes', () => {
    const result = runProcessIoEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => 0
    });
    expect(result).toMatchObject({
      engine: PROCESS_IO_ENGINE_ID,
      generatedAt: '1970-01-01T00:00:00.000Z',
      processCount: 2,
      names: ['foreground-app', 'service'],
      totalReadBytesPerSecond: 300,
      totalWriteBytesPerSecond: 75,
      maximumIoWaitPercent: 4,
      level: 'normal',
      observationEnabled: true,
      state: 'observe',
      confidence: 1,
      recommendations: ['no-change'],
      actions: []
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('classifies elevated and high I/O wait', () => {
    expect(runProcessIoEngine(facts({ processes: [
      { name: 'app', ioReadBytesPerSecond: 1, ioWriteBytesPerSecond: 2, ioWaitPercent: 10 }
    ] }), { trigger: 'workload.changed', now: () => 0 })).toMatchObject({
      level: 'elevated',
      state: 'watch',
      recommendations: ['observe-next-sample', 'review-storage-contention']
    });
    expect(runProcessIoEngine(facts({
      environment: 'headless',
      processes: [{ name: 'service', ioReadBytesPerSecond: 1, ioWriteBytesPerSecond: 2, ioWaitPercent: 30 }]
    }), { trigger: 'health.interval', now: () => 0 })).toMatchObject({
      level: 'high',
      state: 'protect-services',
      recommendations: ['protect-services', 'review-storage-contention']
    });
  });

  test('reports disabled, unknown, empty, and malformed observations', () => {
    expect(runProcessIoEngine(facts({
      capabilities: { processIoObservation: false }
    }), { trigger: 'install.preflight', now: () => 0 })).toMatchObject({
      observationEnabled: false,
      state: 'observation-disabled',
      recommendations: ['keep-process-io-observation-disabled']
    });
    expect(runProcessIoEngine(facts({ processes: [{}] }), {
      trigger: 'system.facts.request',
      now: () => 0
    })).toMatchObject({
      processCount: 1,
      names: [],
      totalReadBytesPerSecond: null,
      totalWriteBytesPerSecond: null,
      maximumIoWaitPercent: null,
      level: 'unknown',
      state: 'observation-required',
      confidence: 0.4,
      recommendations: ['request-process-io-observation']
    });
    expect(runProcessIoEngine(facts({
      environment: 'headless',
      processes: []
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      processCount: 0,
      level: 'unknown',
      state: 'no-processes',
      confidence: 0.2,
      recommendations: ['no-process-io-review']
    });
    expect(runProcessIoEngine(facts({ processes: [null, {
      name: '', ioReadBytesPerSecond: -1, ioWriteBytesPerSecond: -2, ioWaitPercent: 120
    }] }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      processCount: 1,
      names: [],
      totalReadBytesPerSecond: null,
      totalWriteBytesPerSecond: null,
      maximumIoWaitPercent: 100,
      level: 'high'
    });
  });

  test('requires a known environment, facts, triggers, and a clock', () => {
    expect(runProcessIoEngine(facts({
      environment: 'other',
      processes: []
    }), { trigger: 'system.facts.request', now: () => 0 })).toMatchObject({
      environment: 'unknown',
      state: 'profile-required',
      confidence: 0,
      recommendations: ['request-environment-profile']
    });
    expect(() => runProcessIoEngine(null, { trigger: 'system.facts.request' }))
      .toThrow('facts must be an object');
    expect(() => runProcessIoEngine({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires system-facts facts');
    expect(() => runProcessIoEngine(facts({ processes: null }), {
      trigger: 'system.facts.request'
    })).toThrow('require a process list');
    expect(() => runProcessIoEngine(facts(), { trigger: 'bad' }))
      .toThrow('Unsupported process-I/O trigger: bad');
    expect(() => runProcessIoEngine(facts(), {}))
      .toThrow('Unsupported process-I/O trigger: unknown');
    expect(() => runProcessIoEngine())
      .toThrow('Unsupported process-I/O trigger: unknown');
    expect(() => runProcessIoEngine(facts(), {
      trigger: 'system.facts.request',
      now: () => NaN
    })).toThrow('Process-I/O clock must return a number');
  });
});
