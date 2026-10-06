import { TEMP_PREVIEW_SAFETY_TRIGGERS, TEMP_PREVIEW_SAFETY_TURBO_ID,
  TEMP_PREVIEW_SAFETY_TURBO_VERSION, runTempPreviewSafetyTurbo } from '../pc/engines/temp-cleanup/turbos/preview-safety/turbo.js';

function facts(item, overrides = {}) { return { engine: 'system-facts', environment: 'interactive', temporaryFiles: [item], ...overrides }; }
function file(overrides = {}) { return { temporary: true, systemOwned: true, userOwned: false, name: 'temp', sizeBytes: 1, ...overrides }; }
describe('temp-cleanup preview-safety turbo', () => {
  test('publishes identity and reports stable safe previews', () => {
    expect(TEMP_PREVIEW_SAFETY_TURBO_ID).toBe('temp-cleanup.preview-safety'); expect(TEMP_PREVIEW_SAFETY_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(TEMP_PREVIEW_SAFETY_TRIGGERS)).toBe(true);
    const result = runTempPreviewSafetyTurbo([facts(file()), facts(file())], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: TEMP_PREVIEW_SAFETY_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 2,
      fileCount: 1, safeCount: 1, reviewCount: 0, userOwnedCount: 0, incompleteCount: 0, candidateBytes: 1,
      comparisonCount: 1, changeCount: 0, finalEnvironment: 'interactive', state: 'preview-safe-stable', confidence: 1,
      recommendations: ['preview-safe-temp-candidates'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes safety states, drift, and empty evidence', () => {
    expect(runTempPreviewSafetyTurbo([facts(file({ userOwned: true }))], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ state: 'user-owned-review', userOwnedCount: 1, confidence: 0.5 });
    expect(runTempPreviewSafetyTurbo([facts(file({ systemOwned: false })), facts(file({ name: '' }))], { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ state: 'safety-evidence-required', reviewCount: 1, incompleteCount: 1, confidence: 0.5 });
    expect(runTempPreviewSafetyTurbo([facts(file()), facts(file({ sizeBytes: 2 }))], { trigger: 'workload.changed', now: () => 0 }))
      .toMatchObject({ state: 'preview-drift-observed', changeCount: 1 });
    expect(runTempPreviewSafetyTurbo([facts(file()), facts(file({ sizeBytes: 2 })), facts(file({ sizeBytes: 3 }))], { trigger: 'workload.changed', now: () => 0 }))
      .toMatchObject({ state: 'preview-drift-sustained', changeCount: 2 });
    expect(runTempPreviewSafetyTurbo([facts(file(), { temporaryFiles: [] }), facts(file(), { temporaryFiles: [] })], { trigger: 'health.interval', now: () => 0 }))
      .toMatchObject({ state: 'no-temp-review', fileCount: 0, confidence: 0.25 });
    expect(runTempPreviewSafetyTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', confidence: 0 });
  });
  test('normalizes rows, environments, and evidence fields', () => {
    expect(runTempPreviewSafetyTurbo([facts(file({ temporary: false }), { environment: 'other', temporaryFiles: [null, file({ temporary: false }), file({ sizeBytes: -1 })] })], {
      trigger: 'workload.changed', minimumSamples: 1, now: () => 0
    })).toMatchObject({ finalEnvironment: 'unknown', fileCount: 2, reviewCount: 2, incompleteCount: 2, state: 'safety-evidence-required', confidence: 0.5 });
  });
  test('rejects invalid triggers, bounds, snapshots, lists, and clocks', () => {
    expect(() => runTempPreviewSafetyTurbo([], { trigger: 'bad' })).toThrow('Unsupported temp-cleanup preview-safety trigger: bad');
    expect(() => runTempPreviewSafetyTurbo()).toThrow('Unsupported temp-cleanup preview-safety trigger: unknown');
    expect(() => runTempPreviewSafetyTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runTempPreviewSafetyTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runTempPreviewSafetyTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runTempPreviewSafetyTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runTempPreviewSafetyTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runTempPreviewSafetyTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runTempPreviewSafetyTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runTempPreviewSafetyTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runTempPreviewSafetyTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runTempPreviewSafetyTurbo([{ engine: 'system-facts', temporaryFiles: null }], { trigger: 'health.interval' })).toThrow('requires a temporary-file list');
    expect(() => runTempPreviewSafetyTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
