import {
  CPU_SCHEDULER_LIBRARY_ID,
  CPU_SCHEDULER_LIBRARY_VERSION,
  buildCpuSchedulerEnvelope,
  classifyCpuScheduler,
  compareCpuScheduler,
  createCpuSchedulerLibrary
} from '../pc/engines/cpu-scheduler/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    cpu: { runQueueLength: 2, contextSwitchesPerSecond: 1000, logicalCpus: 8 },
    ...overrides
  };
}

describe('CPU-scheduler library', () => {
  test('classifies normal, elevated, and high scheduler pressure', () => {
    expect(classifyCpuScheduler(facts())).toMatchObject({
      library: CPU_SCHEDULER_LIBRARY_ID,
      libraryVersion: CPU_SCHEDULER_LIBRARY_VERSION,
      runQueueLength: 2,
      contextSwitchesPerSecond: 1000,
      level: 'normal',
      samplingIntervalMs: 1000,
      recommendations: ['no-change']
    });
    expect(classifyCpuScheduler(facts({ cpu: {
      runQueueLength: 4, contextSwitchesPerSecond: 50000, logicalCpus: 8
    } })).level).toBe('elevated');
    expect(classifyCpuScheduler(facts({
      environment: 'headless',
      cpu: { runQueueLength: 16, contextSwitchesPerSecond: 100000, logicalCpus: 8 }
    }))).toMatchObject({
      level: 'high',
      samplingIntervalMs: 250,
      recommendations: ['protect-services']
    });
    expect(classifyCpuScheduler(facts({ cpu: {
      runQueueLength: 16, contextSwitchesPerSecond: 100000, logicalCpus: 8
    } })).recommendations).toEqual(['protect-foreground']);
  });

  test('handles unknown values, cadence, and comparison deltas', () => {
    expect(classifyCpuScheduler(facts({
      environment: 'unknown',
      cpu: { runQueueLength: undefined, contextSwitchesPerSecond: undefined, logicalCpus: undefined }
    }))).toMatchObject({
      level: 'unknown',
      samplingIntervalMs: 2000,
      recommendations: ['request-scheduler-observation']
    });
    expect(classifyCpuScheduler(facts({
      environment: 'headless',
      cpu: { runQueueLength: 1, contextSwitchesPerSecond: 1, logicalCpus: 8 }
    })).samplingIntervalMs).toBe(5000);
    expect(compareCpuScheduler(facts(), facts({ cpu: {
      runQueueLength: 5, contextSwitchesPerSecond: 50000, logicalCpus: 8
    } }))).toMatchObject({
      changed: true,
      runQueueDelta: 3,
      contextSwitchDelta: 49000,
      previousLevel: 'normal',
      currentLevel: 'elevated'
    });
    expect(compareCpuScheduler(facts({ cpu: {} }), facts({ cpu: {
      runQueueLength: 1, contextSwitchesPerSecond: 1, logicalCpus: 1
    } })).runQueueDelta).toBeNull();
    expect(compareCpuScheduler(facts(), facts({ cpu: {
      runQueueLength: 3, contextSwitchesPerSecond: 1000, logicalCpus: 8
    } })).changed).toBe(true);
    expect(compareCpuScheduler(facts(), facts({ cpu: {
      runQueueLength: 2, contextSwitchesPerSecond: 2000, logicalCpus: 8
    } })).changed).toBe(true);
  });

  test('bounds values and builds immutable envelopes and facades', () => {
    expect(classifyCpuScheduler(facts({ cpu: {
      runQueueLength: -1, contextSwitchesPerSecond: -2, logicalCpus: -3
    } })).runQueueLength).toBeNull();
    const envelope = buildCpuSchedulerEnvelope(facts(), {
      trigger: 'health.interval',
      now: () => 0
    });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createCpuSchedulerLibrary({ now: () => 1000 });
    expect(library.id).toBe(CPU_SCHEDULER_LIBRARY_ID);
    expect(library.version).toBe(CPU_SCHEDULER_LIBRARY_VERSION);
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(library.emptyRecommendations).toEqual([]);
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, options, triggers, and clocks', () => {
    expect(() => classifyCpuScheduler(null)).toThrow('facts must be an object');
    expect(() => classifyCpuScheduler({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyCpuScheduler({ ...facts(), cpu: null }))
      .toThrow('requires CPU facts');
    expect(() => buildCpuSchedulerEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildCpuSchedulerEnvelope(facts(), { trigger: '', now: () => 0 }))
      .toThrow('trigger is required');
    expect(() => buildCpuSchedulerEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createCpuSchedulerLibrary(null)).toThrow('options must be an object');
    expect(() => createCpuSchedulerLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
