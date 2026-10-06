import {
  ORGANIZATION_PREVIEW_CATEGORY_DRIFT_LIBRARY_ID,
  ORGANIZATION_PREVIEW_CATEGORY_DRIFT_LIBRARY_VERSION,
  buildOrganizationPreviewCategoryDriftEnvelope,
  buildOrganizationPreviewCategoryDriftPlan,
  createOrganizationPreviewCategoryDriftLibrary,
  mergeOrganizationPreviewCategoryDriftReports
} from '../pc/engines/organization-preview/turbos/category-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'organization-preview.category-drift', state: 'stable-categories', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, itemCount: 2,
    unknownCategoryCount: 0, categoryChangeCount: 0, observedCount: sampleCount,
    incompleteCount: 0, noOrganizationCount: 0, comparisonCount: sampleCount - 1,
    categoryChangeSampleCount: 0, confidence: 1, ...overrides
  };
}

describe('organization-preview category-drift library', () => {
  test('publishes identity and merges category evidence', () => {
    const merged = mergeOrganizationPreviewCategoryDriftReports([
      report({ sampleCount: 2, itemCount: 1, observedCount: 2, comparisonCount: 1 }),
      report({ state: 'category-drift-sustained', sampleCount: 6, observedCount: 5,
        categoryChangeCount: 1, comparisonCount: 5, categoryChangeSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(ORGANIZATION_PREVIEW_CATEGORY_DRIFT_LIBRARY_ID).toBe('organization-preview.category-drift.library');
    expect(ORGANIZATION_PREVIEW_CATEGORY_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'category-drift-sustained', sampleCount: 8,
      itemCount: 2, unknownCategoryCount: 0, categoryChangeCount: 1, observedCount: 7,
      comparisonCount: 6, categoryChangeSampleCount: 3, confidence: 0.875,
      recommendations: ['review-category-drift-without-file-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeOrganizationPreviewCategoryDriftReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-organization-categories']
    });
    expect(mergeOrganizationPreviewCategoryDriftReports([report({ state: 'no-organization-preview', sampleCount: 1,
      itemCount: 0, unknownCategoryCount: 0, observedCount: 0, noOrganizationCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-organization-preview', recommendations: ['no-organization-preview']
    });
    expect(mergeOrganizationPreviewCategoryDriftReports([report({ state: 'incomplete-evidence',
      itemCount: 0, unknownCategoryCount: 0, observedCount: 0, incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-evidence', recommendations: ['request-organization-category-observation']
    });
    expect(mergeOrganizationPreviewCategoryDriftReports([report({ state: 'category-drift-observed',
      categoryChangeCount: 1, categoryChangeSampleCount: 1, confidence: 0.75 })]).recommendations)
      .toEqual(['observe-category-stability']);
    expect(mergeOrganizationPreviewCategoryDriftReports([report()]).recommendations).toEqual(['preview-proposals-only']);
    expect(mergeOrganizationPreviewCategoryDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      itemCount: 0, unknownCategoryCount: 0, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeOrganizationPreviewCategoryDriftReports([report({ state: 'insufficient-data', sampleCount: 0,
      itemCount: 0, unknownCategoryCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeOrganizationPreviewCategoryDriftReports([
      report({ state: 'category-drift-sustained' }), report({ state: 'no-organization-preview', sampleCount: 1,
        itemCount: 0, unknownCategoryCount: 0, observedCount: 0, noOrganizationCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-organization-preview' });
    const states = [
      ['category-drift-sustained', 'category-review', 750],
      ['category-drift-observed', 'category-observation', 1000],
      ['stable-categories', 'stable-category-observation', 5000],
      ['no-organization-preview', 'no-organization-observation', 10000],
      ['incomplete-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-organization-preview';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildOrganizationPreviewCategoryDriftPlan(report({ state, sampleCount,
        itemCount: empty ? 0 : 2, unknownCategoryCount: 0,
        observedCount: empty ? 0 : sampleCount, noOrganizationCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildOrganizationPreviewCategoryDriftPlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildOrganizationPreviewCategoryDriftPlan(report({ sampleCount: 0, itemCount: 0,
      unknownCategoryCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildOrganizationPreviewCategoryDriftEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: ORGANIZATION_PREVIEW_CATEGORY_DRIFT_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createOrganizationPreviewCategoryDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(ORGANIZATION_PREVIEW_CATEGORY_DRIFT_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, itemCount: 0,
      unknownCategoryCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, counts, triggers, and clocks', () => {
    expect(() => mergeOrganizationPreviewCategoryDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeOrganizationPreviewCategoryDriftReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeOrganizationPreviewCategoryDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeOrganizationPreviewCategoryDriftReports([report({ turbo: 'other' })]))
      .toThrow('requires a category-drift turbo report');
    expect(() => mergeOrganizationPreviewCategoryDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeOrganizationPreviewCategoryDriftReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeOrganizationPreviewCategoryDriftReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeOrganizationPreviewCategoryDriftReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noOrganizationCount', 'comparisonCount', 'categoryChangeSampleCount']) {
      expect(() => mergeOrganizationPreviewCategoryDriftReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeOrganizationPreviewCategoryDriftReports([report({ itemCount: 4097 })]))
      .toThrow('itemCount must be from 0 to 4096');
    expect(() => mergeOrganizationPreviewCategoryDriftReports([report({ unknownCategoryCount: 3 })]))
      .toThrow('unknownCategoryCount must fit inside itemCount');
    expect(() => mergeOrganizationPreviewCategoryDriftReports([report({ categoryChangeCount: 4097 })]))
      .toThrow('categoryChangeCount must be from 0 to 4096');
    expect(() => mergeOrganizationPreviewCategoryDriftReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildOrganizationPreviewCategoryDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildOrganizationPreviewCategoryDriftEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
