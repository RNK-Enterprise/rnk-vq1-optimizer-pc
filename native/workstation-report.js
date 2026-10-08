/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Bounded daily workstation report reduction. It reads facts already retained
 * by the steward history and never changes the host or treats missing sensors
 * as healthy.
 */

export const WORKSTATION_REPORT_VERSION = 1;
const LEVELS = Object.freeze(['normal', 'warning', 'critical', 'emergency', 'unknown']);
const MAX_HISTORY_ENTRIES = 4096;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function nonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function rows(value) { return Array.isArray(value) ? value.filter(record) : []; }
function level(value) { return LEVELS.includes(value) ? value : 'unknown'; }
function finiteValues(values) { return values.filter((value) => value !== null); }
function minimum(values) { return values.length ? Math.min(...values) : null; }
function maximum(values) { return values.length ? Math.max(...values) : null; }
function last(values) { return values.at(-1) ?? null; }
function count(values, predicate) { return values.filter(predicate).length; }

function requireClock(now) {
  if (typeof now !== 'function') throw new TypeError('Workstation report clock must be a function');
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('Workstation report clock must return a number');
  return timestamp;
}

function requireWindow(windowMs) {
  if (!Number.isInteger(windowMs) || windowMs < 60 * 1000 || windowMs > 7 * 24 * 60 * 60 * 1000) throw new RangeError('Workstation report window is out of range');
  return windowMs;
}

function samplesFor(entries, from, to, maxSamples) {
  if (!Array.isArray(entries)) throw new TypeError('Workstation report entries must be an array');
  if (entries.length > MAX_HISTORY_ENTRIES) throw new RangeError('Workstation report entries exceed the bound');
  return entries.filter((entry) => record(entry) && entry.event === 'report' && Number.isFinite(entry.timestamp) && entry.timestamp >= from && entry.timestamp <= to && record(entry.facts)).slice(-maxSamples);
}

function storageSample(facts) {
  const pressure = record(facts.storagePressure) ? facts.storagePressure : {};
  const storageRows = rows(facts.storage);
  const primary = storageRows.find((row) => /^c:$/i.test(text(row.mount) || '') || text(row.mount) === '/') || storageRows[0] || {};
  const totalBytes = nonNegative(pressure.totalBytes ?? primary.totalBytes);
  const freeBytes = nonNegative(pressure.freeBytes ?? primary.freeBytes);
  return { totalBytes, freeBytes, level: level(pressure.level), belowTarget: pressure.belowTargetFreeFloor === true };
}

function memorySample(facts) {
  const memory = record(facts.memory) ? facts.memory : {};
  const totalBytes = nonNegative(memory.totalBytes);
  const availableBytes = nonNegative(memory.availableBytes ?? memory.freeBytes);
  const usedBytes = nonNegative(memory.usedBytes ?? (totalBytes !== null && availableBytes !== null ? Math.max(0, totalBytes - Math.min(totalBytes, availableBytes)) : null));
  const usedPercent = nonNegative(memory.usedPercent ?? (totalBytes && usedBytes !== null ? usedBytes / totalBytes * 100 : null));
  const derived = usedPercent === null ? 'unknown' : usedPercent >= 95 ? 'critical' : usedPercent >= 80 ? 'warning' : 'normal';
  return { totalBytes, availableBytes, usedBytes, usedPercent, pressure: level(memory.pressure || derived) };
}

function cpuGpuSample(facts) {
  const cpu = record(facts.cpu) ? facts.cpu : {};
  const gpu = record(facts.gpu) ? facts.gpu : {};
  return {
    cpuPercent: nonNegative(cpu.loadPercent ?? cpu.utilizationPercent),
    gpuPercent: nonNegative(gpu.loadPercent ?? gpu.utilizationPercent),
    gpuMemoryUsedBytes: nonNegative(gpu.memoryUsedBytes),
    gpuMemoryTotalBytes: nonNegative(gpu.memoryTotalBytes)
  };
}

function thermalSample(facts) {
  const thermal = record(facts.thermals) ? facts.thermals : record(facts.thermal) ? facts.thermal : {};
  return { temperatureC: nonNegative(thermal.maxTemperatureC), throttling: thermal.throttling === true || thermal.thermalThrottling === true };
}

