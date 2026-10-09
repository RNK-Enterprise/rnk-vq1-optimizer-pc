/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Authority-side action audit. It records bounded before/preview/apply/verify
 * evidence around the native agent; it does not add execution capabilities.
 */

export const ACTION_AUDIT_VERSION = 1;

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function idFor(planId, suffix) { return `${text(planId)?.slice(0, 100) || 'native-plan'}-${suffix}`; }
function compactFacts(facts) {
  const source = record(facts) ? facts : {};
  return Object.freeze({
    platform: text(source.platform) || 'unknown',
    collectedAt: text(source.collectedAt),
    cpu: record(source.cpu) ? source.cpu : null,
    memory: record(source.memory) ? source.memory : null,
    gpu: record(source.gpu) ? source.gpu : null,
    storage: Array.isArray(source.storage) ? source.storage.slice(0, 16) : [],
    volumes: record(source.volumes) && Array.isArray(source.volumes.volumes) ? source.volumes.volumes.slice(0, 32) : [],
    pagefile: record(source.pagefile) ? source.pagefile : null,
    storagePressure: record(source.storagePressure) ? source.storagePressure : null,
    battery: record(source.battery) ? source.battery : null,
    thermals: record(source.thermals) ? { maxTemperatureC: source.thermals.maxTemperatureC ?? null } : null,
    network: record(source.network) ? { interfaces: Array.isArray(source.network.interfaces) ? source.network.interfaces.slice(0, 16) : [] } : null,
    processCount: Array.isArray(source.processes) ? source.processes.length : 0,
    startupCount: record(source.startup) && Array.isArray(source.startup.entries) ? source.startup.entries.length : 0
  });
}

function requireAgent(agent) {
  if (!agent || typeof agent.collectFacts !== 'function' || typeof agent.applyPlan !== 'function' || typeof agent.requestPlan !== 'function') throw new TypeError('Action audit requires a native agent');
  return agent;
}
function requireStore(historyStore) {
  if (!historyStore || typeof historyStore.append !== 'function') throw new TypeError('Action audit requires a history store');
  return historyStore;
}
function requireClock(now) {
  if (typeof now !== 'function') throw new TypeError('Action audit clock must be a function');
  return now;
}

export function createAuditedNativeAgent({ agent, historyStore, now = Date.now } = {}) {
  const nativeAgent = requireAgent(agent);
  const store = requireStore(historyStore);
  const clock = requireClock(now);

  async function applyPlan(plan, options = {}) {
    const timestamp = clock();
    if (!Number.isFinite(timestamp)) throw new TypeError('Action audit clock must return a number');
    const beforeFacts = options.beforeFacts === undefined ? await nativeAgent.collectFacts() : options.beforeFacts;
    const before = compactFacts(beforeFacts);
    const platform = before.platform;
    const observation = await store.append({ id: idFor(plan?.planId, 'observation'), event: 'observation', timestamp, platform, reversible: false, facts: before });
    const preview = await store.append({ id: idFor(plan?.planId, 'preview'), event: 'preview', timestamp, platform, reversible: false, planId: text(plan?.planId), plan });
    const { beforeFacts: ignored, ...agentOptions } = options;
    void ignored;
    const report = await nativeAgent.applyPlan(plan, agentOptions);
    const applied = await store.append({ id: idFor(plan?.planId, 'apply'), event: 'apply', timestamp: clock(), platform, reversible: false, planId: text(plan?.planId), report });
    const after = compactFacts(await nativeAgent.collectFacts());
    const verification = await store.append({ id: idFor(plan?.planId, 'verify'), event: 'verify', timestamp: clock(), platform: after.platform, reversible: false, planId: text(plan?.planId), before, after, report });
    return Object.freeze({ report, verification: Object.freeze({ before, after }), history: Object.freeze([observation, preview, applied, verification]) });
  }

  async function optimize(options = {}) {
    const facts = await nativeAgent.collectFacts();
    const plan = await nativeAgent.requestPlan(facts, { profile: options.profile });
    const audited = await applyPlan(plan, { ...options, beforeFacts: facts });
    return Object.freeze({ facts, plan, ...audited });
  }

  return Object.freeze({ collectFacts: nativeAgent.collectFacts.bind(nativeAgent), requestPlan: nativeAgent.requestPlan.bind(nativeAgent), applyPlan, optimize });
}
