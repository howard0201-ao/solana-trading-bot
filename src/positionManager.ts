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

const STATE_FILE = path.join(__dirname, '..', 'state.json');

export class PositionManager {
  private state: BotState;

  constructor(
    private riskManager: RiskManager,
    private trader: JupiterTrader,
    private notifier: Notifier,
    private logger: Logger,
    initialCapital: number
  ) {
    this.state = this.loadState(initialCapital);
  }

  get currentState(): BotState {
    return this.state;
  }

  /**
   * エントリー（買い）
   */
  async enter(signal: Signal): Promise<Position | null> {
    const check = this.riskManager.canEnter(this.state);
    if (!check.allowed) {
      this.logger.warn(`エントリー不可: ${check.reason}`);
      return null;
    }

    const positionSizeSol = this.riskManager.calcPositionSize(this.state.capitalSol);
    if (positionSizeSol < 0.001) {
      this.logger.warn('ポジションサイズが小さすぎます');
      return null;
    }

    this.logger.info(`エントリー試行: ${signal.token.symbol} (${positionSizeSol.toFixed(4)} SOL)`);

    const result = await this.trader.buy(signal.token.address, positionSizeSol);

    if (!result.success) {
      this.logger.error(`買いエラー: ${result.error}`);
      await this.notifier.error(`買い注文失敗: ${signal.token.symbol}`, new Error(result.error ?? ''));
      return null;
    }

    const entryPrice = signal.token.price;
    const position: Position = {
      id: uuidv4(),
      tokenAddress: signal.token.address,
      tokenSymbol: signal.token.symbol,
      entryPrice,
      entryAmount: positionSizeSol,
      tokenAmount: result.outputAmount,
      entryTime: new Date(),
      stopLoss: this.riskManager.calcStopLoss(entryPrice),
      takeProfit: this.riskManager.calcTakeProfit(entryPrice),
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
      stop_loss: 'ストップロス',
      take_profit: 'テイクプロフィット',
      manual: '手動',
    };

    position.exitPrice = exitPrice;
    position.exitTime = new Date();
    position.pnlSol = pnlSol;
    position.status = 'closed';

    this.state.openPositions.splice(idx, 1);
    this.state.closedPositions.push(position);
    this.state.capitalSol += receivedSol;
    this.state.totalPnlSol += pnlSol;

    // ログ + 通知
    this.logger.logTrade({
      type: 'SELL',
      symbol: position.tokenSymbol,
      tokenAddress: position.tokenAddress,
      sizeSol: receivedSol,
      price: exitPrice,
      pnlSol,
      reason: reasonLabel[reason],
      txSignature: result.txSignature,
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
   * オープンポジションの価格チェックとSL/TP判定
   * 10秒ごとに呼ばれる
   */
  async monitorPositions(): Promise<void> {
    for (const pos of [...this.state.openPositions]) {
      try {
        const currentPrice = await this.trader.getTokenPriceInSol(pos.tokenAddress);
        if (!currentPrice) continue;

        const action = this.riskManager.checkExit(pos, currentPrice);
        if (action === 'stop_loss') {
          this.logger.warn(`ストップロス発動: ${pos.tokenSymbol} @ $${currentPrice.toFixed(6)}`);
          await this.exit(pos.id, 'stop_loss');
        } else if (action === 'take_profit') {
          this.logger.info(`テイクプロフィット発動: ${pos.tokenSymbol} @ $${currentPrice.toFixed(6)}`);
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
        const raw = fs.readFileSync(STATE_FILE, 'utf-8');
        const loaded = JSON.parse(raw) as BotState;
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
