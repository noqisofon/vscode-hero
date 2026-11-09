'use strict';
const vscode = require('vscode');
const game = require('./game');

const STATE_KEY = 'hero.state';
const MAX_OFFLINE_TURNS = 3600; // 放置分の上限

const HEARTBEAT_MS = 5000;   // 保存・排他チェックの間隔
const OWNER_TIMEOUT_MS = 15000; // この時間更新が無い他ウィンドウは死んだとみなす
const INSTANCE = Math.random().toString(36).slice(2);

let state, timer, statusItem, view, extCtx;
let active = true, lastSync = 0;

const cfg = () => vscode.workspace.getConfiguration('hero');

function snapshot() {
  return {
    name: state.name, level: state.level, xp: state.xp, xpMax: game.xpToNext(state),
    hp: state.hp, hpMax: game.maxHp(state), gold: state.gold, floor: state.floor,
    bestFloor: state.bestFloor, kills: state.kills, deaths: state.deaths,
    weapon: state.weapon, armor: state.armor, power: game.power(state),
    monster: state.monster, log: state.log.slice(-12),
    healCost: game.HEAL_COST,
  };
}

function render() {
  statusItem.text = `$(heart) ${state.hp}/${game.maxHp(state)}  Lv${state.level}  ${state.floor}F  ${state.gold}G`;
  statusItem.tooltip = `${state.name}の冒険（クリックで開く）`;
  if (view && view.visible) view.webview.postMessage({ type: 'state', state: snapshot() });
}

function save() {
  state.lastSeen = Date.now();
  return extCtx.globalState.update(STATE_KEY, { owner: INSTANCE, savedAt: state.lastSeen, state });
}

// 複数ウィンドウの排他: 直近に他ウィンドウが保存していればそちらに任せ、自分は表示だけ行う。
function sync() {
  lastSync = Date.now();
  const env = extCtx.globalState.get(STATE_KEY);
  const raw = env && env.state ? env.state : env; // 旧形式（envelope なし）も許容
  const other = env && env.owner && env.owner !== INSTANCE && Date.now() - env.savedAt < OWNER_TIMEOUT_MS;
  if (other) {
    active = false;
    state = game.load(raw, cfg().get('name', 'ヒーロー'));
    statusItem.tooltip = '別のウィンドウで冒険中（こちらは表示のみ）';
    return;
  }
  if (!active || !state) { // 起動時、または他ウィンドウが止まったので引き継ぐ
    active = true;
    state = game.load(raw, cfg().get('name', 'ヒーロー'));
    catchUp();
  }
  save();
}

function startLoop() {
  clearInterval(timer);
  const ms = Math.max(250, cfg().get('tickSeconds', 1) * 1000);
  timer = setInterval(() => {
    if (Date.now() - lastSync >= HEARTBEAT_MS) sync();
    if (active) game.tick(state);
    render();
  }, ms);
}

function catchUp() {
  const sec = (Date.now() - (state.lastSeen || Date.now())) / 1000;
  const turns = Math.min(MAX_OFFLINE_TURNS, Math.floor(sec / Math.max(0.25, cfg().get('tickSeconds', 1))));
  if (turns < 30) return;
  const before = { level: state.level, gold: state.gold, kills: state.kills, floor: state.floor };
  game.simulate(state, turns);
  vscode.window.showInformationMessage(
    `留守中に ${state.name} は冒険を続けた: ${state.kills - before.kills} 体撃破 / ` +
    `Lv${before.level}→${state.level} / ${before.floor}F→${state.floor}F / +${state.gold - before.gold}G`);
}

class HeroViewProvider {
  resolveWebviewView(v) {
    view = v;
    v.webview.options = { enableScripts: true };
    v.webview.html = html();
    v.webview.onDidReceiveMessage((m) => {
      if (m.type === 'heal') vscode.commands.executeCommand('hero.heal');
      if (m.type === 'ready') render();
    });
    v.onDidChangeVisibility(() => render());
    v.onDidDispose(() => { if (view === v) view = undefined; });
    render();
  }
}

function html() {
  const nonce = require('crypto').randomBytes(16).toString('hex');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);margin:0;padding:8px 12px;font-size:12px}
