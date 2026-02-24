// =============================================
// signals.ts - シグナル検出
// モメンタム + レジスタンス突破を検出
// =============================================

import axios from 'axios';
import { TokenInfo, Signal } from './types';

const BIRDEYE_BASE = 'https://public-api.birdeye.so';

export class SignalDetector {
  /**
   * トークンのシグナル全体を評価
   */
  async evaluate(token: TokenInfo, sentimentScore: number): Promise<Signal> {
    const hasMomentum = this.checkMomentum(token);
    const hasBreakout = await this.checkBreakout(token);

    // 総合スコア計算
    let strength = 0;
    if (hasMomentum) strength += 40;
    if (hasBreakout) strength += 35;
    strength += (sentimentScore / 100) * 25;

    return {
      token,
      hasMomentum,
      hasBreakout,
      sentimentScore,
      signalStrength: Math.round(strength),
      detectedAt: new Date(),
    };
  }

  /**
   * モメンタムチェック: 直近4hで強い買い出来高
   */
  private checkMomentum(token: TokenInfo): boolean {
    // 出来高が前4hの1.5倍以上かつ価格プラス
    const hasVolumeSpike = token.volumeChange4h >= 1.5;
    const isPricePositive = token.priceChange4h > 0;
    return hasVolumeSpike && isPricePositive;
  }

  /**
   * レジスタンス突破チェック: OHLCV履歴から直近高値を突破しているか
   * Birdeye無料APIを使用（APIキー不要）
   */
  async checkBreakout(token: TokenInfo): Promise<boolean> {
    try {
      // 過去48時間の1時間足OHLCVを取得
      const now = Math.floor(Date.now() / 1000);
      const from = now - 48 * 3600;

      const url = `${BIRDEYE_BASE}/defi/ohlcv?address=${token.address}&type=1H&time_from=${from}&time_to=${now}`;
      const res = await axios.get(url, {
        headers: { 'X-API-KEY': 'public' },  // Birdeye公開エンドポイント
        timeout: 8000,
      });

      const candles: any[] = res.data?.data?.items ?? [];
      if (candles.length < 8) return false;

      // 直近4h以前の最高値 = レジスタンスライン
      const recentCandles = candles.slice(-4);  // 直近4本
      const olderCandles = candles.slice(0, -4); // それ以前

      const resistance = Math.max(...olderCandles.map((c: any) => c.h ?? 0));
      const currentHigh = Math.max(...recentCandles.map((c: any) => c.h ?? 0));
      const currentClose = recentCandles[recentCandles.length - 1]?.c ?? 0;

      // 現在値がレジスタンスを突破して終値が上にあるか
      const breakout = currentClose > resistance * 1.01; // 1%以上上抜け
      if (breakout) {
        console.log(`  📈 ${token.symbol}: レジスタンス突破 (resistance: ${resistance.toFixed(6)}, close: ${currentClose.toFixed(6)})`);
      }
      return breakout;

    } catch (err: any) {
      // BirdeyeがダウンしていてもDexScreenerデータで代替判断
      console.warn(`  ⚠️ ${token.symbol}: OHLCVデータ取得失敗、価格変化で代替判断`);
      // 4h価格変化が+5%以上をブレイクアウトとみなす
      return token.priceChange4h >= 5;
    }
  }

  /**
   * シグナルが強いかどうかの判定（エントリー可否）
   */
  isEntrySignal(signal: Signal): boolean {
    return (
      signal.hasMomentum &&
      signal.hasBreakout &&
      signal.sentimentScore >= 50 &&
      signal.signalStrength >= 70
    );
  }
}
