/**
 * RNK Vortex System Optimizer (vendored component)
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
 * Shared vq-cluster-auth suite - parameterized by the module-under-test.
 * Both VQ stacks ship their own copy of vq-cluster-auth.js; this factory
 * runs the identical behavioral contract against each copy so any drift
 * between the stacks fails CI immediately.
 *
 * Coverage: env token handling with the short-token warning, timing-safe
 * comparison semantics (length mismatch and non-string inputs never
 * throw), WS-upgrade and HTTP token extraction paths, verify/open-mode
 * semantics, loopback detection, env hints, and one real-socket
 * integration test.
 */

import http from 'http';
import * as ws_ from 'ws';

const WebSocket = ws_.WebSocket || ws_.default;
const WebSocketServer = ws_.WebSocketServer || ws_.Server;

const TOKEN = 'abcdef0123456789abcdef0123456789'; // 32 chars, >= MIN_TOKEN_LENGTH

/** Rejects so a broken handshake fails the test instead of hanging it.
 *  The safety timer is cleared when the wrapped promise settles first, so
 *  no dangling handle keeps the Jest process alive. */
function withTimeout(promise, ms = 3000, label = 'step') {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]);
}

/** Run fn with a patched VQ_CLUSTER_TOKEN, restoring the old value after. */
function withEnv(value, fn) {
  const old = process.env.VQ_CLUSTER_TOKEN;
  if (value === undefined) delete process.env.VQ_CLUSTER_TOKEN;
  else process.env.VQ_CLUSTER_TOKEN = value;
  try {
    return fn();
  } finally {
    if (old === undefined) delete process.env.VQ_CLUSTER_TOKEN;
    else process.env.VQ_CLUSTER_TOKEN = old;
  }
}

/** Stub shaped like the fields extractToken/extractHttpToken actually read. */
function stubReq({ url = '/', headers = {} } = {}) {
  return { url, headers };
}

/**
 * Register the full auth contract suite.
 * @param {string} label describe() heading, e.g. 'VQ 1 auth copy'
 * @param {() => Promise<object>} importAuth loads the stack's own
 *   vq-cluster-auth.js module namespace
 */
