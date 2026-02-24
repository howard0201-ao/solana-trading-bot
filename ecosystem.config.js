// PM2 エコシステム設定
// 使い方:
//   pm2 start ecosystem.config.js      # 起動
//   pm2 stop solana-bot                # 停止
//   pm2 restart solana-bot             # 再起動
//   pm2 logs solana-bot                # ログ確認
//   pm2 save && pm2 startup            # OS再起動後も自動起動

module.exports = {
  apps: [
    {
      name: 'solana-bot',
      script: './node_modules/.bin/ts-node',
      args: 'src/index.ts',
      cwd: __dirname,

      // --- 再起動設定 ---
      autorestart: true,         // クラッシュ時に自動再起動
      watch: false,              // ファイル変更監視はオフ（本番）
      max_memory_restart: '300M', // メモリ上限で再起動
      restart_delay: 3000,       // 再起動待機 3秒
      max_restarts: 20,          // 無限ループ防止

      // --- ログ設定 ---
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      merge_logs: true,

      // --- 環境変数 ---
      env: {
        NODE_ENV: 'production',
      },

      // --- クラッシュ検出 ---
      min_uptime: '10s',         // 10秒未満で落ちたら異常とみなす
      listen_timeout: 8000,
      kill_timeout: 5000,

      // --- 指数バックオフ再起動（連続クラッシュ防止）---
      exp_backoff_restart_delay: 100,
    },
  ],
};
