// =============================================
// types.ts - 共通型定義
// =============================================

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  liquidityUsd: number;
  ageHours: number;
  price: number;
  volume24h: number;
  volume4h: number;
  volumeChange4h: number; // % change in 4h vs previous 4h
  priceChange4h: number;
  marketCap?: number;
}

export interface Signal {
  token: TokenInfo;
  hasMomentum: boolean;       // 直近4h強い買い出来高
  hasBreakout: boolean;       // レジスタンス突破
  sentimentScore: number;     // 0-100 (LunarCrush)
  signalStrength: number;     // 総合スコア 0-100
  detectedAt: Date;
}

export interface Position {
  id: string;
  tokenAddress: string;
  tokenSymbol: string;
  entryPrice: number;
  entryAmount: number;  // SOL amount invested
  tokenAmount: number;  // token quantity
  entryTime: Date;
  stopLoss: number;     // price
  takeProfit: number;   // price
  status: 'open' | 'closed';
  exitPrice?: number;
  exitTime?: Date;
  pnlSol?: number;
}

export interface RiskConfig {
  initialCapitalSol: number;        // 0.84
  maxPositionSizePct: number;       // 0.10 (10%)
  maxPositions: number;             // 3
  stopLossPct: number;              // 0.15 (15%)
  takeProfitPct: number;            // 0.30 (30%)
  portfolioStopLossSol: number;     // 0.34
}

export interface BotState {
  capitalSol: number;
  openPositions: Position[];
  closedPositions: Position[];
  totalPnlSol: number;
  isRunning: boolean;
  isStopped: boolean; // portfolio stop triggered
}
