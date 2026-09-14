/**
 * RNK Vortex System Optimizer (vendored component)
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
 * Shared Jest config factory for contract suites.
 *
 * Usage (jest.contract.config.js at the consumer root):
 *
 *   import { makeJestContractConfig } from '@rnk/vq-contract-tests/jest.config';
 *   export default makeJestContractConfig({ testMatch: ['<rootDir>/tests'] });
 *
 * The factory handles the four non-obvious knobs every consumer needs:
 * an INLINE babel preset (a babel.config.js / package.json `babel` field
 * is only found inside the consumer's `rootDir`, so package code reached
 * from outside it is otherwise transformed to nothing - see the
 * babel-jest preset-in-config note in TANDEM_CLUSTER.md), the `file://`
 * moduleNameMapper used by the engine runtime's dynamic imports,
 * modulePaths so peer deps (ws) resolve from the CONSUMER's node_modules
 * (file: dependencies keep their real on-disk location, whose walk-up
 * path does not include the consumer's node_modules), and a
 * transformIgnorePatterns exemption for this package itself.
 */

/**
 * @param {object} [overrides] jest options merged over the defaults; pass
 *   `testMatch` pointing at your contract test files.
 * @returns {object} a Jest config object
 */
export function makeJestContractConfig(overrides = {}) {
  return {
    testEnvironment: 'node',
    modulePaths: ['<rootDir>/node_modules'],
    moduleNameMapper: {
      '^file://(.*)$': '$1'
    },
    transform: {
      // Inline preset: consumers' babel config (package.json "babel" or
      // babel.config.js) is only discovered inside their rootDir; test
      // suites imported from THIS package sit outside it, so babel-jest
      // would find no config and emit empty modules. Inline presets apply
      // everywhere and are per-file, so no cross-file state is shared.
      '^.+\\.js$': ['babel-jest', { presets: ['@babel/preset-env'] }]
    },
    transformIgnorePatterns: [
      // Always transform first-party package code: through a file: dep's
      // node_modules symlink the package path matches node_modules/**, and
      // skipping the transform leaves raw ESM `export` in a CJS Jest run.
      'node_modules/(?!(@jest|@rnk)/)'
    ],
    testTimeout: 60000,
    ...overrides
  };
}
