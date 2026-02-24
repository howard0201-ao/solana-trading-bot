// =============================================
// jupiter.ts - Jupiter API を使ったスワップ実行
// Jupiter v6 Quote + Swap API
// =============================================

import axios from 'axios';
import {
  Connection,
  Keypair,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

const JUPITER_BASE = 'https://quote-api.jup.ag/v6';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SLIPPAGE_BPS = 100; // 1% スリッページ

export interface SwapResult {
  success: boolean;
  txSignature?: string;
  error?: string;
  inputAmount: number;
  outputAmount: number;
}

export class JupiterTrader {
  constructor(
    private connection: Connection,
    private wallet: Keypair
  ) {}

  /**
   * SOL → トークン（買い）
   * @param tokenMint  - 購入トークンのmintアドレス
   * @param solAmount  - 投入SOL量
   */
  async buy(tokenMint: string, solAmount: number): Promise<SwapResult> {
    const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
    return this.swap(SOL_MINT, tokenMint, lamports);
  }

  /**
   * トークン → SOL（売り）
   * @param tokenMint    - 売却トークンのmintアドレス
   * @param tokenAmount  - 売却トークン量（最小単位）
   */
  async sell(tokenMint: string, tokenAmount: number): Promise<SwapResult> {
    return this.swap(tokenMint, SOL_MINT, tokenAmount);
  }

  private async swap(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<SwapResult> {
    try {
      // Step 1: Quoteを取得
      const quoteRes = await axios.get(`${JUPITER_BASE}/quote`, {
        params: {
          inputMint,
          outputMint,
          amount,
          slippageBps: SLIPPAGE_BPS,
          onlyDirectRoutes: false,
        },
        timeout: 10000,
      });

      const quote = quoteRes.data;
      if (!quote || quote.error) {
        return { success: false, error: quote?.error ?? 'Quoteエラー', inputAmount: amount, outputAmount: 0 };
      }

      // Step 2: スワップトランザクションを取得
      const swapRes = await axios.post(`${JUPITER_BASE}/swap`, {
        quoteResponse: quote,
        userPublicKey: this.wallet.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        computeUnitPriceMicroLamports: 'auto', // 優先手数料を自動設定
      }, { timeout: 15000 });

      const { swapTransaction } = swapRes.data;
      if (!swapTransaction) {
        return { success: false, error: 'スワップトランザクション取得失敗', inputAmount: amount, outputAmount: 0 };
      }

      // Step 3: トランザクションをデシリアライズして署名・送信
      const txBuf = Buffer.from(swapTransaction, 'base64');
      const tx = VersionedTransaction.deserialize(txBuf);
      tx.sign([this.wallet]);

      const signature = await this.connection.sendRawTransaction(
        tx.serialize(),
        { skipPreflight: false, maxRetries: 3 }
      );

      // Step 4: 確認待ち
      const confirmation = await this.connection.confirmTransaction(
        signature,
        'confirmed'
      );

      if (confirmation.value.err) {
        return {
          success: false,
          error: `トランザクション失敗: ${JSON.stringify(confirmation.value.err)}`,
          inputAmount: amount,
          outputAmount: 0,
          txSignature: signature,
        };
      }

      console.log(`✅ スワップ成功: https://solscan.io/tx/${signature}`);
      return {
        success: true,
        txSignature: signature,
        inputAmount: amount,
        outputAmount: parseInt(quote.outAmount ?? '0'),
      };

    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        inputAmount: amount,
        outputAmount: 0,
      };
    }
  }

  /**
   * 現在のSOL建て価格を取得
   */
  async getTokenPriceInSol(tokenMint: string): Promise<number | null> {
    try {
      const res = await axios.get(`${JUPITER_BASE}/quote`, {
        params: {
          inputMint: tokenMint,
          outputMint: SOL_MINT,
          amount: 1_000_000, // 1 token (6 decimals想定)
          slippageBps: 100,
        },
        timeout: 8000,
      });
      const outAmount = parseInt(res.data?.outAmount ?? '0');
      return outAmount / LAMPORTS_PER_SOL;
    } catch {
      return null;
    }
  }
}
