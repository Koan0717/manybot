// ManyBot Bridge — ManyBot ダッシュボードとマイクラ（統合版 BDS）をつなぐアドオン
//
// - 60秒ごとにハートビートを送り、ダッシュボードに「接続中」・オンラインのプレイヤー・アドオンのバージョンを表示させる
// - ワールドへの参加・退出をダッシュボードに送り、設定したDiscordチャンネルにログを流す
// - マイクラ内の通貨は Discord サーバーの通貨（ManyBot の所持金）そのもの。
//   /manybot:link で Discord と連携し、/manybot:balance・/manybot:pay・/manybot:sell で使う
// - コマンドブロックや他のアドオンからは /scriptevent manybot:adjust {"player":"名前","amount":100,"reason":"クエスト報酬"}
//
// 設定は BDS の config/default/variables.json（manybot_url）と secrets.json（manybot_api_key）に置く。

import {
  system,
  world,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
} from '@minecraft/server';
import { http, HttpRequest, HttpHeader, HttpRequestMethod } from '@minecraft/server-net';
import { secrets, variables } from '@minecraft/server-admin';

const ADDON_VERSION = '1.0.0';
const SCRIPT_API_VERSION = '2.0.0';
const HEARTBEAT_TICKS = 20 * 60;
const PREFIX = '§a[ManyBot]§r ';

// ------------------------------------------------------------
// 設定
// ------------------------------------------------------------
let baseUrl = '';
let serverName = null;
let apiKey = null; // SecretString（secrets.json）か文字列（variables.json）
let usesSecret = false;

function loadConfig() {
  baseUrl = String(variables.get('manybot_url') ?? '').replace(/\/+$/, '');
  serverName = variables.get('manybot_server_name') ?? null;
  apiKey = secrets.get('manybot_api_key') ?? null;
  usesSecret = !!apiKey;
  // secrets.json を使わない場合の予備（キーがログ等に出やすいので推奨しない）
  if (!apiKey) apiKey = variables.get('manybot_api_key') ?? null;
  if (!baseUrl || !apiKey) {
    console.warn('[ManyBot] manybot_url / manybot_api_key が未設定です。config/default/variables.json と secrets.json を確認してください。');
  }
}

// ダッシュボードから受け取った設定（ハートビートの返り値）
let remote = { currency_name: 'コイン', features: { pay: true, sell: true }, sell_prices: [] };

// ------------------------------------------------------------
// HTTP
// ------------------------------------------------------------
async function api(method, path, body) {
  if (!baseUrl || !apiKey) return { ok: false, error: 'アドオンの設定（URL・APIキー）がされていません' };
  const req = new HttpRequest(`${baseUrl}${path}`);
  req.setMethod(method === 'GET' ? HttpRequestMethod.Get : HttpRequestMethod.Post);
  req.setHeaders([new HttpHeader('Content-Type', 'application/json'), new HttpHeader('X-ManyBot-Key', apiKey)]);
  req.setTimeout(10);
  if (body !== undefined) req.setBody(JSON.stringify(body));
  try {
    const res = await http.request(req);
    let data = {};
    try {
      data = JSON.parse(res.body || '{}');
    } catch {
      data = {};
    }
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, status: res.status, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: `ダッシュボードに接続できませんでした (${e})` };
  }
}

function onlineNames(exclude) {
  return world
    .getAllPlayers()
    .map((p) => p.name)
    .filter((n) => n !== exclude);
}

async function heartbeat() {
  const res = await api('POST', '/api/minecraft/heartbeat', {
    addon_version: ADDON_VERSION,
    server_name: serverName,
    players: onlineNames(),
    info: { server_net: true, server_admin: usesSecret, script_api: SCRIPT_API_VERSION },
  });
  if (res.ok) {
    remote = {
      currency_name: res.currency_name ?? remote.currency_name,
      features: res.features ?? remote.features,
      sell_prices: Array.isArray(res.sell_prices) ? res.sell_prices : remote.sell_prices,
    };
  } else {
    console.warn(`[ManyBot] heartbeat failed: ${res.error}`);
  }
}

