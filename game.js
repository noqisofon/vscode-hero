'use strict';
// VSCode 非依存のゲームロジック。tick() が 1 ターン進める。

const MONSTERS = [
  { name: 'スライム', icon: '🟢', hp: 1, atk: 1, xp: 1, gold: 1 },
  { name: 'コウモリ', icon: '🦇', hp: 1.3, atk: 1.2, xp: 1.4, gold: 1.5 },
  { name: 'ゴブリン', icon: '👺', hp: 1.8, atk: 1.5, xp: 2, gold: 2.5 },
  { name: 'スケルトン', icon: '💀', hp: 2.2, atk: 1.8, xp: 3, gold: 3 },
  { name: 'オーク', icon: '👹', hp: 3, atk: 2.2, xp: 4.5, gold: 5 },
  { name: 'ゴースト', icon: '👻', hp: 3.5, atk: 2.6, xp: 6, gold: 6 },
  { name: 'ドラゴン', icon: '🐉', hp: 6, atk: 3.5, xp: 12, gold: 15 },
];
const BOSS_EVERY = 10; // 10 階ごとにボス
const BOSS_SAFETY = 1.2; // 倒すまでの見込み被ダメージにこの余裕を掛けた HP が無ければボスに挑まない
const BOSS_MIN_HP_RATIO = 0.6; // HP がこの割合未満ならボスに挑まず、通常モンスターで回復する
const BOSS_SCALE_BONUS = 0.5;
const BOSS_HP_MULT = 1.5;
const BOSS_ATK_MULT = 0.8;
const DEATH_GOLD_PER_FLOOR = 3; // 死亡時に失うゴールド = 階数 × これ
const HEAL_COST = 50;
const MAX_LOG = 30;

function newState(name = 'ヒーロー') {
  return {
    name, level: 1, xp: 0, gold: 0,
    hp: 30, floor: 1, kills: 0, deaths: 0, bestFloor: 1,
    weapon: 0, armor: 0,
    monster: null, log: [], lastSeen: Date.now(),
  };
}

const maxHp = (s) => 30 + (s.level - 1) * 8 + s.armor * 5;
const power = (s) => 4 + (s.level - 1) * 2 + s.weapon * 3;
const xpToNext = (s) => Math.floor(10 * Math.pow(1.25, s.level - 1));
const weaponCost = (s) => Math.floor(30 * Math.pow(1.6, s.weapon));
const armorCost = (s) => Math.floor(30 * Math.pow(1.6, s.armor));

