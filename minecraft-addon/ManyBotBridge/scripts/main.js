// ManyBot Bridge — ManyBot ダッシュボードとマイクラ（統合版 BDS）をつなぐアドオン
//
// - 60秒ごとにハートビートを送り、ダッシュボードに「接続中」・オンラインのプレイヤー・アドオンのバージョンを表示させる
// - ワールドへの参加・退出をダッシュボードに送り、設定したDiscordチャンネルにログを流す
// - マイクラ内の通貨は Discord サーバーの通貨（ManyBot の所持金）そのもの。
//   /manybot:link で Discord と連携し、/manybot:balance・/manybot:pay・/manybot:sell で使う
// - ショップ: /manybot:shop か、専用アイテム「ショップ端末」を使う（PCは右クリック・スマホは長押し・
//   それ以外は使用ボタン）と、売りたいものを選ぶ画面が開く。端末は /manybot:shopitem でもらえる
// - コマンドブロックや他のアドオンからは /scriptevent manybot:adjust {"player":"名前","amount":100,"reason":"クエスト報酬"}
//
// 設定は BDS の config/default/variables.json（manybot_url）と secrets.json（manybot_api_key）に置く。

import {
  system,
  world,
  ItemStack,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
} from '@minecraft/server';
import { http, HttpRequest, HttpHeader, HttpRequestMethod } from '@minecraft/server-net';
import { secrets, variables } from '@minecraft/server-admin';
import { ActionFormData, FormCancelationReason } from '@minecraft/server-ui';

const ADDON_VERSION = '1.1.0';
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

// ------------------------------------------------------------
// 売却（コマンド・ショップ共通）
// ------------------------------------------------------------

// ショップ端末の目印（説明文の最後の行）。名前は変えられても説明文は金床で変えられない
const SHOP_ITEM_TYPE = 'minecraft:compass';
const SHOP_ITEM_MARKER = '§r§8manybot:shop';

function isShopItem(item) {
  return !!item && item.typeId === SHOP_ITEM_TYPE && item.getLore().includes(SHOP_ITEM_MARKER);
}

function createShopItem() {
  const item = new ItemStack(SHOP_ITEM_TYPE, 1);
  item.nameTag = '§a§lManyBot ショップ端末';
  item.setLore(['§7右クリック / 長押し / 使用ボタンで', '§7ショップを開きます', SHOP_ITEM_MARKER]);
  item.keepOnDeath = true;
  return item;
}

function inventoryOf(player) {
  return player.getComponent('minecraft:inventory')?.container;
}

/** インベントリにある typeId の個数（ショップ端末は数えない） */
function countItem(container, typeId) {
  let n = 0;
  for (let i = 0; i < container.size; i++) {
    const it = container.getItem(i);
    if (it && it.typeId === typeId && !isShopItem(it)) n += it.amount;
  }
  return n;
}

/** typeId を n 個取り除き、取り除いた分（返却用の複製）を返す。preferSlot から先に減らす */
function takeItems(container, typeId, n, preferSlot) {
  const slots = [...Array(container.size).keys()];
  if (preferSlot !== undefined) slots.sort((x, y) => (x === preferSlot ? -1 : y === preferSlot ? 1 : 0));
  const taken = [];
  let left = n;
  for (const i of slots) {
    if (left <= 0) break;
    const it = container.getItem(i);
    if (!it || it.typeId !== typeId || isShopItem(it)) continue;
    const k = Math.min(left, it.amount);
    const copy = it.clone();
    copy.amount = k;
    taken.push(copy);
    if (k >= it.amount) container.setItem(i, undefined);
    else {
      it.amount -= k;
      container.setItem(i, it);
    }
    left -= k;
  }
  return taken;
}

function giveBack(player, items) {
  if (!player.isValid) return;
  const container = inventoryOf(player);
  for (const it of items) {
    const rest = container?.addItem(it);
    if (rest) player.dimension.spawnItem(rest, player.location);
  }
}

const priceOf = (typeId) => remote.sell_prices.find((p) => p.item === typeId);
const itemLabel = (entry) => entry.label || entry.item.replace(/^minecraft:/, '');

/**
 * 売却の本体。先にアイテムを取り除いてからダッシュボードに売却を記録し、失敗したら返す（二重取りを防ぐ）。
 * system.run の中（インベントリを変更できる文脈）で呼ぶこと。
 */
async function sellItems(player, typeId, count, preferSlot) {
  if (!remote.features.sell) return say(player, '§cこのサーバーではアイテム売却がOFFです');
  const entry = priceOf(typeId);
  if (!entry) return say(player, `§c${typeId} は売却できません`);
  const container = inventoryOf(player);
  if (!container) return;
  const n = Math.min(count, countItem(container, typeId));
  if (!(n >= 1)) return say(player, `§c${itemLabel(entry)} を持っていません`);

  const taken = takeItems(container, typeId, n, preferSlot);
  const res = await api('POST', '/api/minecraft/sell', { player: player.name, item: typeId, count: n });
  if (!res.ok) {
    system.run(() => {
      giveBack(player, taken);
      if (player.isValid) player.sendMessage(`${PREFIX}§c${res.error}（アイテムは返却しました）`);
    });
    return;
  }
  say(player, `${itemLabel(entry)} x${n} を売却して §e+${fmt(res.earned)} ${res.currency_name}§r（残高 ${fmt(res.balance)}）`);
}