const fmt = (n) => Number(n ?? 0).toLocaleString();
const say = (player, msg) => system.run(() => player.isValid && player.sendMessage(PREFIX + msg));

// ------------------------------------------------------------
// 入退出
// ------------------------------------------------------------
world.afterEvents.playerSpawn.subscribe(async (ev) => {
  if (!ev.initialSpawn) return;
  const player = ev.player;
  const name = player.name;
  const res = await api('POST', '/api/minecraft/events', { type: 'join', player: name, online: onlineNames() });
  if (!res.ok) return;
  if (res.linked && res.balance != null) {
    say(player, `おかえりなさい！ 所持金: §e${fmt(res.balance)} ${res.currency_name ?? remote.currency_name}`);
  } else if (!res.linked) {
    say(player, '§7Discordと連携すると、サーバーの通貨をマイクラ内で使えます → §b/manybot:link');
  }
});

world.afterEvents.playerLeave.subscribe((ev) => {
  api('POST', '/api/minecraft/events', { type: 'leave', player: ev.playerName, online: onlineNames(ev.playerName) });
});

// ------------------------------------------------------------
// コマンド
// ------------------------------------------------------------
function asPlayer(origin) {
  const e = origin.sourceEntity;
  return e && e.typeId === 'minecraft:player' ? e : null;
}

const ok = () => ({ status: CustomCommandStatus.Success });
const playerOnly = () => ({ status: CustomCommandStatus.Failure, message: 'プレイヤーだけが使えるコマンドです' });

async function cmdLink(player) {
  const res = await api('POST', '/api/minecraft/link', { player: player.name });
  if (!res.ok) return say(player, `§c${res.error}`);
  const min = Math.round((res.expires_in ?? 600) / 60);
  say(
    player,
    `連携コード: §e§l${res.code}§r\n§7Webのメンバー画面（プロフィール → マイクラ連携）にこのコードを入力してください（${min}分間有効）` +
      (res.already_linked_to ? '\n§7※すでに連携済みです。入力すると連携先が置き換わります' : '')
  );
}

async function cmdBalance(player) {
  const res = await api('GET', `/api/minecraft/balance?player=${encodeURIComponent(player.name)}`);
  if (!res.ok) return say(player, `§c${res.error}`);
  if (!res.linked) return say(player, '§cまだDiscordと連携していません → /manybot:link');
  say(player, `所持金: §e${fmt(res.balance)} ${res.currency_name}`);
}

async function cmdPay(player, to, amount) {
  if (!remote.features.pay) return say(player, '§cこのサーバーではゲーム内送金がOFFです');
  const res = await api('POST', '/api/minecraft/pay', { from: player.name, to, amount });
  if (!res.ok) return say(player, `§c${res.error}`);
  say(player, `§b${res.to}§r に §e${fmt(res.amount)} ${res.currency_name}§r を送金しました（残高 ${fmt(res.balance)}）`);
  const target = world.getAllPlayers().find((p) => p.name.toLowerCase() === String(res.to).toLowerCase());
  if (target) say(target, `§b${player.name}§r から §e${fmt(res.amount)} ${res.currency_name}§r を受け取りました`);
}

