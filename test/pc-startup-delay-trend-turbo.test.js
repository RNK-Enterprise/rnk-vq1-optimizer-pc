import { STARTUP_DELAY_TREND_TRIGGERS, STARTUP_DELAY_TREND_TURBO_ID,
  STARTUP_DELAY_TREND_TURBO_VERSION, runStartupDelayTrendTurbo } from '../pc/engines/startup/turbos/delay-trend/turbo.js';

function facts(delay, overrides = {}) { return { engine: 'system-facts', environment: 'interactive', startup: [{ name: 'launcher', delayMs: delay }], ...overrides }; }
describe('startup delay-trend turbo', () => {
  test('publishes identity and detects sustained delay growth', () => {
    expect(STARTUP_DELAY_TREND_TURBO_ID).toBe('startup.delay-trend'); expect(STARTUP_DELAY_TREND_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(STARTUP_DELAY_TREND_TRIGGERS)).toBe(true);
    const result = runStartupDelayTrendTurbo([facts(100), facts(200), facts(300)], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: STARTUP_DELAY_TREND_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      delayThresholdMs: 50, observedCount: 3, unknownCount: 0, comparisonCount: 2, changedCount: 2, risingCount: 2, fallingCount: 0,
      finalMaximumDelayMs: 300, finalEntryCount: 1, finalEnvironment: 'interactive', state: 'delay-rising-sustained', confidence: 1,
      recommendations: ['review-startup-delay-growth-without-mutation'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes delay states and bounded samples', () => {
    expect(runStartupDelayTrendTurbo([facts(100), facts(100)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stable-delay' });
    expect(runStartupDelayTrendTurbo([facts(100), facts(200)], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'delay-rising-observed', risingCount: 1 });
    expect(runStartupDelayTrendTurbo([facts(300), facts(200), facts(100)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'delay-falling-sustained', fallingCount: 2 });
    expect(runStartupDelayTrendTurbo([facts(200), facts(100)], { trigger: 'health.interval', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'delay-falling-observed', fallingCount: 1 });
    expect(runStartupDelayTrendTurbo([facts(null)], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'delay-unknown', observedCount: 0 });
    expect(runStartupDelayTrendTurbo([facts(100), facts(null)], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'delay-observation-required', unknownCount: 1 });
    expect(runStartupDelayTrendTurbo([facts(null, { startup: [] }), facts(null, { startup: [] })], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-startup-items', finalEntryCount: 0, confidence: 0 });
    expect(runStartupDelayTrendTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, finalMaximumDelayMs: null, confidence: 0 });
  });
  test('normalizes delay and environment evidence', () => {
    expect(runStartupDelayTrendTurbo([facts(6000, { environment: 'other' })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalMaximumDelayMs: 6000, finalEnvironment: 'unknown', state: 'stable-delay', confidence: 1 });
    expect(runStartupDelayTrendTurbo([facts(-1)], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalMaximumDelayMs: null, state: 'delay-unknown' });
  });
  test('rejects invalid triggers, bounds, snapshots, thresholds, and clocks', () => {
    expect(() => runStartupDelayTrendTurbo([], { trigger: 'bad' })).toThrow('Unsupported startup delay-trend trigger: bad');
    expect(() => runStartupDelayTrendTurbo()).toThrow('Unsupported startup delay-trend trigger: unknown');
    expect(() => runStartupDelayTrendTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runStartupDelayTrendTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runStartupDelayTrendTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runStartupDelayTrendTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runStartupDelayTrendTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runStartupDelayTrendTurbo([], { trigger: 'health.interval', delayThresholdMs: 0 })).toThrow('delayThresholdMs must be from 1 to 5000');
    expect(() => runStartupDelayTrendTurbo([], { trigger: 'health.interval', delayThresholdMs: 5001 })).toThrow('delayThresholdMs must be from 1 to 5000');
    expect(() => runStartupDelayTrendTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runStartupDelayTrendTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runStartupDelayTrendTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runStartupDelayTrendTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runStartupDelayTrendTurbo([{ engine: 'system-facts', startup: null }], { trigger: 'health.interval' })).toThrow('requires a startup list');
    expect(() => runStartupDelayTrendTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
