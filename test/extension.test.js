'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

test('拡張の起動・ティック・保存・放置分の進行', async (t) => {
  const msgs = [], registered = {};
  const status = { show() {}, dispose() {} };
  const vscode = {
    StatusBarAlignment: { Right: 2 },
    window: {
      createStatusBarItem: () => status,
      showInformationMessage: (m) => msgs.push(m),
      showWarningMessage: async () => 'やり直す',
      registerWebviewViewProvider: () => ({ dispose() {} }),
    },
    workspace: {
      getConfiguration: () => ({ get: (k, d) => (k === 'tickSeconds' ? 0.25 : d) }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
    },
    commands: {
      registerCommand: (id, fn) => ((registered[id] = fn), { dispose() {} }),
      executeCommand: async () => {},
    },
  };
  const orig = Module._load;
  Module._load = function (r, ...a) { return r === 'vscode' ? vscode : orig.call(this, r, ...a); };
  t.after(() => { Module._load = orig; });

  const store = { 'hero.state': { level: 3, gold: 10, lastSeen: Date.now() - 600 * 1000 } };
  const ctx = {
    subscriptions: [],
    globalState: { get: (k) => store[k], update: async (k, v) => { store[k] = v; } },
  };
  const ext = require('../extension');
  const mock = t.mock.timers; mock.enable({ apis: ['setInterval'] });
  ext.activate(ctx);

  assert.ok(msgs.some((m) => m.includes('留守中')), '放置分の通知');
  assert.ok(status.text.includes('Lv'), 'ステータスバー表示');
  const lvAfterCatchUp = store['hero.state'].level;
  mock.tick(250 * 10); // 10 ターン → 保存が走る
  assert.ok(store['hero.state'].kills >= 0 && store['hero.state'].lastSeen > Date.now() - 5000);
  assert.ok(lvAfterCatchUp >= 3);

  await registered['hero.reset']();
  assert.strictEqual(store['hero.state'].level, 1);
  ctx.subscriptions.forEach((d) => d.dispose && d.dispose());
  mock.reset();
});
