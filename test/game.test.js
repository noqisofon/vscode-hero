'use strict';
const test = require('node:test');
const assert = require('node:assert');
const g = require('../game');

function seeded(seed = 1) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

test('ヒーローは放置すると成長する', () => {
  const s = g.newState();
  g.simulate(s, 2000, seeded());
  assert.ok(s.level > 5, `level=${s.level}`);
  assert.ok(s.kills > 100);
  assert.ok(s.bestFloor > 5);
});

test('不変条件: HP は 0 超〜最大、ログは上限以内', () => {
  const s = g.newState();
  const rng = seeded(7);
  for (let i = 0; i < 5000; i++) {
    g.tick(s, rng);
    assert.ok(s.hp > 0 && s.hp <= g.maxHp(s));
    assert.ok(s.gold >= 0 && s.floor >= 1);
    assert.ok(s.log.length <= 30);
  }
});

test('死亡するとゴールドを失い退却する', () => {
  const s = g.newState();
  s.floor = 20; s.gold = 100; s.hp = 1;
  s.monster = { name: 'x', icon: 'x', boss: false, hp: 9999, maxHp: 9999, atk: 50, xp: 1, gold: 1 };
  g.tick(s, () => 0.5);
  assert.strictEqual(s.deaths, 1);
  assert.strictEqual(s.floor, 17);
  assert.strictEqual(s.gold, 80);
});

test('回復薬', () => {
  const s = g.newState();
  s.gold = 100; s.hp = 5;
  assert.ok(g.heal(s));
  assert.strictEqual(s.hp, g.maxHp(s));
  assert.strictEqual(s.gold, 50);
  assert.ok(!g.heal(s)); // 満タンでは使えない
});

test('壊れた保存データを補完する', () => {
  const s = g.load({ level: 'x', gold: 5, log: 3 }, 'A');
  assert.strictEqual(s.level, 1);
  assert.strictEqual(s.gold, 5);
  assert.deepStrictEqual(s.log, []);
});
