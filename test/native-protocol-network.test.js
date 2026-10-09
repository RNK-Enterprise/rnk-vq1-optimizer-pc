/**
 * Native protocol extension tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { validateNativeAction } from '../native/protocol.js';

describe('network and FPS protocol actions', () => {
  test('accepts bounded process network and FPS actions', () => {
    expect(validateNativeAction({ type: 'set-process-network-limit', key: 'process.network-limit', value: 'bytes-per-second', limit: 4096, pid: 42 })).toMatchObject({ pid: 42 });
    expect(validateNativeAction({ type: 'set-fps-policy', key: 'fps.policy', value: 'cap', limit: 120 })).toMatchObject({ limit: 120 });
  });

  test('rejects invalid network and FPS actions', () => {
    expect(() => validateNativeAction({ type: 'set-process-network-limit', key: 'wrong', value: 'bytes-per-second', limit: 4096, pid: 42 })).toThrow('key');
    expect(() => validateNativeAction({ type: 'set-process-network-limit', key: 'process.network-limit', value: 'bytes-per-second', limit: 1, pid: 42 })).toThrow('bounded');
    expect(() => validateNativeAction({ type: 'set-process-network-limit', key: 'process.network-limit', value: 'bytes-per-second', limit: 4096, pid: 0 })).toThrow('process id');
    expect(() => validateNativeAction({ type: 'set-fps-policy', key: 'fps.policy', value: 'cap', limit: 29 })).toThrow('FPS');
    expect(() => validateNativeAction({ type: 'set-fps-policy', key: 'fps.policy', value: 'cap', limit: 501 })).toThrow('FPS');
    expect(() => validateNativeAction({ type: 'set-fps-policy', key: 'fps.policy', value: 'cap', limit: 120, pid: 0 })).toThrow('process id');
    expect(() => validateNativeAction({ type: 'set-fps-policy', key: 'fps.policy', value: 'cap', limit: 120, pid: 2147483648 })).toThrow('process id');
  });
});
