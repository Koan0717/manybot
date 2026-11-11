"""どう森機能のデータ（doumori リポジトリ src/data・src/config.js から移植）"""

FISH_LIST = [
    {
        "id": "goldfish",
        "name": "キンギョ",
        "emoji": "🐠",
        "rarity": "COMMON",
        "weight": 35,
        "time": "all",
        "desc": "かわいらしいおなじみの鑑賞魚。"
    },
    {
        "id": "killifish",
        "name": "メダカ",
        "emoji": "🐟",
        "rarity": "COMMON",
        "weight": 35,
        "time": "all",
        "desc": "小川に群れて泳ぐ小さな魚。"
    },
    {
        "id": "crucian_carp",
        "name": "フナ",
        "emoji": "🐟",
        "rarity": "COMMON",
        "weight": 30,
        "time": "all",
        "desc": "川釣りといえばまずはコレ！"
    },
    {
        "id": "pale_chub",
        "name": "オイカワ",
        "emoji": "🐟",
        "rarity": "COMMON",
        "weight": 30,
        "time": "all",
        "desc": "きれいな川にすむ元気な魚。"
    },
    {
        "id": "dace",
        "name": "ウグイ",
        "emoji": "🐟",
        "rarity": "COMMON",
        "weight": 25,
        "time": "all",
        "desc": "環境適応力が高くどこにでもいる。"
    },
    {
        "id": "carp",
        "name": "コイ",
        "emoji": "🐟",
        "rarity": "UNCOMMON",
        "weight": 20,
        "time": "all",
        "desc": "大きな体で川底を優雅に泳ぐ。"
    },
    {
        "id": "black_bass",
        "name": "ブラックバス",
        "emoji": "🐟",
        "rarity": "UNCOMMON",
        "weight": 20,
        "time": "all",
        "desc": "ルアー釣りの大人気ターゲット。"
    },
    {
        "id": "horse_mackerel",
        "name": "アジ",
        "emoji": "🐟",
        "rarity": "UNCOMMON",
        "weight": 20,
        "time": "all",
        "desc": "アジフライにすると絶品！"
    },
    {
        "id": "mackerel",
        "name": "サバ",
        "emoji": "🐟",
        "rarity": "UNCOMMON",
        "weight": 15,
        "time": "all",
        "desc": "青魚の代表格。味噌煮が最高。"
    },
    {
        "id": "rainbow_trout",
        "name": "ニジマス",
        "emoji": "🐟",
        "rarity": "RARE",
        "weight": 12,
        "time": "day",
        "desc": "美しい虹色の模様を持つマス。"
    },
    {
        "id": "sea_bream",
        "name": "タイ",
        "emoji": "🐠",
        "rarity": "RARE",
        "weight": 10,
        "time": "all",
        "desc": "目出鯛！おめでたい高級魚。"
    },
    {
        "id": "flounder",
        "name": "ヒラメ",
        "emoji": "🐟",
        "rarity": "RARE",
        "weight": 10,
        "time": "night",
        "desc": "砂底に隠れる名手。左に目が寄り。"
    },
    {
        "id": "salmon",
        "name": "サケ",
        "emoji": "🐟",
        "rarity": "RARE",
        "weight": 10,
        "time": "all",
        "desc": "川をのぼるたくましい白身魚。"
    },
    {
        "id": "eel",
        "name": "ウナギ",
        "emoji": "🐍",
        "rarity": "RARE",
        "weight": 8,
        "time": "night",
        "desc": "スタミナ抜群！夜の川に潜む。"
    },
    {
        "id": "tuna",
        "name": "マグロ",
        "emoji": "🐟",
        "rarity": "SUPER_RARE",
        "weight": 5,
        "time": "all",
        "desc": "大海原を回遊する巨大な魚。"
    },
    {
        "id": "marlin",
        "name": "カジキ",
        "emoji": "🗡️",
        "rarity": "SUPER_RARE",
        "weight": 4,
        "time": "all",
        "desc": "鋭いツノを持つ海のハンター。"
    },
    {
        "id": "pirarucu",
        "name": "ピラルク",
        "emoji": "🐊",
        "rarity": "SUPER_RARE",
        "weight": 3,
        "time": "day",
        "desc": "アマゾン川の巨大な淡水魚。"
    },
    {
        "id": "oarfish",
        "name": "リュウグウノツカイ",
        "emoji": "🐉",
        "rarity": "LEGENDARY",
        "weight": 1.5,
        "time": "night",
        "desc": "深海から訪れる神秘的な赤いヒレの魚。"
    },
    {
        "id": "stringfish",
        "name": "イトウ",
        "emoji": "🐋",
        "rarity": "LEGENDARY",
        "weight": 1,
        "time": "night",
        "desc": "幻の巨大魚。なかなかお目にかかれない。"
    },
    {
        "id": "coelacanth",
        "name": "シーラカンス",
        "emoji": "🦴",
        "rarity": "LEGENDARY",
        "weight": 0.5,
        "time": "all",
        "desc": "生きた化石！超超低確率の伝説の魚。"
    }
]

