// =============================================
// wallet.ts - ウォレット管理
// =============================================

import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';

dotenv.config();

export class WalletManager {
  private keypair: Keypair;
  private connection: Connection;

  constructor() {
    const privateKeyStr = process.env.WALLET_PRIVATE_KEY;
    if (!privateKeyStr) {
      throw new Error('WALLET_PRIVATE_KEY が .env に設定されていません');
    }

    const secretKey = bs58.decode(privateKeyStr);
    this.keypair = Keypair.fromSecretKey(secretKey);

    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');

    console.log(`✅ ウォレット読み込み完了: ${this.keypair.publicKey.toBase58()}`);
  }

  get publicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  get signer(): Keypair {
    return this.keypair;
  }

  get conn(): Connection {
    return this.connection;
  }

  async getBalanceSol(): Promise<number> {
    const lamports = await this.connection.getBalance(this.keypair.publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  async logBalance(): Promise<void> {
    const balance = await this.getBalanceSol();
    console.log(`💰 残高: ${balance.toFixed(4)} SOL`);
  }
}
