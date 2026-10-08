/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Append-only workstation history. It stores bounded observations, previews,
 * verifies, and reversible action receipts without deleting or executing them.
 */

import fs from 'fs/promises';
import path from 'path';

export const STEWARD_HISTORY_VERSION = 1;
export const STEWARD_HISTORY_EVENTS = Object.freeze(['observation', 'preview', 'apply', 'verify', 'rollback', 'quarantine', 'report']);
const MAX_ENTRY_BYTES = 128 * 1024;

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function validateLimit(value) { if (!Number.isInteger(value) || value < 1 || value > 4096) throw new RangeError('History maxEntries out of range'); return value; }
function validateEntry(entry) { if (!record(entry)) throw new TypeError('History entry must be an object'); if (!text(entry.id) || text(entry.id).length > 128) throw new Error('History entry requires a short id'); if (!STEWARD_HISTORY_EVENTS.includes(entry.event)) throw new Error('History entry has an unsupported event'); if (!Number.isFinite(entry.timestamp)) throw new TypeError('History entry timestamp must be numeric'); const serialized = JSON.stringify(entry); if (serialized.length > MAX_ENTRY_BYTES) throw new RangeError('History entry is too large'); return Object.freeze({ ...entry, version: STEWARD_HISTORY_VERSION }); }
function inside(root, candidate, pathImpl) { const relative = pathImpl.relative(root, candidate); return relative !== '' && !relative.startsWith('..') && !pathImpl.isAbsolute(relative); }

export function createStewardHistoryStore({ filePath, fsImpl = fs, pathImpl = path, maxEntries = 2048 } = {}) {
  if (typeof filePath !== 'string' || filePath.length === 0) throw new TypeError('History store requires a filePath');
  const resolvedFile = pathImpl.resolve(filePath);
  const limit = validateLimit(maxEntries);

  async function read() {
    let contents;
    try { contents = await fsImpl.readFile(resolvedFile, 'utf8'); } catch (error) { if (error?.code === 'ENOENT') return Object.freeze([]); throw error; }
    const lines = contents.split('\n').filter((line) => line.length > 0);
    if (lines.length > limit) throw new RangeError('History store exceeds maxEntries');
    return Object.freeze(lines.map((line) => { let value; try { value = JSON.parse(line); } catch { throw new Error('History store contains invalid JSON'); } return validateEntry(value); }));
  }

  async function append(entry) {
    const checked = validateEntry(entry);
    const current = await read();
    if (current.length >= limit) throw new RangeError('History store is full');
    await fsImpl.mkdir(pathImpl.dirname(resolvedFile), { recursive: true });
    await fsImpl.appendFile(resolvedFile, `${JSON.stringify(checked)}\n`, 'utf8');
    return checked;
  }

  async function latest() { const entries = await read(); return entries.at(-1) || null; }

  function rollbackPlan(entry) {
    const checked = validateEntry(entry);
    if (checked.reversible !== true || !record(checked.undo)) return Object.freeze({ state: 'refused', reason: 'history entry has no approved undo description' });
    return Object.freeze({ state: 'preview', requiresApproval: true, action: Object.freeze({ type: 'rollback', id: checked.id, undo: Object.freeze({ ...checked.undo }) }) });
  }

  function quarantinePlan(entry, protectedRoots = []) {
    const checked = validateEntry(entry);
    const source = text(checked.path);
    if (!source) return Object.freeze({ state: 'refused', reason: 'history entry has no source path' });
    const absoluteSource = pathImpl.resolve(source);
    if (protectedRoots.some((root) => typeof root === 'string' && inside(pathImpl.resolve(root), absoluteSource, pathImpl))) return Object.freeze({ state: 'refused', reason: 'source path is protected' });
    const quarantine = pathImpl.join(pathImpl.dirname(resolvedFile), 'quarantine', pathImpl.basename(absoluteSource));
    return Object.freeze({ state: 'preview', requiresApproval: true, action: Object.freeze({ type: 'quarantine', id: checked.id, source: absoluteSource, destination: quarantine, reversible: true }) });
  }

  return Object.freeze({ filePath: resolvedFile, maxEntries: limit, read, append, latest, rollbackPlan, quarantinePlan });
}
