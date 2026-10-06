import { TEMP_OWNERSHIP_DRIFT_TRIGGERS, TEMP_OWNERSHIP_DRIFT_TURBO_ID,
  TEMP_OWNERSHIP_DRIFT_TURBO_VERSION, runTempOwnershipDriftTurbo } from '../pc/engines/temp-cleanup/turbos/ownership-drift/turbo.js';

function facts(item, overrides = {}) { return { engine: 'system-facts', environment: 'interactive', temporaryFiles: [item], ...overrides }; }
function file(systemOwned, userOwned = false) { return { temporary: true, systemOwned, userOwned, name: 'temp', sizeBytes: 1 }; }
describe('temp-cleanup ownership-drift turbo', () => {
  test('publishes identity and detects sustained ownership drift', () => {
    expect(TEMP_OWNERSHIP_DRIFT_TURBO_ID).toBe('temp-cleanup.ownership-drift'); expect(TEMP_OWNERSHIP_DRIFT_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(TEMP_OWNERSHIP_DRIFT_TRIGGERS)).toBe(true);
    const result = runTempOwnershipDriftTurbo([facts(file(true)), facts(file(false, true)), facts(file(true))], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: TEMP_OWNERSHIP_DRIFT_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      fileCount: 1, systemOwnedCount: 1, userOwnedCount: 0, unknownOwnershipCount: 0, comparisonCount: 2, changeCount: 2,
      finalEnvironment: 'interactive', state: 'ownership-drift-sustained', confidence: 1, recommendations: ['review-temp-ownership-drift-without-mutation'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes ownership states and empty evidence', () => {
    expect(runTempOwnershipDriftTurbo([facts(file(true)), facts(file(true))], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'stable-ownership' });
    expect(runTempOwnershipDriftTurbo([facts(file(false, true))], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'user-owned-review', userOwnedCount: 1 });
    expect(runTempOwnershipDriftTurbo([facts(file(false))], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'ownership-required', unknownOwnershipCount: 1 });
    expect(runTempOwnershipDriftTurbo([facts(file(true), { temporaryFiles: [] }), facts(file(true), { temporaryFiles: [] })], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-temp-review', fileCount: 0, confidence: 0.25 });
    expect(runTempOwnershipDriftTurbo([facts(file(false, true)), facts(file(true))], { trigger: 'workload.changed', now: () => 0 })).toMatchObject({ state: 'ownership-drift-observed', changeCount: 1 });
    expect(runTempOwnershipDriftTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });
  test('normalizes rows and environments', () => {
    expect(runTempOwnershipDriftTurbo([facts(file(true), { environment: 'other', temporaryFiles: [null, file(true)] })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalEnvironment: 'unknown', fileCount: 1, systemOwnedCount: 1, state: 'stable-ownership', confidence: 1 });
  });
  test('rejects invalid triggers, bounds, snapshots, lists, and clocks', () => {
    expect(() => runTempOwnershipDriftTurbo([], { trigger: 'bad' })).toThrow('Unsupported temp-cleanup ownership-drift trigger: bad');
    expect(() => runTempOwnershipDriftTurbo()).toThrow('Unsupported temp-cleanup ownership-drift trigger: unknown');
    expect(() => runTempOwnershipDriftTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runTempOwnershipDriftTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runTempOwnershipDriftTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runTempOwnershipDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runTempOwnershipDriftTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runTempOwnershipDriftTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runTempOwnershipDriftTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runTempOwnershipDriftTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runTempOwnershipDriftTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runTempOwnershipDriftTurbo([{ engine: 'system-facts', temporaryFiles: null }], { trigger: 'health.interval' })).toThrow('requires a temporary-file list');
    expect(() => runTempOwnershipDriftTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
