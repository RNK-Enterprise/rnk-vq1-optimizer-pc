/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated category-drift library. It validates, aggregates, and plans
 * category reports without importing the turbo or changing user files.
 */

export const ORGANIZATION_PREVIEW_CATEGORY_DRIFT_LIBRARY_ID = 'organization-preview.category-drift.library';
export const ORGANIZATION_PREVIEW_CATEGORY_DRIFT_LIBRARY_VERSION = 1;

const STATES = Object.freeze([
  'category-drift-sustained', 'category-drift-observed', 'stable-categories',
  'no-organization-preview', 'incomplete-evidence', 'insufficient-data'
]);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSampleCount(report, field, label) {
  if (!Number.isInteger(report[field]) || report[field] < 0 || report[field] > report.sampleCount) {
    throw new RangeError(`Category-drift library report ${label} must fit inside sampleCount`);
  }
  return report[field];
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Category-drift library report must be an object');
  if (report.turbo !== 'organization-preview.category-drift') {
    throw new Error('Category-drift library requires a category-drift turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Category-drift library report has an invalid state');
  if (!Number.isInteger(report.sampleCount) || report.sampleCount < 0 || report.sampleCount > 64) {
    throw new RangeError('Category-drift library report sampleCount must be from 0 to 64');
  }
  if (!Number.isInteger(report.minimumSamples) || report.minimumSamples < 1 || report.minimumSamples > 64) {
    throw new RangeError('Category-drift library minimumSamples must be from 1 to 64');
  }
  if (!Number.isInteger(report.persistenceThreshold) || report.persistenceThreshold < 1
    || report.persistenceThreshold > 64) {
    throw new RangeError('Category-drift library persistenceThreshold must be from 1 to 64');
  }
  for (const [field, label] of [
    ['observedCount', 'observed count'], ['incompleteCount', 'incomplete count'],
    ['noOrganizationCount', 'no-organization count'], ['comparisonCount', 'comparison count'],
    ['categoryChangeSampleCount', 'category-change sample count']
  ]) requireSampleCount(report, field, label);
  if (!Number.isInteger(report.itemCount) || report.itemCount < 0 || report.itemCount > 4096) {
    throw new RangeError('Category-drift library itemCount must be from 0 to 4096');
  }
  if (!Number.isInteger(report.unknownCategoryCount) || report.unknownCategoryCount < 0
    || report.unknownCategoryCount > report.itemCount) {
    throw new RangeError('Category-drift library unknownCategoryCount must fit inside itemCount');
  }
  if (!Number.isInteger(report.categoryChangeCount) || report.categoryChangeCount < 0
    || report.categoryChangeCount > 4096) {
    throw new RangeError('Category-drift library categoryChangeCount must be from 0 to 4096');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Category-drift library confidence must be between 0 and 1');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Category-drift library reports must be an array');
  if (reports.length > 64) throw new RangeError('Category-drift library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedState(reports) {
  if (reports.length === 0) return 'insufficient-data';
  if (reports.some((report) => report.state === 'no-organization-preview')) return 'no-organization-preview';
  if (reports.some((report) => report.state === 'incomplete-evidence')) return 'incomplete-evidence';
  if (reports.some((report) => report.state === 'category-drift-sustained')) return 'category-drift-sustained';
  if (reports.some((report) => report.state === 'category-drift-observed')) return 'category-drift-observed';
  if (reports.every((report) => report.state === 'insufficient-data')) return 'insufficient-data';
  return 'stable-categories';
}

function mergedConfidence(reports) {
  if (reports.length === 0) return 0;
  const samples = reports.reduce((sum, report) => sum + report.sampleCount, 0);
  if (samples === 0) return 0;
  const observed = reports.reduce((sum, report) => sum + report.observedCount, 0);
  return Math.round((observed / samples) * 10000) / 10000;
}

function recommendations(state) {
  if (state === 'insufficient-data') return Object.freeze(['collect-more-organization-categories']);
  if (state === 'no-organization-preview') return Object.freeze(['no-organization-preview']);
  if (state === 'incomplete-evidence') return Object.freeze(['request-organization-category-observation']);
  if (state === 'category-drift-sustained') return Object.freeze(['review-category-drift-without-file-mutation']);
  if (state === 'category-drift-observed') return Object.freeze(['observe-category-stability']);
  return Object.freeze(['preview-proposals-only']);
}

function environmentOf(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'category-drift-sustained') return 'category-review';
  if (state === 'category-drift-observed') return 'category-observation';
  if (state === 'no-organization-preview') return 'no-organization-observation';
  if (state === 'incomplete-evidence') return 'evidence-bootstrap';
  if (state === 'insufficient-data') return 'sample-bootstrap';
  return 'stable-category-observation';
}

function intervalFor(state, environment) {
  if (state === 'category-drift-sustained') return 750;
  if (state === 'category-drift-observed') return 1000;
  if (state === 'no-organization-preview') return 10000;
  if (state === 'incomplete-evidence' || state === 'insufficient-data') return 1500;
  return environment === 'headless' ? 10000 : 5000;
}

function latest(reports) {
  const report = reports.at(-1);
  return report || { itemCount: 0, unknownCategoryCount: 0, categoryChangeCount: 0 };
}

export function mergeOrganizationPreviewCategoryDriftReports(reports) {
  const validated = requireReports(reports);
  const state = mergedState(validated);
  const last = latest(validated);
  return Object.freeze({
    library: ORGANIZATION_PREVIEW_CATEGORY_DRIFT_LIBRARY_ID,
    libraryVersion: ORGANIZATION_PREVIEW_CATEGORY_DRIFT_LIBRARY_VERSION,
    reportCount: validated.length,
    state,
    sampleCount: validated.reduce((sum, report) => sum + report.sampleCount, 0),
    itemCount: last.itemCount,
    unknownCategoryCount: last.unknownCategoryCount,
    categoryChangeCount: last.categoryChangeCount,
    observedCount: validated.reduce((sum, report) => sum + report.observedCount, 0),
    incompleteCount: validated.reduce((sum, report) => sum + report.incompleteCount, 0),
    noOrganizationCount: validated.reduce((sum, report) => sum + report.noOrganizationCount, 0),
    comparisonCount: validated.reduce((sum, report) => sum + report.comparisonCount, 0),
    categoryChangeSampleCount: validated.reduce((sum, report) => sum + report.categoryChangeSampleCount, 0),
    confidence: mergedConfidence(validated),
    recommendations: recommendations(state)
  });
}

export function buildOrganizationPreviewCategoryDriftPlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentOf(environment);
  return Object.freeze({
    library: ORGANIZATION_PREVIEW_CATEGORY_DRIFT_LIBRARY_ID,
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
  if (!Number.isFinite(timestamp)) throw new TypeError('Category-drift library clock must return a number');
  return timestamp;
}

export function buildOrganizationPreviewCategoryDriftEnvelope(report, { trigger, now = Date.now } = {}) {
  if (typeof trigger !== 'string' || trigger.length === 0) {
    throw new TypeError('Category-drift library trigger is required');
  }
  return Object.freeze({
    library: ORGANIZATION_PREVIEW_CATEGORY_DRIFT_LIBRARY_ID,
    libraryVersion: ORGANIZATION_PREVIEW_CATEGORY_DRIFT_LIBRARY_VERSION,
    trigger,
    generatedAt: new Date(requireClock(now)).toISOString(),
    report: requireReport(report)
  });
}

export function createOrganizationPreviewCategoryDriftLibrary() {
  return Object.freeze({
    id: ORGANIZATION_PREVIEW_CATEGORY_DRIFT_LIBRARY_ID,
    version: ORGANIZATION_PREVIEW_CATEGORY_DRIFT_LIBRARY_VERSION,
    merge: mergeOrganizationPreviewCategoryDriftReports,
    plan: buildOrganizationPreviewCategoryDriftPlan,
    envelope: buildOrganizationPreviewCategoryDriftEnvelope
  });
}
