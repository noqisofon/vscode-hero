'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

function setup(t, stored) {
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
  t.mock.timers.enable({ apis: ['setInterval'] });
  const store = { 'hero.state': stored };
  const ctx = {
    subscriptions: [],
    globalState: { get: (k) => store[k], update: async (k, v) => { store[k] = v; } },
  };
  delete require.cache[require.resolve('../extension')]; // モジュール変数を毎回初期化
  const ext = require('../extension');
  t.after(() => { Module._load = orig; t.mock.timers.reset(); ctx.subscriptions.forEach((d) => d.dispose && d.dispose()); });
  return { ext, ctx, store, msgs, registered, status };
}

test('起動・ティック・放置分の進行・リセット', async (t) => {
  const { ext, ctx, store, msgs, registered, status } = setup(t, { level: 3, gold: 10, lastSeen: Date.now() - 600 * 1000 });
  ext.activate(ctx);
  assert.ok(msgs.some((m) => m.includes('留守中')), '放置分の通知');
  assert.ok(status.text.includes('Lv'));
  const kills = store['hero.state'].state.kills;
  t.mock.timers.tick(250 * 10);
  await ext.deactivate();
  assert.ok(store['hero.state'].state.kills > kills, 'ティックで進み、deactivate で保存される');
  await registered['hero.reset']();
  assert.strictEqual(store['hero.state'].state.level, 1);
});

test('deactivate は保存の Promise を返す', async (t) => {
  const { ext, ctx, store } = setup(t, { level: 2, lastSeen: Date.now() });
  ext.activate(ctx);
  t.mock.timers.tick(250 * 3);
  const p = ext.deactivate();
  assert.ok(p && typeof p.then === 'function');
  await p;
  assert.ok(Date.now() - store['hero.state'].savedAt < 5000);
});

test('別ウィンドウが稼働中なら進行も上書き保存もしない', async (t) => {
  const other = { owner: 'other-window', savedAt: Date.now(), state: { level: 7, gold: 99, kills: 5, lastSeen: Date.now() } };
  const { ext, ctx, store, msgs, registered } = setup(t, other);
  ext.activate(ctx);
  t.mock.timers.tick(250 * 20);
  assert.strictEqual(msgs.length, 0, '二重に放置分を計算しない');
  await registered['hero.heal']();
  assert.ok(msgs[0].includes('別のウィンドウ'), '表示のみの間は回復薬を使えない旨を通知');
  assert.strictEqual(store['hero.state'].state.gold, 99, 'ゴールドは減らない');
  assert.strictEqual(store['hero.state'], other, '保存を食い合わない');
  assert.strictEqual(await ext.deactivate(), undefined);
  assert.strictEqual(store['hero.state'].owner, 'other-window');
});

test('他ウィンドウが止まっていれば引き継ぐ', async (t) => {
  const stale = { owner: 'dead-window', savedAt: Date.now() - 60000, state: { level: 4, kills: 5, lastSeen: Date.now() - 60000 } };
  const { ext, ctx, store } = setup(t, stale);
  ext.activate(ctx);
  assert.notStrictEqual(store['hero.state'].owner, 'dead-window');
  assert.strictEqual(store['hero.state'].state.level >= 4, true);
});