function pushLog(s, msg) {
  s.log.push(msg);
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

function makeMonster(s, rng, boss, prep) {
  const tier = Math.min(MONSTERS.length - 1, Math.floor((s.floor - 1) / 3));
  const base = boss ? MONSTERS[MONSTERS.length - 1] : MONSTERS[Math.max(0, tier - Math.floor(rng() * 2))];
  const scale = 1 + (prep ? s.floor - 2 : s.floor - 1) * 0.35 + (boss ? BOSS_SCALE_BONUS : 0);
  const hp = Math.ceil(10 * base.hp * scale * (boss ? BOSS_HP_MULT : 1));
  return {
    name: (boss ? 'ボス ' : '') + base.name, icon: base.icon, boss, prep,
    hp, maxHp: hp,
    atk: Math.max(1, Math.round(2 * base.atk * scale * (boss ? BOSS_ATK_MULT : 1))),
    xp: Math.ceil(4 * base.xp * scale * (boss ? 4 : 1)),
    gold: Math.ceil(3 * base.gold * scale * (boss ? 4 : 1)),
  };
}

// ボスを倒すまでに受ける見込みダメージ（会心込みの平均与ダメージで概算）
function expectedBossDamage(s, boss) {
  const turns = Math.ceil(boss.hp / (power(s) * 1.1));
  return turns * boss.atk;
}

function spawn(s, rng) {
  let m;
  if (s.floor % BOSS_EVERY === 0) {
    const boss = makeMonster(s, rng, true, false);
    const ready = s.hp >= maxHp(s) * BOSS_MIN_HP_RATIO && s.hp >= expectedBossDamage(s, boss) * BOSS_SAFETY;
    // 準備不足なら 1 つ下の階相当の雑魚と戦って回復・育成する（階は進めない）
    m = ready ? boss : makeMonster(s, rng, false, true);
    if (!ready) pushLog(s, `🩹 ボスに備えて鍛える (HP ${s.hp}/${maxHp(s)})`);
  } else {
    m = makeMonster(s, rng, false, false);
  }
  s.monster = m;
  pushLog(s, `${m.icon} ${m.name} が現れた！`);
}

function gainXp(s, n) {
  s.xp += n;
  while (s.xp >= xpToNext(s)) {
    s.xp -= xpToNext(s);
    s.level++;
    s.hp = maxHp(s);
    pushLog(s, `⭐ レベルアップ！ Lv${s.level}`);
  }
}

// 装備を自動購入（買えるときは安い方から）
function autoShop(s) {
  for (let i = 0; i < 5; i++) {
    const w = weaponCost(s) + HEAL_COST, a = armorCost(s) + HEAL_COST; // 回復薬用に HEAL_COST を残す
    if (s.weapon <= s.armor && s.gold >= w) { s.gold -= w - HEAL_COST; s.weapon++; pushLog(s, `⚔️ 武器を強化 (+${s.weapon})`); }
    else if (s.gold >= a) { s.gold -= a - HEAL_COST; s.armor++; s.hp = Math.min(maxHp(s), s.hp + 5); pushLog(s, `🛡️ 防具を強化 (+${s.armor})`); }
    else if (s.gold >= w) { s.gold -= w - HEAL_COST; s.weapon++; pushLog(s, `⚔️ 武器を強化 (+${s.weapon})`); }
    else break;
  }
}

function tick(s, rng = Math.random) {
  if (!s.monster) spawn(s, rng);
  const m = s.monster;

  const dmg = Math.max(1, Math.round(power(s) * (0.8 + rng() * 0.4)));
  const crit = rng() < 0.1;
  const dealt = crit ? dmg * 2 : dmg;
  m.hp -= dealt;
  pushLog(s, `${crit ? '💥会心！ ' : ''}${s.name} の攻撃 → ${m.name} に ${dealt} ダメージ`);

  if (m.hp <= 0) {
    s.kills++;
    s.gold += m.gold;
    pushLog(s, `🏆 ${m.name} を倒した！ +${m.xp}XP +${m.gold}G`);
    gainXp(s, m.xp);
    if (m.boss) pushLog(s, `👑 ボス撃破！ ${s.floor} 階クリア`);
    if (!m.prep) s.floor++;
    s.bestFloor = Math.max(s.bestFloor, s.floor);
    s.monster = null;
    s.hp = Math.min(maxHp(s), s.hp + Math.ceil(maxHp(s) * 0.1));
    autoShop(s);
    return;
  }

  const taken = Math.max(1, Math.round(m.atk * (0.8 + rng() * 0.4)));
  s.hp -= taken;
  pushLog(s, `${m.name} の攻撃 → ${taken} ダメージ`);

  if (s.hp <= 0) {
    s.deaths++;
    const lost = Math.min(s.gold, s.floor * DEATH_GOLD_PER_FLOOR); // 所持金に比例させず定額（比例だと死亡の積み重ねで貯金できず詰む）
    s.gold -= lost;
    s.floor = Math.max(1, s.floor - (m.boss ? 1 : 3));
    s.hp = maxHp(s);
    s.monster = null;
    pushLog(s, `☠️ ${s.name} は倒れた… ${lost}G を失い、${s.floor} 階まで退却`);
  }
}

// 放置中の経過ターンをまとめて進める（最大 maxTurns）
function simulate(s, turns, rng = Math.random) {
  for (let i = 0; i < turns; i++) tick(s, rng);
}

function heal(s) {
  if (s.gold < HEAL_COST || s.hp >= maxHp(s)) return false;
  s.gold -= HEAL_COST;
  s.hp = maxHp(s);
  pushLog(s, '🧪 回復薬を使った！');
  return true;
}

// 保存データの検証・補完
function load(raw, name) {
  const base = newState(name);
  if (!raw || typeof raw !== 'object') return base;
  const s = Object.assign({}, base, raw);
  for (const k of ['level', 'xp', 'gold', 'hp', 'floor', 'kills', 'deaths', 'bestFloor', 'weapon', 'armor']) {
    if (typeof raw[k] !== 'number' || !Number.isFinite(raw[k])) s[k] = base[k];
  }
  if (!Array.isArray(s.log)) s.log = [];
  for (const k of ['xp', 'gold', 'kills', 'deaths', 'weapon', 'armor']) s[k] = Math.max(0, Math.floor(s[k]));
  s.level = Math.max(1, Math.floor(s.level));
  s.floor = Math.max(1, Math.floor(s.floor));
  s.bestFloor = Math.max(s.floor, Math.floor(s.bestFloor));
  s.hp = s.hp > 0 ? Math.min(Math.floor(s.hp), maxHp(s)) : maxHp(s);
  if (!s.monster || typeof s.monster !== 'object' || !(s.monster.hp > 0) || !(s.monster.maxHp > 0)) s.monster = null;
  return s;
}

module.exports = { newState, tick, simulate, heal, load, maxHp, power, xpToNext, weaponCost, armorCost, HEAL_COST };
