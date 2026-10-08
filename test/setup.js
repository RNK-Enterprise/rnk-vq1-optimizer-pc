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
 *
 * Jest Setup - Foundry VTT Environment Mocks
 */

// Reset game object before each test
beforeEach(() => {
  global.game = {
    settings: {
      settings: new Map(),
      menus: new Map(),
      register: jest.fn(),
      registerMenu: jest.fn(),
      get: jest.fn(),
      set: jest.fn()
    },
    user: {
      isGM: true
    },
    messages: {
      contents: []
    },
    combats: {
      contents: []
    },
    packs: {
      values: () => []
    }
  };
});

global.Hooks = {
  once: jest.fn((event, callback) => {
    if (event === 'init' || event === 'ready') {
      setTimeout(() => callback(), 0);
    }
  }),
  on: jest.fn()
};

global.FormApplication = class FormApplication {
  constructor(object, options) {
    this.object = object || {};
    this.options = options || {};
  }

  static get defaultOptions() {
    return {
      classes: [],
      closeOnSubmit: true,
      submitOnChange: false,
      editable: true
    };
  }

  async getData() {
    return {};
  }

  activateListeners() {}

  async _updateObject() {}

  async render() {
    return this;
  }

  async close() {
    return this;
  }
};

global.Dialog = {
  confirm: jest.fn().mockResolvedValue(true)
};

global.ui = {
  notifications: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
};

global.ChatMessage = {
  deleteDocuments: jest.fn().mockResolvedValue([])
};

global.Combat = {
  deleteDocuments: jest.fn().mockResolvedValue([])
};

global.foundry = {
  utils: {
    mergeObject: (original, other) => ({ ...original, ...other })
  }
};

global.mergeObject = (original, other) => ({ ...original, ...other });

global.canvas = {
  app: {
    ticker: {
      maxFPS: 60
    }
  }
};

global.window = global;

if (typeof performance === 'undefined') {
  global.performance = {
    now: () => Date.now(),
    memory: {
      usedJSHeapSize: 10000000
    }
  };
}

if (typeof requestAnimationFrame === 'undefined') {
  global.requestAnimationFrame = (callback) => {
    return setTimeout(() => callback(performance.now()), 16);
  };
}
