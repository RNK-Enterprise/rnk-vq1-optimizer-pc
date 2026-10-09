/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Bounded daily workstation report reduction. It reads facts already retained
 * by the steward history and never changes the host or treats missing sensors
 * as healthy.
 */

import { compareNetworkRates } from './network-rate.js';
import { summarizeNetworkUsage } from './network-manager.js';
import { deriveProcessResourceRateSamples, summarizeProcessResourceRates } from './process-resource-report.js';
import { buildWorkstationPolicyPlan } from './workstation-policy.js';

export const WORKSTATION_REPORT_VERSION = 1;
const LEVELS = Object.freeze(['normal', 'warning', 'critical', 'emergency', 'unknown']);
const MAX_HISTORY_ENTRIES = 4096;
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_NETWORK_INTERVAL_MS = 1000;

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
    gpuTemperatureC: nonNegative(gpu.temperatureC ?? gpu.temperature),
    gpuThermalThrottling: gpu.thermalThrottling === true
      ? true
      : gpu.thermalThrottling === false ? false : null,
    gpuMemoryUsedBytes: nonNegative(gpu.memoryUsedBytes),
    gpuMemoryTotalBytes: nonNegative(gpu.memoryTotalBytes)
  };
}

function thermalSample(facts) {
  const thermal = record(facts.thermals) ? facts.thermals : record(facts.thermal) ? facts.thermal : {};
  const throttling = thermal.throttling === true || thermal.thermalThrottling === true
    ? true
    : thermal.throttling === false || thermal.thermalThrottling === false ? false : null;
  return { temperatureC: nonNegative(thermal.maxTemperatureC), throttling };
}

function fanSample(facts) {
  const source = record(facts.fans) ? facts.fans : {};
  const rpms = rows(source.fans).map((fan) => nonNegative(fan.rpm ?? fan.currentSpeed)).filter((value) => value !== null);
  return { available: source.available === true, maximumRpm: maximum(rpms), fanCount: rpms.length };
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
  return { pressurePercent: nonNegative(pagefile.pressurePercent), allocatedBytes: nonNegative(pagefile.allocatedBytes), currentBytes: nonNegative(pagefile.currentBytes), systemManaged: typeof pagefile.systemManaged === 'boolean' ? pagefile.systemManaged : null, managementStatus: typeof pagefile.managementStatus === 'string' ? pagefile.managementStatus : 'UNKNOWN', commitStatus: typeof pagefile.commitStatus === 'string' ? pagefile.commitStatus : 'UNAVAILABLE' };
}

function driveSample(facts) {
  const source = record(facts.drives) ? facts.drives : {};
  const drives = rows(source.drives).map((item) => Object.freeze({
    device: text(item.device),
    model: text(item.model),
    mediaType: text(item.mediaType),
    health: text(item.health),
    smart: record(item.smart) ? Object.freeze({
      health: text(item.smart.health),
      temperatureC: nonNegative(item.smart.temperatureC),
      percentageUsed: nonNegative(item.smart.percentageUsed),
      criticalWarning: text(item.smart.criticalWarning)
    }) : null
  }));
  return { available: source.available === true, count: drives.length, degraded: count(drives, (item) => item.health === 'degraded'), failed: count(drives, (item) => item.health === 'failed'), drives };
}

function volumeSample(facts) {
  const source = record(facts.volumes) ? facts.volumes : {};
  const volumes = rows(source.volumes).map((item) => Object.freeze({
    mount: text(item.mount),
    totalBytes: nonNegative(item.totalBytes),
    freeBytes: nonNegative(item.freeBytes),
    usedBytes: nonNegative(item.usedBytes)
  })).filter((item) => item.mount);
  return { available: source.available === true, volumes };
}

function processSample(facts) {
  const processes = rows(facts.processes);
  const abnormal = processes.filter((process) => process.abnormal === true || ['crashed', 'failed', 'zombie', 'unresponsive'].includes(text(process.state)?.toLowerCase()));
  const memoryRows = processes.map((process) => ({ name: text(process.name) || 'unknown', bytes: nonNegative(process.memoryBytes) })).filter((process) => process.bytes !== null).sort((a, b) => b.bytes - a.bytes);
  return { count: processes.length, abnormalCount: abnormal.length, topMemory: memoryRows[0] || null };
}

