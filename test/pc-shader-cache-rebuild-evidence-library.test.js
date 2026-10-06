import { SHADER_REBUILD_EVIDENCE_LIBRARY_ID, SHADER_REBUILD_EVIDENCE_LIBRARY_VERSION,
  buildShaderRebuildEvidenceEnvelope, buildShaderRebuildEvidencePlan, createShaderRebuildEvidenceLibrary,
  mergeShaderRebuildEvidenceReports } from '../pc/engines/shader-cache/turbos/rebuild-evidence/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return { turbo: 'shader-cache.rebuild-evidence', state: 'rebuild-evidence-observed', sampleCount, minimumSamples: 2, persistenceThreshold: 2,
    cacheCount: 1, staleCount: 1, documentedCount: 1, undocumentedCount: 0, unknownEvidenceCount: 0, comparisonCount: Math.max(0, sampleCount - 1), changeCount: 0,
    finalEnvironment: 'interactive', confidence: 1, ...overrides };
}
describe('shader-cache rebuild-evidence library', () => {
  test('publishes identity and merges reports', () => {
    const merged = mergeShaderRebuildEvidenceReports([report({ sampleCount: 2, comparisonCount: 1 }), report({ state: 'rebuild-evidence-drift-sustained', changeCount: 2, finalEnvironment: 'headless' })]);
    expect(SHADER_REBUILD_EVIDENCE_LIBRARY_ID).toBe('shader-cache.rebuild-evidence.library'); expect(SHADER_REBUILD_EVIDENCE_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'rebuild-evidence-drift-sustained', sampleCount: 6, cacheCount: 1, staleCount: 1, documentedCount: 1, comparisonCount: 4, changeCount: 2, finalEnvironment: 'headless', recommendations: ['review-rebuild-evidence-drift-without-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });
  test('merges states and builds plans', () => {
    expect(mergeShaderRebuildEvidenceReports([])).toMatchObject({ state: 'insufficient-data', recommendations: ['collect-more-rebuild-evidence-samples'] });
    expect(mergeShaderRebuildEvidenceReports([report({ state: 'no-caches', cacheCount: 0, staleCount: 0, documentedCount: 0, comparisonCount: 0, confidence: 0.5 })]).recommendations).toEqual(['no-shader-cache-review']);
    expect(mergeShaderRebuildEvidenceReports([report({ state: 'observation-required', unknownEvidenceCount: 1, documentedCount: 0 })]).recommendations).toEqual(['request-complete-rebuild-evidence']);
    expect(mergeShaderRebuildEvidenceReports([report({ state: 'no-stale-caches', staleCount: 0, documentedCount: 0 })]).recommendations).toEqual(['no-rebuild-review']);
    expect(mergeShaderRebuildEvidenceReports([report({ state: 'rebuild-evidence-required', documentedCount: 0, undocumentedCount: 1 })]).recommendations).toEqual(['request-driver-documented-rebuild-path']);
    expect(mergeShaderRebuildEvidenceReports([report({ state: 'rebuild-evidence-drift-observed', changeCount: 1 })]).recommendations).toEqual(['observe-rebuild-evidence-stability']);
    expect(mergeShaderRebuildEvidenceReports([report()]).recommendations).toEqual(['review-documented-rebuild-path-without-execution']);
    expect(mergeShaderRebuildEvidenceReports([report({ state: 'insufficient-data', sampleCount: 1, cacheCount: 0, staleCount: 0, documentedCount: 0, comparisonCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    for (const [state, mode, intervalMs, sampleCount, cacheCount, staleCount, documentedCount, confidence] of [['no-caches', 'empty-observation', 10000, 4, 0, 0, 0, 0.5], ['no-stale-caches', 'no-rebuild-review', 10000, 4, 1, 0, 0, 1], ['rebuild-evidence-required', 'evidence-request', 1500, 4, 1, 1, 0, 1], ['rebuild-evidence-drift-sustained', 'evidence-review', 1000, 4, 1, 1, 1, 1], ['rebuild-evidence-drift-observed', 'evidence-observation', 1500, 4, 1, 1, 1, 1], ['observation-required', 'evidence-bootstrap', 2000, 4, 1, 1, 0, 0.5], ['insufficient-data', 'evidence-bootstrap', 2000, 0, 0, 0, 0, 0], ['rebuild-evidence-observed', 'documented-review', 5000, 4, 1, 1, 1, 1]]) {
      expect(buildShaderRebuildEvidencePlan(report({ state, sampleCount, cacheCount, staleCount, documentedCount, undocumentedCount: state === 'rebuild-evidence-required' ? 1 : 0, unknownEvidenceCount: state === 'observation-required' ? 1 : 0, comparisonCount: Math.max(0, sampleCount - 1), confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state });
    }
    expect(buildShaderRebuildEvidencePlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 });
    expect(buildShaderRebuildEvidencePlan(report({ sampleCount: 0, cacheCount: 0, staleCount: 0, documentedCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds envelopes and factories', () => {
    const envelope = buildShaderRebuildEvidenceEnvelope(report(), { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z'); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createShaderRebuildEvidenceLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(SHADER_REBUILD_EVIDENCE_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports and envelope inputs', () => {
    expect(() => mergeShaderRebuildEvidenceReports(null)).toThrow('reports must be an array');
    expect(() => mergeShaderRebuildEvidenceReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports');
    expect(() => mergeShaderRebuildEvidenceReports([null])).toThrow('report must be an object');
    expect(() => mergeShaderRebuildEvidenceReports([report({ turbo: 'other' })])).toThrow('requires a rebuild-evidence turbo report');
    expect(() => mergeShaderRebuildEvidenceReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeShaderRebuildEvidenceReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeShaderRebuildEvidenceReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeShaderRebuildEvidenceReports([report({ persistenceThreshold: 65 })])).toThrow('persistenceThreshold must be from 1 to 64');
    expect(() => mergeShaderRebuildEvidenceReports([report({ cacheCount: -1 })])).toThrow('must be from 0 to 4096');
    expect(() => mergeShaderRebuildEvidenceReports([report({ finalEnvironment: 'other' })])).toThrow('finalEnvironment must be normalized');
    expect(() => mergeShaderRebuildEvidenceReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1');
    expect(() => buildShaderRebuildEvidenceEnvelope(report())).toThrow('trigger is required');
    expect(() => buildShaderRebuildEvidenceEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
