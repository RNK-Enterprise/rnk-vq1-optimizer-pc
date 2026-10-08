/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Workstation-health engine. It turns bounded host observations into a daily
 * review report without changing processes, power, storage, or transport.
 */

export const WORKSTATION_HEALTH_ENGINE_ID = 'workstation-health';
export const WORKSTATION_HEALTH_ENGINE_VERSION = 1;
export const WORKSTATION_HEALTH_TRIGGERS = Object.freeze([
  'install.preflight', 'system.facts.request', 'workload.changed', 'health.interval'
]);

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const PRESSURE_LEVELS = Object.freeze(['normal', 'warning', 'critical', 'emergency', 'unknown']);
const HEALTH_STATES = Object.freeze(['healthy', 'degraded', 'failed', 'unknown']);
const PROCESS_STATES = Object.freeze(['unresponsive', 'crashed', 'zombie', 'failed']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function boundedPercent(value) { return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null; }
function nonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function list(value, limit = 16) { return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()).slice(0, limit) : []; }
function level(value) { return PRESSURE_LEVELS.includes(value) ? value : 'unknown'; }
function health(value) { return HEALTH_STATES.includes(value) ? value : 'unknown'; }

function requireFacts(facts) {
  if (!isRecord(facts)) throw new TypeError('Workstation-health facts must be an object');
  if (facts.engine !== 'system-facts' && facts.engine !== 'workstation-health-input') {
    throw new Error('Workstation-health requires system-facts or workstation-health-input facts');
  }
  return facts;
}

function requireTrigger(trigger) {
  if (!WORKSTATION_HEALTH_TRIGGERS.includes(trigger)) throw new Error(`Unsupported workstation-health trigger: ${trigger || 'unknown'}`);
  return trigger;
}

function requireClock(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('Workstation-health clock must return a number');
  return timestamp;
}

function storageEvidence(source) {
  const pressure = isRecord(source.storagePressure) ? source.storagePressure : {};
  const rows = Array.isArray(source.storage) ? source.storage.filter(isRecord) : [];
  const row = rows.find((item) => typeof item.mount === 'string' && (/^c:/i.test(item.mount) || item.mount === '/')) || rows[0] || {};
  const totalBytes = nonNegative(pressure.totalBytes ?? row.totalBytes);
  const freeBytes = totalBytes === null ? nonNegative(pressure.freeBytes ?? row.freeBytes) : Math.min(totalBytes, nonNegative(pressure.freeBytes ?? row.freeBytes));
  const freePercent = boundedPercent(pressure.freePercent ?? (totalBytes && freeBytes !== null ? freeBytes / totalBytes * 100 : null));
  return Object.freeze({ freeBytes, totalBytes, freePercent, pressureLevel: level(pressure.level), health: health(source.storageHealth?.health) });
}

function metric(source, keys) {
  for (const key of keys) {
    if (Number.isFinite(source?.[key])) return boundedPercent(source[key]);
  }
  return null;
}

function resourceEvidence(source) {
  const cpu = isRecord(source.cpu) ? source.cpu : {};
  const memory = isRecord(source.memory) ? source.memory : {};
  const gpu = isRecord(source.gpu) ? source.gpu : {};
  const thermal = isRecord(source.thermal) ? source.thermal : {};
  const memoryTotal = nonNegative(memory.totalBytes);
  const availableMemory = nonNegative(memory.availableBytes);
  const memoryUsed = nonNegative(memory.usedBytes ?? (memoryTotal !== null && availableMemory !== null ? memoryTotal - Math.min(memoryTotal, availableMemory) : null));
  const memoryPercent = memoryTotal && memoryUsed !== null ? memoryUsed / memoryTotal * 100 : null;
  const derivedMemoryPressure = memoryPercent === null ? 'unknown' : memoryPercent >= 95 ? 'critical' : memoryPercent >= 80 ? 'warning' : 'normal';
  const memoryPressure = level(memory.pressure || derivedMemoryPressure);
  const temperature = Number.isFinite(thermal.maxTemperatureC) ? thermal.maxTemperatureC : null;
  const throttling = thermal.throttling === true;
  const thermalState = throttling || (temperature !== null && temperature >= 95) ? 'critical' : temperature !== null && temperature >= 85 ? 'warning' : temperature === null ? 'unknown' : 'normal';
  return Object.freeze({
    cpuLoadPercent: metric(cpu, ['loadPercent', 'utilizationPercent']),
    memoryPressure,
    gpuLoadPercent: metric(gpu, ['loadPercent', 'utilizationPercent']),
    temperatureC: temperature,
    thermalState,
    thermalThrottling: throttling
  });
}

function processEvidence(source) {
  const rows = Array.isArray(source.processes) ? source.processes.filter(isRecord) : [];
  const abnormal = rows.filter((item) => item.abnormal === true || PROCESS_STATES.includes(item.state) || item.health === 'failed');
  return Object.freeze({ abnormalCount: abnormal.length, abnormalNames: list(abnormal.map((item) => item.name).filter(Boolean)), observed: Array.isArray(source.processes) });
}

