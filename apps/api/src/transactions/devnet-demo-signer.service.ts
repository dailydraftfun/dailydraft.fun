import { createHmac } from 'node:crypto';
import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  AuthorityType,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  type PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';

import {
  createDepositCardAssetInstruction,
  deriveEscrowV2CardVault,
  type EscrowV2Role,
} from '../contracts/openpacksduel-escrow-v2.js';

const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const DEFAULT_DEVNET_RPC_URL = 'https://api.devnet.solana.com';

export interface DepositedDemoCard {
  mint: PublicKey;
  openedAt: Date;
  signature: string | null;
  sourceTokenAccount: PublicKey;
  vault: PublicKey;
}

export interface PreparedSignedTransaction {
  expectedSigner: string;
  lastValidBlockHeight: string;
  recentBlockhash: string;
  serializedTransactionBase64: string;
}

@Injectable()
export class DevnetDemoSignerService {
  readonly #connection = new Connection(resolveRpcUrl(), 'finalized');

  get publicKey(): PublicKey {
    return this.signer().publicKey;
  }

  async assertReady(): Promise<void> {
    if (process.env.OPENPACKSDUEL_NETWORK !== 'solana-devnet') {
      throw new ServiceUnavailableException('The OpenPacks demo signer is devnet-only');
    }
    if ((await this.#connection.getGenesisHash()) !== DEVNET_GENESIS_HASH) {
      throw new ServiceUnavailableException('Configured Solana RPC is not devnet');
    }
    const configured = process.env.ESCROW_PROVIDER_SIGNER?.trim();
    if (!configured || configured !== this.publicKey.toBase58()) {
      throw new ServiceUnavailableException(
        'Devnet provider keypair does not match ESCROW_PROVIDER_SIGNER',
      );
    }
  }

  demoMint(providerReference: string): PublicKey {
    return this.demoMintKeypair(providerReference).publicKey;
  }

  referenceMac(payload: string): string {
    return createHmac('sha256', this.signer().secretKey)
      .update(`openpacksduel-demo-reference:v1:${payload}`)
      .digest('hex');
  }

  async ensureCardDeposited(input: {
    duel: PublicKey;
    providerReference: string;
    role: EscrowV2Role;
  }): Promise<DepositedDemoCard> {
    await this.assertReady();
    const signer = this.signer();
    const mintSigner = this.demoMintKeypair(input.providerReference);
    const mint = mintSigner.publicKey;
    const sourceTokenAccount = getAssociatedTokenAddressSync(mint, signer.publicKey);
    const vault = deriveEscrowV2CardVault(input.duel, input.role);

    if (await this.accountExists(vault)) {
      await this.assertVault(vault, input.duel, mint);
      return {
        mint,
        openedAt: await this.resolveOpenedAt(mint),
        signature: null,
        sourceTokenAccount,
        vault,
      };
    }

    const instructions: TransactionInstruction[] = [];
    const additionalSigners: Keypair[] = [];
    if (await this.accountExists(mint)) {
      await this.assertCanonicalMint(mint);
      const source = await getAccount(this.#connection, sourceTokenAccount, 'finalized');
      if (
        !source.owner.equals(signer.publicKey) ||
        !source.mint.equals(mint) ||
        source.amount !== 1n
      ) {
        throw new ConflictException('Existing demo mint is not held by the provider signer');
      }
    } else {
      const rent = await this.#connection.getMinimumBalanceForRentExemption(MINT_SIZE, 'finalized');
      instructions.push(
        SystemProgram.createAccount({
          fromPubkey: signer.publicKey,
          lamports: rent,
          newAccountPubkey: mint,
          programId: TOKEN_PROGRAM_ID,
          space: MINT_SIZE,
        }),
        createInitializeMintInstruction(mint, 0, signer.publicKey, signer.publicKey),
        createAssociatedTokenAccountIdempotentInstruction(
          signer.publicKey,
          sourceTokenAccount,
          signer.publicKey,
          mint,
        ),
        createMintToInstruction(mint, sourceTokenAccount, signer.publicKey, 1),
        createSetAuthorityInstruction(mint, signer.publicKey, AuthorityType.MintTokens, null),
        createSetAuthorityInstruction(mint, signer.publicKey, AuthorityType.FreezeAccount, null),
      );
      additionalSigners.push(mintSigner);
    }

    instructions.push(
      createDepositCardAssetInstruction({
        cardMint: mint,
        depositor: signer.publicKey,
        depositorSource: sourceTokenAccount,
        duel: input.duel,
        role: input.role,
      }),
    );
    const signature = await this.send(instructions, additionalSigners);
    await this.assertCanonicalMint(mint);
    await this.assertVault(vault, input.duel, mint);
    return {
      mint,
      openedAt: await this.resolveOpenedAt(mint),
      signature,
      sourceTokenAccount,
      vault,
    };
  }

  async isCardDeposited(input: {
    duel: PublicKey;
    providerReference: string;
    role: EscrowV2Role;
  }): Promise<boolean> {
    const mint = this.demoMint(input.providerReference);
    const vault = deriveEscrowV2CardVault(input.duel, input.role);
    if (!(await this.accountExists(vault))) return false;
    await this.assertCanonicalMint(mint);
    await this.assertVault(vault, input.duel, mint);
    return true;
  }

  async signAndSendPrepared(input: PreparedSignedTransaction): Promise<string> {
    await this.assertReady();
    const signer = this.signer();
    if (input.expectedSigner !== signer.publicKey.toBase58()) {
      throw new ConflictException('Prepared transaction expects another signer');
    }
    const transaction = Transaction.from(Buffer.from(input.serializedTransactionBase64, 'base64'));
    transaction.partialSign(signer);
    const signature = await this.#connection.sendRawTransaction(transaction.serialize(), {
      maxRetries: 5,
      preflightCommitment: 'confirmed',
      skipPreflight: false,
    });
    const confirmation = await this.#connection.confirmTransaction(
      {
        blockhash: input.recentBlockhash,
        lastValidBlockHeight: Number(input.lastValidBlockHeight),
        signature,
      },
      'finalized',
    );
    if (confirmation.value.err) {
      throw new ServiceUnavailableException('Devnet provider transaction failed');
    }
    return signature;
  }

  private async send(
    instructions: TransactionInstruction[],
    additionalSigners: Keypair[],
  ): Promise<string> {
    const signer = this.signer();
    const latest = await this.#connection.getLatestBlockhash('finalized');
    const transaction = new Transaction({
      blockhash: latest.blockhash,
      feePayer: signer.publicKey,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }).add(...instructions);
    transaction.sign(signer, ...additionalSigners);
    const signature = await this.#connection.sendRawTransaction(transaction.serialize(), {
      maxRetries: 5,
      preflightCommitment: 'confirmed',
      skipPreflight: false,
    });
    const confirmation = await this.#connection.confirmTransaction(
      { ...latest, signature },
      'finalized',
    );
    if (confirmation.value.err) {
      throw new ServiceUnavailableException('Devnet card mint/deposit transaction failed');
    }
    return signature;
  }

  private async assertCanonicalMint(mint: PublicKey): Promise<void> {
    const account = await getMint(this.#connection, mint, 'finalized');
    if (
      account.decimals !== 0 ||
      account.supply !== 1n ||
      account.mintAuthority !== null ||
      account.freezeAuthority !== null
    ) {
      throw new ConflictException(
        'Demo card mint must have one token, zero decimals, and revoked authorities',
      );
    }
  }

  private async assertVault(vault: PublicKey, duel: PublicKey, mint: PublicKey): Promise<void> {
    const account = await getAccount(this.#connection, vault, 'finalized');
    if (!account.owner.equals(duel) || !account.mint.equals(mint) || account.amount !== 1n) {
      throw new ConflictException('Demo card is not held by the canonical escrow vault');
    }
  }

  private async accountExists(address: PublicKey): Promise<boolean> {
    return (await this.#connection.getAccountInfo(address, 'finalized')) !== null;
  }

  private async resolveOpenedAt(mint: PublicKey): Promise<Date> {
    const signatures = await this.#connection.getSignaturesForAddress(
      mint,
      { limit: 10 },
      'finalized',
    );
    const blockTimes = signatures.flatMap((signature) =>
      signature.blockTime == null ? [] : [signature.blockTime],
    );
    if (blockTimes.length === 0) {
      throw new ServiceUnavailableException('Devnet card creation time is unavailable');
    }
    return new Date(Math.min(...blockTimes) * 1_000);
  }

  private demoMintKeypair(providerReference: string): Keypair {
    const seed = createHmac('sha256', this.signer().secretKey)
      .update(`openpacksduel-demo-mint:v1:${providerReference}`)
      .digest()
      .subarray(0, 32);
    return Keypair.fromSeed(seed);
  }

  private signer(): Keypair {
    const value = process.env.OPENPACKSDUEL_DEVNET_PROVIDER_KEYPAIR_JSON?.trim();
    if (!value) {
      throw new ServiceUnavailableException('Devnet provider keypair is not configured');
    }
    try {
      const secret: unknown = JSON.parse(value);
      if (
        !Array.isArray(secret) ||
        secret.length !== 64 ||
        !secret.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
      ) {
        throw new Error('invalid secret');
      }
      return Keypair.fromSecretKey(Uint8Array.from(secret));
    } catch {
      throw new ServiceUnavailableException('Devnet provider keypair is invalid');
    }
  }
}

function resolveRpcUrl(): string {
  const value = process.env.SOLANA_RPC_URL?.trim() || DEFAULT_DEVNET_RPC_URL;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
    return url.toString();
  } catch {
    throw new ServiceUnavailableException('Configured Solana RPC URL is invalid');
  }
}
