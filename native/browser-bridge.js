/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Bounded native-messaging bridge for browser download preflight. Browser
 * messages carry facts only; they never select commands, paths, or files.
 */

import { collectSystemFacts } from './system-facts.js';
import { preflightDownload } from './download-guard.js';
import { applyBrowserRedirect, previewBrowserRedirect } from './browser-redirect.js';

export const BROWSER_BRIDGE_VERSION = 1;
export const MAX_BROWSER_MESSAGE_BYTES = 64 * 1024;
const MESSAGE_HEADER_BYTES = 4;

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function validSize(value) { return Number.isFinite(value) && value >= 0; }

function response(requestId, result, type = 'download-preflight-result') {
  return Object.freeze({ version: BROWSER_BRIDGE_VERSION, type, requestId: text(requestId), ...result });
}

export async function handleBrowserMessage(message, { factsProvider = collectSystemFacts, redirectPolicy = null } = {}) {
  if (!record(message)) throw new TypeError('Browser bridge message must be an object');
  if (message.type === 'download-redirect') {
    if (!record(redirectPolicy) || typeof redirectPolicy.sourceRoot !== 'string' || !record(redirectPolicy.targetRoots)) throw new Error('Browser redirect policy is unavailable');
    const targetRoot = redirectPolicy.targetRoots[message.targetMount];
    const facts = await factsProvider();
    const targetVolume = (facts?.volumes?.volumes || []).find((item) => String(item.mount).toUpperCase() === String(message.targetMount).toUpperCase());
    const plan = previewBrowserRedirect({ sourcePath: message.sourcePath, sourceRoot: redirectPolicy.sourceRoot, targetRoot, targetMount: message.targetMount, sizeBytes: message.sizeBytes, targetFreeBytes: targetVolume?.freeBytes });
    const result = plan.state !== 'preview-ready'
      ? { state: plan.state, applied: false, plan }
      : redirectPolicy.approved === true
        ? await applyBrowserRedirect(plan, { approved: true, dryRun: false })
        : { state: 'redirect-preview', applied: false, plan };
    return response(message.requestId, { state: result.state, redirect: result }, 'download-redirect-result');
  }
  if (message.type !== 'download-preflight') throw new Error('Browser bridge message type is unsupported');
  if (!validSize(message.sizeBytes)) return response(message.requestId, { state: 'observation-required', reason: 'download size is unavailable' });
  const facts = await factsProvider();
  const volumes = Array.isArray(facts?.volumes?.volumes) ? facts.volumes.volumes : [];
  const result = preflightDownload({ sizeBytes: message.sizeBytes, destinationMount: message.destinationMount, volumes });
  return response(message.requestId, { state: result.state, preflight: result });
}

export function encodeBrowserMessage(message, { maxBytes = MAX_BROWSER_MESSAGE_BYTES } = {}) {
  if (!record(message)) throw new TypeError('Browser bridge response must be an object');
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || payload.length > maxBytes) throw new RangeError('Browser bridge message is too large');
  const header = Buffer.alloc(MESSAGE_HEADER_BYTES);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

function parseFrames(buffer, maxBytes) {
  const messages = [];
  let offset = 0;
  while (buffer.length - offset >= MESSAGE_HEADER_BYTES) {
    const size = buffer.readUInt32LE(offset);
    if (size > maxBytes) throw new RangeError('Browser bridge message is too large');
    if (buffer.length - offset < MESSAGE_HEADER_BYTES + size) break;
    const payload = buffer.subarray(offset + MESSAGE_HEADER_BYTES, offset + MESSAGE_HEADER_BYTES + size).toString('utf8');
    messages.push(JSON.parse(payload));
    offset += MESSAGE_HEADER_BYTES + size;
  }
  return { messages, remainder: buffer.subarray(offset) };
}

export async function runBrowserBridge(options) {
  const { input, output, factsProvider = collectSystemFacts, redirectPolicy = null, maxMessageBytes = MAX_BROWSER_MESSAGE_BYTES } = options || {};
  if (!input || typeof input.on !== 'function') throw new TypeError('Browser bridge input is required');
  if (!output || typeof output.write !== 'function') throw new TypeError('Browser bridge output is required');
  let buffer = Buffer.alloc(0);
  input.on('data', (chunk) => {
    try {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      const parsed = parseFrames(buffer, maxMessageBytes);
      buffer = parsed.remainder;
      for (const message of parsed.messages) {
        Promise.resolve(handleBrowserMessage(message, { factsProvider, redirectPolicy }))
          .then((result) => output.write(encodeBrowserMessage(result, { maxBytes: maxMessageBytes })))
          .catch((error) => output.write(encodeBrowserMessage(response(null, { state: 'error', reason: error.message }), { maxBytes: maxMessageBytes })));
      }
    } catch (error) {
      buffer = Buffer.alloc(0);
      output.write(encodeBrowserMessage(response(null, { state: 'error', reason: error.message })));
    }
  });
  return new Promise((resolve, reject) => {
    input.once('end', () => resolve({ state: 'stopped' }));
    input.once('error', reject);
  });
}
