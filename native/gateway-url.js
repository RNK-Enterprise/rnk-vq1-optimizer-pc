/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Gateway URL policy for the native PC authority.
 */

const LOOPBACK_HOSTS = Object.freeze(new Set(['localhost', '127.0.0.1', '::1', '[::1]']));

export function validateGatewayUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('Optimizer gateway URL is required');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Optimizer gateway URL is invalid');
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('Optimizer gateway URL must use HTTPS or loopback HTTP');
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error('Optimizer gateway URL cannot contain credentials or fragments');
  }

  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol === 'http:' && !LOOPBACK_HOSTS.has(host)) {
    throw new Error('Remote optimizer gateways must use HTTPS');
  }

  return parsed.toString();
}

export { LOOPBACK_HOSTS };
