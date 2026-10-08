/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated capability-turbo library. It merges bounded capability reports
 * and separates safe observations, admin-required controls, and disabled
 * capabilities without importing the turbo or executing a control.
 */

export const SYSTEM_FACTS_CAPABILITY_LIBRARY_ID = 'system-facts.capability.library';
export const SYSTEM_FACTS_CAPABILITY_LIBRARY_VERSION = 1;

const STATUSES = Object.freeze([
  'supported',
  'observation-only',
  'admin-required',
  'unavailable',
  'unknown',
  'not-applicable'
]);
const STATES = Object.freeze(['ready', 'partial', 'blocked']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rounded(value) {
  return Math.round(value * 10000) / 10000;
}

function statusRank(status) {
  return STATUSES.indexOf(status);
}

function requireCapability(item) {
  if (!isRecord(item)) throw new TypeError('Capability library item must be an object');
  if (typeof item.name !== 'string' || item.name.length === 0) {
    throw new TypeError('Capability library item name must be a non-empty string');
  }
  if (!STATUSES.includes(item.status)) throw new Error('Capability library item has an invalid status');
  if (typeof item.required !== 'boolean') throw new TypeError('Capability library item required must be boolean');
  return Object.freeze({ name: item.name, status: item.status, required: item.required });
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Capability library report must be an object');
  if (report.turbo !== 'system-facts.capability') {
    throw new Error('Capability library requires a capability turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Capability library report has an invalid state');
  if (!ENVIRONMENTS.includes(report.environment)) {
    throw new Error('Capability library report has an invalid environment');
  }
  if (!Number.isFinite(report.score) || report.score < 0 || report.score > 100) {
    throw new RangeError('Capability library report score must be between 0 and 100');
  }
  if (!Array.isArray(report.capabilities)) throw new TypeError('Capability library capabilities must be an array');
  if (!Array.isArray(report.requiredFailures)) {
    throw new TypeError('Capability library requiredFailures must be an array');
  }
  return Object.freeze({
    turbo: report.turbo,
    state: report.state,
    environment: report.environment,
    score: report.score,
    capabilities: Object.freeze(report.capabilities.map(requireCapability)),
    requiredFailures: Object.freeze([...report.requiredFailures])
  });
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Capability library reports must be an array');
  if (reports.length > 64) throw new RangeError('Capability library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedEnvironment(reports) {
  if (reports.length === 0) return 'unknown';
  const first = reports[0].environment;
  return reports.every((report) => report.environment === first) ? first : 'unknown';
}

function mergedState(reports) {
  if (reports.some((report) => report.state === 'blocked')) return 'blocked';
  if (reports.some((report) => report.state === 'partial')) return 'partial';
  return 'ready';
}

function mergedCapabilities(reports) {
  const byName = new Map();
  for (const report of reports) {
    for (const item of report.capabilities) {
      const previous = byName.get(item.name);
      if (!previous || statusRank(item.status) > statusRank(previous.status)) {
        byName.set(item.name, Object.freeze({
          ...item,
          required: item.required || previous?.required === true
        }));
      } else if (previous && item.required) {
        byName.set(item.name, Object.freeze({ ...previous, required: true }));
      }
    }
  }
  return Object.freeze([...byName.values()].sort((left, right) => left.name.localeCompare(right.name)));
}

function statusSummary(capabilities) {
  const summary = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  capabilities.forEach((item) => { summary[item.status] += 1; });
  return Object.freeze(summary);
}

function requiredFailures(capabilities) {
  return Object.freeze(capabilities
    .filter((item) => item.required && item.status !== 'supported')
    .map((item) => item.name));
}

export function mergeCapabilityReports(reports) {
  const validated = requireReports(reports);
  const capabilities = mergedCapabilities(validated);
  return Object.freeze({
    library: SYSTEM_FACTS_CAPABILITY_LIBRARY_ID,
    reportCount: validated.length,
    environment: mergedEnvironment(validated),
    state: validated.length === 0 ? 'blocked' : mergedState(validated),
    score: validated.length === 0
      ? null
      : rounded(validated.reduce((sum, report) => sum + report.score, 0) / validated.length),
    capabilities,
    summary: statusSummary(capabilities),
    requiredFailures: requiredFailures(capabilities)
  });
}

function normalizedEnvironment(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function safeObservations(capabilities) {
  return Object.freeze(capabilities
    .filter((item) => item.name.endsWith('-observation')
      && (item.status === 'supported' || item.status === 'observation-only'))
    .map((item) => item.name));
}

function adminControls(capabilities) {
  return Object.freeze(capabilities
    .filter((item) => item.status === 'admin-required')
    .map((item) => item.name));
}

function disabledCapabilities(capabilities) {
  return Object.freeze(capabilities
    .filter((item) => item.status === 'unavailable' || item.status === 'unknown')
    .map((item) => item.name));
}

function planMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'blocked') return 'manual-review-required';
  if (environment === 'headless') return 'headless-observation';
  return 'interactive-observation';
}

function recommendations(state, environment, adminRequired, disabled) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (state === 'blocked') return Object.freeze(['resolve-required-capabilities']);
  const result = [];
  if (adminRequired.length > 0) result.push('request-explicit-admin-consent');
  if (disabled.length > 0) result.push('keep-unsupported-controls-disabled');
  if (result.length === 0) result.push('use-capability-selected-plan');
  return Object.freeze(result);
}

export function buildCapabilityPlan(report, environment) {
  const validated = requireReport(report);
  const targetEnvironment = normalizedEnvironment(environment || validated.environment);
  const observations = safeObservations(validated.capabilities);
  const adminRequired = adminControls(validated.capabilities);
  const disabled = disabledCapabilities(validated.capabilities);
  const failures = requiredFailures(validated.capabilities);
  const state = failures.length > 0 ? 'blocked' : validated.state;
  return Object.freeze({
    library: SYSTEM_FACTS_CAPABILITY_LIBRARY_ID,
    environment: targetEnvironment,
    mode: planMode(state, targetEnvironment),
    state,
    safeObservations: observations,
    adminRequired,
    disabled,
    requiredFailures: failures,
    automatic: state === 'ready' && targetEnvironment !== 'unknown' && adminRequired.length === 0,
    recommendations: recommendations(state, targetEnvironment, adminRequired, disabled),
    actions: Object.freeze([])
  });
}

export function createCapabilityLibrary() {
  return Object.freeze({
    id: SYSTEM_FACTS_CAPABILITY_LIBRARY_ID,
    version: SYSTEM_FACTS_CAPABILITY_LIBRARY_VERSION,
    merge: mergeCapabilityReports,
    plan: buildCapabilityPlan
  });
}
