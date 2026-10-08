/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
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
 * Foundry document source adapter - the ONLY place where the optimizer
 * core touches Foundry VTT globals. Implements the DocumentSource and
 * PerformanceProvider interfaces consumed by scripts/optimizer-core.js,
 * so the core itself stays host-neutral.
 */

import { PerformanceTweaks } from './performance-tweaks.js';

/** Adapts Foundry world state (game.messages / game.combats / game.packs)
 *  to the DocumentSource interface.
 *  ERROR POLICY: no try/catch here by design - this is a thin delegation
 *  layer; errors propagate intentionally to the caller (optimizer-core),
 *  which owns error reporting and report notes. */
export class FoundryDocumentSource {
  getMessages() {
    return game.messages?.contents ?? [];
  }

  async deleteMessages(ids) {
    await ChatMessage.deleteDocuments(ids);
  }

  getCombats() {
    return game.combats?.contents ?? [];
  }

  async deleteCombats(ids) {
    await Combat.deleteDocuments(ids);
  }

  getPacks() {
    return Array.from(game.packs?.values?.() ?? []);
  }

  isGM() {
    return !!game.user?.isGM;
  }
}

/** Bundles a document source with the Foundry performance-tweaks provider
 *  into the dependency object OptimizerCore expects. */
export function createFoundryCoreDependencies({ logFn } = {}) {
  const tweaks = new PerformanceTweaks(logFn ?? null);
  return {
    documentSource: new FoundryDocumentSource(),
    performanceProvider: tweaks
  };
}
