/**
 * RNK Vortex System Optimizer
 * Contributor: RNK Enterprise
 *
 * System-facts library. This is a dedicated algorithm library for the
 * system-facts engine. It accepts normalized facts and produces deterministic
 * fingerprints, change sets, sampling guidance, and bounded envelopes.
 */

export const SYSTEM_FACTS_LIBRARY_ID = 'system-facts-library';
export const SYSTEM_FACTS_LIBRARY_VERSION = 1;

const ENVIRONMENTS = Object.freeze(['interactive', 'headless', 'unknown']);
const PRESSURES = Object.freeze(['normal', 'elevated', 'high', 'unknown']);
const EMPTY_ARRAY = Object.freeze([]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function scalar(value, fallback = null) {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function listOrEmpty(value) {
  return value;
}

function validPressure(value) {
  return PRESSURES.includes(value) ? value : 'unknown';
}

function validFacts(facts) {
  return isRecord(facts)
    && facts.protocolVersion === 1
    && facts.engine === 'system-facts'
    && ENVIRONMENTS.includes(facts.environment)
    && isRecord(facts.cpu)
    && isRecord(facts.memory)
    && isRecord(facts.pressure)
    && Array.isArray(facts.gpus)
    && Array.isArray(facts.storage)
    && Array.isArray(facts.network);
}

function requireFacts(facts) {
  if (!validFacts(facts)) throw new TypeError('Normalized system facts are required');
  return facts;
}

function memoryClass(facts) {
  return validPressure(facts.pressure.memory);
}

function pressureClass(facts) {
  return [
    validPressure(facts.pressure.cpu),
    validPressure(facts.pressure.memory),
    validPressure(facts.pressure.swap),
    validPressure(facts.pressure.storage)
  ];
}

function gpuSignature(facts) {
  return listOrEmpty(facts.gpus)
    .map((gpu) => [scalar(gpu?.vendor), scalar(gpu?.model), numberOrNull(gpu?.vramBytes)])
    .map((parts) => parts.join(':'))
    .sort();
}

function storageSignature(facts) {
  return listOrEmpty(facts.storage)
    .map((disk) => [scalar(disk?.mount, '/'), scalar(disk?.type), disk?.readOnly === true])
    .map((parts) => parts.join(':'))
    .sort();
}

function networkSignature(facts) {
  return listOrEmpty(facts.network)
    .map((item) => [scalar(item?.name), scalar(item?.kind), item?.mesh === true])
    .map((parts) => parts.join(':'))
    .sort();
}

function topologySignature(facts) {
  return [
    scalar(facts.cpu?.architecture),
    numberOrNull(facts.cpu?.physicalCpus),
    numberOrNull(facts.cpu?.logicalCpus),
    numberOrNull(facts.cpu?.sockets)
  ];
}

export function fingerprintFacts(facts) {
  requireFacts(facts);
  return JSON.stringify({
    environment: facts.environment,
    os: [scalar(facts.os?.family), scalar(facts.os?.version)],
    cpu: topologySignature(facts),
    memory: [numberOrNull(facts.memory?.totalBytes), memoryClass(facts)],
    gpu: gpuSignature(facts),
    storage: storageSignature(facts),
    network: networkSignature(facts)
  });
}

function changed(previous, current, selector) {
  return JSON.stringify(selector(previous)) !== JSON.stringify(selector(current));
}

export function compareFactSnapshots(previous, current) {
  requireFacts(previous);
  requireFacts(current);
  return Object.freeze({
    changed: fingerprintFacts(previous) !== fingerprintFacts(current),
    environmentChanged: previous.environment !== current.environment,
    cpuChanged: changed(previous, current, topologySignature),
    memoryChanged: changed(previous, current, (facts) => [
      numberOrNull(facts.memory?.totalBytes), memoryClass(facts)
    ]),
    gpuChanged: changed(previous, current, gpuSignature),
    storageChanged: changed(previous, current, storageSignature),
    networkChanged: changed(previous, current, networkSignature),
    pressureChanged: JSON.stringify(pressureClass(previous)) !== JSON.stringify(pressureClass(current))
  });
}

export function recommendSamplingInterval(facts) {
  requireFacts(facts);
  const pressures = pressureClass(facts);
  if (pressures.includes('high')) return 500;
  if (pressures.includes('elevated')) return 1000;
  if (facts.environment === 'interactive') return 1000;
  if (facts.environment === 'headless') return 5000;
  return 2000;
}

function requireTrigger(trigger) {
  if (!scalar(trigger)) throw new TypeError('System-facts envelope trigger is required');
  return trigger;
}

function requireSequence(sequence) {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('System-facts envelope sequence must be positive');
  }
  return sequence;
}

export function buildFactEnvelope(facts, {
  trigger,
  sequence = 1,
  now = Date.now
} = {}) {
  requireFacts(facts);
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new TypeError('System-facts envelope clock must return a number');
  return Object.freeze({
    library: SYSTEM_FACTS_LIBRARY_ID,
    libraryVersion: SYSTEM_FACTS_LIBRARY_VERSION,
    trigger: requireTrigger(trigger),
    sequence: requireSequence(sequence),
    generatedAt: new Date(timestamp).toISOString(),
    fingerprint: fingerprintFacts(facts),
    samplingIntervalMs: recommendSamplingInterval(facts)
  });
}

export function createSystemFactsLibrary(options = {}) {
  if (!isRecord(options)) throw new TypeError('System-facts library options must be an object');
  const clock = typeof options.now === 'function' ? options.now : Date.now;
  return Object.freeze({
    id: SYSTEM_FACTS_LIBRARY_ID,
    version: SYSTEM_FACTS_LIBRARY_VERSION,
    fingerprint: fingerprintFacts,
    compare: compareFactSnapshots,
    samplingInterval: recommendSamplingInterval,
    envelope: (facts, envelopeOptions = {}) => buildFactEnvelope(facts, {
      ...envelopeOptions,
      now: clock
    })
  });
}
