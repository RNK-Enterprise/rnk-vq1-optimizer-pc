/**
 * Native media metadata tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { buildMediaMetadataPlan, collectMediaMetadata, MEDIA_METADATA_VERSION, parseMediaMetadataOutput } from '../native/media-metadata.js';
import path from 'path';

const fileFs = { lstat: async () => ({ isSymbolicLink: () => false, isFile: () => true }) };
const probeOutput = JSON.stringify({ format: { format_name: 'mp4', duration: '12.5', size: '4000' }, streams: [{ codec_type: 'video', codec_name: 'h264', width: '1920', height: 1080 }, { codec_type: 'audio', codec_name: 'aac', channels: 2, sample_rate: '48000' }] });

describe('native bounded media metadata', () => {
  test('builds fixed ffprobe plans and normalizes metadata', () => {
    expect(buildMediaMetadataPlan()).toMatchObject({ version: MEDIA_METADATA_VERSION, state: 'refused' });
    expect(buildMediaMetadataPlan('https://example.com/a.mp4')).toMatchObject({ state: 'refused' });
    expect(buildMediaMetadataPlan('/media/a.txt')).toMatchObject({ state: 'refused', reason: 'media file extension is not supported' });
    const plan = buildMediaMetadataPlan('/media/a.mp4', { pathImpl: path.posix });
    expect(plan).toMatchObject({ state: 'plan-ready', operation: 'inspect-media-metadata', command: { file: 'ffprobe', args: expect.arrayContaining(['--', '/media/a.mp4']) }, requiresApproval: false });
    expect(parseMediaMetadataOutput(probeOutput, { path: '/media/a.mp4' })).toMatchObject({ version: MEDIA_METADATA_VERSION, available: true, format: { name: 'mp4', durationSeconds: 12.5, sizeBytes: 4000 }, streams: [{ type: 'video', codec: 'h264', width: 1920, height: 1080 }, { type: 'audio', codec: 'aac', channels: 2, sampleRate: 48000 }] });
    expect(parseMediaMetadataOutput('bad', { path: '/media/a.mp4' })).toMatchObject({ available: false, reason: 'ffprobe returned invalid JSON' });
    expect(parseMediaMetadataOutput()).toMatchObject({ available: false, reason: 'ffprobe returned invalid JSON' });
    expect(parseMediaMetadataOutput('[]')).toMatchObject({ available: false, reason: 'ffprobe returned an invalid record' });
    expect(parseMediaMetadataOutput(JSON.stringify({ format: 'bad', streams: null }))).toMatchObject({ available: true, format: { name: null }, streams: [] });
  });

  test('collects exact local metadata and preserves unavailable states', async () => {
    const plan = buildMediaMetadataPlan('/media/a.mp4', { pathImpl: path.posix });
    await expect(collectMediaMetadata()).resolves.toMatchObject({ state: 'refused', available: false });
    await expect(collectMediaMetadata('/media/a.mp4', { pathImpl: path.posix })).resolves.toMatchObject({ state: 'plan-ready', available: false, reason: 'command runner unavailable' });
    await expect(collectMediaMetadata('/media/a.mp4', { pathImpl: path.posix, commandRunner: { run: jest.fn() }, maxOutputBytes: 100 })).rejects.toThrow('output bound');
    expect(await collectMediaMetadata('/media/a.mp4', { pathImpl: path.posix, fsImpl: fileFs, commandRunner: { run: jest.fn().mockResolvedValue({ code: 0, stdout: probeOutput }) } })).toMatchObject({ available: true, format: { name: 'mp4' } });
    expect(await collectMediaMetadata('/media/a.mp4', { pathImpl: path.posix, fsImpl: fileFs, commandRunner: { run: jest.fn().mockResolvedValue({ code: 1, stderr: 'unsupported' }) } })).toMatchObject({ available: false, reason: 'unsupported' });
    expect(await collectMediaMetadata('/media/a.mp4', { pathImpl: path.posix, fsImpl: fileFs, commandRunner: { run: jest.fn().mockResolvedValue({ code: 1 }) } })).toMatchObject({ available: false, reason: 'ffprobe failed' });
    expect(await collectMediaMetadata('/media/a.mp4', { pathImpl: path.posix, fsImpl: fileFs, commandRunner: { run: jest.fn().mockRejectedValue(new Error('failed')) } })).toMatchObject({ available: false, reason: 'failed' });
    expect(plan.command.file).toBe('ffprobe');
  });

  test('refuses missing, symbolic-link, non-file, malformed, and oversized outputs', async () => {
    const commandRunner = { run: jest.fn() };
    expect(await collectMediaMetadata('/media/a.txt', { pathImpl: path.posix, commandRunner })).toMatchObject({ state: 'refused', available: false });
    expect(await collectMediaMetadata('/media/a.mp4', { pathImpl: path.posix, fsImpl: { lstat: async () => { throw new Error('missing'); } }, commandRunner })).toMatchObject({ available: false, reason: 'missing' });
    expect(await collectMediaMetadata('/media/a.mp4', { pathImpl: path.posix, fsImpl: { lstat: async () => ({ isSymbolicLink: () => true, isFile: () => false }) }, commandRunner })).toMatchObject({ available: false, reason: 'symbolic links are not metadata targets' });
    expect(await collectMediaMetadata('/media/a.mp4', { pathImpl: path.posix, fsImpl: { lstat: async () => ({ isSymbolicLink: () => false, isFile: () => false }) }, commandRunner })).toMatchObject({ available: false, reason: 'metadata target is not a regular file' });
    expect(await collectMediaMetadata('/media/a.mp4', { pathImpl: path.posix, fsImpl: { lstat: async () => ({}) }, commandRunner })).toMatchObject({ available: false, reason: 'metadata target is not a regular file' });
    expect(parseMediaMetadataOutput(JSON.stringify({ format: {}, streams: [null, { codec_type: '', codec_name: '', width: -1, height: 'bad', channels: 0, sample_rate: 0 }] }))).toMatchObject({ available: true, streams: [{ type: 'unknown', codec: null, width: null, height: null }] });
  });
});
