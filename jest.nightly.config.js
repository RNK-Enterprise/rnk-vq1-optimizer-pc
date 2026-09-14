/**
 * RNK Vortex Quantum™
 * Copyright © 2025 Asgard Innovations / RNK™. All Rights Reserved.
 *
 * PROPRIETARY AND CONFIDENTIAL
 *
 * Nightly Jest config - runs ONLY the real-tree suites in test/nightly/.
 * Heavy by design (imports hundreds of real engine modules per stack), so
 * it runs sequentially with generous per-test timeouts and without the
 * main suite's 100% coverage thresholds. Scheduled by
 * .github/workflows/nightly.yml; also runnable via `npm run test:nightly`.
 */
export default {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/nightly/**/*.test.js'],
  moduleNameMapper: {
    '^file://(.*)$': '$1'
  },
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@jest)/)'
  ],
  testTimeout: 120000,
  maxWorkers: 1
};