function networkSample(facts) {
  const interfaces = rows(facts.network?.interfaces);
  const connections = rows(facts.networkConnections?.connections);
  return {
    receivedBytes: interfaces.reduce((sum, item) => sum + (nonNegative(item.receivedBytes) || 0), 0),
    sentBytes: interfaces.reduce((sum, item) => sum + (nonNegative(item.sentBytes) || 0), 0),
    interfaceCount: interfaces.length,
    connectionCount: connections.length
  };
}

function processNetworkSample(facts) {
  const usage = summarizeNetworkUsage(facts.networkProcesses?.processes);
  return { available: usage.available, top: usage.perProcess[0] || null };
}

function networkRateSamples(entries) {
  let previous = null;
  let previousTimestamp = null;
  return entries.map((entry) => {
    const current = record(entry.facts?.network) ? entry.facts.network : {};
    const intervalMs = previousTimestamp === null
      ? DEFAULT_NETWORK_INTERVAL_MS
      : Math.min(24 * 60 * 60 * 1000, Math.max(1, entry.timestamp - previousTimestamp));
    const result = compareNetworkRates(previous, current, { intervalMs });
    previous = current;
    previousTimestamp = entry.timestamp;
    return result;
  });
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
  const fans = samples.map((entry) => fanSample(entry.facts));
  const batteries = samples.map((entry) => batterySample(entry.facts));
  const pagefile = samples.map((entry) => pagefileSample(entry.facts));
  const drives = samples.map((entry) => driveSample(entry.facts));
  const volumes = samples.map((entry) => volumeSample(entry.facts));
  const processes = samples.map((entry) => processSample(entry.facts));
  const processResourceRates = summarizeProcessResourceRates(deriveProcessResourceRateSamples(samples));
  const network = samples.map((entry) => networkSample(entry.facts));
  const processNetworks = samples.map((entry) => processNetworkSample(entry.facts));
  const networkRates = networkRateSamples(samples);
  const workloads = samples.map((entry) => workloadSample(entry, entry.facts));
  const cleanup = samples.map((entry) => cleanupSample(entry, entry.facts));
  const policy = buildWorkstationPolicyPlan(samples.at(-1)?.facts || {});
  const storageFree = finiteValues(storage.map((item) => item.freeBytes));
  const volumeFree = finiteValues(volumes.flatMap((sample) => sample.volumes.map((item) => item.freeBytes)));
  const memoryUsed = finiteValues(memory.map((item) => item.usedBytes));
  const memoryPercent = finiteValues(memory.map((item) => item.usedPercent));
  const cpuPercent = finiteValues(cpuGpu.map((item) => item.cpuPercent));
  const gpuPercent = finiteValues(cpuGpu.map((item) => item.gpuPercent));
  const gpuTemperatures = finiteValues(cpuGpu.map((item) => item.gpuTemperatureC));
  const gpuThrottleEvents = count(cpuGpu, (item) => item.gpuThermalThrottling === true);
  const temperatures = finiteValues(thermals.map((item) => item.temperatureC));
  const batteryHealth = finiteValues(batteries.map((item) => item.healthPercent));
  const pagefilePressure = finiteValues(pagefile.map((item) => item.pressurePercent));
  const pagefileEvents = count(pagefile, (item) => item.pressurePercent !== null && item.pressurePercent >= 80);
  const receivedRates = finiteValues(networkRates.map((item) => item.receivedBytesPerSecond));
  const sentRates = finiteValues(networkRates.map((item) => item.sentBytesPerSecond));
  const storageEvents = count(storage, (item) => ['warning', 'critical', 'emergency'].includes(item.level) || item.belowTarget);
  const memoryEvents = count(memory, (item) => ['warning', 'critical', 'emergency'].includes(item.pressure));
  const throttleEvents = count(thermals, (item) => item.throttling);
  const abnormalEvents = processes.reduce((sum, item) => sum + item.abnormalCount, 0);
  const recommendations = [];
  if (storageEvents) recommendations.push('review-storage-pressure');
  if (memoryEvents) recommendations.push('review-memory-and-pagefile');
  if (pagefileEvents) recommendations.push('review-pagefile-pressure');
  if (throttleEvents) recommendations.push('review-thermal-workload');
  if (gpuThrottleEvents) recommendations.push('review-gpu-thermal-workload');
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
    cpuGpu: Object.freeze({ peakCpuPercent: maximum(cpuPercent), peakGpuPercent: maximum(gpuPercent), peakGpuTemperatureC: maximum(gpuTemperatures), latestGpuTemperatureC: last(gpuTemperatures), latestGpuMemoryUsedBytes: last(finiteValues(cpuGpu.map((item) => item.gpuMemoryUsedBytes))), gpuThermalThrottleEvents: gpuThrottleEvents }),
    thermals: Object.freeze({ peakTemperatureC: maximum(temperatures), throttleEvents }),
    fans: Object.freeze({ peakRpm: maximum(fans.map((item) => item.maximumRpm).filter((value) => value !== null)), latestRpm: last(fans.map((item) => item.maximumRpm)), latestFanCount: last(fans.map((item) => item.fanCount)), observedSamples: count(fans, (item) => item.available) }),
    battery: Object.freeze({ latestChargePercent: last(finiteValues(batteries.map((item) => item.chargePercent))), minimumHealthPercent: minimum(batteryHealth), latestCycleCount: last(finiteValues(batteries.map((item) => item.cycleCount))) }),
    pagefile: Object.freeze({ peakPressurePercent: maximum(pagefilePressure), latestCurrentBytes: last(finiteValues(pagefile.map((item) => item.currentBytes))), pressureEvents: pagefileEvents, systemManaged: pagefile.at(-1)?.systemManaged ?? null, managementStatus: pagefile.at(-1)?.managementStatus ?? 'UNKNOWN', commitStatus: pagefile.at(-1)?.commitStatus ?? 'UNAVAILABLE', cleanup: 'never' }),
    drives: Object.freeze({ latestCount: last(drives.map((item) => item.count)), latestDegradedCount: last(drives.map((item) => item.degraded)), latestFailedCount: last(drives.map((item) => item.failed)), latest: Object.freeze(drives.at(-1)?.drives || []), observedSamples: count(drives, (item) => item.available) }),
    volumes: Object.freeze({ latest: Object.freeze(volumes.at(-1)?.volumes || []), latestCount: volumes.at(-1)?.volumes.length || 0, minimumFreeBytes: minimum(volumeFree), observedSamples: count(volumes, (item) => item.available) }),
    processes: Object.freeze({ peakCount: maximum(processes.map((item) => item.count)), abnormalEvents, latestTopMemory: processes.at(-1)?.topMemory || null, peakCpuPercent: processResourceRates.peakCpuPercent, peakIoBytesPerSecond: processResourceRates.peakIoBytesPerSecond, latestTopCpu: processResourceRates.latestTopCpu, latestTopIo: processResourceRates.latestTopIo, rateSamples: processResourceRates.rateSamples, counterResetEvents: processResourceRates.counterResetEvents }),
    network: Object.freeze({ latestReceivedBytes: last(network.map((item) => item.receivedBytes)), latestSentBytes: last(network.map((item) => item.sentBytes)), latestInterfaceCount: last(network.map((item) => item.interfaceCount)), latestConnectionCount: last(network.map((item) => item.connectionCount)), latestReceivedBytesPerSecond: last(networkRates.map((item) => item.receivedBytesPerSecond)), latestSentBytesPerSecond: last(networkRates.map((item) => item.sentBytesPerSecond)), peakReceivedBytesPerSecond: maximum(receivedRates), peakSentBytesPerSecond: maximum(sentRates), rateSamples: count(networkRates, (item) => item.state === 'rate-ready'), counterResetEvents: count(networkRates, (item) => item.state === 'counter-reset'), latestRateState: last(networkRates.map((item) => item.state)), latestTopProcess: last(processNetworks.map((item) => item.top)), processSamples: count(processNetworks, (item) => item.available) }),
    development: Object.freeze({ activeClasses, contentionEvents: count(workloads, (item) => item.contention) }),
    gaming: Object.freeze({ detectedEvents: count(workloads, (item) => item.gameDetected), contentionEvents: count(workloads, (item) => item.contention) }),
    cleanup: Object.freeze({ performedSamples: count(cleanup, (item) => item.performed), recoveredBytes: cleanup.reduce((sum, item) => sum + item.recoveredBytes, 0), actionCount: cleanup.reduce((sum, item) => sum + item.actionCount, 0) }),
    policy: Object.freeze({ state: policy.state, recommendations: policy.recommendations, actionCount: policy.actions.length, approvalRequired: policy.actions.some((item) => item.requiresApproval) }),
    evidence: Object.freeze({ telemetrySamples: samples.length, complete: samples.length > 0 && storageFree.length > 0 && (memoryUsed.length > 0 || memoryPercent.length > 0) }),
    recommendations: Object.freeze(recommendations),
    priorities: Object.freeze(recommendations.slice(0, 3))
  });
}
