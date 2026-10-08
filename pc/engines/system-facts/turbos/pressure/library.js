/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Dedicated pressure-turbo library. It ranks resource signals, aggregates
 * bounded reports, and builds a conservative protection plan without
 * importing the turbo or performing an operating-system action.
 */

export const SYSTEM_FACTS_PRESSURE_LIBRARY_ID = 'system-facts.pressure.library';
export const SYSTEM_FACTS_PRESSURE_LIBRARY_VERSION = 1;

const LEVELS = Object.freeze(['normal', 'elevated', 'high']);
const RESOURCES = Object.freeze(['cpu', 'memory', 'swap', 'storage', 'gpu']);
const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rounded(value) {
  return Math.round(value * 10000) / 10000;
}

function clamp(value, lower, upper) {
  return Math.min(upper, Math.max(lower, value));
}

function levelRank(level) {
  if (level === 'high') return 2;
  if (level === 'elevated') return 1;
  return 0;
}

function requireSignal(value) {
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1)) {
    throw new RangeError('Pressure library signal must be null or between 0 and 1');
  }
  return value;
}

function requireReport(report) {
  if (!isRecord(report)) throw new TypeError('Pressure library report must be an object');
  if (report.turbo !== 'system-facts.pressure') {
    throw new Error('Pressure library requires a pressure turbo report');
  }
  if (!LEVELS.includes(report.level)) throw new Error('Pressure library report has an invalid level');
  if (!Number.isFinite(report.score) || report.score < 0 || report.score > 100) {
    throw new RangeError('Pressure library report score must be between 0 and 100');
  }
  if (!Number.isFinite(report.confidence) || report.confidence < 0 || report.confidence > 1) {
    throw new RangeError('Pressure library report confidence must be between 0 and 1');
  }
  if (!isRecord(report.signals)) throw new TypeError('Pressure library report signals must be an object');
  for (const [name, value] of Object.entries(report.signals)) {
    if (!RESOURCES.includes(name)) continue;
    requireSignal(value);
  }
  if (report.dominant !== null && !RESOURCES.includes(report.dominant)) {
    throw new Error('Pressure library report has an invalid dominant resource');
  }
  return report;
}

function requireReports(reports) {
  if (!Array.isArray(reports)) throw new TypeError('Pressure library reports must be an array');
  if (reports.length > 64) throw new RangeError('Pressure library accepts at most 64 reports');
  return Object.freeze(reports.map(requireReport));
}

function activeSignals(report) {
  return Object.entries(report.signals)
    .filter(([name, value]) => RESOURCES.includes(name) && value !== null)
    .map(([name, value]) => Object.freeze({ name, value }));
}

function rankSignals(report) {
  return Object.freeze(activeSignals(report)
    .sort((left, right) => right.value - left.value || RESOURCES.indexOf(left.name) - RESOURCES.indexOf(right.name)));
}

function aggregateSignals(reports) {
  return Object.freeze(Object.fromEntries(RESOURCES.map((resource) => {
    const values = reports
      .map((report) => report.signals[resource])
      .filter((value) => value !== null && value !== undefined);
    return [resource, values.length === 0 ? null : rounded(values.reduce((sum, value) => sum + value, 0) / values.length)];
  })));
}

function dominantFromSignals(signals) {
  const ranked = Object.entries(signals)
    .filter(([, value]) => value !== null)
    .sort((left, right) => right[1] - left[1] || RESOURCES.indexOf(left[0]) - RESOURCES.indexOf(right[0]));
  return ranked.length === 0 ? null : ranked[0][0];
}

function aggregateLevel(reports) {
  return reports.reduce((level, report) => levelRank(report.level) > levelRank(level) ? report.level : level, 'normal');
}

function aggregateScore(reports) {
  return rounded(reports.reduce((sum, report) => sum + report.score, 0) / reports.length);
}

function aggregateConfidence(reports) {
  return rounded(reports.reduce((sum, report) => sum + report.confidence, 0) / reports.length);
}

export function mergePressureReports(reports) {
  const validated = requireReports(reports);
  if (validated.length === 0) {
    return Object.freeze({
      library: SYSTEM_FACTS_PRESSURE_LIBRARY_ID,
      reportCount: 0,
      score: null,
      level: 'normal',
      dominant: null,
      confidence: 0,
      signals: Object.freeze(Object.fromEntries(RESOURCES.map((resource) => [resource, null])))
    });
  }
  const signals = aggregateSignals(validated);
  return Object.freeze({
    library: SYSTEM_FACTS_PRESSURE_LIBRARY_ID,
    reportCount: validated.length,
    score: aggregateScore(validated),
    level: aggregateLevel(validated),
    dominant: dominantFromSignals(signals),
    confidence: aggregateConfidence(validated),
    signals
  });
}

function environmentName(environment) {
  return ENVIRONMENTS.includes(environment) ? environment : 'unknown';
}

function planMode(level, environment) {
  if (environment === 'unknown') return 'profile-required';
  if (level === 'high' && environment === 'headless') return 'protect-services';
  if (level === 'high') return 'protect-foreground';
  if (level === 'elevated') return 'watch';
  return 'observe';
}

function recheckMs(level, environment) {
  if (environment === 'unknown') return 30000;
  if (level === 'high') return 5000;
  if (level === 'elevated') return 15000;
  return 60000;
}

function topResources(report) {
  return Object.freeze(rankSignals(report).slice(0, 3).map((item) => item.name));
}

export function buildPressurePlan(report, environment) {
  const validated = requireReport(report);
  const normalizedEnvironment = environmentName(environment);
  const ranked = rankSignals(validated);
  return Object.freeze({
    library: SYSTEM_FACTS_PRESSURE_LIBRARY_ID,
    environment: normalizedEnvironment,
    mode: planMode(validated.level, normalizedEnvironment),
    recheckMs: recheckMs(validated.level, normalizedEnvironment),
    dominant: validated.dominant || (ranked[0]?.name || null),
    topResources: topResources(validated),
    holdDestructiveActions: validated.level === 'high',
    score: clamp(validated.score, 0, 100),
    confidence: clamp(validated.confidence, 0, 1)
  });
}

export function createPressureLibrary() {
  return Object.freeze({
    id: SYSTEM_FACTS_PRESSURE_LIBRARY_ID,
    version: SYSTEM_FACTS_PRESSURE_LIBRARY_VERSION,
    merge: mergePressureReports,
    plan: buildPressurePlan
  });
}
