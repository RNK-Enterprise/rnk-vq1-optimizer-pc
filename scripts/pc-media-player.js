/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Browser-owned local media host. Playback accepts only user-selected
 * File/Blob-like objects and uses the host HTMLAudioElement; it never fetches
 * URLs, reads arbitrary filesystem paths, or downloads media.
 */

export const PC_MEDIA_PLAYER_VERSION = 1;
const MAX_QUEUE = 256;
const MAX_FILE_BYTES = 4 * 1024 ** 3;
const AUDIO_EXTENSIONS = new Set(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav', '.weba', '.wma']);
const AUDIO_TYPES = new Set(['audio/aac', 'audio/flac', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/opus', 'audio/wav', 'audio/webm', 'audio/x-ms-wma']);

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function fileName(value) { return text(value?.name) || null; }
function isAudioFile(value) {
  const name = fileName(value);
  const type = text(value?.type)?.toLowerCase();
  const extension = name?.slice(name.lastIndexOf('.')).toLowerCase();
  return Boolean(name && ((type && AUDIO_TYPES.has(type)) || (extension && AUDIO_EXTENSIONS.has(extension))));
}
function validFile(value) { return record(value) && Number.isFinite(value.size) && value.size >= 0 && value.size <= MAX_FILE_BYTES && typeof value.arrayBuffer === 'function' && isAudioFile(value); }
function metadata(entry) { return Object.freeze({ name: entry.file.name, type: text(entry.file.type) || null, size: entry.file.size }); }

function defaultAudioFactory() {
  return typeof globalThis.Audio === 'function' ? new globalThis.Audio() : null;
}

export function createPcMediaPlayer({ audioFactory = defaultAudioFactory, urlApi = globalThis.URL, random = Math.random } = {}) {
  if (typeof audioFactory !== 'function') throw new TypeError('PC media player audio factory must be callable');
  if (typeof random !== 'function') throw new TypeError('PC media player random source must be callable');
  const audio = audioFactory();
  const canPlay = record(audio) && typeof audio.play === 'function' && typeof audio.pause === 'function';
  const canCreateUrl = record(urlApi) && typeof urlApi.createObjectURL === 'function' && typeof urlApi.revokeObjectURL === 'function';
  const queue = [];
  let currentIndex = -1;
  let currentUrl = null;
  let status = 'idle';
  let shuffle = false;
  let repeat = 'off';

  function unsupported() { return Object.freeze({ version: PC_MEDIA_PLAYER_VERSION, state: 'unsupported', reason: !canPlay ? 'browser audio host is unavailable' : 'browser object URL host is unavailable' }); }
  function read() {
    return Object.freeze({ version: PC_MEDIA_PLAYER_VERSION, state: canPlay && canCreateUrl ? status : 'unsupported', queue: Object.freeze(queue.map(metadata)), currentIndex, current: currentIndex >= 0 ? metadata(queue[currentIndex]) : null, shuffle, repeat, positionSeconds: canPlay && Number.isFinite(audio.currentTime) ? audio.currentTime : 0, durationSeconds: canPlay && Number.isFinite(audio.duration) ? audio.duration : null });
  }
  function revoke() {
    if (currentUrl && canCreateUrl) urlApi.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  function load(index) {
    if (!canPlay || !canCreateUrl) return unsupported();
    if (!Number.isInteger(index) || index < 0 || index >= queue.length) return Object.freeze({ version: PC_MEDIA_PLAYER_VERSION, state: 'refused', reason: 'media queue index is invalid' });
    revoke();
    currentIndex = index;
    currentUrl = urlApi.createObjectURL(queue[index].file);
    audio.src = currentUrl;
    audio.currentTime = 0;
    status = 'loaded';
    return read();
  }
  function nextIndex(direction) {
    if (!queue.length) return -1;
    if (shuffle && direction > 0 && queue.length > 1) {
      const sample = random();
      const offset = Math.floor((Number.isFinite(sample) && sample >= 0 && sample < 1 ? sample : 0) * (queue.length - 1)) + 1;
      return (currentIndex + offset + queue.length) % queue.length;
    }
    const candidate = currentIndex + direction;
    if (candidate >= 0 && candidate < queue.length) return candidate;
    return repeat === 'all' ? (candidate < 0 ? queue.length - 1 : 0) : -1;
  }
  function add(file) {
    if (!validFile(file)) return Object.freeze({ version: PC_MEDIA_PLAYER_VERSION, state: 'refused', reason: 'user-selected audio File or Blob is required' });
    if (queue.length >= MAX_QUEUE) return Object.freeze({ version: PC_MEDIA_PLAYER_VERSION, state: 'refused', reason: 'media queue is full' });
    queue.push({ file });
    if (currentIndex < 0) currentIndex = 0;
    return read();
  }
  async function play() {
    if (!canPlay || !canCreateUrl) return unsupported();
    if (!queue.length) return Object.freeze({ version: PC_MEDIA_PLAYER_VERSION, state: 'refused', reason: 'media queue is empty' });
    if (!currentUrl) load(0);
    try { await audio.play(); status = 'playing'; return read(); } catch (error) { status = 'rejected'; return Object.freeze({ ...read(), reason: error?.message || 'browser audio playback was rejected' }); }
  }
  function pause() {
    if (!canPlay || !canCreateUrl) return unsupported();
    audio.pause(); status = 'paused'; return read();
  }
  function ended() {
    if (!canPlay || !canCreateUrl) return unsupported();
    if (repeat === 'one') { audio.currentTime = 0; status = 'playing'; return Object.freeze({ ...read(), state: 'replay-required' }); }
    const index = nextIndex(1);
    if (index < 0) { status = 'ended'; return read(); }
    return load(index);
  }
  function command(action, value) {
    if (action === 'add') return add(value);
    if (action === 'load') return load(value);
    if (action === 'play') return play();
    if (action === 'pause') return pause();
    if (action === 'next') return load(nextIndex(1));
    if (action === 'previous') return load(nextIndex(-1));
    if (action === 'shuffle') { shuffle = value === true; return read(); }
    if (action === 'repeat') { if (!['off', 'one', 'all'].includes(value)) throw new Error('PC media player repeat mode is invalid'); repeat = value; return read(); }
    if (action === 'seek') { if (!canPlay || !Number.isFinite(value) || value < 0) return Object.freeze({ version: PC_MEDIA_PLAYER_VERSION, state: 'refused', reason: 'media seek position is invalid' }); audio.currentTime = value; return read(); }
    if (action === 'ended') return ended();
    throw new Error(`Unsupported PC media player action: ${action || 'unknown'}`);
  }
  function dispose() { if (canPlay) audio.pause(); revoke(); queue.length = 0; currentIndex = -1; status = 'idle'; return Object.freeze({ version: PC_MEDIA_PLAYER_VERSION, state: 'disposed' }); }
  if (canPlay) audio.onended = () => { const result = ended(); if (result.state === 'replay-required') audio.play().catch(() => {}); };
  return Object.freeze({ version: PC_MEDIA_PLAYER_VERSION, read, command, play, pause, dispose });
}
