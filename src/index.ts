// =============================================
// index.ts - Solana Momentum Trading Bot
// デーモンプロセスとして常時稼働
// =============================================

import dotenv from 'dotenv';
dotenv.config();

import { WalletManager } from './wallet';
import { TokenScanner } from './scanner';
import { SignalDetector } from './signals';
import { SentimentAnalyzer } from './sentiment';
import { JupiterTrader } from './jupiter';
import { RiskManager, DEFAULT_RISK_CONFIG } from './riskManager';
import { PositionManager } from './positionManager';
import { Notifier } from './notifier';
import { Logger } from './logger';

// ----- インターバル設定 -----
const POSITION_MONITOR_MS = 10_000;      // 10秒: ポジション監視 (SL/TP)
const MARKET_SCAN_MS = 20_000;           // 20秒: 市場スキャン
const SIGNAL_EVAL_MS = 30_000;           // 30秒: シグナル評価
const HEARTBEAT_MS = 5 * 60_000;         // 5分: ハートビートログ
const TOKEN_REFRESH_MS = 2 * 60_000;     // 2分: 条件トークンリフレッシュ

let cachedTokens: Awaited<ReturnType<TokenScanner['scanQualifyingTokens']>> = [];
let lastTokenRefresh = 0;

async function main() {
  const logger = new Logger();
  const notifier = new Notifier();

  logger.info('========================================');
  logger.info('🤖 Solana Momentum Trading Bot 起動中...');
  logger.info('========================================');

  // ---- 初期化 ----
  let wallet: WalletManager;
  try {
    wallet = new WalletManager();
  } catch (err: any) {
    logger.error(`ウォレット初期化失敗: ${err.message}`);
    await notifier.error('ウォレット初期化失敗', err);
    process.exit(1);
  }

  const balance = await wallet.getBalanceSol();
  logger.info(`ウォレット: ${wallet.publicKey.toBase58()}`);
  logger.info(`残高: ${balance.toFixed(4)} SOL`);

  const config = DEFAULT_RISK_CONFIG;
  const trader = new JupiterTrader(wallet.conn, wallet.signer);
  const riskManager = new RiskManager(config);
  const positionManager = new PositionManager(
    riskManager, trader, notifier, logger, config.initialCapitalSol
  );
  const scanner = new TokenScanner();
  const signalDetector = new SignalDetector();
  const sentiment = new SentimentAnalyzer();

  const state = positionManager.currentState;
  state.isRunning = true;
  positionManager.saveState();

  logger.info(`設定: 資金=${config.initialCapitalSol}SOL | ポジション上限=${config.maxPositions} | SL=${config.stopLossPct*100}% | TP=${config.takeProfitPct*100}%`);
  await notifier.botStarted(balance);

  // ----------------------------------------
  // 1. ポジション監視ループ（10秒ごと）
  // ----------------------------------------
  const monitorTimer = setInterval(async () => {
    if (state.isStopped) return;
    try {
      await positionManager.monitorPositions();
    } catch (err: any) {
      logger.error(`ポジション監視エラー: ${err.message}`);
    }
  }, POSITION_MONITOR_MS);

  // ----------------------------------------
  // 2. シグナル評価ループ（30秒ごと）
  // ----------------------------------------
  const signalTimer = setInterval(async () => {
    if (state.isStopped) return;

    // トークンキャッシュが古ければリフレッシュ
    if (Date.now() - lastTokenRefresh > TOKEN_REFRESH_MS) {
      try {
        cachedTokens = await scanner.scanQualifyingTokens();
        lastTokenRefresh = Date.now();
        logger.info(`トークンリフレッシュ: ${cachedTokens.length}件`);
      } catch (err: any) {
        logger.error(`スキャンエラー: ${err.message}`);
        return;
      }
    }

    if (cachedTokens.length === 0) return;

    // 上位5件のみシグナル評価（レート制限対策）
    for (const token of cachedTokens.slice(0, 5)) {
      const { allowed } = riskManager.canEnter(state);
      if (!allowed) break;

      try {
        const sentimentScore = await sentiment.getScore(token.symbol);
        const signal = await signalDetector.evaluate(token, sentimentScore);

        if (signalDetector.isEntrySignal(signal)) {
          logger.info(`🎯 シグナル: ${token.symbol} (スコア: ${signal.signalStrength})`);
          await positionManager.enter(signal);
        }
      } catch (err: any) {
        logger.error(`シグナル評価エラー (${token.symbol}): ${err.message}`);
      }
    }
  }, SIGNAL_EVAL_MS);

  // ----------------------------------------
  // 3. ハートビートログ（5分ごと）
  // ----------------------------------------
  const heartbeatTimer = setInterval(async () => {
    logger.heartbeat(state.capitalSol, state.openPositions.length, state.totalPnlSol);

    // ポートフォリオストップのチェック
    if (riskManager.shouldStopPortfolio(state)) {
      state.isStopped = true;
      logger.error('ポートフォリオストップライン到達 — ボット停止');
      await notifier.portfolioStop(state.totalPnlSol);
      shutdown('ポートフォリオストップ');
    }
  }, HEARTBEAT_MS);

  // ----------------------------------------
  // 4. 市場トレンド記録（20秒ごとに価格変化を観察）
  // ----------------------------------------
  let trendCounter = 0;
  const marketTimer = setInterval(async () => {
    if (state.isStopped || cachedTokens.length === 0) return;
    trendCounter++;

    // 10分ごとに市場観察をtrading.mdに記録
    if (trendCounter % 30 === 0) {
      const topTokens = cachedTokens.slice(0, 3)
        .map(t => `${t.symbol}: $${t.price.toFixed(6)} (4h: ${t.priceChange4h > 0 ? '+' : ''}${t.priceChange4h.toFixed(1)}%)`);
      logger.logMarketInsight(`トップ候補:\n${topTokens.map(t => `- ${t}`).join('\n')}`);
    }
  }, MARKET_SCAN_MS);

  // ----------------------------------------
  // Graceful Shutdown
  // ----------------------------------------
  function shutdown(reason: string) {
    logger.info(`シャットダウン: ${reason}`);
    clearInterval(monitorTimer);
    clearInterval(signalTimer);
    clearInterval(heartbeatTimer);
    clearInterval(marketTimer);
    state.isRunning = false;
    positionManager.saveState();
    riskManager.logSummary(state);
    notifier.botStopped(reason).finally(() => process.exit(0));
  }

  process.on('SIGINT',  () => shutdown('SIGINT（手動停止）'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 回復不能エラー以外はプロセスを落とさない
  process.on('uncaughtException', async (err) => {
    logger.error(`未捕捉エラー: ${err.message}\n${err.stack}`);
    await notifier.error('未捕捉例外', err);
    // PM2が再起動するのでexitしない（エラーが連続しない限り）
  });

  process.on('unhandledRejection', async (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error(`未処理のPromise拒否: ${err.message}`);
    await notifier.error('unhandledRejection', err);
  });

  logger.info('✅ 全ループ起動完了 — 稼働中');
}

main().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
