// =============================================
// notifier.ts - Telegram通知モジュール
// 重要イベントをすべてTelegramに送信
// =============================================

import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? '';
const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

export type NotifyLevel = 'info' | 'success' | 'warning' | 'error';

const LEVEL_EMOJI: Record<NotifyLevel, string> = {
  info:    'ℹ️',
  success: '✅',
  warning: '⚠️',
  error:   '🚨',
};

export class Notifier {
  private enabled: boolean;
  private queue: string[] = [];
  private flushing = false;

  constructor() {
    this.enabled = !!(BOT_TOKEN && CHAT_ID);
    if (!this.enabled) {
      console.warn('⚠️ Telegram通知無効 (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 未設定)');
    }
  }

  /** 通知を送信（失敗してもボットは止めない） */
  async send(message: string, level: NotifyLevel = 'info'): Promise<void> {
    const emoji = LEVEL_EMOJI[level];
    const text = `${emoji} *[HowardBot]*\n${message}`;
    console.log(`[Notify] ${text.replace(/\*/g, '')}`);
    if (!this.enabled) return;

    this.queue.push(text);
    if (!this.flushing) this.flushQueue();
  }

  private async flushQueue(): Promise<void> {
    this.flushing = true;
    while (this.queue.length > 0) {
      const text = this.queue.shift()!;
      try {
        await axios.post(`${BASE_URL}/sendMessage`, {
          chat_id: CHAT_ID,
          text,
          parse_mode: 'Markdown',
        }, { timeout: 5000 });
        await sleep(300); // レート制限対策
      } catch (err: any) {
        console.warn(`[Notify] 送信失敗: ${err.message}`);
      }
    }
    this.flushing = false;
  }

  // ---- 便利メソッド ----

  async botStarted(balanceSol: number): Promise<void> {
    await this.send(
      `🤖 ボット起動\n残高: \`${balanceSol.toFixed(4)} SOL\``,
      'info'
    );
  }

  async botStopped(reason: string): Promise<void> {
    await this.send(`🛑 ボット停止\n理由: ${reason}`, 'warning');
  }

  async tradeEntered(symbol: string, sizeSol: number, entryPrice: number, sl: number, tp: number): Promise<void> {
    await this.send(
      `🚀 *エントリー: ${symbol}*\n` +
      `サイズ: \`${sizeSol.toFixed(4)} SOL\`\n` +
      `価格: \`$${entryPrice.toFixed(6)}\`\n` +
      `SL: \`$${sl.toFixed(6)}\` | TP: \`$${tp.toFixed(6)}\``,
      'info'
    );
  }

  async tradeExited(symbol: string, pnlSol: number, reason: string, txSig?: string): Promise<void> {
    const level: NotifyLevel = pnlSol >= 0 ? 'success' : 'warning';
    const pnlStr = `${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL`;
    const txLine = txSig ? `\n[Solscan](https://solscan.io/tx/${txSig})` : '';
    await this.send(
      `📤 *エグジット: ${symbol}*\n` +
      `理由: ${reason}\n` +
      `PnL: \`${pnlStr}\`` + txLine,
      level
    );
  }

  async portfolioStop(totalPnlSol: number): Promise<void> {
    await this.send(
      `⛔ *ポートフォリオストップ発動*\n` +
      `総損失: \`${totalPnlSol.toFixed(4)} SOL\`\n` +
      `ボットを停止します。`,
      'error'
    );
  }

  async heartbeat(capitalSol: number, openPositions: number, totalPnlSol: number): Promise<void> {
    const pnlStr = `${totalPnlSol >= 0 ? '+' : ''}${totalPnlSol.toFixed(4)}`;
    await this.send(
      `💓 ハートビート\n` +
      `残高: \`${capitalSol.toFixed(4)} SOL\` | PnL: \`${pnlStr} SOL\`\n` +
      `ポジション: ${openPositions}件`,
      'info'
    );
  }

  async error(context: string, err: Error): Promise<void> {
    await this.send(`💥 エラー: ${context}\n\`${err.message}\``, 'error');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
