// =============================================
// sentiment.ts - SNSセンチメント分析
// LunarCrush API (無料プランあり)
// =============================================

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const LUNARCRUSH_BASE = 'https://lunarcrush.com/api4/public';

export class SentimentAnalyzer {
  private apiKey: string;
  private cache: Map<string, { score: number; timestamp: number }> = new Map();
  private CACHE_TTL_MS = 5 * 60 * 1000; // 5分キャッシュ

  constructor() {
    this.apiKey = process.env.LUNARCRUSH_API_KEY ?? '';
    if (!this.apiKey) {
      console.warn('⚠️ LUNARCRUSH_API_KEY が未設定。センチメントスコアはデフォルト50を使用します。');
    }
  }

  /**
   * トークンシンボルのセンチメントスコアを取得 (0-100)
   */
  async getScore(symbol: string): Promise<number> {
    if (!this.apiKey) return 50; // デフォルト中立

    // キャッシュチェック
    const cached = this.cache.get(symbol);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.score;
    }

    try {
      const res = await axios.get(`${LUNARCRUSH_BASE}/coins/${symbol.toLowerCase()}/v1`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeout: 8000,
      });

      const data = res.data?.data;
      if (!data) return 50;

      // LunarCrushのgalaxy_scoreは1-100のスコア
      const score = data.galaxy_score ?? data.alt_rank ?? 50;
      const normalized = Math.min(100, Math.max(0, score));

      this.cache.set(symbol, { score: normalized, timestamp: Date.now() });
      return normalized;

    } catch (err: any) {
      // APIエラー時は中立スコアを返す（ボットを止めない）
      console.warn(`  ⚠️ センチメント取得失敗 (${symbol}): ${err.message}`);
      return 50;
    }
  }

  /**
   * センチメントラベルを返す
   */
  label(score: number): string {
    if (score >= 75) return '🟢 強気';
    if (score >= 55) return '🟡 やや強気';
    if (score >= 45) return '⚪ 中立';
    if (score >= 25) return '🟠 やや弱気';
    return '🔴 弱気';
  }
}
