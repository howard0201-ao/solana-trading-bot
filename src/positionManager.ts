// =============================================
// positionManager.ts - ポジション管理
// =============================================

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Position, BotState, Signal } from './types';
import { RiskManager } from './riskManager';
import { JupiterTrader } from './jupiter';
import { Notifier } from './notifier';
import { Logger } from './logger';
import { RugChecker } from './rugcheck';

const STATE_FILE = path.join(__dirname, '..', 'state.json');

export class PositionManager {
  private state: BotState;
  private rugChecker: RugChecker;

  constructor(
    private riskManager: RiskManager,
    private trader: JupiterTrader,
    private notifier: Notifier,
    private logger: Logger,
    initialCapital: number
  ) {
    this.state = this.loadState(initialCapital);
    this.rugChecker = new RugChecker();
  }

  get currentState(): BotState {
    return this.state;
  }

  /**
   * エントリー（買い）
   * ラグチェック → リスクチェック → 発注
   */
  async enter(signal: Signal): Promise<Position | null> {
    // ① リスク管理チェック
    const check = this.riskManager.canEnter(this.state);
    if (!check.allowed) {
      this.logger.warn(`エントリー不可: ${check.reason}`);
      return null;
    }

    // ② ラグチェック（エントリー前の安全確認）
    this.logger.info(`ラグチェック中: ${signal.token.symbol}`);
    const rug = await this.rugChecker.check(signal.token.address);
    const rugLabel = this.rugChecker.label(rug.score);

    if (!rug.safe) {
      this.logger.warn(`ラグチェック拒否: ${signal.token.symbol} — ${rug.rejectReason} (${rugLabel})`);
      await this.notifier.send(
        `🚫 *ラグチェック拒否: ${signal.token.symbol}*\n理由: ${rug.rejectReason}\nスコア: ${rug.score}/1000`,
        'warning'
      );
      return null;
    }

    this.logger.info(`ラグチェック通過: ${signal.token.symbol} — スコア ${rug.score}/1000 (${rugLabel})`);

    // ③ ポジションサイズ計算
    const positionSizeSol = this.riskManager.calcPositionSize(this.state.capitalSol);
    if (positionSizeSol < 0.001) {
      this.logger.warn('ポジションサイズが小さすぎます');
      return null;
    }

    this.logger.info(`エントリー試行: ${signal.token.symbol} (${positionSizeSol.toFixed(4)} SOL)`);

    // ④ 発注
    const result = await this.trader.buy(signal.token.address, positionSizeSol);
    if (!result.success) {
      this.logger.error(`買いエラー: ${result.error}`);
      await this.notifier.error(`買い注文失敗: ${signal.token.symbol}`, new Error(result.error ?? ''));
      return null;
    }

    // ⑤ ポジション作成（highestPrice = entryPrice で初期化）
    const entryPrice = signal.token.price;
    const position: Position = {
      id: uuidv4(),
      tokenAddress: signal.token.address,
      tokenSymbol: signal.token.symbol,
      entryPrice,
      entryAmount: positionSizeSol,
      tokenAmount: result.outputAmount,
      entryTime: new Date(),
      stopLoss:     this.riskManager.calcStopLoss(entryPrice),
      takeProfit:   this.riskManager.calcTakeProfit(entryPrice),
      highestPrice: entryPrice,   // トレーリングSL起点
      status: 'open',
    };

    this.state.openPositions.push(position);
    this.state.capitalSol -= positionSizeSol;
    this.saveState();

    // ログ + 通知
    this.logger.logTrade({
      type: 'BUY',
      symbol: signal.token.symbol,
      tokenAddress: signal.token.address,
      sizeSol: positionSizeSol,
      price: entryPrice,
      txSignature: result.txSignature,
      signalStrength: signal.signalStrength,
      sentimentScore: signal.sentimentScore,
    });

    await this.notifier.tradeEntered(
      signal.token.symbol,
      positionSizeSol,
      entryPrice,
      position.stopLoss,
      position.takeProfit
    );

    return position;
  }

