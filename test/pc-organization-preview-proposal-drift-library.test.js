import {
  ORGANIZATION_PREVIEW_PROPOSAL_DRIFT_LIBRARY_ID,
  ORGANIZATION_PREVIEW_PROPOSAL_DRIFT_LIBRARY_VERSION,
  buildOrganizationPreviewProposalDriftEnvelope,
  buildOrganizationPreviewProposalDriftPlan,
  createOrganizationPreviewProposalDriftLibrary,
  mergeOrganizationPreviewProposalDriftReports
} from '../pc/engines/organization-preview/turbos/proposal-drift/library.js';

function report(overrides = {}) {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    turbo: 'organization-preview.proposal-drift', state: 'stable-proposals', sampleCount,
    minimumSamples: 2, persistenceThreshold: 2, itemCount: 2,
    unknownProposalCount: 0, proposalChangeCount: 0, observedCount: sampleCount,
    incompleteCount: 0, noOrganizationCount: 0, comparisonCount: sampleCount - 1,
    proposalChangeSampleCount: 0, confidence: 1, ...overrides
  };
}

describe('organization-preview proposal-drift library', () => {
  test('publishes identity and merges proposal evidence', () => {
    const merged = mergeOrganizationPreviewProposalDriftReports([
      report({ sampleCount: 2, itemCount: 1, observedCount: 2, comparisonCount: 1 }),
      report({ state: 'proposal-drift-sustained', sampleCount: 6, observedCount: 5,
        proposalChangeCount: 1, comparisonCount: 5, proposalChangeSampleCount: 3, confidence: 0.8333 })
    ]);
    expect(ORGANIZATION_PREVIEW_PROPOSAL_DRIFT_LIBRARY_ID).toBe('organization-preview.proposal-drift.library');
    expect(ORGANIZATION_PREVIEW_PROPOSAL_DRIFT_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'proposal-drift-sustained', sampleCount: 8,
      itemCount: 2, unknownProposalCount: 0, proposalChangeCount: 1, observedCount: 7,
      comparisonCount: 6, proposalChangeSampleCount: 3, confidence: 0.875,
      recommendations: ['review-proposal-drift-without-file-mutation'] });
    expect(Object.isFrozen(merged)).toBe(true);
  });

  test('preserves aggregate states and empty confidence', () => {
    expect(mergeOrganizationPreviewProposalDriftReports([])).toMatchObject({
      state: 'insufficient-data', confidence: 0,
      recommendations: ['collect-more-organization-proposals']
    });
    expect(mergeOrganizationPreviewProposalDriftReports([report({ state: 'no-organization-preview', sampleCount: 1,
      itemCount: 0, unknownProposalCount: 0, observedCount: 0, noOrganizationCount: 1, confidence: 0 })])).toMatchObject({
      state: 'no-organization-preview', recommendations: ['no-organization-preview']
    });
    expect(mergeOrganizationPreviewProposalDriftReports([report({ state: 'incomplete-evidence',
      itemCount: 0, unknownProposalCount: 0, observedCount: 0, incompleteCount: 1, confidence: 0 })])).toMatchObject({
      state: 'incomplete-evidence', recommendations: ['request-explicit-organization-proposals']
    });
    expect(mergeOrganizationPreviewProposalDriftReports([report({ state: 'proposal-drift-observed',
      proposalChangeCount: 1, proposalChangeSampleCount: 1, confidence: 0.75 })]).recommendations)
      .toEqual(['observe-proposal-stability']);
    expect(mergeOrganizationPreviewProposalDriftReports([report()]).recommendations)
      .toEqual(['preview-proposals-only']);
    expect(mergeOrganizationPreviewProposalDriftReports([report({ state: 'insufficient-data', sampleCount: 1,
      itemCount: 0, unknownProposalCount: 0, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data');
    expect(mergeOrganizationPreviewProposalDriftReports([report({ state: 'insufficient-data', sampleCount: 0,
      itemCount: 0, unknownProposalCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 })]).confidence).toBe(0);
  });

  test('applies safety precedence and builds every state plan', () => {
    expect(mergeOrganizationPreviewProposalDriftReports([
      report({ state: 'proposal-drift-sustained' }), report({ state: 'no-organization-preview', sampleCount: 1,
        itemCount: 0, unknownProposalCount: 0, observedCount: 0, noOrganizationCount: 1, confidence: 0 })
    ])).toMatchObject({ state: 'no-organization-preview' });
    const states = [
      ['proposal-drift-sustained', 'proposal-review', 750],
      ['proposal-drift-observed', 'proposal-observation', 1000],
      ['stable-proposals', 'stable-proposal-observation', 5000],
      ['no-organization-preview', 'no-organization-observation', 10000],
      ['incomplete-evidence', 'evidence-bootstrap', 1500],
      ['insufficient-data', 'sample-bootstrap', 1500]
    ];
    for (const [state, mode, intervalMs] of states) {
      const empty = state === 'no-organization-preview';
      const sampleCount = empty ? 1 : 4;
      const confidence = empty ? 0 : 1;
      expect(buildOrganizationPreviewProposalDriftPlan(report({ state, sampleCount,
        itemCount: empty ? 0 : 2, unknownProposalCount: 0,
        observedCount: empty ? 0 : sampleCount, noOrganizationCount: empty ? 1 : 0, confidence }), 'interactive'))
        .toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence });
    }
    expect(buildOrganizationPreviewProposalDriftPlan(report(), 'headless')).toMatchObject({
      environment: 'headless', intervalMs: 10000
    });
    expect(buildOrganizationPreviewProposalDriftPlan(report({ sampleCount: 0, itemCount: 0,
      unknownProposalCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'other')).toMatchObject({
      environment: 'unknown', mode: 'profile-required', confidence: 0
    });
  });

  test('builds immutable envelopes and factories', () => {
    const envelope = buildOrganizationPreviewProposalDriftEnvelope(report(), {
      trigger: 'health.interval', now: () => 0
    });
    expect(envelope).toMatchObject({ library: ORGANIZATION_PREVIEW_PROPOSAL_DRIFT_LIBRARY_ID,
      libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' });
    expect(Object.isFrozen(envelope)).toBe(true);
    const library = createOrganizationPreviewProposalDriftLibrary();
    expect(Object.isFrozen(library)).toBe(true);
    expect(library.id).toBe(ORGANIZATION_PREVIEW_PROPOSAL_DRIFT_LIBRARY_ID);
    expect(library.merge([])).toMatchObject({ state: 'insufficient-data' });
    expect(library.plan(report({ sampleCount: 0, itemCount: 0,
      unknownProposalCount: 0, observedCount: 0, comparisonCount: 0, confidence: 0 }), 'headless'))
      .toMatchObject({ confidence: 0 });
    expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
  });

  test('rejects malformed reports, bounds, counts, triggers, and clocks', () => {
    expect(() => mergeOrganizationPreviewProposalDriftReports(null)).toThrow('reports must be an array');
    expect(() => mergeOrganizationPreviewProposalDriftReports(Array.from({ length: 65 }, () => report())))
      .toThrow('at most 64 reports');
    expect(() => mergeOrganizationPreviewProposalDriftReports([null])).toThrow('report must be an object');
    expect(() => mergeOrganizationPreviewProposalDriftReports([report({ turbo: 'other' })]))
      .toThrow('requires a proposal-drift turbo report');
    expect(() => mergeOrganizationPreviewProposalDriftReports([report({ state: 'other' })])).toThrow('invalid state');
    expect(() => mergeOrganizationPreviewProposalDriftReports([report({ sampleCount: -1 })]))
      .toThrow('sampleCount must be from 0 to 64');
    expect(() => mergeOrganizationPreviewProposalDriftReports([report({ minimumSamples: 0 })]))
      .toThrow('minimumSamples must be from 1 to 64');
    expect(() => mergeOrganizationPreviewProposalDriftReports([report({ persistenceThreshold: 0 })]))
      .toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noOrganizationCount', 'proposalChangeSampleCount']) {
      expect(() => mergeOrganizationPreviewProposalDriftReports([report({ [field]: 5 })]))
        .toThrow('must fit inside sampleCount');
    }
    expect(() => mergeOrganizationPreviewProposalDriftReports([report({ itemCount: 4097 })]))
      .toThrow('itemCount must be from 0 to 4096');
    expect(() => mergeOrganizationPreviewProposalDriftReports([report({ unknownProposalCount: 3 })]))
      .toThrow('unknownProposalCount must fit inside itemCount');
    expect(() => mergeOrganizationPreviewProposalDriftReports([report({ proposalChangeCount: 4097 })]))
      .toThrow('proposalChangeCount must be from 0 to 4096');
    expect(() => mergeOrganizationPreviewProposalDriftReports([report({ confidence: 1.1 })]))
      .toThrow('confidence must be between 0 and 1');
    expect(() => buildOrganizationPreviewProposalDriftEnvelope(report())).toThrow('trigger is required');
    expect(() => buildOrganizationPreviewProposalDriftEnvelope(report(), { trigger: 'x', now: () => NaN }))
      .toThrow('clock must return a number');
  });
});
