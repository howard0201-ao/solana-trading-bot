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
   * ポジションがストップロス/テイクプロフィットに達したか確認
   */
  checkExit(position: Position, currentPrice: number): 'stop_loss' | 'take_profit' | 'hold' {
    if (currentPrice <= position.stopLoss) return 'stop_loss';
    if (currentPrice >= position.takeProfit) return 'take_profit';
    return 'hold';
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
