/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Local media queue state and safe media-panel handoff. Audio decoding and
 * network playback remain application-host responsibilities.
 */

export const MEDIA_PLAYER_VERSION = 1;
export const REPEAT_MODES = Object.freeze(['off', 'one', 'all']);
const MAX_TRACKS = 256;

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function tracks(value) { return Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))].slice(0, MAX_TRACKS) : []; }
function stateOf(source) { return Object.freeze({ version: MEDIA_PLAYER_VERSION, queue: Object.freeze(tracks(source.queue)), currentIndex: Number.isInteger(source.currentIndex) && source.currentIndex >= 0 ? source.currentIndex : 0, playing: source.playing === true, shuffle: source.shuffle === true, repeat: REPEAT_MODES.includes(source.repeat) ? source.repeat : 'off', positionSeconds: Number.isFinite(source.positionSeconds) && source.positionSeconds >= 0 ? source.positionSeconds : 0, authority: 'player-host-required', mutation: 'state-only' }); }

function nextState(state, direction, random) {
  if (!state.queue.length) return stateOf({ ...state, playing: false });
  if (state.repeat === 'one' && direction > 0) return state;
  if (state.shuffle && direction > 0 && state.queue.length > 1) {
    const sample = random();
    const normalized = Number.isFinite(sample) && sample >= 0 && sample < 1 ? sample : 0;
    const offset = Math.floor(normalized * (state.queue.length - 1)) + 1;
    return stateOf({ ...state, currentIndex: (state.currentIndex + offset) % state.queue.length, positionSeconds: 0 });
  }
  const candidate = state.currentIndex + direction;
  if (candidate >= 0 && candidate < state.queue.length) return stateOf({ ...state, currentIndex: candidate, positionSeconds: 0 });
  if (state.repeat === 'all') return stateOf({ ...state, currentIndex: candidate < 0 ? state.queue.length - 1 : 0, positionSeconds: 0 });
  return stateOf({ ...state, playing: false, positionSeconds: 0 });
}

export function createMediaPlayer({ queue = [], initial = {}, now = Date.now, random = Math.random } = {}) {
  if (typeof now !== 'function') throw new TypeError('Media player clock must be a function');
  if (typeof random !== 'function') throw new TypeError('Media player random source must be a function');
  let state = stateOf({ ...initial, queue: queue.length ? queue : initial.queue });
  function read() { return Object.freeze({ ...state, track: state.queue[state.currentIndex] || null, updatedAt: now() }); }
  function command(action, value) {
    switch (action) {
      case 'play': state = state.queue.length ? stateOf({ ...state, playing: true }) : stateOf({ ...state, playing: false }); break;
      case 'pause': state = stateOf({ ...state, playing: false }); break;
      case 'next': state = nextState(state, 1, random); break;
      case 'previous': state = nextState(state, -1, random); break;
      case 'shuffle': state = stateOf({ ...state, shuffle: value === true }); break;
      case 'repeat': if (!REPEAT_MODES.includes(value)) throw new Error('Media player repeat mode is invalid'); state = stateOf({ ...state, repeat: value }); break;
      case 'select': if (!Number.isInteger(value) || value < 0 || value >= state.queue.length) throw new RangeError('Media player track index is invalid'); state = stateOf({ ...state, currentIndex: value, positionSeconds: 0 }); break;
      default: throw new Error(`Unsupported media player action: ${action || 'unknown'}`);
    }
    return read();
  }
  function search(catalogue, query = '') { const needle = text(query)?.toLowerCase() || ''; return Object.freeze((Array.isArray(catalogue) ? catalogue : []).filter((item) => item && (!needle || `${item.title || ''} ${item.path || ''}`.toLowerCase().includes(needle))).slice(0, MAX_TRACKS)); }
  return Object.freeze({ version: MEDIA_PLAYER_VERSION, read, command, search });
}

export function buildMediaPanelPlan(url, { allowedHosts = ['music.youtube.com', 'www.youtube.com', 'youtu.be'] } = {}) {
  const value = text(url);
  if (!value) return Object.freeze({ state: 'refused', reason: 'media-panel URL is required', mutation: 'none' });
  let parsed;
  try { parsed = new URL(value); } catch { return Object.freeze({ state: 'refused', reason: 'media-panel URL is invalid', mutation: 'none' }); }
  const hosts = Array.isArray(allowedHosts) ? allowedHosts.map(text).filter(Boolean).map((host) => host.toLowerCase()) : [];
  if (parsed.protocol !== 'https:') return Object.freeze({ state: 'refused', reason: 'media-panel requires HTTPS', mutation: 'none' });
  if (!hosts.includes(parsed.hostname.toLowerCase())) return Object.freeze({ state: 'refused', reason: 'media-panel host is not allow-listed', mutation: 'none' });
  return Object.freeze({ version: MEDIA_PLAYER_VERSION, state: 'review-ready', url: parsed.toString(), host: parsed.hostname.toLowerCase(), operation: 'embed-media-panel', mutation: 'none', downloads: false, requiresApproval: true });
}
