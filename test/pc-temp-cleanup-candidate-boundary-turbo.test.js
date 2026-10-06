import { TEMP_CANDIDATE_BOUNDARY_TRIGGERS, TEMP_CANDIDATE_BOUNDARY_TURBO_ID,
  TEMP_CANDIDATE_BOUNDARY_TURBO_VERSION, runTempCandidateBoundaryTurbo } from '../pc/engines/temp-cleanup/turbos/candidate-boundary/turbo.js';

function facts(file, overrides = {}) {
  return { engine: 'system-facts', environment: 'interactive', temporaryFiles: [file], ...overrides };
}
function candidate(name, sizeBytes, overrides = {}) { return { name, sizeBytes, temporary: true, systemOwned: true, ...overrides }; }
describe('temp-cleanup candidate-boundary turbo', () => {
  test('publishes identity and detects sustained candidate drift', () => {
    expect(TEMP_CANDIDATE_BOUNDARY_TURBO_ID).toBe('temp-cleanup.candidate-boundary'); expect(TEMP_CANDIDATE_BOUNDARY_TURBO_VERSION).toBe(1);
    expect(Object.isFrozen(TEMP_CANDIDATE_BOUNDARY_TRIGGERS)).toBe(true);
    const result = runTempCandidateBoundaryTurbo([facts(candidate('a', 10)), facts(candidate('b', 20)), facts(candidate('c', 30))], { trigger: 'system.facts.request', now: () => 0 });
    expect(result).toMatchObject({ turbo: TEMP_CANDIDATE_BOUNDARY_TURBO_ID, generatedAt: '1970-01-01T00:00:00.000Z', sampleCount: 3,
      fileCount: 1, candidateCount: 1, reviewCount: 0, completeCount: 1, candidateBytes: 30, comparisonCount: 2, changeCount: 2,
      finalEnvironment: 'interactive', state: 'candidate-drift-sustained', confidence: 1, recommendations: ['review-candidate-drift-without-file-mutation'], actions: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
  test('distinguishes preview, review, empty, and incomplete states', () => {
    expect(runTempCandidateBoundaryTurbo([facts(candidate('a', 1)), facts(candidate('a', 1))], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'preview-stable' });
    expect(runTempCandidateBoundaryTurbo([facts(candidate('a', 1)), facts(candidate('b', 1))], { trigger: 'workload.changed', persistenceThreshold: 2, now: () => 0 })).toMatchObject({ state: 'candidate-drift-observed', changeCount: 1 });
    expect(runTempCandidateBoundaryTurbo([facts({ name: 'owned', temporary: true, systemOwned: true, userOwned: true })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'review-required', reviewCount: 1 });
    expect(runTempCandidateBoundaryTurbo([facts({ name: 'ambiguous', temporary: false, systemOwned: true })], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'review-required', reviewCount: 1 });
    expect(runTempCandidateBoundaryTurbo([facts(candidate('a', 1), { temporaryFiles: [] }), facts(candidate('a', 1), { temporaryFiles: [] })], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'no-temp-review', confidence: 0.25 });
    expect(runTempCandidateBoundaryTurbo([facts(candidate('', 'bad'))], { trigger: 'health.interval', minimumSamples: 1, now: () => 0 })).toMatchObject({ state: 'preview-stable', completeCount: 0, confidence: 0.5 });
    expect(runTempCandidateBoundaryTurbo([], { trigger: 'health.interval', now: () => 0 })).toMatchObject({ state: 'insufficient-data', sampleCount: 0, confidence: 0 });
  });
  test('normalizes rows and environments', () => {
    expect(runTempCandidateBoundaryTurbo([facts(candidate('a', 2), { environment: 'other', temporaryFiles: [null, candidate('a', 2)] })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ finalEnvironment: 'unknown', fileCount: 1, candidateCount: 1, state: 'preview-stable', confidence: 1 });
    expect(runTempCandidateBoundaryTurbo([facts(candidate(null, null), { temporaryFiles: [{ name: null, sizeBytes: null, temporary: true, systemOwned: true }] })], { trigger: 'workload.changed', minimumSamples: 1, now: () => 0 }))
      .toMatchObject({ fileCount: 1, candidateCount: 1, completeCount: 0, candidateBytes: 0, confidence: 0.5 });
  });
  test('rejects invalid triggers, bounds, snapshots, lists, and clocks', () => {
    expect(() => runTempCandidateBoundaryTurbo([], { trigger: 'bad' })).toThrow('Unsupported temp-cleanup candidate-boundary trigger: bad');
    expect(() => runTempCandidateBoundaryTurbo()).toThrow('Unsupported temp-cleanup candidate-boundary trigger: unknown');
    expect(() => runTempCandidateBoundaryTurbo(null, { trigger: 'health.interval' })).toThrow('samples must be an array');
    expect(() => runTempCandidateBoundaryTurbo([], { trigger: 'health.interval', windowSize: 1 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runTempCandidateBoundaryTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize must be an integer from 2 to 64');
    expect(() => runTempCandidateBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 0 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runTempCandidateBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, minimumSamples: 5 })).toThrow('minimumSamples must fit inside the window');
    expect(() => runTempCandidateBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 0 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runTempCandidateBoundaryTurbo([], { trigger: 'health.interval', windowSize: 4, persistenceThreshold: 5 })).toThrow('persistenceThreshold must be an integer');
    expect(() => runTempCandidateBoundaryTurbo([null], { trigger: 'health.interval' })).toThrow('snapshot must be an object');
    expect(() => runTempCandidateBoundaryTurbo([{ engine: 'other' }], { trigger: 'health.interval' })).toThrow('requires a system-facts snapshot');
    expect(() => runTempCandidateBoundaryTurbo([{ engine: 'system-facts', temporaryFiles: null }], { trigger: 'health.interval' })).toThrow('requires a temporary-file list');
    expect(() => runTempCandidateBoundaryTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock must return a number');
  });
});
