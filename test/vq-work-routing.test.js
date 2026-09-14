/**
 * RNK Vortex Quantum™
 * Copyright © 2025 Asgard Innovations / RNK™. All Rights Reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL
 *
 * Work-routing tests - classification priority, capability-aware unit
 * selection, degraded fallback and the proxy integration (pickUnit,
 * dispatch stats, failover, health-frame advertisement parsing).
 */

import http from 'http';
import * as ws_ from 'ws';
import { classifyWork, pickUnitForWork, unitSupports, WORK_CLASSES } from '../vq-work-routing.js';
import { LISAProxyServer, VQUnit } from '../lisa-secure-proxy.js';

const WebSocketServer = ws_.WebSocketServer || ws_.Server;
const silentLog = () => {};

/** Unit stub with the surface pickUnitForWork/unitSupports read. */
function makeUnit(id, { role = null, capabilities = null, inFlight = 0, lastLatencyMs = null } = {}) {
  return {
    id,
    role,
    capabilities,
    inFlight,
    lastLatencyMs,
    get load() { return this.inFlight; }
  };
}

describe('classifyWork - classification priority', () => {
  test('explicit routingHint beats command type and engine name', () => {
    expect(classifyWork({ type: 'vq.render.effect', routingHint: 'compute' }))
      .toEqual({ workClass: 'compute', reason: 'explicit-hint' });
    expect(classifyWork({ type: 'vq.work.execute', routingHint: 'render', payload: { engine: 'physics-engine-modular' } }))
      .toEqual({ workClass: 'render', reason: 'explicit-hint' });
  });

  test('routingHint is case-insensitive and passes unknown classes through', () => {
    expect(classifyWork({ routingHint: 'RENDER' }).workClass).toBe('render');
    expect(classifyWork({ routingHint: 'Batch' })).toEqual({ workClass: 'batch', reason: 'explicit-hint' });
  });

  test('an empty routingHint is ignored (falls through to the type table)', () => {
    expect(classifyWork({ type: 'vq.render.effect', routingHint: '' }))
      .toEqual({ workClass: 'render', reason: 'command-type' });
  });

  test('command type beats engine-name hints', () => {
    // vq.bench is compute-class even when it names a render engine.
    expect(classifyWork({ type: 'vq.bench', payload: { engine: 'particle-engine-modular' } }))
      .toEqual({ workClass: 'compute', reason: 'command-type' });
  });

  test('render command types classify as render', () => {
    expect(classifyWork({ type: 'vq.render.effect', payload: { particleCount: 10 } }))
      .toEqual({ workClass: 'render', reason: 'command-type' });
    expect(classifyWork({ type: 'vq.render.stop' }).workClass).toBe('render');
  });

  test('catalog and benchmark commands classify as compute', () => {
    for (const type of ['vq.bench', 'vq.engines.search', 'vq.engines.list', 'vq.engine.info']) {
      expect(classifyWork({ type }).workClass).toBe('compute');
    }
  });

  test('vq.work.execute classifies by engine name in both payload shapes', () => {
    expect(classifyWork({ type: 'vq.work.execute', payload: { engine: 'particle-engine-modular' } }))
      .toEqual({ workClass: 'render', reason: 'engine-name' });
    expect(classifyWork({ type: 'vq.work.execute', engine: 'Canvas-Engine' }))
      .toEqual({ workClass: 'render', reason: 'engine-name' });
    expect(classifyWork({ type: 'vq.work.execute', payload: { engine: 'crypto-hash-engine' } }))
      .toEqual({ workClass: 'compute', reason: 'engine-name' });
  });

  test('render hints win over compute hints when a name matches both', () => {
    // 'particle' (render) and 'state' (compute) both appear.
    expect(classifyWork({ type: 'vq.work.execute', payload: { engine: 'particle-state-engine' } }).workClass)
      .toBe('render');
  });

  test('unclassified engine names and missing names are general', () => {
    expect(classifyWork({ type: 'vq.work.execute', payload: { engine: 'jasper-controller' } }))
      .toEqual({ workClass: 'general', reason: 'unclassified-engine' });
    expect(classifyWork({ type: 'vq.work.execute', payload: {} }))
      .toEqual({ workClass: 'general', reason: 'unclassified-engine' });
  });

  test('no payload, non-object payload and unknown types are general', () => {
    expect(classifyWork(null)).toEqual({ workClass: 'general', reason: 'no-payload' });
    expect(classifyWork('nope')).toEqual({ workClass: 'general', reason: 'no-payload' });
    expect(classifyWork({ type: 'mystery.command' })).toEqual({ workClass: 'general', reason: 'no-match' });
    expect(classifyWork({})).toEqual({ workClass: 'general', reason: 'no-match' });
  });
});

