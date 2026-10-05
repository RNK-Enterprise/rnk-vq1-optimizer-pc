import {
  SWAP_LIBRARY_ID,
  SWAP_LIBRARY_VERSION,
  buildSwapEnvelope,
  classifySwap,
  compareSwap,
  createSwapLibrary
} from '../pc/engines/swap/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'interactive',
    memory: { swapTotalBytes: 8192, swapFreeBytes: 4096, swapUsedPercent: 50 },
    ...overrides
  };
}

describe('Swap library', () => {
  test('classifies normal, elevated, high, and no-swap states', () => {
    expect(classifySwap(facts())).toMatchObject({
      library: SWAP_LIBRARY_ID, libraryVersion: SWAP_LIBRARY_VERSION,
      totalBytes: 8192, freeBytes: 4096, usedPercent: 50,
      state: 'elevated', recommendations: ['observe-next-sample', 'review-documented-swap-policy']
    });
    expect(classifySwap(facts({ memory: {
      swapTotalBytes: 8192, swapFreeBytes: 7000, swapUsedPercent: 10
    } })).state).toBe('normal');
    expect(classifySwap(facts({ environment: 'headless', memory: {
      swapTotalBytes: 8192, swapFreeBytes: 100, swapUsedPercent: 80
    } })).recommendations).toEqual(['hold-destructive-actions', 'review-memory-pressure']);
    expect(classifySwap(facts({ memory: {
      swapTotalBytes: 0, swapFreeBytes: 0, swapUsedPercent: 100
    } })).recommendations).toEqual(['no-change', 'keep-no-swap-user-owned']);
  });

  test('separates unknown swap and environment evidence', () => {
    expect(classifySwap(facts({ environment: 'other', memory: {
      swapTotalBytes: undefined, swapFreeBytes: undefined, swapUsedPercent: undefined
    } }))).toMatchObject({
      environment: 'unknown', state: 'unknown', recommendations: ['request-environment-profile']
    });
    expect(classifySwap(facts({ memory: {
      swapTotalBytes: undefined, swapFreeBytes: 1, swapUsedPercent: undefined
    } })).recommendations).toEqual(['request-swap-observation']);
    expect(classifySwap(facts({ memory: {
      swapTotalBytes: -1, swapFreeBytes: -2, swapUsedPercent: -3
    } }))).toMatchObject({ totalBytes: null, freeBytes: null, usedPercent: 0, state: 'unknown' });
  });

  test('compares swap snapshots and builds immutable local facades', () => {
    expect(compareSwap(facts(), facts({ memory: {
      swapTotalBytes: 8192, swapFreeBytes: 4000, swapUsedPercent: 55
    } }))).toMatchObject({ changed: true, stateChanged: false, usedChanged: true, totalChanged: false, freeDelta: -96 });
    expect(compareSwap(facts(), facts({ memory: {
      swapTotalBytes: 16384, swapFreeBytes: 4096, swapUsedPercent: 50
    } }))).toMatchObject({ changed: true, stateChanged: false, usedChanged: false, totalChanged: true });
    expect(compareSwap(facts({ memory: {
      swapTotalBytes: 8192, swapFreeBytes: 4096, swapUsedPercent: 10
    } }), facts({ memory: {
      swapTotalBytes: 8192, swapFreeBytes: 4096, swapUsedPercent: 80
    } }))).toMatchObject({ changed: true, stateChanged: true });
    expect(compareSwap(facts(), facts())).toMatchObject({ changed: false });
    expect(compareSwap(facts(), facts({ memory: {
      swapTotalBytes: 8192, swapFreeBytes: -1, swapUsedPercent: 50
    } }))).toMatchObject({ freeDelta: null, changed: false });
    const envelope = buildSwapEnvelope(facts(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createSwapLibrary({ now: () => 1000 });
    expect(library.envelope(facts(), { trigger: 'x' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(Object.isFrozen(library)).toBe(true);
  });

  test('rejects malformed facts, clocks, triggers, and options', () => {
    expect(() => classifySwap(null)).toThrow('facts must be an object');
    expect(() => classifySwap({ ...facts(), engine: 'other' }))
      .toThrow('requires normalized system facts');
    expect(() => classifySwap({ ...facts(), memory: null })).toThrow('requires memory facts');
    expect(() => buildSwapEnvelope(facts())).toThrow('trigger is required');
    expect(() => buildSwapEnvelope(facts(), { trigger: 'x', now: () => Infinity }))
      .toThrow('clock must return a number');
    expect(() => createSwapLibrary(null)).toThrow('options must be an object');
    expect(() => createSwapLibrary().envelope(facts())).toThrow('trigger is required');
  });
});
