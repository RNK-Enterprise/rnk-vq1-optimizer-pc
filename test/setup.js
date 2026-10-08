/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 *
 * Jest setup for the PC optimizer test environment.
 */

import { jest as jestApi } from '@jest/globals';

globalThis.jest = jestApi;

// Keep the test environment deliberately empty: every host dependency must be
// supplied by the test that uses it rather than by a global application mock.
