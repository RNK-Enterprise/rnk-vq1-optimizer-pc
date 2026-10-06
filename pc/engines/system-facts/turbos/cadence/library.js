/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * Dedicated cadence-turbo library. It coalesces bounded schedules using the
 * sooner safe interval and builds an explicit observation policy without
 * importing the turbo or scheduling an external action.
 */

export const SYSTEM_FACTS_CADENCE_LIBRARY_ID = 'system-facts.cadence.library';
export const SYSTEM_FACTS_CADENCE_LIBRARY_VERSION = 1;

const STATES = Object.freeze(['urgent', 'responsive', 'balanced', 'relaxed']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rounded(value) {
  return Math.round(value * 10000) / 10000;
}

function clamp(value, lower, upper) {
  return Math.min(upper, Math.max(lower, value));
}

function stateRank(state) {
  return STATES.length - STATES.indexOf(state);
}

function requireRange(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`Cadence library ${label} must be between 0 and 1`);
  }
  return value;
}

function requireSchedule(schedule) {
  if (!isRecord(schedule)) throw new TypeError('Cadence library schedule must be an object');
  const fields = ['intervalMs', 'minimumMs', 'maximumMs'];
  if (fields.some((field) => !Number.isInteger(schedule[field]) || schedule[field] <= 0)) {
    throw new RangeError('Cadence library schedule values must be positive integers');
  }
  if (schedule.minimumMs > schedule.maximumMs || schedule.intervalMs < schedule.minimumMs
    || schedule.intervalMs > schedule.maximumMs) {
    throw new RangeError('Cadence library schedule bounds are invalid');
  }
  return Object.freeze({
    intervalMs: schedule.intervalMs,
    minimumMs: schedule.minimumMs,
    maximumMs: schedule.maximumMs
  });
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Cadence library report must be an object');
  if (report.turbo !== 'system-facts.cadence') {
    throw new Error('Cadence library requires a cadence turbo report');
  }
  if (!STATES.includes(report.state)) throw new Error('Cadence library report has an invalid state');
  if (!ENVIRONMENTS.includes(report.environment)) {
    throw new Error('Cadence library report has an invalid environment');
  }
  requireRange(report.pressure, 'pressure');
  requireRange(report.volatility, 'volatility');
  requireRange(report.confidence, 'confidence');
  if (!Number.isInteger(report.samples) || report.samples < 0) {
    throw new RangeError('Cadence library report samples must be a non-negative integer');
  }
  if (!TRIGGERS.includes(report.trigger)) throw new Error('Cadence library report has an invalid trigger');
  return Object.freeze({
    turbo: report.turbo,
    state: report.state,
    environment: report.environment,
    pressure: report.pressure,
    volatility: report.volatility,
    confidence: report.confidence,
    samples: report.samples,
    trigger: report.trigger,
    schedule: requireSchedule(report.schedule)
  });
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Cadence library reports must be an array');
  if (reports.length > 64) throw new RangeError('Cadence library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function mergedEnvironment(reports) {
  const first = reports[0].environment;
  return reports.every((report) => report.environment === first) ? first : 'unknown';
}

function mergedState(reports) {
  return reports.reduce((state, report) => stateRank(report.state) > stateRank(state) ? report.state : state, 'relaxed');
}

function uniqueTriggers(reports) {
  return Object.freeze([...new Set(reports.map((report) => report.trigger))]);
}

function mergedSchedule(reports) {
  return Object.freeze({
    intervalMs: Math.min(...reports.map((report) => report.schedule.intervalMs)),
    minimumMs: Math.max(...reports.map((report) => report.schedule.minimumMs)),
    maximumMs: Math.min(...reports.map((report) => report.schedule.maximumMs))
  });
}

export function mergeCadenceReports(reports) {
  const validated = requireReports(reports);
  if (validated.length === 0) {
    return Object.freeze({
      library: SYSTEM_FACTS_CADENCE_LIBRARY_ID,
      reportCount: 0,
      environment: 'unknown',
      state: 'balanced',
      pressure: null,
      volatility: null,
      confidence: 0,
      samples: 0,
      triggers: Object.freeze([]),
      schedule: null
    });
  }
  const schedule = mergedSchedule(validated);
  return Object.freeze({
    library: SYSTEM_FACTS_CADENCE_LIBRARY_ID,
    reportCount: validated.length,
    environment: mergedEnvironment(validated),
    state: mergedState(validated),
    pressure: rounded(Math.max(...validated.map((report) => report.pressure))),
    volatility: rounded(Math.max(...validated.map((report) => report.volatility))),
    confidence: rounded(Math.min(...validated.map((report) => report.confidence))),
    samples: Math.max(...validated.map((report) => report.samples)),
    triggers: uniqueTriggers(validated),
    schedule
  });
}

function targetEnvironment(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function policyMode(state, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (state === 'urgent') return 'accelerated-observation';
  if (state === 'responsive') return 'responsive-observation';
  if (state === 'relaxed') return 'relaxed-observation';
  return 'balanced-observation';
}

function policyInterval(report, environment) {
  const { intervalMs, minimumMs, maximumMs } = report.schedule;
  if (environment === 'unknown') return Math.min(intervalMs, 30000);
  if (report.state === 'urgent') return minimumMs;
  if (report.state === 'responsive') return Math.max(minimumMs, Math.round(intervalMs / 2));
  if (report.state === 'relaxed') return Math.min(maximumMs, Math.round(intervalMs * 1.25));
  return clamp(intervalMs, minimumMs, maximumMs);
}

function policyRecommendations(state, environment) {
  if (environment === 'unknown') return Object.freeze(['request-environment-profile']);
  if (state === 'urgent') return Object.freeze(['sample-at-minimum-interval', 'hold-destructive-actions']);
  if (state === 'responsive') return Object.freeze(['sample-soon-after-workload-change']);
  if (state === 'relaxed') return Object.freeze(['allow-longer-interval']);
  return Object.freeze(['observe-at-selected-cadence']);
}

export function buildCadencePolicy(report, environment) {
  const validated = requireReport(report);
  const normalized = targetEnvironment(environment || validated.environment);
  return Object.freeze({
    library: SYSTEM_FACTS_CADENCE_LIBRARY_ID,
    environment: normalized,
    state: validated.state,
    mode: policyMode(validated.state, normalized),
    intervalMs: policyInterval(validated, normalized),
    minimumMs: validated.schedule.minimumMs,
    maximumMs: validated.schedule.maximumMs,
    automatic: normalized !== 'unknown' && validated.state !== 'urgent',
    recommendations: policyRecommendations(validated.state, normalized)
  });
}

export function createCadenceLibrary() {
  return Object.freeze({
    id: SYSTEM_FACTS_CADENCE_LIBRARY_ID,
    version: SYSTEM_FACTS_CADENCE_LIBRARY_VERSION,
    merge: mergeCadenceReports,
    plan: buildCadencePolicy
  });
}
