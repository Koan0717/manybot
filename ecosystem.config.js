// pm2 の設定: 1台のVPSで ManyBot とマイクラサーバー（BDS）をまとめて動かす
//
//   pm2 start ecosystem.config.js          # まとめて起動
//   pm2 start ecosystem.config.js --only bds
//   pm2 save && pm2 startup                # VPS 再起動後も自動で起動
//
// 置き場所は環境変数で変えられる（未設定なら下の既定値）。フォルダが無いアプリは起動しない。
//   MANYBOT_DIR  … このリポジトリ（既定: このファイルがあるフォルダ）。Bot は その中の bot/ で起動する
//   BDS_DIR      … Bedrock Dedicated Server を展開したフォルダ（既定: ~/bedrock-server）

const fs = require('fs');
const os = require('os');
const path = require('path');

const MANYBOT_DIR = process.env.MANYBOT_DIR || __dirname;
const BOT_DIR = path.join(MANYBOT_DIR, 'bot');
const BDS_DIR = process.env.BDS_DIR || path.join(os.homedir(), 'bedrock-server');

/** venv があればその python、無ければ python3 */
function python(dir) {
  // bot/ の中、またはリポジトリ直下の venv
  for (const base of [dir, MANYBOT_DIR]) {
    for (const v of ['venv', '.venv']) {
      const p = path.join(base, v, 'bin', 'python');
      if (fs.existsSync(p)) return p;
    }
  }
  return 'python3';
}

const apps = [
  {
    name: 'manybot',
    cwd: BOT_DIR,
    script: 'bot.py',
    interpreter: python(BOT_DIR),
    env: { PORT: '8080', PYTHONUNBUFFERED: '1' },
    autorestart: true,
    restart_delay: 5000,
    max_memory_restart: '1G',
  },
  {
    name: 'bds',
    cwd: BDS_DIR,
    script: './bedrock_server',
    interpreter: 'none',
    env: { LD_LIBRARY_PATH: '.' },
    autorestart: true,
    restart_delay: 10000,
    // 止めるときにワールドを保存する時間を取る
    kill_timeout: 30000,
  },
];

module.exports = {
  apps: apps.filter((app) => fs.existsSync(path.join(app.cwd, app.script))),
};
