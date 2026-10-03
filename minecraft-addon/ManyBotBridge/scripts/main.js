// ManyBot Bridge — ManyBot ダッシュボードとマイクラ（統合版 BDS）をつなぐアドオン
//
// - 60秒ごとにハートビートを送り、ダッシュボードに「接続中」・オンラインのプレイヤー・アドオンのバージョンを表示させる
// - ワールドへの参加・退出をダッシュボードに送り、設定したDiscordチャンネルにログを流す
// - マイクラ内の通貨は Discord サーバーの通貨（ManyBot の所持金）そのもの。
//   /manybot:link で Discord と連携し、/manybot:balance・/manybot:pay・/manybot:sell で使う
// - ショップ: /manybot:shop か、専用アイテム「ショップ端末」を使う（PCは右クリック・スマホは長押し・
//   それ以外は使用ボタン）とメニューが開く。端末は /manybot:shopitem でもらえる
//   - 売却（出品・/manybot:shopsell）と 買取（プレイヤーの出品を買う・/manybot:shopbuy）。代金は鯖内通貨
//   - サーバーに即売り: ダッシュボードで決めた値段でサーバーがすぐ買う（/manybot:sell）
// - コマンドブロックや他のアドオンからは /scriptevent manybot:adjust {"player":"名前","amount":100,"reason":"クエスト報酬"}
//
// 設定は BDS の config/default/variables.json（manybot_url）と secrets.json（manybot_api_key）に置く。

import {
  system,
  world,
  BlockTypes,
  ItemStack,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
} from '@minecraft/server';
import { http, HttpRequest, HttpHeader, HttpRequestMethod } from '@minecraft/server-net';
import { secrets, variables } from '@minecraft/server-admin';
import { ActionFormData, FormCancelationReason, MessageFormData, ModalFormData } from '@minecraft/server-ui';

const ADDON_VERSION = '1.2.0';
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
let remote = { currency_name: 'コイン', features: { pay: true, sell: true, market: true }, sell_prices: [] };

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
// インベントリ
// ------------------------------------------------------------

// ショップ端末の目印（説明文の最後の行）。名前は金床で変えられても説明文は変えられない
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

// 中身や種類（ポーションの効果・花火の飛距離など）を持つアイテムは、出品の記録（アイテムIDと個数）から
// 元に戻せないので出品できない
const NOT_LISTABLE = /(shulker_box|bundle|potion|tipped_arrow|firework_rocket|firework_star|banner|enchanted_book|written_book|writable_book|filled_map|_map$|goat_horn|suspicious_stew|ominous_bottle)/;

/** 出品できる「ふつうの」アイテムか（名前・説明文・エンチャント・耐久の減りがなく、スタックできる） */
function isPlain(item) {
  if (!item || isShopItem(item) || item.nameTag || item.getLore().length > 0) return false;
  if (item.maxAmount <= 1 || NOT_LISTABLE.test(item.typeId)) return false;
  try {
    if (item.getComponent('minecraft:enchantable')?.getEnchantments().length) return false;
    if ((item.getComponent('minecraft:durability')?.damage ?? 0) > 0) return false;
  } catch {}
  return true;
}

function inventoryOf(player) {
  return player.getComponent('minecraft:inventory')?.container;
}

/** インベントリにある typeId の個数（ショップ端末は数えない。plainOnly なら出品できるものだけ） */
function countItem(container, typeId, plainOnly = false) {
  let n = 0;
  for (let i = 0; i < container.size; i++) {
    const it = container.getItem(i);
    if (it && it.typeId === typeId && !isShopItem(it) && (!plainOnly || isPlain(it))) n += it.amount;
  }
  return n;
}

