/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 * Media-assistant turbo. It indexes caller-supplied local media, normalizes
 * playlists, validates allowed web-media references, and creates facts-only
 * plans from a small fixed natural-language command vocabulary.
 */

export const WORKSTATION_STEWARD_MEDIA_ASSISTANT_TURBO_ID = 'workstation-steward.media-assistant';
export const WORKSTATION_STEWARD_MEDIA_ASSISTANT_TURBO_VERSION = 1;
const TRIGGERS = Object.freeze(['install.preflight', 'system.facts.request', 'workload.changed', 'health.interval']);
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function list(value, limit = 64) { return Array.isArray(value) ? value.filter(record).slice(0, limit) : []; }
function intent(query) { const value = text(query)?.toLowerCase() || ''; if (value.includes('c drive') && value.includes('full')) return 'storage-diagnosis'; if (value.includes('ram')) return 'memory-diagnosis'; if (value.includes('game') && (value.includes('build') || value.includes('finish'))) return 'workload-coexistence'; if (value.includes('move') && value.includes(' to ')) return 'file-move-preview'; if (value.includes('clean') && value.includes('safe')) return 'safe-cleanup-preview'; if (value.includes('battery')) return 'battery-health'; if (value.includes('changed since')) return 'daily-diff'; return 'unknown'; }
function panel(urls) { return Object.freeze((Array.isArray(urls) ? urls : []).map((raw) => { const value = text(raw); if (!value) return Object.freeze({ url: null, state: 'invalid' }); try { const parsed = new URL(value); const host = parsed.hostname.toLowerCase(); const allowed = parsed.protocol === 'https:' && ['youtube.com', 'www.youtube.com', 'youtu.be', 'music.youtube.com'].includes(host); return Object.freeze({ url: value, state: allowed ? 'reviewable' : 'refused', reason: allowed ? 'approved-media-host' : 'https-approved-host-required' }); } catch { return Object.freeze({ url: value, state: 'invalid' }); } })); }
function duplicates(media) { const grouped = new Map(); media.forEach((item) => { const hash = text(item.sha256)?.toLowerCase(); if (hash) grouped.set(hash, [...(grouped.get(hash) || []), text(item.path)].filter(Boolean)); }); return Object.freeze([...grouped.entries()].filter(([, paths]) => paths.length > 1).map(([sha256, paths]) => Object.freeze({ sha256, paths: Object.freeze(paths) }))); }
function clock(now) { const value = now(); if (!Number.isFinite(value)) throw new TypeError('Workstation-steward media-assistant clock must return a number'); return value; }
function triggerOf(trigger) { if (!TRIGGERS.includes(trigger)) throw new Error(`Unsupported workstation-steward media-assistant trigger: ${trigger || 'unknown'}`); return trigger; }

export function runWorkstationStewardMediaAssistantTurbo(sample = {}, { trigger, now = Date.now } = {}) {
  triggerOf(trigger);
  if (!record(sample)) throw new TypeError('Workstation-steward media-assistant sample must be an object');
  const timestamp = clock(now);
  const media = list(sample.media);
  const tracks = list(sample.tracks);
  const playlists = list(sample.playlists);
  const receipts = list(sample.receipts);
  const queryIntent = intent(sample.query);
  const actions = Object.freeze(receipts.filter((item) => text(item.id)).map((item) => Object.freeze({ id: text(item.id), status: text(item.status) || 'preview', undoToken: `undo:${text(item.id)}`, reversible: true })));
  const state = !media.length && !tracks.length && !text(sample.query) ? 'observation-required' : 'review-ready';
  return Object.freeze({ protocolVersion: 1, turbo: WORKSTATION_STEWARD_MEDIA_ASSISTANT_TURBO_ID, turboVersion: 1, trigger, generatedAt: new Date(timestamp).toISOString(), state, mediaCount: media.length, mediaTypes: Object.freeze([...new Set(media.map((item) => text(item.type)?.toLowerCase() || 'unknown'))]), duplicateGroups: duplicates(media), tracks: Object.freeze(tracks.map((item) => Object.freeze({ path: text(item.path), title: text(item.title) || text(item.path) || 'untitled', favorite: item.favorite === true }))), playlists: Object.freeze(playlists.map((item) => Object.freeze({ name: text(item.name) || 'unnamed', trackCount: Array.isArray(item.tracks) ? item.tracks.length : 0 }))), intent: queryIntent, plan: queryIntent === 'unknown' ? 'ask-for-supported-workstation-question' : `review-${queryIntent}`, panel: panel(sample.panelUrls), actionHistory: actions, assistantAuthority: 'facts-to-plan-approval-deterministic-action-verify' });
}