BUG_LIST = [
    {
        "id": "cabbage_butterfly",
        "name": "モンシロチョウ",
        "emoji": "🦋",
        "rarity": "COMMON",
        "weight": 35,
        "time": "day",
        "desc": "キャベツ畑でおなじみの白いチョウ。"
    },
    {
        "id": "cicada",
        "name": "アブラゼミ",
        "emoji": "🪰",
        "rarity": "COMMON",
        "weight": 35,
        "time": "day",
        "desc": "ジリジリと夏を告げるセミ。"
    },
    {
        "id": "grasshopper",
        "name": "ショウリョウバッタ",
        "emoji": "🦗",
        "rarity": "COMMON",
        "weight": 30,
        "time": "all",
        "desc": "草むらでぴょんぴょん跳ねる。"
    },
    {
        "id": "pill_bug",
        "name": "ダンゴムシ",
        "emoji": "🪲",
        "rarity": "COMMON",
        "weight": 30,
        "time": "all",
        "desc": "つっつくと丸くなるかわいいやつ。"
    },
    {
        "id": "ladybug",
        "name": "ナナホシテントウ",
        "emoji": "🐞",
        "rarity": "COMMON",
        "weight": 25,
        "time": "day",
        "desc": "幸運を呼ぶ赤と黒の星模様。"
    },
    {
        "id": "swallowtail_butterfly",
        "name": "アゲハチョウ",
        "emoji": "🦋",
        "rarity": "UNCOMMON",
        "weight": 20,
        "time": "day",
        "desc": "黄色と黒の華やかな羽模様。"
    },
    {
        "id": "walker_cicada",
        "name": "ミンミンゼミ",
        "emoji": "🪰",
        "rarity": "UNCOMMON",
        "weight": 20,
        "time": "day",
        "desc": "ミーンミーンと元気に鳴く。"
    },
    {
        "id": "mantis",
        "name": "カマキリ",
        "emoji": "🦗",
        "rarity": "UNCOMMON",
        "weight": 20,
        "time": "all",
        "desc": "鎌をかまえた草むらのハンター。"
    },
    {
        "id": "locust",
        "name": "トノサマバッタ",
        "emoji": "🦗",
        "rarity": "UNCOMMON",
        "weight": 15,
        "time": "day",
        "desc": "遠くまで飛んで逃げる立派なバッタ。"
    },
    {
        "id": "miyama_stag",
        "name": "ミヤマクワガタ",
        "rarity": "RARE",
        "emoji": "🪲",
        "weight": 12,
        "time": "all",
        "desc": "頭の突起がかっこいい山奥のクワガタ。"
    },
    {
        "id": "sawtooth_stag",
        "name": "ノコギリクワガタ",
        "emoji": "🪲",
        "rarity": "RARE",
        "weight": 10,
        "time": "night",
        "desc": "曲がった大あごが自慢のクワガタ。"
    },
    {
        "id": "beetle",
        "name": "カブトムシ",
        "emoji": "🪲",
        "rarity": "RARE",
        "weight": 10,
        "time": "night",
        "desc": "昆虫の王様！立派なツノが輝く。"
    },
    {
        "id": "darner_dragonfly",
        "name": "オニヤンマ",
        "emoji": "🐝",
        "rarity": "RARE",
        "weight": 10,
        "time": "day",
        "desc": "日本最大のトンボ。黒と黄色の虎模様。"
    },
    {
        "id": "evening_cicada",
        "name": "ヒグラシ",
        "emoji": "🪰",
        "rarity": "RARE",
        "weight": 8,
        "time": "night",
        "desc": "カナカナカナ…と切なく鳴く。"
    },
    {
        "id": "giant_stag",
        "name": "オオクワガタ",
        "emoji": "🪲",
        "rarity": "SUPER_RARE",
        "weight": 5,
        "time": "night",
        "desc": "黒いダイヤと呼ばれる憧れのクワガタ。"
    },
    {
        "id": "tarantula",
        "name": "タランチュラ",
        "emoji": "🕷️",
        "rarity": "SUPER_RARE",
        "weight": 4,
        "time": "night",
        "desc": "毛深く巨大なクモ。噛まれると危険！"
    },
    {
        "id": "scorpion",
        "name": "サソリ",
        "emoji": "🦂",
        "rarity": "SUPER_RARE",
        "weight": 3,
        "time": "night",
        "desc": "猛毒のハサミと尻尾を持つ危険生物。"
    },
    {
        "id": "birdwing_butterfly",
        "name": "アレクサンドラアゲハ",
        "emoji": "🦋",
        "rarity": "SUPER_RARE",
        "weight": 3,
        "time": "day",
        "desc": "世界最大の美しいチョウ。"
    },
    {
        "id": "hercules_beetle",
        "name": "ヘラクレスオオカブト",
        "emoji": "🪲",
        "rarity": "LEGENDARY",
        "weight": 1,
        "time": "night",
        "desc": "世界最大最強の巨大なカブトムシ！"
    },
    {
        "id": "gold_beetle",
        "name": "コガネムシ",
        "emoji": "✨",
        "rarity": "LEGENDARY",
        "weight": 0.5,
        "time": "all",
        "desc": "黄金に輝く超超超レアドロップの虫。"
    }
]

