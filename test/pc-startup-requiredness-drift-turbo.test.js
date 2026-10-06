import { STARTUP_REQUIREDNESS_DRIFT_TRIGGERS, STARTUP_REQUIREDNESS_DRIFT_TURBO_ID,
  STARTUP_REQUIREDNESS_DRIFT_TURBO_VERSION, runStartupRequirednessDriftTurbo } from '../pc/engines/startup/turbos/requiredness-drift/turbo.js';

function facts(entry, overrides = {}) { return { engine: 'system-facts', environment: 'interactive', startup: [entry], ...overrides }; }
function item(overrides = {}) { return { name: 'launcher', enabled: true, required: false, ...overrides }; }
describe('startup requiredness-drift turbo', () => {
  test('publishes identity and detects sustained requiredness drift', () => {
    expect(STARTUP_REQUIREDNESS_DRIFT_TURBO_ID).toBe('startup.requiredness-drift'); expect(STARTUP_REQUIREDNESS_DRIFT_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(STARTUP_REQUIREDNESS_DRIFT_TRIGGERS)).toBe(true);
    const result = runStartupRequirednessDriftTurbo([facts(item()), facts(item({ required: true })), facts(item({ required: false, name: 'other' }))], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: STARTUP_REQUIREDNESS_DRIFT_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      entryCount: 1, requiredCount: 0, requiredDisabledCount: 0, comparisonCount: 2, changeCount: 2, finalEnvironment: 'interactive',
      state: 'requiredness-drift-sustained', confidence: 1, recommendations: ['review-startup-requiredness-drift-without-mutation'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes requiredness states and bounded samples', () => {
    expect(runStartupRequirednessDriftTurbo([facts(item()), facts(item())], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stable-requiredness' });
    expect(runStartupRequirednessDriftTurbo([facts(item()), facts(item({ required: true }))], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'requiredness-drift-observed', changeCount: 1 });
    expect(runStartupRequirednessDriftTurbo([facts(item({ required: true, enabled: false }))], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'required-disabled-review', requiredDisabledCount: 1 });
    expect(runStartupRequirednessDriftTurbo([facts(item(), { startup: [] }), facts(item(), { startup: [] })], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-startup-items', entryCount: 0, confidence: 0.25 });
    expect(runStartupRequirednessDriftTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });
  test('normalizes names and environments', () => {
    expect(runStartupRequirednessDriftTurbo([facts(item({ name: '' }), { environment: 'other', startup: [null, item({ name: '' })] })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalEnvironment: 'unknown', entryCount: 1, requiredCount: 0, confidence: 1 });
  });
  test('rejects invalid triggers, bounds, snapshots, lists, and clocks', () => {
    expect(() => runStartupRequirednessDriftTurbo([], { trigger: 'bad' })).toThrow('Unsupported startup requiredness-drift trigger: bad');
    expect(() => runStartupRequirednessDriftTurbo()).toThrow('Unsupported startup requiredness-drift trigger: unknown');
    expect(() => runStartupRequirednessDriftTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runStartupRequirednessDriftTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runStartupRequirednessDriftTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runStartupRequirednessDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runStartupRequirednessDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runStartupRequirednessDriftTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runStartupRequirednessDriftTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runStartupRequirednessDriftTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runStartupRequirednessDriftTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runStartupRequirednessDriftTurbo([{ engine: 'system-facts', startup: null }], { trigger: 'health.interval' })).toThrow('requires a startup list');
    expect(() => runStartupRequirednessDriftTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
