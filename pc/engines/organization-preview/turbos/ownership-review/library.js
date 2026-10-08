/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated ownership-review library. It validates, aggregates, and plans
 * ownership reports without importing the turbo or changing user files.
 */

export const ORGANIZATION_PREVIEW_OWNERSHIP_REVIEW_LIBRARY_ID = 'organization-preview.ownership-review.library';
export const ORGANIZATION_PREVIEW_OWNERSHIP_REVIEW_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'ownership-review-sustained', 'ownership-review-observed', 'no-user-owned-items',
  'no-organization-preview', 'incomplete-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Ownership-review library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Ownership-review library report must be an object');
  if (report.turbo !== 'organization-preview.ownership-review') {
    throw new Error('Ownership-review library requires an ownership-review turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Ownership-review library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Ownership-review library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Ownership-review library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Ownership-review library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noOrganizationCount', 'no-organization count'], ['ownedSampleCount', 'owned sample count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.itemCount) || report.itemCount < 0 || report.itemCount > 4096) {
    throw new RangeError('Ownership-review library itemCount must be from 0 to 4096');
  }
  for (const [field, label] of [['userOwnedCount', 'user-owned count'], ['unknownOwnershipCount', 'unknown-ownership count']]) {
    if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.itemCount) {
      throw new RangeError(`Ownership-review library ${label} must fit inside itemCount`);
    }
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Ownership-review library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Ownership-review library reports must be an array');
  if (reports.length > 64) throw new RangeError('Ownership-review library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-organization-preview')) return 'no-organization-preview';
  if (reports.some((report) => report.state === 'incomplete-evidence')) return 'incomplete-evidence';
  if (reports.some((report) => report.state === 'ownership-review-sustained')) return 'ownership-review-sustained';
  if (reports.some((report) => report.state === 'ownership-review-observed')) return 'ownership-review-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'no-user-owned-items';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-ownership-evidence']);
  if (state === 'no-organization-preview') return Object.freeze(['no-organization-preview']);
  if (state === 'incomplete-evidence') return Object.freeze(['request-explicit-ownership-evidence']);
  if (state === 'ownership-review-sustained') return Object.freeze(['request-explicit-organization-approval']);
  if (state === 'ownership-review-observed') return Object.freeze(['observe-user-owned-review-boundary']);
  return Object.freeze(['preview-proposals-only']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'ownership-review-sustained') return 'approval-review';
  if (state === 'ownership-review-observed') return 'approval-observation';
  if (state === 'no-organization-preview') return 'no-organization-observation';
  if (state === 'incomplete-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'no-user-owned-observation';
}

function intervalFor(state, environment) {
  if (state === 'ownership-review-sustained') return 750;
  if (state === 'ownership-review-observed') return 1000;
  if (state === 'no-organization-preview') return 10000;
  if (state === 'incomplete-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || { itemCount: 0, userOwnedCount: 0, unknownOwnershipCount: 0 };
}

export function mergeOrganizationPreviewOwnershipReviewReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: ORGANIZATION_PREVIEW_OWNERSHIP_REVIEW_LIBRARY_ID,
    libraryVersion: ORGANIZATION_PREVIEW_OWNERSHIP_REVIEW_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    itemCount: last.itemCount,
    userOwnedCount: last.userOwnedCount,
    unknownOwnershipCount: last.unknownOwnershipCount,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noOrganizationCount: validated.reduce((sum, report) => sum + report.noOrganizationCount, 0),
    ownedSampleCount: validated.reduce((sum, report) => sum + report.ownedSampleCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildOrganizationPreviewOwnershipReviewPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: ORGANIZATION_PREVIEW_OWNERSHIP_REVIEW_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.state, normalizedEnvironment),
    intervalMs: intervalFor(validated.state, normalizedEnvironment),
    state: validated.state,
    confidence: validated.sampleCount === 0 ? 0
      : Math.round((validated.observedCount / validated.sampleCount) * 10000) / 10000
  });
}

function requireClock(now) {
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Ownership-review library clock must return a number');
  return timestamp;
}

export function buildOrganizationPreviewOwnershipReviewEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Ownership-review library trigger is required');
  }
  return Object.freeze({
    library: ORGANIZATION_PREVIEW_OWNERSHIP_REVIEW_LIBRARY_ID,
    libraryVersion: ORGANIZATION_PREVIEW_OWNERSHIP_REVIEW_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createOrganizationPreviewOwnershipReviewLibrary() {
  return Object.freeze({
    id: ORGANIZATION_PREVIEW_OWNERSHIP_REVIEW_LIBRARY_ID,
    version: ORGANIZATION_PREVIEW_OWNERSHIP_REVIEW_LIBRARY_VERSION,
    merge: mergeOrganizationPreviewOwnershipReviewReports,
    plan: buildOrganizationPreviewOwnershipReviewPlan,
    envelope: buildOrganizationPreviewOwnershipReviewEnvelope
  });
}
