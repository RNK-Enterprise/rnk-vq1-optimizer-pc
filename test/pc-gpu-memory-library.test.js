import {
  GPU_MEMORY_LIBRARY_ID,
  GPU_MEMORY_LIBRARY_VERSION,
  buildGpuMemoryEnvelope,
  classifyGpuMemory,
  compareGpuMemory,
  createGpuMemoryLibrary
} from '../pc/engines/gpu-memory/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    gpus: [{ vramBytes: 4096, vramUsedBytes: 2048 }],
    ...overrides
  };
}

describe('GPU-memory library', () => {
  test('classifies normal, elevated, and bounded VRAM occupancy', () => {
    expect(classifyGpuMemory(facts())).toMatchObject({
      library: GPU_MEMORY_LIBRARY_ID, libraryVersion: GPU_MEMORY_LIBRARY_VERSION,
      gpuCount: 1, totalVramBytes: 4096, maximumUsedPercent: 50,
      occupancyKnownCount: 1, level: 'normal', recommendations: ['no-change']
    });
    expect(classifyGpuMemory(facts({ gpus: [
      { vramBytes: 4096, vramUsedBytes: 3072 },
      { vramBytes: 0, vramUsedBytes: 100 }
    ] }))).toMatchObject({
      gpuCount: 2, totalVramBytes: 4096, maximumUsedPercent: 75,
      occupancyKnownCount: 1, level: 'elevated'
    });
  });

  test('preserves absent, unknown, and high-pressure memory states', () => {
    expect(classifyGpuMemory(facts({ gpus: [] })).recommendations)
      .toEqual(['no-change', 'keep-gpu-memory-controls-disabled']);
    expect(classifyGpuMemory(facts({ gpus: [{ vramBytes: null, vramUsedBytes: null }] })))
      .toMatchObject({ gpuCount: 1, totalVramBytes: null, maximumUsedPercent: null,
        occupancyKnownCount: 0, level: 'unknown', recommendations: ['request-vram-observation'] });
    expect(classifyGpuMemory(facts({ environment: 'headless', gpus: [
      { vramBytes: 4096, vramUsedBytes: 4096 }
    ] })).recommendations).toEqual(['protect-services', 'hold-unapproved-memory-policy']);
    expect(classifyGpuMemory(facts({ gpus: [
      { vramBytes: 4096, vramUsedBytes: 4096 }
    ] })).recommendations).toEqual(['protect-foreground', 'hold-unapproved-memory-policy']);
    expect(classifyGpuMemory(facts({ environment: 'other', gpus: [] })).recommendations)
      .toEqual(['request-environment-profile']);
  });

  test('compares memory observations and builds immutable local facades', () => {
    expect(compareGpuMemory(facts(), facts({ gpus: [
      { vramBytes: 4096, vramUsedBytes: 2304 }
    ] }))).toMatchObject({ changed: true, levelChanged: false, occupancyChanged: true, countChanged: false });
    expect(compareGpuMemory(facts(), facts({ gpus: [] })))
      .toMatchObject({ changed: true, countChanged: true });
    expect(compareGpuMemory(facts(), facts())).toMatchObject({ changed: false });
    const envelope = buildGpuMemoryEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createGpuMemoryLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifyGpuMemory(null)).toThrow('facts must be an object');
    expect(() => classifyGpuMemory({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifyGpuMemory({ ...facts(), gpus: null })).toThrow('requires a GPU list');
    expect(() => buildGpuMemoryEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildGpuMemoryEnvelope(facts(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
    expect(() => createGpuMemoryLibrary(null)).toThrow('options must be an object');
    expect(() => createGpuMemoryLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
