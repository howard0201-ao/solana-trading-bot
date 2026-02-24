// =============================================
// riskManager.ts - リスク管理
// =============================================

import { RiskConfig, Position, BotState } from './types';

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  initialCapitalSol: 0.84,
  maxPositionSizePct: 0.10,   // 10%
  maxPositions: 3,
  stopLossPct: 0.15,           // -15%
  takeProfitPct: 0.30,         // +30%
  portfolioStopLossSol: 0.34,  // 0.34 SOL損失で全停止
};

export class RiskManager {
  constructor(private config: RiskConfig = DEFAULT_RISK_CONFIG) {}

  /**
   * 新規エントリーが可能かチェック
   */
  canEnter(state: BotState): { allowed: boolean; reason?: string } {
    if (state.isStopped) {
      return { allowed: false, reason: 'ポートフォリオストップライン到達' };
    }
    if (state.openPositions.length >= this.config.maxPositions) {
      return { allowed: false, reason: `同時ポジション上限 (${this.config.maxPositions}件)` };
    }
    if (state.totalPnlSol <= -this.config.portfolioStopLossSol) {
      return { allowed: false, reason: `ポートフォリオ損失が ${this.config.portfolioStopLossSol} SOL に達した` };
    }
    return { allowed: true };
  }

  /**
   * ポジションサイズを計算 (SOL)
   */
  calcPositionSize(currentCapital: number): number {
    const size = currentCapital * this.config.maxPositionSizePct;
    return Math.round(size * 10000) / 10000; // 小数点4桁
  }

  /**
   * ストップロス価格を計算
   */
  calcStopLoss(entryPrice: number): number {
    return entryPrice * (1 - this.config.stopLossPct);
  }

  /**
   * テイクプロフィット価格を計算
   */
  calcTakeProfit(entryPrice: number): number {
    return entryPrice * (1 + this.config.takeProfitPct);
  }

  /**
   * トレーリングSLを更新し、エグジット判定を返す
   *
   * ロジック:
   *   - 最高値を更新 → SL = highestPrice * (1 - stopLossPct) に引き上げ
   *   - 最高値が更新されなくても、SLは下がらない（ラチェット式）
   *   - 例: エントリー$1.00 → 最高値$1.20 → SL=$1.02（利益確保）
   *        その後$1.10に下落してもSLは$1.02のまま
   */
  checkExit(position: Position, currentPrice: number): 'stop_loss' | 'take_profit' | 'hold' {
    // テイクプロフィットは固定
    if (currentPrice >= position.takeProfit) return 'take_profit';

    // トレーリングSL判定
    if (currentPrice <= position.stopLoss) return 'stop_loss';

    return 'hold';
  }

  /**
   * トレーリングSLを更新（モニタリングループから毎回呼ぶ）
   * 最高値が更新された場合のみSLを引き上げる
   * @returns SLが更新された場合 true
   */
  updateTrailingStop(position: Position, currentPrice: number): boolean {
    if (currentPrice <= position.highestPrice) return false;

    // 最高値を更新
    position.highestPrice = currentPrice;

    // 新しいSL = 最高値 × (1 - stopLossPct)
    // ただしエントリー時の初期SLより下がることはない
    const trailingSL = currentPrice * (1 - this.config.stopLossPct);
    const initialSL  = position.entryPrice * (1 - this.config.stopLossPct);
    const newSL = Math.max(trailingSL, initialSL);

    if (newSL > position.stopLoss) {
      position.stopLoss = newSL;
      return true;
    }
    return false;
  }

  /**
   * ポートフォリオストップラインをチェック
   */
  shouldStopPortfolio(state: BotState): boolean {
    return state.totalPnlSol <= -this.config.portfolioStopLossSol;
  }

  /**
   * 現在の損益サマリーをログ出力
   */
  logSummary(state: BotState): void {
    const pnlStr = state.totalPnlSol >= 0
      ? `+${state.totalPnlSol.toFixed(4)}`
      : state.totalPnlSol.toFixed(4);

    console.log('\n📊 ===== ポートフォリオサマリー =====');
    console.log(`  資金残高:       ${state.capitalSol.toFixed(4)} SOL`);
    console.log(`  総損益:         ${pnlStr} SOL`);
    console.log(`  オープン:       ${state.openPositions.length} ポジション`);
    console.log(`  クローズ済み:   ${state.closedPositions.length} ポジション`);
    console.log(`  ストップ状態:   ${state.isStopped ? '⛔ 停止中' : '✅ 稼働中'}`);
    console.log('====================================\n');
  }
}
