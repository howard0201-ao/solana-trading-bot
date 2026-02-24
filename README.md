# 🤖 Solana Momentum Trading Bot

Howardが管理するSolanaモメンタムトレーディングボット。

## 戦略

- **対象**: 流動性$1M以上 / 作成24時間以上 / 出来高トレンドあり
- **エントリー**: 4h強い買い出来高 + レジスタンス突破 + ポジティブセンチメント
- **DEX**: Jupiter API v6（価格最適化）

## リスク管理

| 設定 | 値 |
|------|-----|
| 初期資金 | 0.84 SOL |
| 最大ポジションサイズ | 10%（= 約0.084 SOL） |
| 同時ポジション上限 | 3件 |
| ストップロス | -15% |
| テイクプロフィット | +30% |
| ポートフォリオSL | -0.34 SOL（全停止） |

## セットアップ

### 1. 依存関係インストール
```bash
npm install
```

### 2. `.env` を設定
```
WALLET_PRIVATE_KEY=...        # 自動生成済み
TELEGRAM_BOT_TOKEN=...        # @BotFather で取得
TELEGRAM_CHAT_ID=...          # 設定済み (8795354216)
LUNARCRUSH_API_KEY=...        # lunarcrush.com/developers
```

### 3. 起動

**開発（ログ直接表示）:**
```bash
npm start
```

**本番（PM2デーモン）:**
```bash
npm run pm2:start
npm run pm2:logs    # ログ確認
pm2 save            # 設定保存
pm2 startup         # OS再起動後も自動起動
```

## ファイル構成

```
src/
├── index.ts          # エントリーポイント・ループ管理
├── types.ts          # 型定義
├── wallet.ts         # ウォレット管理
├── scanner.ts        # トークンスキャン（DexScreener）
├── signals.ts        # シグナル検出（モメンタム＋ブレイクアウト）
├── sentiment.ts      # SNSセンチメント（LunarCrush）
├── jupiter.ts        # 取引実行（Jupiter v6）
├── riskManager.ts    # リスク管理
├── positionManager.ts # ポジション追跡
├── notifier.ts       # Telegram通知
└── logger.ts         # ファイルログ＋heartbeat

logs/                 # ログファイル（日付別）
trading.md            # 取引日誌＋市場メモ（自動更新）
state.json            # ポジション状態（再起動後も維持）
```

## ループ設計

| ループ | 間隔 | 用途 |
|--------|------|------|
| ポジション監視 | 10秒 | SL/TP チェック |
| シグナル評価 | 30秒 | エントリー判断 |
| トークンスキャン | 2分 | 候補リフレッシュ |
| ハートビートログ | 5分 | 稼働確認・PnL記録 |

## ウォレット

- **公開鍵**: `3gnBbdzxZoJb6RAm44Zan66xWePNFfs1PCeexZzKGwtT`
- [Solscanで確認](https://solscan.io/account/3gnBbdzxZoJb6RAm44Zan66xWePNFfs1PCeexZzKGwtT)
