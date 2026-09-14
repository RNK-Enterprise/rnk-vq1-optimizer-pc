/**
 * Tandem cluster end-to-end smoke test (run manually: node test/smoke-tandem.js)
 * Starts two fake VQ units, the secure proxy, and a client; verifies
 * discovery, least-loaded dispatch, health polling and failover live.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { LISAProxyServer } from '../lisa-secure-proxy.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Grab a free ephemeral TCP port (bind, read, release). */
async function freePort() {
  const net = await import('net');
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function startFakeUnit(port, name) {
  const wss = new WebSocketServer({ port });
  let connections = 0;
  wss.on('connection', (ws) => {
    connections++;
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.type === 'vq.health.ping') {
        ws.send(JSON.stringify({ type: 'vq.health', latencyMs: 1, unit: name }));
        return;
      }
      // Echo with a marker of which unit served it
      ws.send(JSON.stringify({ ...msg, servedBy: name }));
    });
  });
  return {
    wss,
    getConnections: () => connections,
    /** Hard-kill: drop established sockets (wss.close() alone does not). */
    kill() {
      for (const client of wss.clients) client.terminate();
      wss.close();
    }
  };
}

console.log('--- starting fake VQ units ---');
// Ephemeral ports: real deployments use 3000/3001 (see ARCHITECTURE.md),
// but the machine running this smoke test may already occupy them.
const port1 = await freePort();
const port2 = await freePort();
const unit1 = startFakeUnit(port1, 'VQ-1');
const unit2 = startFakeUnit(port2, 'VQ-2');

console.log(`--- starting proxy on 19999 (units on ${port1}/${port2}) ---`);
const proxy = new LISAProxyServer(19999, { unitPorts: [port1, port2] });
proxy.log = () => {};
proxy.start();

await sleep(2500); // allow discovery + health polling to mark both healthy

const client = new WebSocket('ws://127.0.0.1:19999');
await new Promise((r) => client.on('open', r));

const responses = [];
client.on('message', (d) => responses.push(JSON.parse(d)));

// 1) cluster status shows TANDEM
client.send(JSON.stringify({ type: 'lisa.cluster.status' }));
await sleep(300);
const status = responses.find((r) => r.type === 'lisa.cluster.status');
console.log('1. cluster mode:', status?.cluster?.mode, `(units ${status?.cluster?.unitsHealthy}/${status?.cluster?.unitsTotal})`);
if (status?.cluster?.mode !== 'TANDEM') { console.error('FAIL: expected TANDEM'); process.exit(1); }

// 2) dispatch requests -> should be shared across both units
for (let i = 0; i < 4; i++) {
  client.send(JSON.stringify({ type: 'lisa.command', seq: i }));
}
await sleep(800);
const served = responses.filter((r) => r.servedBy).map((r) => r.servedBy);
console.log('2. dispatch served by:', served.join(', '));
const distinct = new Set(served);
if (distinct.size < 2) { console.error('FAIL: load was not shared across units'); process.exit(1); }
console.log(`   unit1 conns=${unit1.getConnections()} unit2 conns=${unit2.getConnections()}`);

// 3) kill unit2, verify failover keeps serving
console.log('--- killing VQ-2 ---');
unit2.kill();
await sleep(7000); // wait for close detection + reconnect window + poll cycle
responses.length = 0;
client.send(JSON.stringify({ type: 'lisa.command', seq: 99 }));
await sleep(800);
const after = responses.filter((r) => r.servedBy);
console.log('3. after VQ-2 death, served by:', after.map((r) => r.servedBy).join(', ') || 'NOBODY');
if (!after.length || after.some((r) => r.servedBy !== 'VQ-1')) { console.error('FAIL: failover did not route to VQ-1'); process.exit(1); }

// 4) status shows DEGRADED-SINGLE
responses.length = 0;
client.send(JSON.stringify({ type: 'lisa.cluster.status' }));
await sleep(300);
const status2 = responses.find((r) => r.type === 'lisa.cluster.status');
console.log('4. cluster mode after failure:', status2?.cluster?.mode, `failovers=${status2?.cluster?.failovers}`);
if (status2?.cluster?.mode !== 'DEGRADED-SINGLE') { console.error('FAIL: expected DEGRADED-SINGLE'); process.exit(1); }

console.log('\nALL SMOKE CHECKS PASSED');
client.close();
proxy.stop();
unit1.wss.close();
process.exit(0);
