/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * System-facts engine. This module only normalizes supplied observations and
 * derives bounded capability facts. It never reads files, runs commands, or
 * opens a transport. The native agent remains the authority for execution.
 */

export const SYSTEM_FACTS_ENGINE_ID = 'system-facts';
export const SYSTEM_FACTS_ENGINE_VERSION = 1;
export const SYSTEM_FACTS_PROTOCOL_VERSION = 1;

export const SYSTEM_FACTS_TRIGGERS = Object.freeze([
  'install.preflight',
  'system.facts.request',
  'workload.changed',
  'health.interval'
]);

export const SYSTEM_ENVIRONMENTS = Object.freeze([
  'interactive',
  'headless',
  'unknown'
]);

const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value, fallback = null) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function nonNegative(value, fallback = null) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveInteger(value, fallback = null) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function boundedPercent(value, fallback = null) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0, value));
}

function ratioPercent(used, total) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return boundedPercent((used / total) * 100);
}

function normalizeCpu(cpu) {
  const source = isRecord(cpu) ? cpu : {};
  const logical = positiveInteger(source.logicalCpus);
  const physical = positiveInteger(source.physicalCpus);
  const utilization = boundedPercent(source.utilizationPercent);
  return Object.freeze({
    model: text(source.model),
    architecture: text(source.architecture),
    sockets: positiveInteger(source.sockets, 1),
    physicalCpus: physical,
    logicalCpus: logical,
    utilizationPercent: utilization,
    governor: text(source.governor),
    driver: text(source.driver)
  });
}

function normalizeMemory(memory) {
  const source = isRecord(memory) ? memory : {};
  const total = nonNegative(source.totalBytes);
  const available = total === null
    ? nonNegative(source.availableBytes)
    : Math.min(total, nonNegative(source.availableBytes, 0));
  const used = total === null || available === null ? null : total - available;
  const swapTotal = nonNegative(source.swapTotalBytes);
  const swapFree = swapTotal === null
    ? nonNegative(source.swapFreeBytes)
    : Math.min(swapTotal, nonNegative(source.swapFreeBytes, 0));
  const swapUsed = swapTotal === null || swapFree === null ? null : swapTotal - swapFree;
  return Object.freeze({
    totalBytes: total,
    availableBytes: available,
    usedBytes: used,
    usedPercent: ratioPercent(used, total),
    swapTotalBytes: swapTotal,
    swapFreeBytes: swapFree,
    swapUsedBytes: swapUsed,
    swapUsedPercent: ratioPercent(swapUsed, swapTotal)
  });
}

function normalizeGpu(gpu) {
  const source = gpu;
  return Object.freeze({
    vendor: text(source.vendor),
    model: text(source.model),
    driver: text(source.driver),
    vramBytes: nonNegative(source.vramBytes),
    utilizationPercent: boundedPercent(source.utilizationPercent),
    temperatureCelsius: nonNegative(source.temperatureCelsius)
  });
}

function normalizeStorage(storage) {
  const source = storage;
  const total = nonNegative(source.totalBytes);
  const free = total === null
    ? nonNegative(source.freeBytes)
    : Math.min(total, nonNegative(source.freeBytes, 0));
  const used = total === null ? null : total - free;
  return Object.freeze({
    mount: text(source.mount, '/'),
    device: text(source.device),
    type: text(source.type),
    totalBytes: total,
    freeBytes: free,
    usedBytes: used,
    usedPercent: ratioPercent(used, total),
    readOnly: source.readOnly === true
  });
}

function normalizeNetwork(network) {
  const source = network;
  return Object.freeze({
    name: text(source.name),
    kind: text(source.kind),
    state: text(source.state, 'unknown'),
    mesh: source.mesh === true,
    defaultRoute: source.defaultRoute === true
  });
}

function normalizeList(value, normalizer) {
  if (!Array.isArray(value)) return EMPTY_ARRAY;
  return Object.freeze(value.filter(isRecord).map(normalizer));
}

function classifyEnvironment(source) {
  if (SYSTEM_ENVIRONMENTS.includes(source.environment)) return source.environment;
  if (typeof source.headless === 'boolean') return source.headless ? 'headless' : 'interactive';
  if (source.displayPresent === true) return 'interactive';
  if (source.displayPresent === false) return 'headless';
  return 'unknown';
}

