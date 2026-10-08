/**
 * Native gateway URL policy tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { LOOPBACK_HOSTS, validateGatewayUrl } from '../native/gateway-url.js';

describe('native gateway URL policy', () => {
  test('accepts HTTPS gateways and exact loopback HTTP development URLs', () => {
    expect(validateGatewayUrl('https://optimizer.example.test/plan')).toBe('https://optimizer.example.test/plan');
    expect(validateGatewayUrl('http://localhost:9999/plan')).toBe('http://localhost:9999/plan');
    expect(validateGatewayUrl('http://127.0.0.1:9999/plan')).toBe('http://127.0.0.1:9999/plan');
    expect(validateGatewayUrl('http://[::1]:9999/plan')).toBe('http://[::1]:9999/plan');
    expect(LOOPBACK_HOSTS.has('localhost')).toBe(true);
  });

  test('rejects missing, malformed, remote HTTP, unsupported, credentialed, and fragmented URLs', () => {
    expect(() => validateGatewayUrl('')).toThrow('required');
    expect(() => validateGatewayUrl('not a URL')).toThrow('invalid');
    expect(() => validateGatewayUrl('http://remote.example/plan')).toThrow('HTTPS');
    expect(() => validateGatewayUrl('ftp://localhost/plan')).toThrow('HTTPS or loopback');
    expect(() => validateGatewayUrl('https://user:pass@example.test/plan')).toThrow('credentials');
    expect(() => validateGatewayUrl('https://example.test/plan#secret')).toThrow('fragments');
  });
});
