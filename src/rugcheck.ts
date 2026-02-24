// =============================================
// rugcheck.ts - ラグプルリスク検査
// RugCheck.xyz API（無料・APIキー不要）
// =============================================

import axios from 'axios';

const BASE_URL = 'https://api.rugcheck.xyz/v1';
const REQUEST_TIMEOUT = 8000;

// スコア閾値（0〜1000、高いほど危険）
const MAX_SAFE_SCORE = 500;

// これらのリスクが "danger" レベルで検出されたら即拒否
const CRITICAL_RISK_NAMES = [
  'Freeze Authority still enabled',   // ミント凍結権限あり
  'Mint Authority still enabled',      // ミント増刷権限あり
  'Copycat token',                     // コピーキャット
  'High holder concentration',         // 上位ホルダー集中
  'Low liquidity',                     // 流動性不足
  'Honeypot',                          // ハニーポット
  'Rugged',                            // 過去にラグ済み
];

export interface RugCheckResult {
  safe: boolean;
  score: number;           // 0-1000（低いほど安全）
  risks: RugRisk[];
  rejectReason?: string;
}

export interface RugRisk {
  name: string;
  level: 'info' | 'warn' | 'danger';
  description: string;
  score: number;
}

export class RugChecker {
  private cache: Map<string, { result: RugCheckResult; ts: number }> = new Map();
  private CACHE_TTL_MS = 10 * 60 * 1000; // 10分キャッシュ

  /**
   * トークンのラグリスクを検査
   * @param tokenAddress - トークンのmintアドレス
   */
  async check(tokenAddress: string): Promise<RugCheckResult> {
    // キャッシュ確認
    const cached = this.cache.get(tokenAddress);
    if (cached && Date.now() - cached.ts < this.CACHE_TTL_MS) {
      return cached.result;
    }

    try {
      const res = await axios.get(
        `${BASE_URL}/tokens/${tokenAddress}/report/summary`,
        { timeout: REQUEST_TIMEOUT }
      );

      const data = res.data;
      const score: number = data.score ?? 999;
      const risks: RugRisk[] = (data.risks ?? []).map((r: any) => ({
        name:        r.name        ?? 'Unknown',
        level:       r.level       ?? 'info',
        description: r.description ?? '',
        score:       r.score       ?? 0,
      }));

      // 危険リスクをチェック
      const dangerRisks = risks.filter(r => r.level === 'danger');
      const criticalHit = dangerRisks.find(r =>
        CRITICAL_RISK_NAMES.some(name =>
          r.name.toLowerCase().includes(name.toLowerCase())
        )
      );

      let safe = true;
      let rejectReason: string | undefined;

      if (score > MAX_SAFE_SCORE) {
        safe = false;
        rejectReason = `リスクスコアが高すぎる (${score}/1000)`;
      } else if (criticalHit) {
        safe = false;
        rejectReason = `危険なリスク検出: "${criticalHit.name}"`;
      } else if (dangerRisks.length >= 2) {
        safe = false;
        rejectReason = `dangerリスクが${dangerRisks.length}件あり`;
      }

      const result: RugCheckResult = { safe, score, risks, rejectReason };
      this.cache.set(tokenAddress, { result, ts: Date.now() });
      return result;

    } catch (err: any) {
      // APIエラー時はwarnだけ出して通過（ボットを止めない）
      console.warn(`  ⚠️ RugCheck API エラー (${tokenAddress.slice(0, 8)}...): ${err.message}`);
      // 取得できない場合は「不明・通過」とする（スキャナーの流動性チェックで最低限のフィルタはかかっている）
      return {
        safe: true,
        score: -1,
        risks: [],
        rejectReason: undefined,
      };
    }
  }

  /** スコアのラベル */
  label(score: number): string {
    if (score < 0)    return '⚪ 不明';
    if (score < 200)  return '🟢 安全';
    if (score < 400)  return '🟡 やや注意';
    if (score < 600)  return '🟠 注意';
    return '🔴 危険';
  }
}
