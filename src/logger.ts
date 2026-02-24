// =============================================
// logger.ts - ファイルロギング + ハートビート
// =============================================

import fs from 'fs';
import path from 'path';

const LOG_DIR = path.join(__dirname, '..', 'logs');
const TRADING_MD = path.join(__dirname, '..', 'trading.md');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'TRADE' | 'HEARTBEAT';

export class Logger {
  private logFile: string;

  constructor() {
    const date = new Date().toISOString().slice(0, 10);
    this.logFile = path.join(LOG_DIR, `${date}.log`);
    this.initTradingMd();
  }

  log(level: LogLevel, message: string): void {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] ${message}`;
    console.log(line);
    fs.appendFileSync(this.logFile, line + '\n');
  }

  info(msg: string)  { this.log('INFO', msg); }
  warn(msg: string)  { this.log('WARN', msg); }
  error(msg: string) { this.log('ERROR', msg); }

  /** ハートビートログ（5分ごと） */
  heartbeat(capitalSol: number, openPositions: number, pnlSol: number): void {
    const pnlStr = `${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)}`;
    this.log('HEARTBEAT',
      `capital=${capitalSol.toFixed(4)}SOL | positions=${openPositions} | pnl=${pnlStr}SOL`
    );
  }

  /** 取引ログをtrading.mdに記録 */
  logTrade(params: {
    type: 'BUY' | 'SELL';
    symbol: string;
    tokenAddress: string;
    sizeSol: number;
    price: number;
    pnlSol?: number;
    reason?: string;
    txSignature?: string;
    signalStrength?: number;
    sentimentScore?: number;
  }): void {
    const ts = new Date().toISOString();
    const dateStr = ts.slice(0, 10);

    // ログファイルにも記録
    const logLine = params.type === 'BUY'
      ? `${params.type} ${params.symbol} | size=${params.sizeSol.toFixed(4)}SOL | price=$${params.price.toFixed(6)}`
      : `${params.type} ${params.symbol} | pnl=${params.pnlSol !== undefined ? (params.pnlSol >= 0 ? '+' : '') + params.pnlSol.toFixed(4) : '?'}SOL | reason=${params.reason ?? '?'}`;
    this.log('TRADE', logLine);

    // trading.mdに記録
    const txLine = params.txSignature
      ? `| [Solscan](https://solscan.io/tx/${params.txSignature})`
      : '';
    const pnlLine = params.pnlSol !== undefined
      ? `**PnL:** \`${params.pnlSol >= 0 ? '+' : ''}${params.pnlSol.toFixed(4)} SOL\``
      : '';

    const entry = [
      `\n### ${params.type} ${params.symbol} — ${ts} ${txLine}`,
      `- **アドレス:** \`${params.tokenAddress}\``,
      `- **サイズ:** \`${params.sizeSol.toFixed(4)} SOL\``,
      `- **価格:** \`$${params.price.toFixed(6)}\``,
      params.reason ? `- **理由:** ${params.reason}` : '',
      params.signalStrength !== undefined ? `- **シグナル強度:** ${params.signalStrength}/100` : '',
      params.sentimentScore !== undefined ? `- **センチメント:** ${params.sentimentScore}/100` : '',
      pnlLine ? `- ${pnlLine}` : '',
    ].filter(Boolean).join('\n');

    fs.appendFileSync(TRADING_MD, entry + '\n');
  }

  /** 市場トレンド観察をtrading.mdに記録 */
  logMarketInsight(insight: string): void {
    const ts = new Date().toISOString();
    const entry = `\n### 📊 市場メモ — ${ts}\n${insight}\n`;
    fs.appendFileSync(TRADING_MD, entry);
  }

  private initTradingMd(): void {
    if (!fs.existsSync(TRADING_MD)) {
      fs.writeFileSync(TRADING_MD, `# Trading Journal — Howard 🦉

このファイルはボットが自動更新する取引日誌です。
すべての取引と市場の学びを記録します。

## 設定
- 初期資金: 0.84 SOL
- 戦略: モメンタムトレード (流動性$1M以上 / 24h以上 / 出来高トレンド)
- DEX: Jupiter API v6
- SL: -15% / TP: +30%
- ポートフォリオSL: -0.34 SOL

---

## 取引履歴
`);
      console.log('📝 trading.md を作成しました');
    }
  }
}