# 階級（ダッシュボードの「階級・ランク設定」が無いときの既定値）
DEFAULT_RANKS = [
    {
        "level": 1,
        "name": "🌱 新規住人",
        "required_miles": 0,
        "color": "#A8E6CF",
        "role_name": "新規住人"
    },
    {
        "level": 2,
        "name": "🏠 住人",
        "required_miles": 4000,
        "color": "#3498DB",
        "role_name": "住人"
    },
    {
        "level": 3,
        "name": "☕ 常連住人",
        "required_miles": 15000,
        "color": "#E67E22",
        "role_name": "常連住人"
    },
    {
        "level": 4,
        "name": "🌟 人気住人",
        "required_miles": 45000,
        "color": "#FFD700",
        "role_name": "人気住人"
    }
]

# 共通ミッションテンプレート（ミッションマスターが空のDBに初期投入）
DEFAULT_MISSIONS = [
    {
        "title": "VC交流",
        "description": "VCに通算30分以上参加する"
    },
    {
        "title": "雑談あいさつ",
        "description": "雑談チャンネルであいさつや会話を3回以上送信する"
    },
    {
        "title": "魚釣り挑戦",
        "description": "`/釣り` で魚を1匹以上釣り上げる"
    },
    {
        "title": "虫捕り挑戦",
        "description": "`/虫捕り` で虫を1匹以上捕まえる"
    },
    {
        "title": "ショップ利用",
        "description": "`/ショップ` または `/両替` を1回利用する"
    },
    {
        "title": "生き物売却",
        "description": "`/売却` で重複した生き物を売却してベルにする"
    },
    {
        "title": "VC長時間滞在",
        "description": "VCに通算1時間以上参加してメンバーと交流する"
    },
    {
        "title": "レア生き物捕獲",
        "description": "レア度RARE以上の生き物を1匹捕獲する"
    },
    {
        "title": "図鑑チェック",
        "description": "`/魚図鑑` または `/虫図鑑` を確認してコレクションを広げる"
    },
    {
        "title": "イベント参加",
        "description": "DIY作業台イベントや鯖内イベントに参加・告知する"
    }
]

