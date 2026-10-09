/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Deterministic local workstation question routing. It reads supplied facts,
 * produces explanations or review plans, and never executes an action.
 */

export const WORKSTATION_ASSISTANT_VERSION = 1;
const MAX_PROCESSES = 8;
const EMPTY = Object.freeze([]);

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function number(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function rows(value) { return Array.isArray(value) ? value.filter(record) : []; }
function questionText(value) { const question = text(value); if (!question) throw new TypeError('Assistant question is required'); return question.toLowerCase(); }

function topProcesses(facts) {
  return Object.freeze(rows(facts.processes)
    .map((item) => ({ name: text(item.name) || 'unknown', pid: Number.isInteger(item.pid) ? item.pid : null, memoryBytes: number(item.memoryBytes), cpuPercent: number(item.cpuPercent), protected: item.protected === true }))
    .sort((left, right) => (right.memoryBytes || 0) - (left.memoryBytes || 0))
    .slice(0, MAX_PROCESSES));
}

function storageRows(value) {
  return rows(value).map((item) => ({ mount: text(item.mount) || 'unknown', freeBytes: number(item.freeBytes), totalBytes: number(item.totalBytes), usedBytes: number(item.usedBytes) }));
}

function storageAnswer(facts) {
  const storage = storageRows(facts.storage);
  const volumes = storageRows(facts.volumes?.volumes);
  const observed = volumes.length ? volumes : storage;
  const pressure = record(facts.storagePressure) ? facts.storagePressure : null;
  return Object.freeze({ intent: 'storage', state: observed.length || pressure ? 'answered' : 'observation-required', answer: pressure ? `System storage pressure is ${text(pressure.level) || 'unknown'}.` : 'Storage pressure evidence is unavailable.', evidence: Object.freeze({ storage: Object.freeze(storage), volumes: Object.freeze(volumes), pressure }), recommendations: Object.freeze(observed.length ? ['review-reclaimable-categories', 'preserve-protected-paths'] : ['collect-storage-evidence']) });
}

function memoryAnswer(facts) {
  const memory = record(facts.memory) ? facts.memory : null;
  const pagefile = record(facts.pagefile) ? facts.pagefile : null;
  const processes = topProcesses(facts);
  return Object.freeze({ intent: 'memory', state: memory || processes.length ? 'answered' : 'observation-required', answer: memory ? `Memory usage is ${number(memory.usedPercent) ?? 'unknown'} percent.` : 'Memory evidence is unavailable.', evidence: Object.freeze({ memory, pagefile, topProcesses: processes }), recommendations: Object.freeze(pagefile?.pressure === true ? ['review-pagefile-pressure', 'reduce-concurrent-workloads'] : processes.length ? ['review-top-memory-processes'] : ['collect-memory-evidence']) });
}

function thermalAnswer(facts) {
  const thermals = record(facts.thermals) ? facts.thermals : null;
  const gpu = record(facts.gpu) ? facts.gpu : null;
  const readings = [number(thermals?.maxTemperatureC), number(gpu?.temperatureC)].filter((value) => value !== null);
  const max = readings.length ? Math.max(...readings) : null;
  return Object.freeze({ intent: 'thermals', state: thermals || gpu ? 'answered' : 'observation-required', answer: max === null ? 'Thermal evidence is unavailable.' : `The highest observed thermal reading is ${max} C.`, evidence: Object.freeze({ thermals, gpu }), recommendations: Object.freeze(max !== null && max >= 90 ? ['reduce-sustained-load', 'check-cooling'] : ['continue-thermal-observation']) });
}

function batteryAnswer(facts) {
  const battery = record(facts.battery) ? facts.battery : null;
  const entries = rows(battery?.batteries);
  return Object.freeze({ intent: 'battery', state: entries.length ? 'answered' : 'observation-required', answer: entries.length ? 'Battery evidence is available for review.' : 'Battery evidence is unavailable.', evidence: Object.freeze({ battery }), recommendations: Object.freeze(entries.length ? ['review-health-and-charge-history'] : ['collect-battery-evidence']) });
}

function reportAnswer(report) {
  const supplied = record(report);
  return Object.freeze({ intent: 'history', state: supplied ? 'answered' : 'observation-required', answer: supplied ? 'The supplied workstation report is ready for comparison.' : 'A prior workstation report is required for comparison.', evidence: supplied ? Object.freeze({ report }) : Object.freeze({}), recommendations: Object.freeze(supplied ? ['review-trends-and-recommendations'] : ['run-daily-report']) });
}

function recommendationAnswer(report) {
  const supplied = record(report);
  const listed = supplied && Array.isArray(report.recommendations) ? report.recommendations.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()).slice(0, 8) : [];
  const recommendations = listed.length ? listed : supplied ? ['no-change'] : ['run-daily-report'];
  return Object.freeze({ intent: 'recommendations', state: supplied ? 'answered' : 'observation-required', answer: supplied ? `Today's priorities: ${recommendations.join(', ')}.` : 'A daily workstation report is required before priorities can be ranked.', evidence: Object.freeze({ report: supplied ? report : null, recommendations: Object.freeze(recommendations) }), recommendations: Object.freeze(recommendations) });
}

