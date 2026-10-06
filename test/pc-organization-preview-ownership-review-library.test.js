import {
  ORGANIZATION_PREVIEW_OWNERSHIP_REVIEW_LIBRARY_ID,
  ORGANIZATION_PREVIEW_OWNERSHIP_REVIEW_LIBRARY_VERSION,
  buildOrganizationPreviewOwnershipReviewEnvelope,
  buildOrganizationPreviewOwnershipReviewPlan,
  createOrganizationPreviewOwnershipReviewLibrary,
  mergeOrganizationPreviewOwnershipReviewReports
} from '../pc/engines/organization-preview/turbos/ownership-review/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'organization-preview.ownership-review', state: 'no-user-owned-items', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, itemCount: 2,
    userOwnedCount: 0, unknownOwnershipCount: 0, observedCount: sampleCount,
    incompleteCount: 0, noOrganizationCount: 0, ownedSampleCount: 0,
    confidence: 1, ...overrides
  };
}

describe('organization-preview ownership-review library', () => {
  test('publishes identity and merges ownership evidence', () => {
    const merged = mergeOrganizationPreviewOwnershipReviewReports([
      report({ sampleCount: 2, itemCount: 1, observedCount: 2 }),
      report({ state: 'ownership-review-sustained', sampleCount: 6, observedCount: 5,
        userOwnedCount: 1, ownedSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(ORGANIZATION_PREVIEW_OWNERSHIP_REVIEW_LIBRARY_ID).toBe('organization-preview.ownership-review.library');
    expect(ORGANIZATION_PREVIEW_OWNERSHIP_REVIEW_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'ownership-review-sustained', sampleCount: 8,
      itemCount: 2, userOwnedCount: 1, unknownOwnershipCount: 0, observedCount: 7,
      ownedSampleCount: 3, confidence: 0.875,
      recommendations: ['request-explicit-organization-approval'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeOrganizationPreviewOwnershipReviewReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-ownership-evidence']
    });
    expect(mergeOrganizationPreviewOwnershipReviewReports([report({ state: 'no-organization-preview', sampleCount: 1,
      itemCount: 0, userOwnedCount: 0, unknownOwnershipCount: 0, observedCount: 0, noOrganizationCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-organization-preview', recommendations: ['no-organization-preview']
    });
    expect(mergeOrganizationPreviewOwnershipReviewReports([report({ state: 'incomplete-evidence',
      itemCount: 0, userOwnedCount: 0, unknownOwnershipCount: 0, observedCount: 0, incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-evidence', recommendations: ['request-explicit-ownership-evidence']
    });
    expect(mergeOrganizationPreviewOwnershipReviewReports([report({ state: 'ownership-review-observed',
      userOwnedCount: 1, ownedSampleCount: 1, confidence: 0.75 })]).recommendations)
      .toEqual(['observe-user-owned-review-boundary']);
    expect(mergeOrganizationPreviewOwnershipReviewReports([report()]).recommendations)
      .toEqual(['preview-proposals-only']);
    expect(mergeOrganizationPreviewOwnershipReviewReports([report({ state: 'insufficient-data', sampleCount: 1,
      itemCount: 0, userOwnedCount: 0, unknownOwnershipCount: 0, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeOrganizationPreviewOwnershipReviewReports([report({ state: 'insufficient-data', sampleCount: 0,
      itemCount: 0, userOwnedCount: 0, unknownOwnershipCount: 0, observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeOrganizationPreviewOwnershipReviewReports([
      report({ state: 'ownership-review-sustained' }), report({ state: 'no-organization-preview', sampleCount: 1,
        itemCount: 0, userOwnedCount: 0, unknownOwnershipCount: 0, observedCount: 0, noOrganizationCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-organization-preview' });
    const states = [
      ['ownership-review-sustained', 'approval-review', 750],
      ['ownership-review-observed', 'approval-observation', 1000],
      ['no-user-owned-items', 'no-user-owned-observation', 5000],
      ['no-organization-preview', 'no-organization-observation', 10000],
      ['incomplete-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-organization-preview';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildOrganizationPreviewOwnershipReviewPlan(report({ state, sampleCount,
        itemCount: empty ? 0 : 2, userOwnedCount: 0, unknownOwnershipCount: 0,
        observedCount: empty ? 0 : sampleCount, noOrganizationCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildOrganizationPreviewOwnershipReviewPlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildOrganizationPreviewOwnershipReviewPlan(report({ sampleCount: 0, itemCount: 0,
      userOwnedCount: 0, unknownOwnershipCount: 0, observedCount: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildOrganizationPreviewOwnershipReviewEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: ORGANIZATION_PREVIEW_OWNERSHIP_REVIEW_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createOrganizationPreviewOwnershipReviewLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(ORGANIZATION_PREVIEW_OWNERSHIP_REVIEW_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, itemCount: 0,
      userOwnedCount: 0, unknownOwnershipCount: 0, observedCount: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, counts, triggers, and clocks', () => {
    expect(() => mergeOrganizationPreviewOwnershipReviewReports(null)).toThrow('reports must be an array');
    expect(() => mergeOrganizationPreviewOwnershipReviewReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeOrganizationPreviewOwnershipReviewReports([null])).toThrow('report must be an object');
    expect(() => mergeOrganizationPreviewOwnershipReviewReports([report({ turbo: 'other' })]))
      .toThrow('requires an ownership-review turbo report');
    expect(() => mergeOrganizationPreviewOwnershipReviewReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeOrganizationPreviewOwnershipReviewReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeOrganizationPreviewOwnershipReviewReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeOrganizationPreviewOwnershipReviewReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noOrganizationCount', 'ownedSampleCount']) {
      expect(() => mergeOrganizationPreviewOwnershipReviewReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    for (const field of ['userOwnedCount', 'unknownOwnershipCount']) {
      expect(() => mergeOrganizationPreviewOwnershipReviewReports([report({ [field]: 3 })]))
        .toThrow('must fit inside itemCount');
    }
    expect(() => mergeOrganizationPreviewOwnershipReviewReports([report({ itemCount: 4097 })]))
      .toThrow('itemCount must be from 0 to 4096');
    expect(() => mergeOrganizationPreviewOwnershipReviewReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildOrganizationPreviewOwnershipReviewEnvelope(report())).toThrow('trigger is required');
    expect(() => buildOrganizationPreviewOwnershipReviewEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
