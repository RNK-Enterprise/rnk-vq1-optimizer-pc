/**
 * RNK Vortex System Optimizer
 * Copyright © 2025 Asgard Innovations / RNK™
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3 of the License.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/gpl-3.0.html>.
 *
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
