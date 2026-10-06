import { STARTUP_OWNERSHIP_BOUNDARY_TRIGGERS, STARTUP_OWNERSHIP_BOUNDARY_TURBO_ID,
  STARTUP_OWNERSHIP_BOUNDARY_TURBO_VERSION, runStartupOwnershipBoundaryTurbo } from '../pc/engines/startup/turbos/ownership-boundary/turbo.js';

function facts(entry, overrides = {}) { return { engine: 'system-facts', environment: 'interactive', startup: [entry], ...overrides }; }
function item(overrides = {}) { return { name: 'launcher', enabled: false, userOwned: false, systemOwned: true, ...overrides }; }
describe('startup ownership-boundary turbo', () => {
  test('publishes identity and detects sustained ownership drift', () => {
    expect(STARTUP_OWNERSHIP_BOUNDARY_TURBO_ID).toBe('startup.ownership-boundary'); expect(STARTUP_OWNERSHIP_BOUNDARY_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(STARTUP_OWNERSHIP_BOUNDARY_TRIGGERS)).toBe(true);
    const result = runStartupOwnershipBoundaryTurbo([facts(item()), facts(item({ systemOwned: false })), facts(item({ systemOwned: true, name: 'other' }))], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: STARTUP_OWNERSHIP_BOUNDARY_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      entryCount: 1, userOwnedCount: 0, systemOwnedCount: 1, unknownOwnershipCount: 0, userOwnedEnabledCount: 0,
      comparisonCount: 2, changeCount: 2, finalEnvironment: 'interactive', state: 'ownership-drift-sustained', confidence: 1,
      recommendations: ['review-startup-ownership-drift-without-mutation'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes ownership states and bounded samples', () => {
    expect(runStartupOwnershipBoundaryTurbo([facts(item()), facts(item())], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stable-ownership' });
    expect(runStartupOwnershipBoundaryTurbo([facts(item()), facts(item({ name: 'other' }))], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'ownership-drift-observed', changeCount: 1 });
    expect(runStartupOwnershipBoundaryTurbo([facts(item({ systemOwned: false }))], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'ownership-required', unknownOwnershipCount: 1 });
    expect(runStartupOwnershipBoundaryTurbo([facts(item({ userOwned: true, systemOwned: false, enabled: true }))], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'user-owned-review', userOwnedEnabledCount: 1 });
    expect(runStartupOwnershipBoundaryTurbo([facts(item(), { startup: [] }), facts(item(), { startup: [] })], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-startup-items', entryCount: 0, confidence: 0.25 });
    expect(runStartupOwnershipBoundaryTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });
  test('normalizes names and environments', () => {
    expect(runStartupOwnershipBoundaryTurbo([facts(item({ name: '' }), { environment: 'other', startup: [null, item({ name: '' })] })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalEnvironment: 'unknown', entryCount: 1, systemOwnedCount: 1, confidence: 1 });
  });
  test('rejects invalid triggers, bounds, snapshots, lists, and clocks', () => {
    expect(() => runStartupOwnershipBoundaryTurbo([], { trigger: 'bad' })).toThrow('Unsupported startup ownership-boundary trigger: bad');
    expect(() => runStartupOwnershipBoundaryTurbo()).toThrow('Unsupported startup ownership-boundary trigger: unknown');
    expect(() => runStartupOwnershipBoundaryTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runStartupOwnershipBoundaryTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runStartupOwnershipBoundaryTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runStartupOwnershipBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runStartupOwnershipBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runStartupOwnershipBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runStartupOwnershipBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runStartupOwnershipBoundaryTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runStartupOwnershipBoundaryTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runStartupOwnershipBoundaryTurbo([{ engine: 'system-facts', startup: null }], { trigger: 'health.interval' })).toThrow('requires a startup list');
    expect(() => runStartupOwnershipBoundaryTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