.row{display:flex;gap:16px;align-items:stretch}
.stage{flex:0 0 260px;border:1px solid var(--vscode-panel-border);border-radius:6px;padding:8px;
 background:linear-gradient(#1b2a4a,#2d4a2d 70%,#3a5a2a);position:relative;height:96px;overflow:hidden}
.ground{position:absolute;left:0;right:0;bottom:0;height:22px;background:#4a3a22}
.hero,.mon{position:absolute;bottom:20px;font-size:38px;line-height:1}
.hero{left:30px;animation:walk 1s steps(2) infinite}
.mon{right:30px}
.hero.atk{animation:atk .25s ease-out}
.mon.hit{animation:hit .25s}
.mon.die{animation:die .4s forwards}
@keyframes walk{50%{transform:translateY(-3px)}}
@keyframes atk{50%{transform:translateX(50px) rotate(15deg)}}
@keyframes hit{25%{transform:translateX(6px);filter:brightness(2)}}
@keyframes die{to{opacity:0;transform:translateY(20px) rotate(90deg)}}
.info{flex:1;min-width:180px}
.bar{height:8px;background:var(--vscode-input-background);border-radius:4px;overflow:hidden;margin:2px 0 6px}
.bar>i{display:block;height:100%}
#hpb{background:#d94c4c}#xpb{background:#4c9ad9}#mhpb{background:#c96}
.log{flex:1;min-width:200px;font-family:var(--vscode-editor-font-family);opacity:.85;overflow:hidden}
.log div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:3px 8px;border-radius:3px;cursor:pointer}
.dim{opacity:.7}
</style></head><body>
<div class="row">
 <div class="stage"><div class="hero" id="hero">🦸</div><div class="mon" id="mon"></div><div class="ground"></div></div>
 <div class="info">
  <div><b id="name"></b> Lv<span id="lv"></span> <span class="dim">ATK <span id="pow"></span> / ⚔️+<span id="wp"></span> 🛡️+<span id="ar"></span></span></div>
  <div>HP <span id="hp"></span></div><div class="bar"><i id="hpb"></i></div>
  <div>EXP <span id="xp"></span></div><div class="bar"><i id="xpb"></i></div>
  <div>💰 <span id="gold"></span>G　🏰 <span id="floor"></span>F <span class="dim">(最高 <span id="best"></span>F)</span></div>
  <div class="dim">撃破 <span id="kills"></span> / 敗北 <span id="deaths"></span></div>
  <div><button id="heal"></button></div>
  <div id="mname" class="dim" style="margin-top:4px"></div><div class="bar"><i id="mhpb"></i></div>
 </div>
 <div class="log" id="log"></div>
</div>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();
const $=id=>document.getElementById(id);
let prevMon=null,prevMonHp=0,prevKills=-1;
function pulse(el,cls){el.classList.remove(cls);void el.offsetWidth;el.classList.add(cls);}
window.addEventListener('message',e=>{
 if(e.data.type!=='state')return;
 const s=e.data.state,m=s.monster;
 $('name').textContent=s.name;$('lv').textContent=s.level;$('pow').textContent=s.power;
 $('wp').textContent=s.weapon;$('ar').textContent=s.armor;
 $('hp').textContent=s.hp+'/'+s.hpMax;$('hpb').style.width=(100*s.hp/s.hpMax)+'%';
 $('xp').textContent=s.xp+'/'+s.xpMax;$('xpb').style.width=(100*s.xp/s.xpMax)+'%';
 $('gold').textContent=s.gold;$('floor').textContent=s.floor;$('best').textContent=s.bestFloor;
 $('kills').textContent=s.kills;$('deaths').textContent=s.deaths;
 $('heal').textContent='🧪 回復薬 ('+s.healCost+'G)';
 pulse($('hero'),'atk');
 const mon=$('mon');
 if(m){
  mon.textContent=m.icon;mon.className='mon';
  mon.style.fontSize=m.boss?'56px':'38px';
  $('mname').textContent=m.name+' HP '+Math.max(0,m.hp)+'/'+m.maxHp;
  $('mhpb').style.width=(100*Math.max(0,m.hp)/m.maxHp)+'%';
  if(prevMonHp&&m.hp<prevMonHp)pulse(mon,'hit');
  prevMonHp=m.hp;
 }else{
  if(s.kills!==prevKills&&prevKills>=0)pulse(mon,'die');
  prevMonHp=0;$('mname').textContent='';$('mhpb').style.width='0';
 }
 prevKills=s.kills;
 $('log').replaceChildren(...s.log.map(t=>{const d=document.createElement('div');d.textContent=t;return d;}));
});
$('heal').onclick=()=>vscode.postMessage({type:'heal'});
vscode.postMessage({type:'ready'});
</script></body></html>`;
}

function activate(ctx) {
  extCtx = ctx;
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'hero.show';
  statusItem.show();

  sync();
  render();
  startLoop();

  ctx.subscriptions.push(
    statusItem,
    vscode.window.registerWebviewViewProvider('hero.view', new HeroViewProvider()),
    vscode.commands.registerCommand('hero.show', () => vscode.commands.executeCommand('hero.view.focus')),
    vscode.commands.registerCommand('hero.heal', () => {
      if (active && game.heal(state)) render();
      else vscode.window.showInformationMessage(`回復薬は使えません（${game.HEAL_COST}G 必要、HP が満タンだと不要）`);
    }),
    vscode.commands.registerCommand('hero.reset', async () => {
      const ok = await vscode.window.showWarningMessage('冒険を最初からやり直しますか？', { modal: true }, 'やり直す');
      if (ok) { state = game.newState(cfg().get('name', 'ヒーロー')); active = true; await save(); render(); }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('hero.name')) { state.name = cfg().get('name', 'ヒーロー'); render(); }
      if (e.affectsConfiguration('hero.tickSeconds')) startLoop();
    }),
    { dispose: () => clearInterval(timer) },
  );
}

// VSCode は deactivate が返す Promise を待つので、最終保存はここで行う。
function deactivate() {
  clearInterval(timer);
  return active && state && extCtx ? save() : undefined;
}

module.exports = { activate, deactivate };