function cmdSell(player, count) {
  if (!remote.features.sell) return say(player, '§cこのサーバーではアイテム売却がOFFです');
  // インベントリの操作は読み取り専用の文脈ではできないので system.run の中で行う
  system.run(async () => {
    const container = player.getComponent('minecraft:inventory')?.container;
    const slot = player.selectedSlotIndex;
    const item = container?.getItem(slot);
    if (!container || !item) return say(player, '§c売りたいアイテムを手に持ってください');
    const entry = remote.sell_prices.find((p) => p.item === item.typeId);
    if (!entry) return say(player, `§c${item.typeId} は売却できません`);
    const n = Math.min(count ?? item.amount, item.amount);
    if (!(n >= 1)) return say(player, '§c個数が不正です');

    // 先にアイテムを減らし、売却に失敗したら返す（二重取りを防ぐ）
    const restore = item.clone();
    restore.amount = n;
    if (n >= item.amount) container.setItem(slot, undefined);
    else {
      item.amount -= n;
      container.setItem(slot, item);
    }

    const res = await api('POST', '/api/minecraft/sell', { player: player.name, item: restore.typeId, count: n });
    if (!res.ok) {
      system.run(() => {
        if (!player.isValid) return;
        const left = player.getComponent('minecraft:inventory')?.container?.addItem(restore);
        if (left) player.dimension.spawnItem(left, player.location);
        player.sendMessage(`${PREFIX}§c${res.error}（アイテムは返却しました）`);
      });
      return;
    }
    say(player, `${restore.typeId} x${n} を売却して §e+${fmt(res.earned)} ${res.currency_name}§r（残高 ${fmt(res.balance)}）`);
  });
}

system.beforeEvents.startup.subscribe((init) => {
  const reg = init.customCommandRegistry;
  reg.registerCommand(
    { name: 'manybot:link', description: 'Discord（ManyBot）とアカウントを連携するコードを表示します', permissionLevel: CommandPermissionLevel.Any },
    (origin) => {
      const p = asPlayer(origin);
      if (!p) return playerOnly();
      cmdLink(p);
      return ok();
    }
  );
  reg.registerCommand(
    { name: 'manybot:balance', description: '所持金（Discordサーバーと共通の通貨）を表示します', permissionLevel: CommandPermissionLevel.Any },
    (origin) => {
      const p = asPlayer(origin);
      if (!p) return playerOnly();
      cmdBalance(p);
      return ok();
    }
  );
  reg.registerCommand(
    {
      name: 'manybot:pay',
      description: '連携済みのプレイヤーに通貨を送金します',
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [
        { name: 'player', type: CustomCommandParamType.String },
        { name: 'amount', type: CustomCommandParamType.Integer },
      ],
    },
    (origin, to, amount) => {
      const p = asPlayer(origin);
      if (!p) return playerOnly();
      cmdPay(p, to, amount);
      return ok();
    }
  );
  reg.registerCommand(
    {
      name: 'manybot:sell',
      description: '手に持ったアイテムを売却して通貨に換えます（個数省略で全部）',
      permissionLevel: CommandPermissionLevel.Any,
      optionalParameters: [{ name: 'count', type: CustomCommandParamType.Integer }],
    },
    (origin, count) => {
      const p = asPlayer(origin);
      if (!p) return playerOnly();
      cmdSell(p, count);
      return ok();
    }
  );
});

// コマンドブロック・他のアドオンからの残高増減
//   /scriptevent manybot:adjust {"player":"Steve","amount":100,"reason":"クエスト報酬"}
system.afterEvents.scriptEventReceive.subscribe(async (ev) => {
  if (ev.id !== 'manybot:adjust') return;
  let data;
  try {
    data = JSON.parse(ev.message);
  } catch {
    return console.warn('[ManyBot] manybot:adjust のメッセージはJSONで指定してください');
  }
  const res = await api('POST', '/api/minecraft/adjust', data);
  const target = world.getAllPlayers().find((p) => p.name === data?.player);
  if (!res.ok) {
    console.warn(`[ManyBot] adjust failed: ${res.error}`);
    if (target) say(target, `§c${res.error}`);
    return;
  }
  if (target) {
    const sign = res.amount > 0 ? '+' : '';
    say(target, `§e${sign}${fmt(res.amount)} ${res.currency_name}§r${data.reason ? `（${data.reason}）` : ''} 残高 ${fmt(res.balance)}`);
  }
});

// ------------------------------------------------------------
// 起動
// ------------------------------------------------------------
system.run(async () => {
  loadConfig();
  await heartbeat();
  system.runInterval(heartbeat, HEARTBEAT_TICKS);
  console.info(`[ManyBot] Bridge v${ADDON_VERSION} started (${baseUrl || 'URL未設定'})`);
});
