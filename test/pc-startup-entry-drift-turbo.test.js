import { STARTUP_ENTRY_DRIFT_TRIGGERS, STARTUP_ENTRY_DRIFT_TURBO_ID,
  STARTUP_ENTRY_DRIFT_TURBO_VERSION, runStartupEntryDriftTurbo } from '../pc/engines/startup/turbos/entry-drift/turbo.js';

function facts(entry, overrides = {}) { return { engine: 'system-facts', environment: 'interactive', startup: [entry], ...overrides }; }
function item(overrides = {}) { return { name: 'launcher', enabled: true, required: false, userOwned: false, delayMs: 10, ...overrides }; }
describe('startup entry-drift turbo', () => {
  test('publishes identity and detects sustained entry drift', () => {
    expect(STARTUP_ENTRY_DRIFT_TURBO_ID).toBe('startup.entry-drift'); expect(STARTUP_ENTRY_DRIFT_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(STARTUP_ENTRY_DRIFT_TRIGGERS)).toBe(true);
    const result = runStartupEntryDriftTurbo([facts(item()), facts(item({ enabled: false })), facts(item({ enabled: true, delayMs: 20 }))], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: STARTUP_ENTRY_DRIFT_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      entryCount: 1, unknownCount: 0, requiredDisabledCount: 0, userOwnedEnabledCount: 0, namedCount: 1,
      comparisonCount: 2, changeCount: 2, finalEnvironment: 'interactive', state: 'entry-drift-sustained', confidence: 1,
      recommendations: ['review-startup-entry-drift-without-mutation'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes entry states and bounded samples', () => {
    expect(runStartupEntryDriftTurbo([facts(item()), facts(item())], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stable-startup' });
    expect(runStartupEntryDriftTurbo([facts(item()), facts(item({ delayMs: 20 }))], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'entry-drift-observed', changeCount: 1 });
    expect(runStartupEntryDriftTurbo([facts(item({ enabled: null }))], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'observation-required', unknownCount: 1 });
    expect(runStartupEntryDriftTurbo([facts(item({ enabled: false, required: true }))], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'required-review', requiredDisabledCount: 1 });
    expect(runStartupEntryDriftTurbo([facts(item({ userOwned: true }))], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'user-owned-review', userOwnedEnabledCount: 1 });
    expect(runStartupEntryDriftTurbo([facts(item(), { startup: [] }), facts(item(), { startup: [] })], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-startup-items', entryCount: 0, confidence: 0.25 });
    expect(runStartupEntryDriftTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });
  test('normalizes rows and environments', () => {
    expect(runStartupEntryDriftTurbo([facts(item({ name: '', delayMs: null }), { environment: 'other', startup: [null, item({ name: '', delayMs: -1 })] })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalEnvironment: 'unknown', entryCount: 1, namedCount: 0, confidence: 0.5 });
  });
  test('rejects invalid triggers, bounds, snapshots, lists, and clocks', () => {
    expect(() => runStartupEntryDriftTurbo([], { trigger: 'bad' })).toThrow('Unsupported startup entry-drift trigger: bad');
    expect(() => runStartupEntryDriftTurbo()).toThrow('Unsupported startup entry-drift trigger: unknown');
    expect(() => runStartupEntryDriftTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runStartupEntryDriftTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runStartupEntryDriftTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runStartupEntryDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runStartupEntryDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runStartupEntryDriftTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runStartupEntryDriftTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runStartupEntryDriftTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runStartupEntryDriftTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runStartupEntryDriftTurbo([{ engine: 'system-facts', startup: null }], { trigger: 'health.interval' })).toThrow('requires a startup list');
    expect(() => runStartupEntryDriftTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