describe('unitSupports', () => {
  test('units that never advertised capabilities support everything', () => {
    const legacy = makeUnit('VQ-0');
    expect(unitSupports(legacy, WORK_CLASSES.RENDER)).toBe(true);
    expect(unitSupports(legacy, WORK_CLASSES.COMPUTE)).toBe(true);
    expect(unitSupports(legacy, 'batch')).toBe(true);
  });

  test('general work is supported by any unit', () => {
    expect(unitSupports(makeUnit('u', { capabilities: ['render'] }), WORK_CLASSES.GENERAL)).toBe(true);
  });

  test('advertised capabilities decide support', () => {
    const render = makeUnit('VQ-2', { capabilities: ['render'] });
    expect(unitSupports(render, WORK_CLASSES.RENDER)).toBe(true);
    expect(unitSupports(render, WORK_CLASSES.COMPUTE)).toBe(false);
  });

  test('role implies support even when the capability list disagrees', () => {
    const roleRender = makeUnit('VQ-2', { role: 'render-optimized', capabilities: ['compute'] });
    expect(unitSupports(roleRender, WORK_CLASSES.RENDER)).toBe(true);
    const roleCompute = makeUnit('VQ-1', { role: 'compute-optimized', capabilities: ['render'] });
    expect(unitSupports(roleCompute, WORK_CLASSES.COMPUTE)).toBe(true);
  });

  test('unknown classes are not implicitly supported by specialist units', () => {
    expect(unitSupports(makeUnit('u', { capabilities: ['compute'] }), 'batch')).toBe(false);
  });
});

describe('pickUnitForWork', () => {
  test('no healthy units yields null and unmatched', () => {
    expect(pickUnitForWork([], WORK_CLASSES.RENDER)).toEqual({ unit: null, matched: false });
  });

  test('prefers the supporter even when it is the busier unit', () => {
    const compute = makeUnit('VQ-1', { capabilities: ['compute'], inFlight: 0 });
    const render = makeUnit('VQ-2', { capabilities: ['render'], inFlight: 5 });
    const pick = pickUnitForWork([compute, render], WORK_CLASSES.RENDER);
    expect(pick.unit.id).toBe('VQ-2');
    expect(pick.matched).toBe(true);
  });

  test('supporter ties break on least in-flight, then lowest latency', () => {
    const a = makeUnit('A', { capabilities: ['render'], inFlight: 3 });
    const b = makeUnit('B', { capabilities: ['render'], inFlight: 1 });
    expect(pickUnitForWork([a, b], WORK_CLASSES.RENDER).unit.id).toBe('B');

    const c = makeUnit('C', { capabilities: ['render'], inFlight: 2, lastLatencyMs: 40 });
    const d = makeUnit('D', { capabilities: ['render'], inFlight: 2, lastLatencyMs: 10 });
    expect(pickUnitForWork([c, d], WORK_CLASSES.RENDER).unit.id).toBe('D');
  });

  test('degraded fallback: no supporter healthy -> least-loaded overall, matched=false', () => {
    const compute = makeUnit('VQ-1', { capabilities: ['compute'], inFlight: 4 });
    const pick = pickUnitForWork([compute], WORK_CLASSES.RENDER);
    expect(pick.unit.id).toBe('VQ-1');
    expect(pick.matched).toBe(false);
  });

  test('legacy units (no advertisement) are always treated as supporters', () => {
    const legacy = makeUnit('VQ-0', { inFlight: 7 });
    const specialist = makeUnit('VQ-2', { capabilities: ['render'], inFlight: 0 });
    const pick = pickUnitForWork([specialist, legacy], WORK_CLASSES.RENDER);
    // Both count as supporters, so least-loaded wins.
    expect(pick.unit.id).toBe('VQ-2');
    expect(pick.matched).toBe(true);
  });

  test('does not mutate the input array', () => {
    const a = makeUnit('A', { capabilities: ['render'], inFlight: 5 });
    const b = makeUnit('B', { capabilities: ['render'], inFlight: 0 });
    pickUnitForWork([a, b], WORK_CLASSES.RENDER);
    expect(a.inFlight).toBe(5);
    expect(b.inFlight).toBe(0);
  });
});

