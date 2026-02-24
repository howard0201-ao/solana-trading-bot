// =============================================
// scanner.ts - トークンスキャナー
// 条件: 流動性$1M以上、作成24h以上、出来高トレンドあり
// データソース: DexScreener API (無料・APIキー不要)
// =============================================

import axios from 'axios';
import { TokenInfo } from './types';

const DEXSCREENER_BASE = 'https://api.dexscreener.com/latest/dex';

const MIN_LIQUIDITY_USD = 1_000_000;  // $1M
const MIN_AGE_HOURS = 24;
const MIN_VOLUME_4H_USD = 50_000;     // 4h出来高の最低ライン
const MIN_VOLUME_TREND = 1.5;         // 前4hの1.5倍以上

export class TokenScanner {
  /**
   * Solanaチェーン上の条件を満たすトークンを検索
   */
  async scanQualifyingTokens(): Promise<TokenInfo[]> {
    console.log('🔍 トークンスキャン開始...');

    try {
      // DexScreenerからSolanaの高出来高トークンを取得
      const response = await axios.get(`${DEXSCREENER_BASE}/search?q=SOL`, {
        timeout: 10000,
      });

      const pairs = response.data?.pairs ?? [];
      const solanaPairs = pairs.filter((p: any) => p.chainId === 'solana');

      const qualified: TokenInfo[] = [];

      for (const pair of solanaPairs) {
        const token = this.parsePair(pair);
        if (!token) continue;
        if (this.meetsBasicCriteria(token)) {
          qualified.push(token);
        }
      }

      // 出来高トレンドでソート（強い順）
      qualified.sort((a, b) => b.volumeChange4h - a.volumeChange4h);

      console.log(`✅ 条件クリアトークン数: ${qualified.length}`);
      return qualified;

    } catch (err: any) {
      console.error('❌ スキャンエラー:', err.message);
      return [];
    }
  }

  /**
   * 特定トークンアドレスの詳細データを取得
   */
  async getTokenData(tokenAddress: string): Promise<TokenInfo | null> {
    try {
      const response = await axios.get(
        `${DEXSCREENER_BASE}/tokens/${tokenAddress}`,
        { timeout: 8000 }
      );
      const pairs = response.data?.pairs ?? [];
      if (pairs.length === 0) return null;

      // 流動性が最大のペアを使用
      const best = pairs.sort((a: any, b: any) =>
        (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
      )[0];

      return this.parsePair(best);
    } catch (err: any) {
      console.error(`❌ トークンデータ取得エラー (${tokenAddress}):`, err.message);
      return null;
    }
  }

  private parsePair(pair: any): TokenInfo | null {
    try {
      const liquidityUsd = pair.liquidity?.usd ?? 0;
      const pairCreatedAt = pair.pairCreatedAt ?? 0;
      const ageMs = Date.now() - pairCreatedAt;
      const ageHours = ageMs / (1000 * 60 * 60);

      const vol24h = pair.volume?.h24 ?? 0;
      const vol4h = pair.volume?.h6 ?? 0;   // DexScreenerはh6が最近値
      // 4h出来高の推定: 前後の差分から推定
      const vol4hPrev = Math.max(vol24h / 6 - vol4h, 0); // 概算
      const volumeChange4h = vol4hPrev > 0 ? vol4h / vol4hPrev : 1;

      const token: TokenInfo = {
        address: pair.baseToken?.address ?? '',
        symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
        name: pair.baseToken?.name ?? '',
        decimals: 9,
        liquidityUsd,
        ageHours,
        price: parseFloat(pair.priceUsd ?? '0'),
        volume24h: vol24h,
        volume4h: vol4h,
        volumeChange4h,
        priceChange4h: pair.priceChange?.h6 ?? 0,
        marketCap: pair.marketCap,
      };

      return token;
    } catch {
      return null;
    }
  }

  private meetsBasicCriteria(token: TokenInfo): boolean {
    // 流動性チェック
    if (token.liquidityUsd < MIN_LIQUIDITY_USD) return false;
    // 年齢チェック
    if (token.ageHours < MIN_AGE_HOURS) return false;
    // 4h出来高チェック
    if (token.volume4h < MIN_VOLUME_4H_USD) return false;
    // 出来高トレンドチェック
    if (token.volumeChange4h < MIN_VOLUME_TREND) return false;

    return true;
  }
}