/** typeId を n 個取り除き、取り除いた分（返却用の複製）を返す。preferSlot から先に減らす */
function takeItems(container, typeId, n, { preferSlot, plainOnly = false } = {}) {
  const slots = [...Array(container.size).keys()];
  if (preferSlot !== undefined) slots.sort((x, y) => (x === preferSlot ? -1 : y === preferSlot ? 1 : 0));
  const taken = [];
  let left = n;
  for (const i of slots) {
    if (left <= 0) break;
    const it = container.getItem(i);
    if (!it || it.typeId !== typeId || isShopItem(it) || (plainOnly && !isPlain(it))) continue;
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

/** アイテムを渡す。インベントリに入りきらない分は足元に落とす */
function giveBack(player, items) {
  if (!player.isValid) return;
  const container = inventoryOf(player);
  for (const it of items) {
    const rest = container?.addItem(it);
    if (rest) player.dimension.spawnItem(rest, player.location);
  }
}

/** typeId を n 個、スタックの上限ごとに分けて渡す */
function giveNew(player, typeId, n) {
  const max = new ItemStack(typeId, 1).maxAmount;
  const stacks = [];
  for (let left = n; left > 0; left -= max) stacks.push(new ItemStack(typeId, Math.min(max, left)));
  giveBack(player, stacks);
}

// ------------------------------------------------------------
// アイテムの表示（アイコン・名前）
// ------------------------------------------------------------

// ボタンのアイコンは標準リソースパックのテクスチャ。IDとファイル名が違うものだけここに書く
const ICON_OVERRIDES = {
  'minecraft:redstone': 'textures/items/redstone_dust',
  'minecraft:lapis_lazuli': 'textures/items/dye_powder_blue_new',
  'minecraft:ink_sac': 'textures/items/dye_powder_black',
  'minecraft:slime_ball': 'textures/items/slimeball',
  'minecraft:sugar_cane': 'textures/items/reeds',
  'minecraft:melon_slice': 'textures/items/melon',
  'minecraft:golden_apple': 'textures/items/apple_golden',
  'minecraft:beef': 'textures/items/beef_raw',
  'minecraft:cooked_beef': 'textures/items/beef_cooked',
  'minecraft:porkchop': 'textures/items/porkchop_raw',
  'minecraft:cooked_porkchop': 'textures/items/porkchop_cooked',
  'minecraft:chicken': 'textures/items/chicken_raw',
  'minecraft:cooked_chicken': 'textures/items/chicken_cooked',
  'minecraft:cod': 'textures/items/fish_raw',
  'minecraft:cooked_cod': 'textures/items/fish_cooked',
  'minecraft:salmon': 'textures/items/fish_salmon_raw',
  'minecraft:cooked_salmon': 'textures/items/fish_salmon_cooked',
  'minecraft:wheat_seeds': 'textures/items/seeds_wheat',
  'minecraft:experience_bottle': 'textures/items/experience_bottle',
  'minecraft:oak_log': 'textures/blocks/log_oak',
  'minecraft:spruce_log': 'textures/blocks/log_spruce',
  'minecraft:birch_log': 'textures/blocks/log_birch',
  'minecraft:jungle_log': 'textures/blocks/log_jungle',
  'minecraft:acacia_log': 'textures/blocks/log_acacia',
  'minecraft:dark_oak_log': 'textures/blocks/log_big_oak',
  'minecraft:oak_planks': 'textures/blocks/planks_oak',
  'minecraft:spruce_planks': 'textures/blocks/planks_spruce',
  'minecraft:birch_planks': 'textures/blocks/planks_birch',
  'minecraft:jungle_planks': 'textures/blocks/planks_jungle',
  'minecraft:acacia_planks': 'textures/blocks/planks_acacia',
  'minecraft:dark_oak_planks': 'textures/blocks/planks_big_oak',
  'minecraft:oak_sapling': 'textures/blocks/sapling_oak',
  'minecraft:torch': 'textures/blocks/torch_on',
  'minecraft:pumpkin': 'textures/blocks/pumpkin_face_off',
  'minecraft:white_wool': 'textures/blocks/wool_colored_white',
  'minecraft:grass_block': 'textures/blocks/grass_side_carried',
};

function iconOf(typeId) {
  if (ICON_OVERRIDES[typeId]) return ICON_OVERRIDES[typeId];
  if (!typeId.startsWith('minecraft:')) return undefined;
  const name = typeId.slice('minecraft:'.length);
  let isBlock = false;
  try {
    isBlock = !!BlockTypes.get(typeId);
  } catch {}
  return isBlock ? `textures/blocks/${name}` : `textures/items/${name}`;
}

function localizationKeyOf(item) {
  try {
    return item.localizationKey || null;
  } catch {
    return null;
  }
}

/** アイテム名（ゲームの言語に翻訳される）の RawMessage 部品 */
function nameParts(typeId, key, label) {
  return label ? { text: label } : key ? { translate: key } : { text: typeId.replace(/^minecraft:/, '') };
}

/** 名前＋後ろの文字列のボタン用 RawMessage */
function nameMsg(typeId, key, label, after = '') {
  return { rawtext: [nameParts(typeId, key, label), { text: after }] };
}

/** 文字列とアイテム名を混ぜた RawMessage。['購入しました ', item(...), ' ×3'] のように使う */
const raw = (...parts) => ({ rawtext: parts.map((p) => (typeof p === 'string' ? { text: p } : p)) });
const sayRaw = (player, msg) => system.run(() => player.isValid && player.sendMessage({ rawtext: [{ text: PREFIX }, ...msg.rawtext] }));

// ------------------------------------------------------------
// 画面（フォーム）
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

const picked = (res) => (res && !res.canceled && res.selection !== undefined ? res.selection : null);
const later = (fn) => system.run(fn);

/** 確認画面（「確定する」なら true） */
async function confirm(player, title, body, yes = '§a確定する', no = 'やめる') {
  const res = await showForm(player, new MessageFormData().title(title).body(body).button1(yes).button2(no));
  return picked(res) === 0;
}

function parseCount(raw, max) {
  const n = Number(String(raw ?? '').trim());
  return Number.isSafeInteger(n) && n >= 1 && n <= max ? n : null;
}

async function getBalance(player) {
  return api('GET', `/api/minecraft/balance?player=${encodeURIComponent(player.name)}`);
}

function balanceLine(bal) {
  if (!bal.ok) return `§c${bal.error}`;
  if (!bal.linked) return '§cまだDiscordと連携していません（/manybot:link）';
  return `所持金: §e${fmt(bal.balance)} ${bal.currency_name}`;
}

// ---------------- メニュー ----------------

async function openShop(player) {
  const bal = await getBalance(player);
  const actions = [];
  if (remote.features.market !== false) {
    actions.push(['§l§6売却§r\n§7何を・何個・いくらで出品するか', 'textures/ui/icon_book_writable', () => openListMenu(player)]);
    actions.push(['§l§b買取§r\n§7プレイヤーの出品を選んで買う', 'textures/ui/icon_recipe_item', () => openBuyMenu(player)]);
    actions.push(['§l自分の出品§r\n§7いま売っているもの・取り下げ', 'textures/ui/icon_book_writable', () => openMyListings(player)]);
  }
  if (remote.features.sell && remote.sell_prices.length > 0) {
    actions.push(['§lサーバーに即売り§r\n§7決まった値段ですぐ売れる', 'textures/items/emerald', () => openServerBuyback(player)]);
  }
  if (actions.length === 0) return say(player, '§cこのサーバーではショップがOFFになっています');

  const form = new ActionFormData().title('§lManyBot ショップ').body(balanceLine(bal));
  for (const [text, icon] of actions) form.button(text, icon);
  form.button('§c閉じる');
  const sel = picked(await showForm(player, form));
  if (sel !== null && sel < actions.length) later(actions[sel][2]);
}

// ---------------- 出品 ----------------

/** 出品: インベントリの出品できるアイテムを選ぶ */
async function openListMenu(player) {
  if (remote.features.market === false) return say(player, '§cこのサーバーではマーケットがOFFです');
  const container = inventoryOf(player);
  if (!container) return;
  const groups = new Map();
  for (let i = 0; i < container.size; i++) {
    const it = container.getItem(i);
    if (!isPlain(it)) continue;
    const g = groups.get(it.typeId) ?? { typeId: it.typeId, key: localizationKeyOf(it), count: 0 };
    g.count += it.amount;
    groups.set(it.typeId, g);
  }
  const items = [...groups.values()];
  const form = new ActionFormData().title('§l売却（出品）').body(
    items.length
      ? '売りたいアイテムを選んでください\n§7（名前・エンチャント付き、耐久が減ったもの、ポーションなどは出品できません）'
      : '§c出品できるアイテムを持っていません'
  );
  for (const g of items) form.button(nameMsg(g.typeId, g.key, null, `\n§7所持 ×${g.count}`), iconOf(g.typeId));
  form.button('§7戻る');
  const sel = picked(await showForm(player, form));
  if (sel === null) return;
  if (sel >= items.length) return later(() => openShop(player));
  await askListing(player, items[sel]);
}

/** 出品: 何個・1個いくらかを入力 → 確認 → 出品 → 自分の出品一覧 */
async function askListing(player, g, prev = {}) {
  const bal = await getBalance(player);
  const currency = bal.currency_name ?? remote.currency_name;
  const ref = remote.sell_prices.find((p) => p.item === g.typeId);
  const form = new ModalFormData()
    .title(nameMsg(g.typeId, g.key, null, ' を出品'))
    .textField(`何個売りますか？（所持 ${g.count}個）`, `1〜${g.count}`, { defaultValue: String(prev.count ?? g.count) })
    .textField(`1個の値段（${currency}）${ref ? `\n§7参考: サーバー即売り 1個 ${fmt(ref.price)}` : ''}`, '例: 100', {
      defaultValue: prev.price ? String(prev.price) : '',
    });
  const res = await showForm(player, form);
  if (!res || res.canceled) return later(() => openListMenu(player));
  const [rawCount, rawPrice] = res.formValues ?? [];
  const count = parseCount(rawCount, g.count);
  const price = parseCount(rawPrice, 1_000_000_000);
  if (!count || !price) {
    say(player, `§c${!count ? `個数は1〜${g.count}で入力してください` : '値段は1以上の整数で入力してください'}`);
    return later(() => askListing(player, g, { count: rawCount, price: rawPrice }));
  }

  const ok = await confirm(
    player,
    '§l出品の確認',
    raw(
      'アイテム: §f',
      nameParts(g.typeId, g.key),
      [
        '',
        `§r個数: §f${fmt(count)}個`,
        `§r1個の値段: §e${fmt(price)} ${currency}`,
        `§r全部売れたら: §e${fmt(count * price)} ${currency}`,
        '',
        '§7出品するとアイテムはお店に預けられます。売れ残りは「自分の出品」から取り下げると戻ってきます。',
        '§7代金は売れたときにサーバーの通貨で入ります（オフライン中でも入ります）。',
      ].join('\n')
    ),
    '§a出品する'
  );
  if (!ok) return later(() => askListing(player, g, { count, price }));

  later(async () => {
    const container = inventoryOf(player);
    if (!container || countItem(container, g.typeId, true) < count) return say(player, '§cアイテムが足りなくなりました');
    const taken = takeItems(container, g.typeId, count, { plainOnly: true });
    const res = await api('POST', '/api/minecraft/market/list', {
      player: player.name,
      item: g.typeId,
      name_key: g.key,
      quantity: count,
      unit_price: price,
    });
    if (!res.ok) {
      later(() => giveBack(player, taken));
      return say(player, `§c${res.error}（アイテムは返却しました）`);
    }
    sayRaw(player, raw('§a出品しました！§r ', nameParts(g.typeId, g.key), ` ×${fmt(count)}（1個 ${fmt(price)} ${res.currency_name}）`));
    later(() => openMyListings(player));
  });
}

/** 自分がいま出品しているもの。選ぶと取り下げられる */
async function openMyListings(player) {
  const res = await api('GET', `/api/minecraft/market?seller=${encodeURIComponent(player.name)}`);
  if (!res.ok) return say(player, `§c${res.error}`);
  const listings = res.listings ?? [];
  const currency = res.currency_name ?? remote.currency_name;
  const total = listings.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const form = new ActionFormData()
    .title('§l自分の出品')
    .body(
      listings.length
        ? `いま ${listings.length}件 出品中（全部売れたら §e${fmt(total)} ${currency}§r）\n§7選ぶと取り下げられます`
        : 'いま出品しているものはありません'
    );
  for (const l of listings) {
    form.button(nameMsg(l.item, l.name_key, null, ` ×${fmt(l.quantity)}\n§71個 ${fmt(l.unit_price)} ・ 計 ${fmt(l.quantity * l.unit_price)} ${currency}`), iconOf(l.item));
  }
  form.button('§a新しく出品する', 'textures/ui/icon_book_writable');
  form.button('§7メニューへ');
  const sel = picked(await showForm(player, form));
  if (sel === null) return;
  if (sel === listings.length) return later(() => openListMenu(player));
  if (sel > listings.length) return later(() => openShop(player));

  const l = listings[sel];
  const yes = await confirm(
    player,
    '§l出品の取り下げ',
    raw(nameParts(l.item, l.name_key), ` ×${fmt(l.quantity)}（1個 ${fmt(l.unit_price)} ${currency}）を取り下げますか？\n§7売れ残っている分がインベントリに戻ります。`),
    '§c取り下げる'
  );
  if (!yes) return later(() => openMyListings(player));
  const c = await api('POST', '/api/minecraft/market/cancel', { player: player.name, listing_id: l.id });
  if (!c.ok) {
    say(player, `§c${c.error}`);
  } else {
    later(() => giveNew(player, c.item, c.quantity));
    sayRaw(player, raw('取り下げました。', nameParts(l.item, l.name_key), ` ×${fmt(c.quantity)} を返却しました`));
  }
  later(() => openMyListings(player));
}

// ---------------- 購入 ----------------

/** 購入: 出品しているプレイヤーの一覧 */
async function openBuyMenu(player) {
  if (remote.features.market === false) return say(player, '§cこのサーバーではマーケットがOFFです');
  const res = await api('GET', '/api/minecraft/market');
  if (!res.ok) return say(player, `§c${res.error}`);
  const online = new Set(onlineNames().map((n) => n.toLowerCase()));
  const sellers = new Map();
  for (const l of res.listings ?? []) {
    if (l.seller_mc_name.toLowerCase() === player.name.toLowerCase()) continue; // 自分の出品は「自分の出品」で
    const s = sellers.get(l.seller_mc_name) ?? { name: l.seller_mc_name, count: 0 };
    s.count += 1;
    sellers.set(l.seller_mc_name, s);
  }
  const list = [...sellers.values()];
  const form = new ActionFormData()
    .title('§l買取（購入）')
    .body(list.length ? 'お店（出品しているプレイヤー）を選んでください' : 'いま出品しているプレイヤーはいません');
  for (const s of list) {
    form.button(`§l${s.name}§r\n§7${s.count}件の出品${online.has(s.name.toLowerCase()) ? ' ・ §aオンライン' : ''}`, 'textures/ui/icon_steve');
  }
  form.button('§7メニューへ');
  const sel = picked(await showForm(player, form));
  if (sel === null) return;
  if (sel >= list.length) return later(() => openShop(player));
  await openSellerShop(player, list[sel].name);
}

/** 購入: そのプレイヤーの出品（アイコン・名前・値段・在庫） */
async function openSellerShop(player, sellerName) {
  const [res, bal] = await Promise.all([api('GET', `/api/minecraft/market?seller=${encodeURIComponent(sellerName)}`), getBalance(player)]);
  if (!res.ok) return say(player, `§c${res.error}`);
  const listings = res.listings ?? [];
  const currency = res.currency_name ?? remote.currency_name;
  const form = new ActionFormData()
    .title(`§l${sellerName} のお店`)
    .body(`${balanceLine(bal)}\n${listings.length ? '§7買うアイテムを選んでください' : '§7もう出品はありません'}`);
  for (const l of listings) {
    form.button(nameMsg(l.item, l.name_key, null, `\n§71個 §e${fmt(l.unit_price)} ${currency}§7 ・ 在庫 ${fmt(l.quantity)}個`), iconOf(l.item));
  }
  form.button('§7お店の一覧へ');
  const sel = picked(await showForm(player, form));
  if (sel === null) return;
  if (sel >= listings.length) return later(() => openBuyMenu(player));
  await askBuy(player, sellerName, listings[sel], currency, bal);
}

/** 購入: 何個買うか → 確認 → 購入してアイテムを受け取る */
async function askBuy(player, sellerName, l, currency, bal) {
  const affordable = bal.ok && bal.linked ? Math.floor(bal.balance / l.unit_price) : l.quantity;
  const form = new ModalFormData()
    .title(nameMsg(l.item, l.name_key, null, ' を買う'))
    .textField(
      `在庫 ${fmt(l.quantity)}個 ・ 1個 ${fmt(l.unit_price)} ${currency}\n§7所持金で買えるのは ${fmt(Math.min(affordable, l.quantity))}個まで\n§r何個買いますか？`,
      `1〜${l.quantity}`,
      { defaultValue: '1' }
    );
  const res = await showForm(player, form);
  if (!res || res.canceled) return later(() => openSellerShop(player, sellerName));
  const count = parseCount(res.formValues?.[0], l.quantity);
  if (!count) {
    say(player, `§c個数は1〜${l.quantity}で入力してください`);
    return later(() => askBuy(player, sellerName, l, currency, bal));
  }
  const total = count * l.unit_price;
  const yes = await confirm(
    player,
    '§l購入の確認',
    raw(
      `お店: §f${sellerName}\n§rアイテム: §f`,
      nameParts(l.item, l.name_key),
      [
        '',
        `§r個数: §f${fmt(count)}個（1個 ${fmt(l.unit_price)}）`,
        `§r合計: §e${fmt(total)} ${currency}`,
        bal.ok && bal.linked ? `§r購入後の所持金: §e${fmt(bal.balance - total)} ${currency}` : '',
      ].join('\n')
    ),
    '§a購入する'
  );
  if (!yes) return later(() => openSellerShop(player, sellerName));

  const r = await api('POST', '/api/minecraft/market/buy', {
    player: player.name,
    listing_id: l.id,
    quantity: count,
    unit_price: l.unit_price,
  });
  if (!r.ok) {
    say(player, `§c${r.error}`);
    return later(() => openSellerShop(player, sellerName));
  }
  later(() => giveNew(player, r.item, r.quantity));
  sayRaw(player, raw('§a購入しました！§r ', nameParts(l.item, l.name_key), ` ×${fmt(r.quantity)}（§e-${fmt(r.total)} ${r.currency_name}§r ・ 残高 ${fmt(r.balance)}）`));
  const seller = world.getAllPlayers().find((p) => p.name.toLowerCase() === sellerName.toLowerCase());
  if (seller) {
    sayRaw(
      seller,
      raw(`§b${player.name}§r が `, nameParts(l.item, l.name_key), ` ×${fmt(r.quantity)} を買いました（§e+${fmt(r.total)} ${r.currency_name}§r${r.left > 0 ? ` ・ 残り${fmt(r.left)}個` : ' ・ 売り切れ'}）`)
    );
  }
  later(() => openSellerShop(player, sellerName));
}

// ---------------- サーバーに即売り（ダッシュボードで決めた値段でサーバーが買う） ----------------

const priceOf = (typeId) => remote.sell_prices.find((p) => p.item === typeId);

/**
 * サーバーに売る。先にアイテムを取り除いてからダッシュボードに売却を記録し、失敗したら返す（二重取りを防ぐ）。
 * system.run の中（インベントリを変更できる文脈）で呼ぶこと。
 */
async function sellItems(player, typeId, count, preferSlot) {
  if (!remote.features.sell) return say(player, '§cこのサーバーではサーバー即売りがOFFです');
  const entry = priceOf(typeId);
  if (!entry) return say(player, `§c${typeId.replace(/^minecraft:/, '')} はサーバー即売りの対象ではありません（/manybot:shopsell で出品はできます）`);
  const container = inventoryOf(player);
  if (!container) return;
  const n = Math.min(count, countItem(container, typeId));
  if (!(n >= 1)) return say(player, `§c${entry.label || typeId} を持っていません`);

  const taken = takeItems(container, typeId, n, { preferSlot });
  const res = await api('POST', '/api/minecraft/sell', { player: player.name, item: typeId, count: n });
  if (!res.ok) {
    later(() => {
      giveBack(player, taken);
      if (player.isValid) player.sendMessage(`${PREFIX}§c${res.error}（アイテムは返却しました）`);
    });
    return;
  }
  say(player, `${entry.label || typeId.replace(/^minecraft:/, '')} ×${n} をサーバーに売って §e+${fmt(res.earned)} ${res.currency_name}§r（残高 ${fmt(res.balance)}）`);
}

function cmdSell(player, count) {
  // インベントリの操作は読み取り専用の文脈ではできないので system.run の中で行う
  later(() => {
    const container = inventoryOf(player);
    const item = container?.getItem(player.selectedSlotIndex);
    if (!item || isShopItem(item)) return say(player, '§c売りたいアイテムを手に持ってください（/manybot:shop でショップも開けます）');
    sellItems(player, item.typeId, count ?? countItem(container, item.typeId), player.selectedSlotIndex);
  });
}

async function openServerBuyback(player) {
  const container = inventoryOf(player);
  if (!container) return;
  const bal = await getBalance(player);
  const currency = bal.currency_name ?? remote.currency_name;
  const entries = remote.sell_prices.map((e) => ({ entry: e, owned: countItem(container, e.item) }));
  entries.sort((a, b) => Number(b.owned > 0) - Number(a.owned > 0));

  const form = new ActionFormData().title('§lサーバーに即売り').body(`${balanceLine(bal)}\n§7決まった値段ですぐに売れます`);
  for (const { entry, owned } of entries) {
    form.button(nameMsg(entry.item, null, entry.label, `  ×${owned}\n§7${fmt(entry.price)} ${currency} / 個`), iconOf(entry.item));
  }
  form.button('§7メニューへ');
  const sel = picked(await showForm(player, form));
  if (sel === null) return;
  if (sel >= entries.length) return later(() => openShop(player));
  const { entry, owned } = entries[sel];
  if (owned < 1) {
    say(player, `§c${entry.label || entry.item.replace(/^minecraft:/, '')} を持っていません`);
    return later(() => openServerBuyback(player));
  }
  const options = [...new Set([1, 16, 64].filter((n) => n < owned).concat(owned))];
  const amountForm = new ActionFormData()
    .title('§l個数を選ぶ')
    .body(`所持: ${owned}個 ・ 1個 ${fmt(entry.price)} ${currency}`);
  for (const n of options) amountForm.button(`${n === owned ? '全部 ' : ''}${n}個\n§7→ ${fmt(n * entry.price)} ${currency}`);
  amountForm.button('§7戻る');
  const a = picked(await showForm(player, amountForm));
  if (a === null) return;
  if (a >= options.length) return later(() => openServerBuyback(player));
  later(() => sellItems(player, entry.item, options[a]));
}

// ---------------- ショップ端末 ----------------

function giveShopItem(player) {
  later(() => {
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
  later(() => openShop(player));
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
      description: '手に持ったアイテムをサーバーに即売りします（個数省略で全部）',
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
    { name: 'manybot:shop', description: 'ショップのメニューを開きます（売却・買取・自分の出品・サーバーに即売り）', permissionLevel: CommandPermissionLevel.Any },
    (origin) => {
      const p = asPlayer(origin);
      if (!p) return playerOnly();
      later(() => openShop(p));
      return ok();
    }
  );
  reg.registerCommand(
    { name: 'manybot:shopsell', description: '売却: アイテムを出品します（何を・何個・1個いくらで売るか）', permissionLevel: CommandPermissionLevel.Any },
    (origin) => {
      const p = asPlayer(origin);
      if (!p) return playerOnly();
      later(() => openListMenu(p));
      return ok();
    }
  );
  reg.registerCommand(
    { name: 'manybot:shopbuy', description: '買取: 出品しているプレイヤーを選んで、アイテムを買います', permissionLevel: CommandPermissionLevel.Any },
    (origin) => {
      const p = asPlayer(origin);
      if (!p) return playerOnly();
      later(() => openBuyMenu(p));
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