export function registerAuthSuite(label, importAuth) {
  let auth = null; // module namespace under test

  beforeAll(async () => {
    auth = await importAuth();
  });

  describe(label, () => {
    describe('constants', () => {
      test('header, query param and minimum length are as documented', () => {
        expect(auth.TOKEN_HEADER).toBe('x-vq-token');
        expect(auth.TOKEN_QUERY).toBe('token');
        expect(auth.MIN_TOKEN_LENGTH).toBe(16);
      });
    });

    describe('getClusterToken', () => {
      test('returns null in open mode (unset, empty, whitespace-only)', () => {
        expect(withEnv(undefined, () => auth.getClusterToken())).toBeNull();
        expect(withEnv('', () => auth.getClusterToken())).toBeNull();
        expect(withEnv('   ', () => auth.getClusterToken())).toBeNull();
      });

      test('returns the trimmed token', () => {
        expect(withEnv(`  ${TOKEN}  `, () => auth.getClusterToken())).toBe(TOKEN);
      });

      test('warns when the token is shorter than MIN_TOKEN_LENGTH but still returns it', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          const short = 'short-token';
          expect(withEnv(short, () => auth.getClusterToken())).toBe(short);
          expect(warn).toHaveBeenCalledTimes(1);
          expect(warn.mock.calls[0][0]).toMatch(new RegExp(String(auth.MIN_TOKEN_LENGTH)));
        } finally {
          warn.mockRestore();
        }
      });

      test('exactly-minimum-length tokens do not warn', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          const exactly16 = 'a'.repeat(auth.MIN_TOKEN_LENGTH);
          expect(withEnv(exactly16, () => auth.getClusterToken())).toBe(exactly16);
          expect(warn).not.toHaveBeenCalled();
        } finally {
          warn.mockRestore();
        }
      });
    });

    describe('safeEqual - timing-safe comparison', () => {
      test('equal strings match', () => {
        expect(auth.safeEqual(TOKEN, TOKEN)).toBe(true);
        expect(auth.safeEqual('', '')).toBe(true);
      });

      test('different strings of equal length do not match', () => {
        expect(auth.safeEqual(TOKEN, `${TOKEN.slice(0, -1)}!`)).toBe(false);
        expect(auth.safeEqual('aaa', 'aab')).toBe(false);
      });

      test('length mismatch returns false instead of throwing', () => {
        // Raw crypto.timingSafeEqual throws on unequal buffer lengths; the
        // hash-first design exists precisely so this cannot happen.
        expect(() => auth.safeEqual(TOKEN, `${TOKEN}extra`)).not.toThrow();
        expect(auth.safeEqual(TOKEN, `${TOKEN}extra`)).toBe(false);
        expect(auth.safeEqual('a', 'abcdefgh')).toBe(false);
      });

      test('non-string inputs return false without throwing', () => {
        for (const bad of [null, undefined, 42, { token: TOKEN }, ['x'], true]) {
          expect(() => auth.safeEqual(bad, TOKEN)).not.toThrow();
          expect(auth.safeEqual(bad, TOKEN)).toBe(false);
          expect(() => auth.safeEqual(TOKEN, bad)).not.toThrow();
          expect(auth.safeEqual(TOKEN, bad)).toBe(false);
          expect(auth.safeEqual(bad, bad)).toBe(false);
        }
      });

      test('multi-byte strings compare on UTF-8 bytes', () => {
        expect(auth.safeEqual('tökén-🔐-token', 'tökén-🔐-token')).toBe(true);
        expect(auth.safeEqual('tökén-🔐-token', 'tökén-🔑-token')).toBe(false);
      });

      test('shared prefixes do not leak a match', () => {
        expect(auth.safeEqual(`${TOKEN}-suffix-a`, `${TOKEN}-suffix-b`)).toBe(false);
      });
    });

    describe('extractToken - WebSocket upgrade requests', () => {
      test('reads the header when present', () => {
        expect(auth.extractToken(stubReq({ headers: { [auth.TOKEN_HEADER]: TOKEN } }))).toBe(TOKEN);
      });

      test('header wins over query parameter', () => {
        const req = stubReq({ url: `/?${auth.TOKEN_QUERY}=query-token`, headers: { [auth.TOKEN_HEADER]: TOKEN } });
        expect(auth.extractToken(req)).toBe(TOKEN);
      });

      test('falls back to the query parameter', () => {
        expect(auth.extractToken(stubReq({ url: `/?${auth.TOKEN_QUERY}=query-token` }))).toBe('query-token');
        expect(auth.extractToken(stubReq({ url: `/path?x=1&${auth.TOKEN_QUERY}=q2&y=3` }))).toBe('q2');
      });

      test('returns null without a token anywhere', () => {
        expect(auth.extractToken(stubReq())).toBeNull();
        expect(auth.extractToken(stubReq({ url: '/?other=1' }))).toBeNull();
      });

      test('empty header values fall through to the query parameter', () => {
        const req = stubReq({ url: `/?${auth.TOKEN_QUERY}=from-query`, headers: { [auth.TOKEN_HEADER]: '' } });
        expect(auth.extractToken(req)).toBe('from-query');
      });

      test('non-string (duplicated) header values are ignored', () => {
        const req = stubReq({ url: `/?${auth.TOKEN_QUERY}=from-query`, headers: { [auth.TOKEN_HEADER]: ['a', 'b'] } });
        expect(auth.extractToken(req)).toBe('from-query');
      });

      test('null/undefined requests and malformed URLs never throw', () => {
        expect(auth.extractToken(null)).toBeNull();
        expect(auth.extractToken(undefined)).toBeNull();
        expect(auth.extractToken({ headers: null })).toBeNull();
        expect(() => auth.extractToken(stubReq({ url: '/%\nbad' }))).not.toThrow();
        expect(auth.extractToken(stubReq({ url: '/%\nbad' }))).toBeNull();
      });
    });

    describe('extractHttpToken - HTTP surface', () => {
      test('reads the dedicated header', () => {
        expect(auth.extractHttpToken(stubReq({ headers: { [auth.TOKEN_HEADER]: TOKEN } }))).toBe(TOKEN);
      });

      test('reads bearer authorization case-insensitively', () => {
        expect(auth.extractHttpToken(stubReq({ headers: { authorization: `Bearer ${TOKEN}` } }))).toBe(TOKEN);
        expect(auth.extractHttpToken(stubReq({ headers: { authorization: `bearer ${TOKEN}` } }))).toBe(TOKEN);
        expect(auth.extractHttpToken(stubReq({ headers: { authorization: `BEARER   ${TOKEN}` } }))).toBe(TOKEN);
      });

      test('header is preferred over bearer', () => {
        const req = stubReq({ headers: { [auth.TOKEN_HEADER]: TOKEN, authorization: 'Bearer other' } });
        expect(auth.extractHttpToken(req)).toBe(TOKEN);
      });

      test('non-bearer authorization schemes yield null', () => {
        expect(auth.extractHttpToken(stubReq({ headers: { authorization: 'Basic dXNlcjpwYXNz' } }))).toBeNull();
      });

      test('empty bearer and empty header yield null', () => {
        expect(auth.extractHttpToken(stubReq({ headers: { authorization: 'Bearer ' } }))).toBeNull();
        expect(auth.extractHttpToken(stubReq({ headers: { authorization: 'Bearer    ' } }))).toBeNull();
        expect(auth.extractHttpToken(stubReq({ headers: { [auth.TOKEN_HEADER]: '' } }))).toBeNull();
      });

      test('null/undefined requests and missing headers never throw', () => {
        expect(auth.extractHttpToken(null)).toBeNull();
        expect(auth.extractHttpToken(undefined)).toBeNull();
        expect(auth.extractHttpToken({})).toBeNull();
        expect(auth.extractHttpToken({ headers: {} })).toBeNull();
      });
    });

    describe('verifyToken', () => {
      test('open mode: no expected token accepts anything (including null)', () => {
        expect(auth.verifyToken(null, null)).toBe(true);
        expect(auth.verifyToken(null, 'anything')).toBe(true);
        expect(auth.verifyToken(undefined, '')).toBe(true);
        expect(auth.verifyToken('', TOKEN)).toBe(true);
      });

      test('enforced mode: missing presentation rejects', () => {
        expect(auth.verifyToken(TOKEN, null)).toBe(false);
        expect(auth.verifyToken(TOKEN, undefined)).toBe(false);
        expect(auth.verifyToken(TOKEN, '')).toBe(false);
      });

      test('enforced mode: exact match accepts, anything else rejects', () => {
        expect(auth.verifyToken(TOKEN, TOKEN)).toBe(true);
        expect(auth.verifyToken(TOKEN, `${TOKEN}x`)).toBe(false);
        expect(auth.verifyToken(TOKEN, TOKEN.toUpperCase())).toBe(false);
        expect(auth.verifyToken(TOKEN, ` ${TOKEN}`)).toBe(false); // no implicit trimming
      });
    });

    describe('isLoopback', () => {
      test('recognizes loopback addresses including the IPv4-mapped form', () => {
        for (const addr of ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']) {
          expect(auth.isLoopback(addr)).toBe(true);
        }
      });

      test('rejects non-loopback and junk input', () => {
        for (const addr of ['192.168.1.5', '::ffff:192.168.1.5', '10.0.0.2', 'localhost.evil', '', null, undefined]) {
          expect(auth.isLoopback(addr)).toBe(false);
        }
      });
    });

    describe('envHint', () => {
      test('names the env var and the component', () => {
        expect(auth.envHint('unit')).toMatch(/VQ_CLUSTER_TOKEN/);
        expect(auth.envHint('unit')).toMatch(/unit/);
        expect(auth.envHint('proxy')).toMatch(/proxy/);
      });
    });

    describe('real-socket integration', () => {
      test('extraction works on genuine upgrade and HTTP requests', async () => {
        const seen = { upgradeTokens: [], httpTokens: [] };
        const server = http.createServer((req, res) => {
          seen.httpTokens.push(auth.extractHttpToken(req));
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end('{"ok":true}');
        });
        // A real WebSocketServer performs the RFC 6455 handshake; our
        // recording listener on 'upgrade' observes the raw IncomingMessage.
        const wss = new WebSocketServer({ server });
        wss.on('connection', (cws) => cws.close());
        server.on('upgrade', (req) => {
          seen.upgradeTokens.push(auth.extractToken(req));
        });

        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address();

        const connect = (path, headers) => withTimeout(new Promise((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
          ws.on('open', () => { ws.close(); resolve(); });
          ws.on('error', reject);
        }), 3000, 'ws connect');

        // 1) WS upgrade with the token header
        await connect('/', { [auth.TOKEN_HEADER]: TOKEN });
        // 2) WS upgrade with the query parameter only
        await connect(`/?${auth.TOKEN_QUERY}=query-token`);
        // 3) WS upgrade with no token at all
        await connect('/');

        // 4) HTTP with the header
        await withTimeout(fetch(`http://127.0.0.1:${port}/status`, { headers: { [auth.TOKEN_HEADER]: TOKEN } }), 3000, 'http header');
        // 5) HTTP with a bearer token
        await withTimeout(fetch(`http://127.0.0.1:${port}/status`, { headers: { authorization: `Bearer ${TOKEN}` } }), 3000, 'http bearer');
        // 6) HTTP with nothing
        await withTimeout(fetch(`http://127.0.0.1:${port}/status`), 3000, 'http open');

        wss.close();
        server.closeAllConnections?.();
        await withTimeout(new Promise((r) => server.close(r)), 3000, 'server close');

        expect(seen.upgradeTokens).toEqual([TOKEN, 'query-token', null]);
        expect(seen.httpTokens).toEqual([TOKEN, TOKEN, null]);
      }, 15000);
    });
  });
}