function workloadEvidence(source) {
  const workload = isRecord(source.workload) ? source.workload : {};
  const activeClasses = list(workload.activeClasses, 8).map((item) => item.toLowerCase());
  const gaming = activeClasses.includes('gaming');
  const build = activeClasses.some((item) => ['build', 'development', 'ai'].includes(item));
  return Object.freeze({ activeClasses, foregroundClass: text(workload.foregroundClass), latencySensitive: workload.latencySensitive === true, contentionRisk: gaming && build });
}

function cleanupEvidence(source) {
  const cleanup = isRecord(source.cleanupAudit) ? source.cleanupAudit : {};
  return Object.freeze({ performed: cleanup.performed === true, recoveredBytes: nonNegative(cleanup.recoveredBytes ?? cleanup.removedBytes) || 0, actionCount: Number.isInteger(cleanup.actionCount) && cleanup.actionCount >= 0 ? cleanup.actionCount : 0 });
}

function batteryEvidence(source) {
  const battery = isRecord(source.battery) ? source.battery : {};
  return Object.freeze({ present: typeof battery.present === 'boolean' ? battery.present : null, chargePercent: boundedPercent(battery.chargePercent), health: health(battery.health), charging: typeof battery.charging === 'boolean' ? battery.charging : null });
}

function problemEvidence(storage, resources, battery, processes, workload) {
  const problems = [];
  if (['critical', 'emergency'].includes(storage.pressureLevel)) problems.push('storage-pressure-critical');
  else if (storage.pressureLevel === 'warning') problems.push('storage-pressure-warning');
  if (storage.health === 'failed') problems.push('drive-health-failed');
  else if (storage.health === 'degraded') problems.push('drive-health-degraded');
  if (['critical', 'emergency'].includes(resources.memoryPressure)) problems.push('memory-pressure-critical');
  else if (resources.memoryPressure === 'warning') problems.push('memory-pressure-warning');
  if (resources.thermalThrottling || resources.thermalState === 'critical') problems.push('thermal-throttling');
  else if (resources.thermalState === 'warning') problems.push('thermal-warning');
  if (battery.health === 'failed') problems.push('battery-health-failed');
  else if (battery.health === 'degraded') problems.push('battery-health-degraded');
  if (processes.abnormalCount > 0) problems.push('abnormal-processes');
  if (workload.contentionRisk) problems.push('workload-contention');
  if (storage.freeBytes === null && storage.pressureLevel === 'unknown') problems.push('storage-observation-required');
  return Object.freeze(problems);
}

function recommendations(problems, confidence) {
  const values = [];
  if (problems.some((item) => item.includes('storage-pressure'))) values.push('review-storage-pressure-preview');
  if (problems.includes('drive-health-failed') || problems.includes('drive-health-degraded')) values.push('review-drive-health');
  if (problems.some((item) => item.includes('memory-pressure'))) values.push('review-memory-pressure');
  if (problems.includes('thermal-throttling') || problems.includes('thermal-warning')) values.push('review-thermal-workload');
  if (problems.includes('battery-health-failed') || problems.includes('battery-health-degraded')) values.push('review-battery-condition');
  if (problems.includes('abnormal-processes')) values.push('review-abnormal-processes');
  if (problems.includes('workload-contention')) values.push('review-workload-policy');
  if (confidence < 0.5) values.push('collect-complete-workstation-evidence');
  return Object.freeze(values.length ? values : ['no-change']);
}

function confidence(values) { return Math.round((values.filter((value) => value).length / values.length) * 10000) / 10000; }

export function runWorkstationHealthEngine(facts, { trigger, now = Date.now } = {}) {
  requireTrigger(trigger);
  const source = requireFacts(facts);
  const timestamp = requireClock(now());
  const environment = ENVIRONMENTS.includes(source.environment) ? source.environment : 'unknown';
  const storage = storageEvidence(source);
  const resources = resourceEvidence(source);
  const processes = processEvidence(source);
  const workload = workloadEvidence(source);
  const cleanup = cleanupEvidence(source);
  const battery = batteryEvidence(source);
  const problems = problemEvidence(storage, resources, battery, processes, workload);
  const evidenceConfidence = confidence([environment !== 'unknown', storage.freeBytes !== null, resources.cpuLoadPercent !== null, resources.memoryPressure !== 'unknown', resources.gpuLoadPercent !== null, resources.thermalState !== 'unknown', battery.present !== null || battery.health !== 'unknown', processes.observed]);
  const critical = problems.some((item) => item.includes('critical') || item.includes('failed') || item === 'thermal-throttling');
  const state = critical ? 'critical' : evidenceConfidence < 0.5 ? 'observation-required' : problems.length ? 'warning' : 'healthy';
  return Object.freeze({ protocolVersion: 1, engine: WORKSTATION_HEALTH_ENGINE_ID, engineVersion: WORKSTATION_HEALTH_ENGINE_VERSION, trigger, generatedAt: new Date(timestamp).toISOString(), period: 'daily', environment, state, confidence: evidenceConfidence, storage, resources, battery, processes, workload, cleanup, problemCodes: problems, recommendations: recommendations(problems, evidenceConfidence), actions: EMPTY_ARRAY });
}