function workloadAnswer(facts) {
  const game = record(facts.game) ? facts.game : null;
  const workloads = rows(facts.processes).filter((item) => ['build', 'ai', 'model', 'compiler'].includes(text(item.role)?.toLowerCase()));
  return Object.freeze({ intent: 'workload', state: game || workloads.length ? 'answered' : 'observation-required', answer: game?.detected ? 'A game is reported; background workload coexistence needs approval.' : 'No active game evidence was supplied.', evidence: Object.freeze({ game, workloads: Object.freeze(workloads) }), recommendations: Object.freeze(game?.detected ? ['preview-gaming-build-policy', 'preserve-foreground-latency'] : ['collect-workload-evidence']) });
}

function cleanupPlan(facts) {
  const pressure = record(facts.storagePressure) ? facts.storagePressure : null;
  return Object.freeze({ intent: 'cleanup', state: pressure ? 'preview-required' : 'observation-required', answer: pressure ? 'Safe cleanup can be previewed; approval is still required.' : 'Storage evidence is required before cleanup can be previewed.', evidence: Object.freeze({ pressure }), plan: Object.freeze({ operation: 'storage-preview', mutation: 'none', requiresApproval: true, enabledCategories: EMPTY }), recommendations: Object.freeze(['preview-exact-paths', 'protect-projects-credentials-models']) });
}

function movePlan() {
  return Object.freeze({ intent: 'placement', state: 'explicit-input-required', answer: 'File placement requires explicit file facts, source roots, target root, free space, and protected roots.', evidence: Object.freeze({}), plan: Object.freeze({ operation: 'placement-preview', mutation: 'none', requiresApproval: true }), recommendations: Object.freeze(['supply-explicit-files-and-target']) });
}

export function interpretWorkstationQuestion(question, facts = {}, { report = null } = {}) {
  const normalized = questionText(question);
  if (!record(facts)) throw new TypeError('Assistant facts must be an object');
  if (/\b(c:|drive|disk|storage|space|full)\b/.test(normalized)) return Object.freeze({ version: WORKSTATION_ASSISTANT_VERSION, ...storageAnswer(facts) });
  if (/\b(ram|memory|pagefile|swap)\b/.test(normalized)) return Object.freeze({ version: WORKSTATION_ASSISTANT_VERSION, ...memoryAnswer(facts) });
  if (/\b(hot|thermal|temperature|cooling|throttl)/.test(normalized)) return Object.freeze({ version: WORKSTATION_ASSISTANT_VERSION, ...thermalAnswer(facts) });
  if (/\b(battery|charge|charging|degrad)/.test(normalized)) return Object.freeze({ version: WORKSTATION_ASSISTANT_VERSION, ...batteryAnswer(facts) });
  if (/\b(what should i (fix|care about)|what do i need to fix|top recommendations)\b/.test(normalized)) return Object.freeze({ version: WORKSTATION_ASSISTANT_VERSION, ...recommendationAnswer(report) });
  if (/\b(yesterday|changed|trend|history|since)\b/.test(normalized)) return Object.freeze({ version: WORKSTATION_ASSISTANT_VERSION, ...reportAnswer(report) });
  if (/\b(game|gaming|build|ai job|local model|run .*while)/.test(normalized)) return Object.freeze({ version: WORKSTATION_ASSISTANT_VERSION, ...workloadAnswer(facts) });
  if (/\b(clean|reclaim|remove)\b/.test(normalized)) return Object.freeze({ version: WORKSTATION_ASSISTANT_VERSION, ...cleanupPlan(facts) });
  if (/\b(move|send|place).*(download|file|e:|archive)/.test(normalized)) return Object.freeze({ version: WORKSTATION_ASSISTANT_VERSION, ...movePlan() });
  return Object.freeze({ version: WORKSTATION_ASSISTANT_VERSION, intent: 'unknown', state: 'refused', answer: 'The question does not map to a supported facts-to-plan operation.', evidence: Object.freeze({}), recommendations: Object.freeze(['ask-about-storage-memory-thermals-battery-history-workloads-or-placement']) });
}
