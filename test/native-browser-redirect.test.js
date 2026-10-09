/**
 * Browser cross-volume redirect tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import path from 'path';
import { applyBrowserRedirect, previewBrowserRedirect } from '../native/browser-redirect.js';

const base = { sourcePath: 'C:/Downloads/game.zip', sourceRoot: 'C:/Downloads', targetRoot: 'E:/Games', targetMount: 'E:', sizeBytes: 100, targetFreeBytes: 1000, storageEvidence: { volumes: [{ mount: 'E:', volumeId: 'volume-e', physicalDiskNumber: 2, physicalDevicePath: '\\\\.\\PhysicalDrive2', health: 'healthy', writable: true }], drives: [{ diskNumber: 2, physicalDevicePath: '\\\\.\\PhysicalDrive2', health: 'healthy', smart: 'passed' }] }, pathImpl: path.win32 };

describe('browser cross-volume redirect', () => {
  test('previews only explicit cross-volume moves', () => {
    expect(previewBrowserRedirect(base)).toMatchObject({ state: 'preview-ready', sourceMount: 'C:', targetMount: 'E:', destination: 'E:\\Games\\game.zip' });
    expect(previewBrowserRedirect({ ...base, preserveSource: true })).toMatchObject({ state: 'preview-ready', preserveSource: true });
    expect(previewBrowserRedirect({ ...base, sourcePath: 'D:/other/game.zip' })).toMatchObject({ state: 'rejected', reason: 'browser download is outside the approved source root' });
    expect(previewBrowserRedirect({ ...base, targetMount: 'C:' })).toMatchObject({ state: 'rejected', reason: 'source and target are on the same volume' });
    expect(previewBrowserRedirect({ ...base, sizeBytes: null })).toMatchObject({ state: 'observation-required' });
    expect(previewBrowserRedirect({ ...base, targetFreeBytes: 10 })).toMatchObject({ state: 'rejected', reason: 'target volume lacks space for the download' });
    expect(previewBrowserRedirect({ ...base, sourcePath: '/downloads/game.zip', sourceRoot: '/downloads', targetRoot: '/archive', targetMount: '/', pathImpl: path.posix })).toMatchObject({ state: 'rejected', reason: 'source and target are on the same volume' });
    expect(previewBrowserRedirect({ sourcePath: 'C:/Downloads/game.zip', sourceRoot: 'C:/Downloads' })).toMatchObject({ state: 'rejected', reason: 'source, source root, target root, and target mount are required' });
    expect(previewBrowserRedirect({ ...base, sourcePath: null })).toMatchObject({ state: 'rejected' });
    expect(previewBrowserRedirect()).toMatchObject({ state: 'rejected' });
    expect(previewBrowserRedirect({ ...base, sourceRoot: null })).toMatchObject({ state: 'rejected' });
    expect(previewBrowserRedirect({ sourcePath: '/tmp/game.zip', sourceRoot: '/tmp', targetRoot: '/archive', targetMount: '/mnt', sizeBytes: 1, targetFreeBytes: 2, storageEvidence: { volumes: [{ mount: '/mnt', volumeId: 'mnt', physicalDiskNumber: 0, physicalDevicePath: 'disk0', health: 'healthy' }], drives: [{ diskNumber: 0, physicalDevicePath: 'disk0', health: 'healthy', smart: 'passed' }] } })).toMatchObject({ state: 'preview-ready' });
    const noSourceMount = { ...path.posix, parse: () => ({ root: '' }) };
    expect(previewBrowserRedirect({ sourcePath: '/tmp/game.zip', sourceRoot: '/tmp', targetRoot: '/archive', targetMount: '/mnt', sizeBytes: 1, targetFreeBytes: 2, pathImpl: noSourceMount })).toMatchObject({ state: 'rejected', reason: 'source volume is unavailable' });
    const escapingPath = { ...path.win32, join: () => 'C:\\outside.zip' };
    expect(previewBrowserRedirect({ ...base, pathImpl: escapingPath })).toMatchObject({ state: 'rejected', reason: 'redirect destination is outside the approved target root' });
    expect(previewBrowserRedirect({ ...base, storageEvidence: null })).toMatchObject({ state: 'storage-safety-review', storageSuitability: { state: 'UNKNOWN' } });
    expect(previewBrowserRedirect({ ...base, storageEvidence: {} })).toMatchObject({ state: 'storage-safety-review' });
    expect(previewBrowserRedirect({ ...base, storageEvidence: { state: 'UNKNOWN', admission: 'DENY' } })).toMatchObject({ state: 'storage-safety-review', reason: 'target storage suitability is not proven' });
    expect(previewBrowserRedirect({ ...base, storageEvidence: { state: 'HEALTHY', admission: 'ALLOW' } })).toMatchObject({ state: 'preview-ready' });
  });

  test('copies, verifies, and removes with approval', async () => {
    const plan = previewBrowserRedirect(base);
    await expect(applyBrowserRedirect(plan)).resolves.toMatchObject({ state: 'approval-required', applied: false });
    await expect(applyBrowserRedirect(plan, { approved: true, dryRun: true })).resolves.toMatchObject({ state: 'preview', applied: false });
    await expect(applyBrowserRedirect(plan, { approved: true, dryRun: false, fsImpl: {}, pathImpl: path.win32 })).resolves.toMatchObject({ state: 'unavailable' });
    const files = new Map([[plan.source, { size: 100, isSymbolicLink: () => false }]]);
    const fsImpl = {
      lstat: jest.fn(async (file) => { if (file === plan.destination) { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } return files.get(file) || { size: 0, isSymbolicLink: () => false }; }),
      mkdir: jest.fn(async () => {}),
      copyFile: jest.fn(async () => {}),
      rename: jest.fn(async () => {}),
      stat: jest.fn(async () => ({ size: 100 })),
      unlink: jest.fn(async () => {}),
      readFile: jest.fn(async () => Buffer.alloc(100)),
      open: jest.fn(async () => {
        let reads = 0;
        return { read: jest.fn(async (buffer) => { if (reads++ > 0) return { bytesRead: 0 }; buffer.fill(1, 0, 100); return { bytesRead: 100 }; }), sync: jest.fn(async () => {}), close: jest.fn(async () => {}) };
      })
    };
    await expect(applyBrowserRedirect(plan, { approved: true, dryRun: false, fsImpl, pathImpl: path.win32 })).resolves.toMatchObject({ state: 'applied', mutation: 'copy-delete' });
    const preservePlan = previewBrowserRedirect({ ...base, preserveSource: true });
    const preserveFs = { ...fsImpl, lstat: jest.fn(async (file) => { if (file === preservePlan.destination) { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } return { isSymbolicLink: () => false }; }), stat: jest.fn(async () => ({ size: 100 })), unlink: jest.fn(async () => {}) };
    await expect(applyBrowserRedirect(preservePlan, { approved: true, dryRun: false, fsImpl: preserveFs, pathImpl: path.win32 })).resolves.toMatchObject({ state: 'applied', verificationState: 'verified', sourceDeletionState: 'preserved' });
    fsImpl.lstat.mockImplementationOnce(async () => ({ isSymbolicLink: () => true }));
    await expect(applyBrowserRedirect(plan, { approved: true, dryRun: false, fsImpl, pathImpl: path.win32 })).resolves.toMatchObject({ state: 'rejected', reason: 'source download is a symbolic link' });
    fsImpl.lstat.mockImplementationOnce(async () => ({ isSymbolicLink: () => false })).mockImplementationOnce(async () => { const error = new Error('partial missing'); error.code = 'ENOENT'; throw error; }).mockImplementationOnce(async () => ({ size: 100 }));
    await expect(applyBrowserRedirect(plan, { approved: true, dryRun: false, fsImpl, pathImpl: path.win32 })).resolves.toMatchObject({ state: 'rejected', reason: 'redirect destination already exists' });
    fsImpl.lstat.mockImplementation(async (file) => { if (file === plan.destination) { const error = new Error('permission'); error.code = 'EACCES'; throw error; } return { size: 100, isSymbolicLink: () => false }; });
    await expect(applyBrowserRedirect(plan, { approved: true, dryRun: false, fsImpl, pathImpl: path.win32 })).resolves.toMatchObject({ state: 'rejected', reason: 'permission' });
    fsImpl.lstat.mockImplementation(async (file) => { if (file === plan.destination) { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } return { size: 100, isSymbolicLink: () => false }; });
    fsImpl.stat.mockResolvedValueOnce({ size: 99 });
    await expect(applyBrowserRedirect(plan, { approved: true, dryRun: false, fsImpl, pathImpl: path.win32 })).resolves.toMatchObject({ state: 'rejected', reason: 'redirect copy verification failed' });
    const noRead = { ...fsImpl, lstat: jest.fn(async (file) => { if (file === plan.destination) { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } return { isSymbolicLink: () => false }; }), open: jest.fn(async () => ({ close: jest.fn(async () => {}) })) };
    await expect(applyBrowserRedirect(plan, { approved: true, dryRun: false, fsImpl: noRead, pathImpl: path.win32 })).resolves.toMatchObject({ state: 'rejected', reason: 'redirect hash verification unavailable' });
    const noHash = { ...fsImpl, lstat: noRead.lstat, open: undefined, readFile: undefined };
    await expect(applyBrowserRedirect(plan, { approved: true, dryRun: false, fsImpl: noHash, pathImpl: path.win32 })).resolves.toMatchObject({ state: 'rejected', reason: 'redirect hash verification unavailable' });
    const fallbackPlan = { ...plan, destination: 'E:\\Games\\fallback.zip' };
    const fallback = { ...fsImpl, lstat: jest.fn(async (file) => { if (file === fallbackPlan.destination) { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } return { isSymbolicLink: () => false }; }), open: undefined, readFile: jest.fn(async () => Buffer.alloc(100)) };
    await expect(applyBrowserRedirect(fallbackPlan, { approved: true, dryRun: false, fsImpl: fallback, pathImpl: path.win32 })).resolves.toMatchObject({ state: 'applied', verificationState: 'verified' });
    const noClosePlan = { ...plan, destination: 'E:\\Games\\no-close.zip', preserveSource: true };
    let noCloseCalls = 0;
    const noClose = { ...fsImpl, lstat: jest.fn(async (file) => { if (file === noClosePlan.destination) { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } return { isSymbolicLink: () => false }; }), open: jest.fn(async () => {
      noCloseCalls += 1;
      if (noCloseCalls === 1) return { sync: jest.fn(async () => {}) };
      let reads = 0;
      return { read: jest.fn(async (buffer) => { if (reads++ > 0) return { bytesRead: 0 }; buffer.fill(1, 0, 100); return { bytesRead: 100 }; }) };
    }) };
    await expect(applyBrowserRedirect(noClosePlan, { approved: true, dryRun: false, fsImpl: noClose, pathImpl: path.win32 })).resolves.toMatchObject({ state: 'applied', sourceDeletionState: 'preserved' });
    const partialPath = `${plan.destination}.rnk-partial`;
    const partialSymlink = { ...fsImpl, lstat: jest.fn(async (file) => {
      if (file === plan.source) return { isSymbolicLink: () => false };
      if (file === partialPath) return { isSymbolicLink: () => true, isDirectory: () => false };
      const error = new Error('missing'); error.code = 'ENOENT'; throw error;
    }) };
    await expect(applyBrowserRedirect(plan, { approved: true, dryRun: false, fsImpl: partialSymlink, pathImpl: path.win32 })).resolves.toMatchObject({ state: 'rejected', reason: 'partial redirect destination is not a regular file' });
    const partialDirectory = { ...partialSymlink, lstat: jest.fn(async (file) => {
      if (file === plan.source) return { isSymbolicLink: () => false };
      if (file === partialPath) return { isSymbolicLink: () => false, isDirectory: () => true };
      const error = new Error('missing'); error.code = 'ENOENT'; throw error;
    }) };
    await expect(applyBrowserRedirect(plan, { approved: true, dryRun: false, fsImpl: partialDirectory, pathImpl: path.win32 })).resolves.toMatchObject({ state: 'rejected', reason: 'partial redirect destination is not a regular file' });
    const failedCopy = { ...fsImpl, lstat: jest.fn(async (file) => { if (file === plan.source) return { isSymbolicLink: () => false }; const error = new Error('missing'); error.code = 'ENOENT'; throw error; }), copyFile: jest.fn(async () => { throw new Error('copy-failed'); }), unlink: jest.fn(async () => {}) };
    await expect(applyBrowserRedirect(plan, { approved: true, dryRun: false, fsImpl: failedCopy, pathImpl: path.win32 })).resolves.toMatchObject({ state: 'rejected', reason: 'copy-failed' });
    const cleanupFailure = { ...failedCopy, unlink: jest.fn(async (file) => { if (file === partialPath) { const error = new Error('cleanup-failed'); error.code = 'EACCES'; throw error; } }) };
    await expect(applyBrowserRedirect(plan, { approved: true, dryRun: false, fsImpl: cleanupFailure, pathImpl: path.win32 })).resolves.toMatchObject({ state: 'rejected', reason: 'copy-failed' });
    const cleanupMissing = { ...failedCopy, unlink: jest.fn(async (file) => { if (file === partialPath) { const error = new Error('cleanup-missing'); error.code = 'ENOENT'; throw error; } }) };
    await expect(applyBrowserRedirect(plan, { approved: true, dryRun: false, fsImpl: cleanupMissing, pathImpl: path.win32 })).resolves.toMatchObject({ state: 'rejected', reason: 'copy-failed' });
    const existingPartial = { ...fsImpl, lstat: jest.fn(async (file) => { if (file === plan.source) return { isSymbolicLink: () => false }; if (file === partialPath) return { isSymbolicLink: () => false, isDirectory: () => false }; const error = new Error('missing'); error.code = 'ENOENT'; throw error; }), unlink: jest.fn(async () => {}) };
    await expect(applyBrowserRedirect(plan, { approved: true, dryRun: false, fsImpl: existingPartial, pathImpl: path.win32 })).resolves.toMatchObject({ state: 'applied' });
    const existingCopy = { ...failedCopy, copyFile: jest.fn(async () => { const error = new Error('exists'); error.code = 'EEXIST'; throw error; }) };
    await expect(applyBrowserRedirect(plan, { approved: true, dryRun: false, fsImpl: existingCopy, pathImpl: path.win32 })).resolves.toMatchObject({ state: 'rejected', reason: 'exists' });
    await expect(applyBrowserRedirect({ state: 'bad' }, { approved: true, dryRun: false })).rejects.toThrow('Invalid');
  });
});