function batterySample(facts) {
  const source = record(facts.battery) ? facts.battery : {};
  const battery = rows(source.batteries)[0] || source;
  return {
    present: source.available === false ? false : Boolean(source.available || battery.capacityPercent !== undefined || battery.chargePercent !== undefined),
    chargePercent: nonNegative(battery.capacityPercent ?? battery.chargePercent),
    healthPercent: nonNegative(battery.healthPercent),
    cycleCount: nonNegative(battery.cycleCount)
  };
}

function pagefileSample(facts) {
  const pagefile = record(facts.pagefile) ? facts.pagefile : {};
  return { pressurePercent: nonNegative(pagefile.pressurePercent), allocatedBytes: nonNegative(pagefile.allocatedBytes), currentBytes: nonNegative(pagefile.currentBytes) };
}

function processSample(facts) {
  const processes = rows(facts.processes);
  const abnormal = processes.filter((process) => process.abnormal === true || ['crashed', 'failed', 'zombie', 'unresponsive'].includes(text(process.state)?.toLowerCase()));
  const memoryRows = processes.map((process) => ({ name: text(process.name) || 'unknown', bytes: nonNegative(process.memoryBytes) })).filter((process) => process.bytes !== null).sort((a, b) => b.bytes - a.bytes);
  return { count: processes.length, abnormalCount: abnormal.length, topMemory: memoryRows[0] || null };
}

function networkSample(facts) {
  const interfaces = rows(facts.network?.interfaces);
  return {
    receivedBytes: interfaces.reduce((sum, item) => sum + (nonNegative(item.receivedBytes) || 0), 0),
    sentBytes: interfaces.reduce((sum, item) => sum + (nonNegative(item.sentBytes) || 0), 0),
    interfaceCount: interfaces.length
  };
}

function workloadSample(entry, facts) {
  const workload = record(facts.workload) ? facts.workload : {};
  const activeClasses = Array.isArray(workload.activeClasses) ? workload.activeClasses.filter((item) => typeof item === 'string').map((item) => item.toLowerCase()).slice(0, 16) : [];
  const game = record(entry.report?.game) ? entry.report.game : {};
  return { activeClasses, gameDetected: game.detected === true || activeClasses.includes('gaming'), contention: activeClasses.includes('gaming') && activeClasses.some((item) => ['build', 'development', 'ai'].includes(item)) };
}

function cleanupSample(entry, facts) {
  const cleanup = record(facts.cleanupAudit) ? facts.cleanupAudit : record(entry.report?.cleanup) ? entry.report.cleanup : {};
  return { recoveredBytes: nonNegative(cleanup.recoveredBytes ?? cleanup.removedBytes) || 0, actionCount: Number.isInteger(cleanup.actionCount) && cleanup.actionCount >= 0 ? cleanup.actionCount : 0, performed: cleanup.performed === true };
}

function trend(values) { return values.length > 1 ? last(values) - values[0] : null; }

