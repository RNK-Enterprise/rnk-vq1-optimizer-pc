import {
  MEMORY_PRESSURE_LIBRARY_ID,
  MEMORY_PRESSURE_LIBRARY_VERSION,
  buildMemoryPressureEnvelope,
  classifyMemoryPressure,
  compareMemoryPressure,
  createMemoryPressureLibrary
} from '../pc/engines/memory-pressure/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    memory: { usedPercent: 50, availableBytes: 4096, swapUsedPercent: 10 },
    ...overrides
  };
}

describe('Memory-pressure library', () => {
  test('classifies normal, elevated, and bounded evidence', () => {
    expect(classifyMemoryPressure(facts())).toMatchObject({
      library: MEMORY_PRESSURE_LIBRARY_ID,
      libraryVersion: MEMORY_PRESSURE_LIBRARY_VERSION,
      usedPercent: 50,
      headroomPercent: 50,
      availableBytes: 4096,
      level: 'normal',
      recommendations: ['no-change']
    });
    expect(classifyMemoryPressure(facts({ memory: {
      usedPercent: 80, availableBytes: -1, swapUsedPercent: 120
    } })).recommendations).toEqual(['observe-next-sample', 'review-approved-memory-policy']);
    expect(classifyMemoryPressure(facts({ memory: {
      usedPercent: -5, availableBytes: Number.NaN, swapUsedPercent: -4
    } })).usedPercent).toBe(0);
  });

  test('separates high headless, high interactive, and unknown states', () => {
    expect(classifyMemoryPressure(facts({ environment: 'headless', memory: {
      usedPercent: 95, availableBytes: 1, swapUsedPercent: 90
    } })).recommendations).toEqual(['protect-services', 'hold-destructive-actions']);
    expect(classifyMemoryPressure(facts({ memory: {
      usedPercent: 95, availableBytes: 1, swapUsedPercent: 90
    } })).recommendations).toEqual(['protect-foreground', 'hold-destructive-actions']);
    expect(classifyMemoryPressure(facts({ environment: 'other', memory: {
      usedPercent: undefined, availableBytes: undefined, swapUsedPercent: undefined
    } }))).toMatchObject({
      environment: 'unknown', level: 'unknown', recommendations: ['request-environment-profile']
    });
    expect(classifyMemoryPressure(facts({ memory: {
      usedPercent: undefined, availableBytes: 1, swapUsedPercent: undefined
    } })).recommendations).toEqual(['request-memory-observation']);
  });

  test('compares snapshots and builds immutable local facades', () => {
    expect(compareMemoryPressure(facts(), facts({ memory: {
      usedPercent: 55, availableBytes: 4096, swapUsedPercent: 10
    } }))).toMatchObject({ changed: true, levelChanged: false, usedChanged: true, swapChanged: false });
    expect(compareMemoryPressure(facts(), facts({ memory: {
      usedPercent: 50, availableBytes: 4096, swapUsedPercent: 20
    } }))).toMatchObject({ changed: true, levelChanged: false, usedChanged: false, swapChanged: true });
    expect(compareMemoryPressure(facts({ memory: {
      usedPercent: undefined, availableBytes: undefined, swapUsedPercent: undefined
    } }), facts({ memory: {
      usedPercent: undefined, availableBytes: undefined, swapUsedPercent: undefined
    } }))).toMatchObject({ changed: false, headroomDelta: null });
    const envelope = buildMemoryPressureEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createMemoryPressureLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyMemoryPressure(null)).toThrow('facts must be an object');
    expect(() => classifyMemoryPressure({ ...facts(), protocolVersion: 2 }))
      .toThrow('requires normalized system facts');
    expect(() => classifyMemoryPressure({ ...facts(), memory: null })).toThrow('requires memory facts');
    expect(() => buildMemoryPressureEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildMemoryPressureEnvelope(facts(), { trigger: 'x', now: () => Infinity }))
      .toThrow('clock must return a number');
    expect(() => createMemoryPressureLibrary(null)).toThrow('options must be an object');
    expect(() => createMemoryPressureLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
