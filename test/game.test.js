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

test('回帰: ボスが壁にならない（シードを変えても段階的に進む）', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const s = g.newState();
    const rng = seeded(seed);
    let at20 = 0;
    for (let i = 1; i <= 8000 && !at20; i++) { g.tick(s, rng); if (s.bestFloor >= 20) at20 = i; }
    assert.ok(at20 > 0 && at20 <= 2000, `seed=${seed} 20F到達=${at20}`);
    g.simulate(s, 12000, rng); // 計 約1.5時間
    assert.ok(s.bestFloor >= 30, `seed=${seed} best=${s.bestFloor}`);
  }
});

test('ボス戦で負けても退却は1階だけ', () => {
  const s = g.newState();
  s.floor = 10; s.hp = 1;
  s.monster = { name: 'ボス', icon: 'x', boss: true, hp: 9999, maxHp: 9999, atk: 50, xp: 1, gold: 1 };
  g.tick(s, () => 0.5);
  assert.strictEqual(s.floor, 9);
});

test('自動購入のあとも回復薬分のゴールドが残る', () => {
  const s = g.newState();
  s.gold = 500;
  s.monster = { name: 'x', icon: 'x', boss: false, hp: 1, maxHp: 1, atk: 1, xp: 1, gold: 0 };
  g.tick(s, () => 0.5);
  assert.ok(s.weapon + s.armor > 0);
  assert.ok(s.gold >= g.HEAL_COST, `gold=${s.gold}`);
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

test('壊れたデータ: 負数・hp<=0・不正な monster', () => {
  const s = g.load({ hp: 0, xp: -5, gold: -1, weapon: -2, armor: -1, floor: 0, monster: { hp: -3, maxHp: 10 } });
  assert.strictEqual(s.hp, g.maxHp(s));
  assert.strictEqual(s.xp, 0);
  assert.strictEqual(s.gold, 0);
  assert.strictEqual(s.weapon, 0);
  assert.strictEqual(s.floor, 1);
  assert.strictEqual(s.monster, null);
});