export function buildDailyWorkstationReport(entries, { now = Date.now, windowMs = DEFAULT_WINDOW_MS, maxSamples = 96 } = {}) {
  const to = requireClock(now);
  const window = requireWindow(windowMs);
  if (!Number.isInteger(maxSamples) || maxSamples < 1 || maxSamples > MAX_HISTORY_ENTRIES) throw new RangeError('Workstation report maxSamples is out of range');
  const samples = samplesFor(entries, to - window, to, maxSamples);
  const storage = samples.map((entry) => storageSample(entry.facts));
  const memory = samples.map((entry) => memorySample(entry.facts));
  const cpuGpu = samples.map((entry) => cpuGpuSample(entry.facts));
  const thermals = samples.map((entry) => thermalSample(entry.facts));
  const batteries = samples.map((entry) => batterySample(entry.facts));
  const pagefile = samples.map((entry) => pagefileSample(entry.facts));
  const processes = samples.map((entry) => processSample(entry.facts));
  const network = samples.map((entry) => networkSample(entry.facts));
  const workloads = samples.map((entry) => workloadSample(entry, entry.facts));
  const cleanup = samples.map((entry) => cleanupSample(entry, entry.facts));
  const storageFree = finiteValues(storage.map((item) => item.freeBytes));
  const memoryUsed = finiteValues(memory.map((item) => item.usedBytes));
  const memoryPercent = finiteValues(memory.map((item) => item.usedPercent));
  const cpuPercent = finiteValues(cpuGpu.map((item) => item.cpuPercent));
  const gpuPercent = finiteValues(cpuGpu.map((item) => item.gpuPercent));
  const temperatures = finiteValues(thermals.map((item) => item.temperatureC));
  const batteryHealth = finiteValues(batteries.map((item) => item.healthPercent));
  const pagefilePressure = finiteValues(pagefile.map((item) => item.pressurePercent));
  const storageEvents = count(storage, (item) => ['warning', 'critical', 'emergency'].includes(item.level) || item.belowTarget);
  const memoryEvents = count(memory, (item) => ['warning', 'critical', 'emergency'].includes(item.pressure));
  const throttleEvents = count(thermals, (item) => item.throttling);
  const abnormalEvents = processes.reduce((sum, item) => sum + item.abnormalCount, 0);
  const recommendations = [];
  if (storageEvents) recommendations.push('review-storage-pressure');
  if (memoryEvents) recommendations.push('review-memory-and-pagefile');
  if (throttleEvents) recommendations.push('review-thermal-workload');
  if (abnormalEvents) recommendations.push('review-abnormal-processes');
  if (!samples.length) recommendations.push('collect-workstation-evidence');
  if (!recommendations.length) recommendations.push('no-change');
  const activeClasses = [...new Set(workloads.flatMap((item) => item.activeClasses))];
  return Object.freeze({
    version: WORKSTATION_REPORT_VERSION,
    period: 'daily',
    generatedAt: new Date(to).toISOString(),
    window: Object.freeze({ from: new Date(to - window).toISOString(), to: new Date(to).toISOString(), windowMs: window }),
    sampleCount: samples.length,
    storage: Object.freeze({ minimumFreeBytes: minimum(storageFree), latestFreeBytes: last(storageFree), trendBytes: trend(storageFree), pressureEvents: storageEvents }),
    memory: Object.freeze({ peakUsedBytes: maximum(memoryUsed), peakUsedPercent: maximum(memoryPercent), pressureEvents: memoryEvents }),
    cpuGpu: Object.freeze({ peakCpuPercent: maximum(cpuPercent), peakGpuPercent: maximum(gpuPercent), latestGpuMemoryUsedBytes: last(finiteValues(cpuGpu.map((item) => item.gpuMemoryUsedBytes))) }),
    thermals: Object.freeze({ peakTemperatureC: maximum(temperatures), throttleEvents }),
    battery: Object.freeze({ latestChargePercent: last(finiteValues(batteries.map((item) => item.chargePercent))), minimumHealthPercent: minimum(batteryHealth), latestCycleCount: last(finiteValues(batteries.map((item) => item.cycleCount))) }),
    pagefile: Object.freeze({ peakPressurePercent: maximum(pagefilePressure), latestCurrentBytes: last(finiteValues(pagefile.map((item) => item.currentBytes))), systemManaged: true, cleanup: 'never' }),
    processes: Object.freeze({ peakCount: maximum(processes.map((item) => item.count)), abnormalEvents, latestTopMemory: processes.at(-1)?.topMemory || null }),
    network: Object.freeze({ latestReceivedBytes: last(network.map((item) => item.receivedBytes)), latestSentBytes: last(network.map((item) => item.sentBytes)), latestInterfaceCount: last(network.map((item) => item.interfaceCount)) }),
    development: Object.freeze({ activeClasses, contentionEvents: count(workloads, (item) => item.contention) }),
    gaming: Object.freeze({ detectedEvents: count(workloads, (item) => item.gameDetected), contentionEvents: count(workloads, (item) => item.contention) }),
    cleanup: Object.freeze({ performedSamples: count(cleanup, (item) => item.performed), recoveredBytes: cleanup.reduce((sum, item) => sum + item.recoveredBytes, 0), actionCount: cleanup.reduce((sum, item) => sum + item.actionCount, 0) }),
    evidence: Object.freeze({ telemetrySamples: samples.length, complete: samples.length > 0 && storageFree.length > 0 && (memoryUsed.length > 0 || memoryPercent.length > 0) }),
    recommendations: Object.freeze(recommendations)
  });
}

