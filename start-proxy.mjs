#!/usr/bin/env node
/**
 * RNK Vortex System Optimizer
 * Copyright © 2025 Asgard Innovations / RNK™
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3 of the License.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/gpl-3.0.html>.
 *
 *
 * LISA Secure Proxy entry point. Keeps lisa-secure-proxy.js a pure library
 * (importable by Jest without import.meta CJS-transform failures).
 *
 * Zero-config: discovers VQ units on 127.0.0.1:3000/3001 by default.
 *   VQ_UNIT_PORTS=3100,3101 node start-proxy.mjs   # custom unit ports
 *   LISA_PROXY_PORT=9999 node start-proxy.mjs      # custom proxy port
 *
 * Shared-token auth (recommended): set the SAME secret on the proxy and
 * every unit; units with a token reject unauthenticated connections.
 *   VQ_CLUSTER_TOKEN=$(openssl rand -hex 32) node start-proxy.mjs
 */

import { LISAProxyServer } from './lisa-secure-proxy.js';

const proxy = new LISAProxyServer(process.env.LISA_PROXY_PORT || 9999);
proxy.start();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n[LISA Proxy] Shutting down...');
    proxy.stop();
    process.exit(0);
  });
}