function deriveCapabilities(source, environment, gpus, storage) {
  const declared = isRecord(source.capabilities) ? source.capabilities : {};
  const hasGpu = gpus.length > 0;
  const hasWritableStorage = storage.some((item) => item.readOnly === false);
  return Object.freeze({
    gpuObservation: declared.gpuObservation === true || hasGpu,
    displayObservation: declared.displayObservation === true
      || (environment === 'interactive' && source.displayPresent !== false),
    batteryObservation: declared.batteryObservation === true,
    thermalObservation: declared.thermalObservation === true,
    powerProfileControl: declared.powerProfileControl === true,
    processPriorityControl: declared.processPriorityControl === true,
    ioPriorityControl: declared.ioPriorityControl === true,
    cacheCleanup: declared.cacheCleanup === true && hasWritableStorage,
    networkObservation: declared.networkObservation !== false,
    organizationPreview: declared.organizationPreview === true
  });
}

function derivePressure(cpu, memory, storage) {
  const storageValues = storage
    .map((item) => item.usedPercent)
    .filter((value) => value !== null);
  return Object.freeze({
    cpu: cpu.utilizationPercent === null ? 'unknown'
      : cpu.utilizationPercent >= 85 ? 'high'
        : cpu.utilizationPercent >= 65 ? 'elevated' : 'normal',
    memory: memory.usedPercent === null ? 'unknown'
      : memory.usedPercent >= 90 ? 'high'
        : memory.usedPercent >= 75 ? 'elevated' : 'normal',
    swap: memory.swapUsedPercent === null ? 'unknown'
      : memory.swapUsedPercent >= 75 ? 'high'
        : memory.swapUsedPercent >= 40 ? 'elevated' : 'normal',
    storage: storageValues.length === 0 ? 'unknown'
      : Math.max(...storageValues) >= 90 ? 'high'
        : Math.max(...storageValues) >= 80 ? 'elevated' : 'normal'
  });
}

export function normalizeSystemFacts(input = {}) {
  const source = isRecord(input) ? input : {};
  const cpu = normalizeCpu(source.cpu);
  const memory = normalizeMemory(source.memory);
  const gpus = normalizeList(source.gpus, normalizeGpu);
  const storage = normalizeList(source.storage, normalizeStorage);
  const network = normalizeList(source.network, normalizeNetwork);
  const environment = classifyEnvironment(source);
  return Object.freeze({
    protocolVersion: SYSTEM_FACTS_PROTOCOL_VERSION,
    engine: SYSTEM_FACTS_ENGINE_ID,
    engineVersion: SYSTEM_FACTS_ENGINE_VERSION,
    observedAt: text(source.observedAt),
    hostname: text(source.hostname),
    os: Object.freeze({
      family: text(source.os?.family, 'unknown'),
      version: text(source.os?.version),
      kernel: text(source.os?.kernel)
    }),
    environment,
    cpu,
    memory,
    gpus,
    storage,
    network,
    capabilities: deriveCapabilities(source, environment, gpus, storage),
    pressure: derivePressure(cpu, memory, storage)
  });
}

function requireTrigger(trigger) {
  if (!SYSTEM_FACTS_TRIGGERS.includes(trigger)) {
    throw new Error(`Unsupported system-facts trigger: ${trigger || 'unknown'}`);
  }
}

function observations(facts) {
  return Object.freeze({
    environment: facts.environment,
    cpuPressure: facts.pressure.cpu,
    memoryPressure: facts.pressure.memory,
    swapPressure: facts.pressure.swap,
    storagePressure: facts.pressure.storage,
    gpuCount: facts.gpus.length,
    storageCount: facts.storage.length,
    meshInterfaces: facts.network.filter((item) => item.mesh).map((item) => item.name)
  });
}

function limitations(facts) {
  const values = [];
  if (facts.environment === 'unknown') values.push('environment-selection-required');
  if (facts.gpus.length === 0) values.push('gpu-unavailable');
  if (!facts.capabilities.thermalObservation) values.push('thermal-observation-unavailable');
  if (!facts.capabilities.powerProfileControl) values.push('power-profile-control-unavailable');
  if (!facts.capabilities.cacheCleanup) values.push('cache-cleanup-not-authorized');
  return Object.freeze(values);
}

export function runSystemFactsEngine(input = {}, { trigger, now = Date.now } = {}) {
  requireTrigger(trigger);
  const facts = normalizeSystemFacts(input);
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('System-facts clock must return a number');
  return Object.freeze({
    protocolVersion: SYSTEM_FACTS_PROTOCOL_VERSION,
    engine: SYSTEM_FACTS_ENGINE_ID,
    engineVersion: SYSTEM_FACTS_ENGINE_VERSION,
    trigger,
    generatedAt: new Date(timestamp).toISOString(),
    facts,
    observations: observations(facts),
    limitations: limitations(facts),
    actions: EMPTY_ARRAY
  });
}
