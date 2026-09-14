#!/usr/bin/env node
/**
 * RNK Vortex Quantum™
 * Copyright © 2025 Asgard Innovations / RNK™. All Rights Reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL
 *
 * E2E verification of capability-aware routing in the tandem cluster.
 * Requires: both units + proxy running (see TANDEM_CLUSTER.md).
 *   VQ_PROXY=ws://127.0.0.1:9999 node e2e-capability-routing.js
 */
import * as ws_ from 'ws';
const WebSocket = ws_.WebSocket || ws_.default;

const PROXY = process.env.VQ_PROXY || 'ws://127.0.0.1:9999';
let seq = 0;

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(PROXY);
    const pending = new Map();
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.requestId && pending.has(msg.requestId)) {
        pending.get(msg.requestId)(msg);
        pending.delete(msg.requestId);
      }
    });
    ws.on('open', () => resolve({
      send: (payload) => new Promise((res) => {
        const id = `e2e-${++seq}-${Date.now()}`;
        pending.set(id, res);
        ws.send(JSON.stringify({ ...payload, requestId: id }));
      }),
      close: () => ws.close()
    }));
    ws.on('error', reject);
  });
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const tally = (arr) => arr.reduce((m, id) => ({ ...m, [id]: (m[id] || 0) + 1 }), {});

const ws = await connect();
await new Promise((r) => setTimeout(r, 300)); // let lisa.proxy.connected arrive

// ---- 1) Cluster status: roles + capabilities advertised -------------------
const status = await ws.send({ type: 'lisa.cluster.status' });
const units = status.cluster?.units || [];
const vq1 = units.find((u) => u.id === 'VQ-1');
const vq2 = units.find((u) => u.id === 'VQ-2');
record('units advertise role/capabilities',
  vq1?.role === 'compute-optimized' && vq2?.role === 'render-optimized'
  && (vq1?.capabilities || []).includes('compute') && (vq2?.capabilities || []).includes('render'),
  `VQ-1=${vq1?.role} [${vq1?.capabilities}] VQ-2=${vq2?.role} [${vq2?.capabilities}]`);

// ---- 2) Render-specialty command -> VQ-2 ----------------------------------
const renderServed = [];
for (let i = 0; i < 6; i++) {
  const r = await ws.send({ type: 'vq.render.effect', payload: { particleCount: 2000 } });
  renderServed.push(r.unitId || `type:${r.type}`);
}
const rt = tally(renderServed);
record('render traffic prefers VQ-2', (rt['VQ-2'] || 0) === 6, JSON.stringify(rt));

// ---- 3) Engine-name classification: particle engine -> VQ-2 ---------------
const part = await ws.send({ type: 'vq.work.execute', payload: { engine: 'particle-engine-modular', method: 'createMacro', args: [] } });
record('engine-name hint routes particle engine to VQ-2', part.unitId === 'VQ-2', `served by ${part.unitId} (${part.type})`);

// ---- 4) Compute command -> VQ-1 -------------------------------------------
const computeServed = [];
for (let i = 0; i < 6; i++) {
  const r = await ws.send({ type: 'vq.bench', payload: { iterations: 1000, algorithm: 'loop', input: 5 } });
  computeServed.push(r.unitId || `type:${r.type}`);
}
const ct = tally(computeServed);
record('compute traffic prefers VQ-1', (ct['VQ-1'] || 0) === 6, JSON.stringify(ct));

// ---- 5) Explicit override: routingHint beats engine-name ------------------
const forced = await ws.send({
  type: 'vq.work.execute',
  routingHint: 'compute',
  payload: { engine: 'particle-engine-modular', method: 'createMacro', args: [] }
});
record('explicit routingHint overrides engine classification', forced.unitId === 'VQ-1', `served by ${forced.unitId}`);

// ---- 6) Status exposes per-class routing stats ----------------------------
const status2 = await ws.send({ type: 'lisa.cluster.status' });
const byClass = status2.cluster?.routing?.dispatchByClass;
record('clusterStatus exposes routing.dispatchByClass',
  !!byClass && byClass.render.dispatched >= 7 && byClass.compute.dispatched >= 7,
  JSON.stringify(byClass));

ws.close();

// ---- 7) Degraded fallback: kill VQ-2, render must still flow --------------
console.log('\n-- failover phase: stopping VQ-2 --');
const { execSync } = await import('child_process');
try {
  const pid = execSync("ss -tlnp | grep ':3101' | grep -oP 'pid=\\K[0-9]+' | head -1").toString().trim();
  execSync(`kill ${pid}`);
} catch { /* already down */ }
await new Promise((r) => setTimeout(r, 6000)); // poll interval + failover

const ws2 = await connect();
const degraded = await ws2.send({ type: 'vq.render.effect', payload: { particleCount: 1500 } });
record('render work survives VQ-2 down (VQ-1 fallback)', degraded.unitId === 'VQ-1', `served by ${degraded.unitId} (${degraded.type})`);
ws2.close();

// ---- 8) Recovery: restart VQ-2, capability routing resumes ----------------
console.log('\n-- recovery phase: restarting VQ-2 --');
const token = (await import('fs')).readFileSync('/tmp/vq-test-token', 'utf8').trim();
const { spawn } = await import('child_process');
const { fileURLToPath } = await import('url');
const path = await import('path');
const child = spawn('node', ['vq-unit-server.js'], {
  cwd: path.dirname(fileURLToPath(new URL('../VQ 2/vq-unit-server.js', import.meta.url))),
  env: { ...process.env, PORT: '3101', VQ_CLUSTER_TOKEN: token },
  detached: true, stdio: 'ignore'
});
child.on('error', (e) => { console.error('spawn failed:', e.message); process.exit(1); });
child.unref();
await new Promise((r) => setTimeout(r, 9000)); // reconnect + health

const ws3 = await connect();
const recovered = await ws3.send({ type: 'vq.render.effect', payload: { particleCount: 1500 } });
record('render routing returns to VQ-2 after recovery', recovered.unitId === 'VQ-2', `served by ${recovered.unitId}`);
ws3.close();

// ---- Summary ---------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