  /**
   * エグジット（売り）
   */
  async exit(positionId: string, reason: 'stop_loss' | 'take_profit' | 'manual'): Promise<void> {
    const idx = this.state.openPositions.findIndex(p => p.id === positionId);
    if (idx === -1) return;

    const position = this.state.openPositions[idx];
    this.logger.info(`エグジット試行: ${position.tokenSymbol} (${reason})`);

    const result = await this.trader.sell(position.tokenAddress, position.tokenAmount);

    const receivedSol = result.success
      ? result.outputAmount / 1e9
      : position.entryAmount * (1 - 0.15);

    const pnlSol = receivedSol - position.entryAmount;
    const exitPrice = result.success
      ? (receivedSol / position.tokenAmount) * 1e9
      : position.stopLoss;

    const reasonLabel: Record<string, string> = {
      stop_loss:   'トレーリングストップロス',
      take_profit: 'テイクプロフィット',
      manual:      '手動',
    };

    position.exitPrice = exitPrice;
    position.exitTime  = new Date();
    position.pnlSol    = pnlSol;
    position.status    = 'closed';

    this.state.openPositions.splice(idx, 1);
    this.state.closedPositions.push(position);
    this.state.capitalSol  += receivedSol;
    this.state.totalPnlSol += pnlSol;

    // ログ + 通知
    this.logger.logTrade({
      type: 'SELL',
      symbol:       position.tokenSymbol,
      tokenAddress: position.tokenAddress,
      sizeSol:      receivedSol,
      price:        exitPrice,
      pnlSol,
      reason:       reasonLabel[reason],
      txSignature:  result.txSignature,
    });

    await this.notifier.tradeExited(
      position.tokenSymbol,
      pnlSol,
      reasonLabel[reason],
      result.txSignature
    );

    // ポートフォリオストップチェック
    if (this.riskManager.shouldStopPortfolio(this.state)) {
      this.state.isStopped = true;
      this.logger.error('ポートフォリオストップライン到達');
      await this.notifier.portfolioStop(this.state.totalPnlSol);
    }

    this.saveState();
  }

  /**
   * オープンポジションの価格監視（10秒ごと）
   * トレーリングSL更新 → SL/TP判定
   */
  async monitorPositions(): Promise<void> {
    for (const pos of [...this.state.openPositions]) {
      try {
        const currentPrice = await this.trader.getTokenPriceInSol(pos.tokenAddress);
        if (!currentPrice) continue;

        // トレーリングSL更新
        const slUpdated = this.riskManager.updateTrailingStop(pos, currentPrice);
        if (slUpdated) {
          this.logger.info(
            `📈 トレーリングSL更新: ${pos.tokenSymbol} | 最高値=$${pos.highestPrice.toFixed(6)} → SL=$${pos.stopLoss.toFixed(6)}`
          );
          this.saveState(); // SL更新を永続化
        }

        // エグジット判定
        const action = this.riskManager.checkExit(pos, currentPrice);
        if (action === 'stop_loss') {
          const pct = ((currentPrice - pos.entryPrice) / pos.entryPrice * 100).toFixed(1);
          this.logger.warn(`🛑 トレーリングSL発動: ${pos.tokenSymbol} @ $${currentPrice.toFixed(6)} (${pct}%)`);
          await this.exit(pos.id, 'stop_loss');
        } else if (action === 'take_profit') {
          this.logger.info(`🎯 TP発動: ${pos.tokenSymbol} @ $${currentPrice.toFixed(6)}`);
          await this.exit(pos.id, 'take_profit');
        }

      } catch (err: any) {
        this.logger.error(`ポジション監視エラー (${pos.tokenSymbol}): ${err.message}`);
      }
    }
  }

  private loadState(initialCapital: number): BotState {
    if (fs.existsSync(STATE_FILE)) {
      try {
        const raw  = fs.readFileSync(STATE_FILE, 'utf-8');
        const loaded = JSON.parse(raw) as BotState;
        // 旧stateにhighestPriceがない場合の互換処理
        for (const pos of loaded.openPositions) {
          if (pos.highestPrice === undefined) {
            pos.highestPrice = pos.entryPrice;
          }
        }
        this.logger?.info(`既存ステート読み込み: ${loaded.openPositions.length}件のオープンポジション`);
        return loaded;
      } catch {
        // fallthrough
      }
    }
    return {
      capitalSol: initialCapital,
      openPositions: [],
      closedPositions: [],
      totalPnlSol: 0,
      isRunning: false,
      isStopped: false,
    };
  }

  saveState(): void {
    fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
  }
}