function cmdSell(player, count) {
  // インベントリの操作は読み取り専用の文脈ではできないので system.run の中で行う
  system.run(() => {
    const container = inventoryOf(player);
    const item = container?.getItem(player.selectedSlotIndex);
    if (!item || isShopItem(item)) return say(player, '§c売りたいアイテムを手に持ってください（/manybot:shop でショップも開けます）');
    sellItems(player, item.typeId, count ?? countItem(container, item.typeId), player.selectedSlotIndex);
  });
}

// ------------------------------------------------------------
// ショップ画面
// ------------------------------------------------------------

/** チャット欄を閉じる前（コマンド直後）は画面を出せないので、閉じるまで少し待って出し直す */
async function showForm(player, form) {
  for (let i = 0; i < 20; i++) {
    if (!player.isValid) return null;
    const res = await form.show(player);
    if (res.cancelationReason !== FormCancelationReason.UserBusy) return res;
    await new Promise((r) => system.runTimeout(r, 10));
  }
  return null;
}

async function openShop(player) {
  if (!remote.features.sell) return say(player, '§cこのサーバーではアイテム売却がOFFです');
  const bal = await api('GET', `/api/minecraft/balance?player=${encodeURIComponent(player.name)}`);
  if (!player.isValid) return;
  const container = inventoryOf(player);
  if (!container) return;

  const currency = bal.currency_name ?? remote.currency_name;
  const entries = remote.sell_prices.map((e) => ({ entry: e, owned: countItem(container, e.item) }));
  // 持っているものを上に
  entries.sort((a, b) => Number(b.owned > 0) - Number(a.owned > 0));

  const form = new ActionFormData().title('§lManyBot ショップ');
  form.body(
    !bal.ok
      ? `§c${bal.error}`
      : !bal.linked
        ? '§cまだDiscordと連携していません。\n§7/manybot:link で連携すると、売却した分がサーバーの通貨になります。'
        : entries.length === 0
          ? `所持金: §e${fmt(bal.balance)} ${currency}§r\n§7売却できるアイテムはまだ設定されていません（ダッシュボードの「通貨・取引設定」）`
          : `所持金: §e${fmt(bal.balance)} ${currency}§r\n§7売りたいアイテムを選んでください（サーバーの通貨と共通です）`
  );
  for (const { entry, owned } of entries) {
    form.button(`${owned > 0 ? '' : '§8'}${itemLabel(entry)}  ×${owned}\n§r§7${fmt(entry.price)} ${currency} / 個`);
  }
  form.button('§c閉じる');

  const res = await showForm(player, form);
  if (!res || res.canceled || res.selection === undefined || res.selection >= entries.length) return;
  const { entry, owned } = entries[res.selection];
  if (owned < 1) {
    say(player, `§c${itemLabel(entry)} を持っていません`);
    return system.run(() => openShop(player));
  }
  await chooseAmount(player, entry, owned, currency);
}

async function chooseAmount(player, entry, owned, currency) {
  const options = [...new Set([1, 16, 64].filter((n) => n < owned).concat(owned))];
  const form = new ActionFormData()
    .title(`§l${itemLabel(entry)} を売る`)
    .body(`所持: ${owned}個 ・ 1個 ${fmt(entry.price)} ${currency}`);
  for (const n of options) form.button(`${n === owned ? '全部 ' : ''}${n}個\n§r§7→ ${fmt(n * entry.price)} ${currency}`);
  form.button('§7戻る');

  const res = await showForm(player, form);
  if (!res || res.canceled || res.selection === undefined) return;
  if (res.selection >= options.length) return system.run(() => openShop(player));
  system.run(() => sellItems(player, entry.item, options[res.selection]));
}

function giveShopItem(player) {
  system.run(() => {
    const container = inventoryOf(player);
    if (!container) return;
    for (let i = 0; i < container.size; i++) {
      if (isShopItem(container.getItem(i))) return say(player, 'ショップ端末はもう持っています');
    }
    giveBack(player, [createShopItem()]);
    say(player, '§aショップ端末§rを渡しました。右クリック（スマホは長押し・それ以外は使用ボタン）でショップが開きます');
  });
}

// ショップ端末を使ったら（右クリック / 長押し / 使用ボタン）ショップを開く。コンパス本来の動作は止める
world.beforeEvents.itemUse.subscribe((ev) => {
  if (!isShopItem(ev.itemStack)) return;
  ev.cancel = true;
  const player = ev.source;
  system.run(() => openShop(player));
});

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
  reg.registerCommand(
    { name: 'manybot:shop', description: 'ショップを開いて、アイテムを売却します', permissionLevel: CommandPermissionLevel.Any },
    (origin) => {
      const p = asPlayer(origin);
      if (!p) return playerOnly();
      system.run(() => openShop(p));
      return ok();
    }
  );
  reg.registerCommand(
    { name: 'manybot:shopitem', description: 'ショップを開く専用アイテム「ショップ端末」をもらいます', permissionLevel: CommandPermissionLevel.Any },
    (origin) => {
      const p = asPlayer(origin);
      if (!p) return playerOnly();
      giveShopItem(p);
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
