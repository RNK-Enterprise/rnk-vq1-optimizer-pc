/**
 * Native command runner tests.
 * Copyright © 2026 RNK Enterprise
 * Contributor: RNK Enterprise
 */

import { EventEmitter } from 'events';
import { createCommandRunner } from '../native/command-runner.js';

function childProcess() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  return child;
}

describe('native command runner', () => {
  test('never enables a shell and bounds output', async () => {
    const child = childProcess();
    const spawnFile = jest.fn(() => child);
    const runner = createCommandRunner({ spawnFile, env: { SAFE: '1' } });
    const resultPromise = runner.run('safe-tool', [1, 'two'], { maxOutputBytes: 4 });
    child.stdout.emit('data', 'abcdef');
    child.stderr.emit('data', '123456');
    child.emit('close', 0, null);
    await expect(resultPromise).resolves.toEqual({ code: 0, signal: null, stdout: 'abcd', stderr: '1234' });
    expect(spawnFile).toHaveBeenCalledWith('safe-tool', ['1', 'two'], { shell: false, windowsHide: true, env: { SAFE: '1' } });
    const shortChild = childProcess();
    const shortPromise = createCommandRunner({ spawnFile: () => shortChild }).run('short');
    shortChild.stdout.emit('data', 'ok');
    shortChild.emit('close', 0, null);
    await expect(shortPromise).resolves.toEqual(expect.objectContaining({ stdout: 'ok' }));
  });

  test('rejects invalid input and spawn errors', async () => {
    const runner = createCommandRunner({ spawnFile: () => { throw new Error('spawn failed'); } });
    await expect(runner.run('', [])).rejects.toThrow('requires a file');
    await expect(runner.run('tool', {})).rejects.toThrow('requires a file');
    await expect(runner.run('tool')).rejects.toThrow('spawn failed');
  });

  test('rejects child errors and timeouts only once', async () => {
    const errorChild = childProcess();
    errorChild.once = (event, callback) => errorChild.on(event, callback);
    const errorPromise = createCommandRunner({ spawnFile: () => errorChild }).run('tool');
    errorChild.emit('error', new Error('child failed'));
    errorChild.emit('error', new Error('ignored after settled'));
    errorChild.emit('close', 1, null);
    await expect(errorPromise).rejects.toThrow('child failed');

    const timeoutChild = childProcess();
    const timeoutPromise = createCommandRunner({ spawnFile: () => timeoutChild }).run('slow', [], { timeoutMs: 1 });
    await expect(timeoutPromise).rejects.toThrow('timed out: slow');
    expect(timeoutChild.kill).toHaveBeenCalledWith('SIGTERM');
    timeoutChild.emit('close', 0, null);
  });

  test('ignores a timeout callback after the command has already closed', async () => {
    const child = childProcess();
    let timeoutCallback;
    const clearTimeoutImpl = jest.fn();
    const runner = createCommandRunner({
      spawnFile: () => child,
      setTimeoutImpl: (callback) => { timeoutCallback = callback; return 'timer'; },
      clearTimeoutImpl
    });
    const resultPromise = runner.run('fast');
    child.emit('close', 0, null);
    await expect(resultPromise).resolves.toEqual(expect.objectContaining({ code: 0 }));
    timeoutCallback();
    expect(clearTimeoutImpl).toHaveBeenCalledWith('timer');
    expect(child.kill).not.toHaveBeenCalled();

    const noKillChild = childProcess();
    delete noKillChild.kill;
    let noKillTimeout;
    const noKillPromise = createCommandRunner({
      spawnFile: () => noKillChild,
      setTimeoutImpl: (callback) => { noKillTimeout = callback; return 'no-kill-timer'; }
    }).run('no-kill');
    noKillTimeout();
    await expect(noKillPromise).rejects.toThrow('timed out: no-kill');
  });
});