describe('LISAProxyServer capability routing integration', () => {
  function makeProxy() {
    const proxy = new LISAProxyServer(9999);
    proxy.log = silentLog;
    proxy.configureUnits();
    proxy.units.forEach((u) => { u.healthy = true; });
    proxy.units[0].role = 'compute-optimized';
    proxy.units[0].capabilities = ['compute'];
    proxy.units[1].role = 'render-optimized';
    proxy.units[1].capabilities = ['render'];
    return proxy;
  }

  test('pickUnit prefers the specialist for classified payloads', () => {
    const proxy = makeProxy();
    expect(proxy.pickUnit({ type: 'vq.render.effect', payload: {} }).id).toBe('VQ-2');
    expect(proxy.pickUnit({ type: 'vq.bench', payload: {} }).id).toBe('VQ-1');
    expect(proxy._lastRouting).toEqual({ unitId: 'VQ-1', workClass: 'compute', matched: true });
  });

  test('pickUnit without a payload keeps plain least-loaded behavior', () => {
    const proxy = makeProxy();
    proxy.units[0].inFlight = 2;
    expect(proxy.pickUnit().id).toBe('VQ-2');
    expect(proxy._lastRouting).toBeNull();
  });

  test('routingHint override flows through pickUnit', () => {
    const proxy = makeProxy();
    const pick = proxy.pickUnit({ type: 'vq.render.effect', routingHint: 'compute', payload: {} });
    expect(pick.id).toBe('VQ-1');
    expect(proxy._lastRouting.workClass).toBe('compute');
  });

  test('degraded pickUnit: specialist down -> survivor, matched=false', () => {
    const proxy = makeProxy();
    proxy.units[1].healthy = false;
    const pick = proxy.pickUnit({ type: 'vq.render.effect', payload: {} });
    expect(pick.id).toBe('VQ-1');
    expect(proxy._lastRouting).toEqual({ unitId: 'VQ-1', workClass: 'render', matched: false });
  });

  test('dispatch records per-class stats with matched counting', async () => {
    const proxy = makeProxy();
    const vq2 = jest.spyOn(proxy.units[1], 'request').mockResolvedValue({ ok: true });
    const vq1 = jest.spyOn(proxy.units[0], 'request').mockResolvedValue({ ok: true });

    await proxy.dispatch({ type: 'vq.render.effect', payload: { particleCount: 1 } });
    expect(vq2).toHaveBeenCalledTimes(1);
    expect(vq1).not.toHaveBeenCalled();

    // Specialist down: render still flows to VQ-1, matched does not advance.
    proxy.units[1].healthy = false;
    await proxy.dispatch({ type: 'vq.render.effect', payload: { particleCount: 1 } });
    expect(vq1).toHaveBeenCalledTimes(1);

    const byClass = proxy.stats.dispatchByClass;
    expect(byClass.render).toEqual({ dispatched: 2, matched: 1 });
    expect(byClass.compute).toEqual({ dispatched: 0, matched: 0 });
  });

  test('unknown routingHint classes are counted under general', async () => {
    const proxy = makeProxy();
    jest.spyOn(proxy.units[0], 'request').mockResolvedValue({ ok: true });
    await proxy.dispatch({ type: 'vq.work.execute', routingHint: 'batch', payload: { engine: 'x' } });
    expect(proxy.stats.dispatchByClass.general.dispatched).toBe(1);
    expect(proxy.stats.dispatchByClass.general.matched).toBe(0);
  });

  test('failover prefers a same-class supporter before degrading', async () => {
    const proxy = makeProxy();
    // Both units support render for this scenario.
    proxy.units[0].capabilities = ['render'];
    const vq1 = jest.spyOn(proxy.units[0], 'request').mockRejectedValue(new Error('boom'));
    const vq2 = jest.spyOn(proxy.units[1], 'request').mockResolvedValue({ ok: true });

    const result = await proxy.dispatch({ type: 'vq.render.effect', payload: {} });
    expect(result).toEqual({ ok: true });
    expect(vq1).toHaveBeenCalledTimes(1);
    expect(vq2).toHaveBeenCalledTimes(1);
    expect(proxy.stats.failovers).toBe(1);
  });

  test('failover degrades to any healthy unit when no same-class supporter exists', async () => {
    const proxy = makeProxy();
    const vq2 = jest.spyOn(proxy.units[1], 'request').mockRejectedValue(new Error('boom'));
    const vq1 = jest.spyOn(proxy.units[0], 'request').mockResolvedValue({ ok: true });

    const result = await proxy.dispatch({ type: 'vq.render.effect', payload: {} });
    expect(result).toEqual({ ok: true });
    expect(vq2).toHaveBeenCalledTimes(1);
    expect(vq1).toHaveBeenCalledTimes(1); // compute unit took the render work
    expect(proxy.stats.failovers).toBe(1);
  });

  test('clusterStatus exposes routing stats and unit capabilities', () => {
    const proxy = makeProxy();
    const status = proxy.clusterStatus();
    expect(status.routing.dispatchByClass).toEqual(proxy.stats.dispatchByClass);
    expect(status.units.find((u) => u.id === 'VQ-2').capabilities).toEqual(['render']);
    expect(status.units.find((u) => u.id === 'VQ-1').role).toBe('compute-optimized');
  });
});

describe('VQUnit health-frame capability advertisement', () => {
  test('role and capabilities are parsed from vq.health frames (non-strings filtered)', async () => {
    const server = http.createServer();
    const wss = new WebSocketServer({ server });
    const unit = new VQUnit('VQ-9', '127.0.0.1', 0, silentLog);

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    unit.port = server.address().port;

    wss.on('connection', (cws) => {
      cws.send(JSON.stringify({
        type: 'vq.health',
        latencyMs: 1,
        role: 'render-optimized',
        capabilities: ['render', 42, null]
      }));
    });

    unit.connect();
    await new Promise((r) => setTimeout(r, 250));

    expect(unit.role).toBe('render-optimized');
    expect(unit.capabilities).toEqual(['render']);

    unit.stop();
    wss.close();
    server.close();
  });
});
