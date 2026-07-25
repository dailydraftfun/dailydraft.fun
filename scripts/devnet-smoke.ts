import { createPrivateKey, sign as cryptoSign, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Connection, Keypair, Transaction } from '@solana/web3.js';

const apiUrl = (
  process.env.DAILYDRAFT_SMOKE_API_URL ?? 'https://dailydraft-api.vercel.app/v1'
).replace(/\/$/, '');
const rpcUrl = process.env.DAILYDRAFT_SMOKE_RPC_URL ?? 'https://api.devnet.solana.com';
const creatorPath = requiredEnvironment('DAILYDRAFT_SMOKE_CREATOR_KEYPAIR');
const opponentPath = requiredEnvironment('DAILYDRAFT_SMOKE_OPPONENT_KEYPAIR');
const existingDuelId = process.env.DAILYDRAFT_SMOKE_DUEL_ID?.trim();
const connection = new Connection(rpcUrl, 'confirmed');

const creator = await loadKeypair(creatorPath);
const opponent = await loadKeypair(opponentPath);
const creatorWallet = creator.publicKey.toBase58();
const opponentWallet = opponent.publicKey.toBase58();

console.log(JSON.stringify({ apiUrl, creatorWallet, opponentWallet, rpcUrl, stage: 'starting' }));

const [creatorToken, opponentToken] = await Promise.all([
  authenticate(creator),
  authenticate(opponent),
]);

let duel = existingDuelId
  ? await requestJson<Duel>(`/duels/${existingDuelId}`)
  : await requestJson<Duel>('/duels', {
      body: {
        creatorWallet,
        expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
        matchmakingMode: 'direct',
        opponentWallet,
        packId: 'pokemon_50',
      },
      idempotencyKey: uniqueKey('create'),
      method: 'POST',
      token: creatorToken,
    });
console.log(
  JSON.stringify({
    duelId: duel.id,
    stage: existingDuelId ? 'resumed' : 'created',
    status: duel.status,
  }),
);

if (duel.status === 'waiting') {
  duel = await requestJson<Duel>(`/duels/${duel.id}/join`, {
    body: { wallet: opponentWallet },
    idempotencyKey: uniqueKey('join'),
    method: 'POST',
    token: opponentToken,
  });
  console.log(JSON.stringify({ duelId: duel.id, stage: 'joined' }));
}

if (duel.status === 'matched') {
  await fundSide(duel.id, creator, creatorToken, 'creator', 'committing');
  duel = await requestJson<Duel>(`/duels/${duel.id}`);
}
if (duel.status === 'committing') {
  await fundSide(duel.id, opponent, opponentToken, 'opponent', 'funded');
  duel = await requestJson<Duel>(`/duels/${duel.id}`);
}

const openKey = uniqueKey('open');
let opened: Duel;
if (duel.status === 'settled') {
  opened = duel;
} else {
  assert(
    ['funded', 'opening', 'awaiting_assets', 'settling', 'refunding'].includes(duel.status),
    `Cannot resume duel from ${duel.status}`,
  );
  try {
    opened = await requestJson<Duel>(`/duels/${duel.id}/open-packs`, {
      body: {},
      idempotencyKey: openKey,
      method: 'POST',
      timeoutMs: 295_000,
      token: creatorToken,
    });
  } catch (error) {
    console.error(String(error));
    await Bun.sleep(5_000);
    const current = await requestJson<Duel>(`/duels/${duel.id}`);
    if (current.status === 'settled') {
      opened = current;
    } else {
      assert(current.status !== 'failed', 'Duel failed during opening');
      opened = await requestJson<Duel>(`/duels/${duel.id}/open-packs`, {
        body: {},
        idempotencyKey: openKey,
        method: 'POST',
        timeoutMs: 295_000,
        token: creatorToken,
      });
    }
  }
}
assert(opened.status === 'settled', `Expected settled duel, received ${opened.status}`);

const [receipt, socialCard] = await Promise.all([
  requestJson<PublicReceipt>(`/duels/${duel.id}/receipt`),
  requestJson<SocialCard>(`/duels/${duel.id}/social-card`),
]);
assert(receipt.duel.status === 'settled', 'Receipt duel is not settled');
assert(receipt.availability.complete, 'Receipt is incomplete');
assert(receipt.fees.finalizedSides === 2, 'Both funding sides are not finalized');
assert(receipt.cardActions.availability === 'available', 'Settled card actions are unavailable');
assert(receipt.cardActions.cards.length === 2, 'Receipt does not contain two cards');

const socialResponse = await fetch(socialCard.imageUrl, {
  signal: AbortSignal.timeout(30_000),
});
assert(socialResponse.ok, `Social image returned HTTP ${socialResponse.status}`);
assert(
  socialResponse.headers.get('content-type')?.startsWith('image/png') === true,
  'Social image is not PNG',
);
assert(
  socialResponse.headers.get('x-dailydraft-status') === 'settled',
  'Social image status header is not settled',
);

console.log(
  JSON.stringify({
    cards: receipt.cardActions.cards.map((card) => ({
      assetReference: card.assetReference,
      displayName: card.displayName,
      ownerWallet: card.owner.address,
    })),
    duelId: duel.id,
    imageUrl: socialCard.imageUrl,
    pageUrl: socialCard.pageUrl,
    stage: 'complete',
    status: opened.status,
    winnerWallet: opened.winnerWallet,
  }),
);

async function authenticate(wallet: Keypair): Promise<string> {
  const address = wallet.publicKey.toBase58();
  const challenge = await requestJson<WalletChallenge>('/auth/challenges', {
    body: { wallet: address },
    method: 'POST',
  });
  const privateKey = createPrivateKey({
    format: 'der',
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(wallet.secretKey.slice(0, 32)),
    ]),
    type: 'pkcs8',
  });
  const signature = cryptoSign(null, Buffer.from(challenge.message, 'utf8'), privateKey).toString(
    'base64',
  );
  const session = await requestJson<WalletSession>('/auth/sessions', {
    body: { challengeId: challenge.challengeId, signature, wallet: address },
    method: 'POST',
  });
  return session.token;
}

async function fundSide(
  duelId: string,
  wallet: Keypair,
  token: string,
  side: 'creator' | 'opponent',
  expectedStatus: Duel['status'],
): Promise<void> {
  const address = wallet.publicKey.toBase58();
  const prepared = await requestJson<PreparedTransaction>(`/duels/${duelId}/transactions`, {
    body: { action: 'fund', wallet: address },
    idempotencyKey: uniqueKey(`${side}-prepare`),
    method: 'POST',
    token,
  });
  const transaction = Transaction.from(Buffer.from(prepared.serializedTransactionBase64, 'base64'));
  transaction.partialSign(wallet);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    maxRetries: 5,
    preflightCommitment: 'confirmed',
    skipPreflight: false,
  });
  await requestJson(`/duels/${duelId}/transactions/${prepared.id}/submissions`, {
    body: { signature },
    idempotencyKey: uniqueKey(`${side}-submit`),
    method: 'POST',
    token,
  });
  await waitForFundingFinality(duelId, token, expectedStatus);
  console.log(JSON.stringify({ duelId, side, signature, stage: 'funded-side' }));
}

async function waitForFundingFinality(
  duelId: string,
  token: string,
  expectedStatus: Duel['status'],
): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const result = await requestJson<ReconciliationResult>(
      `/duels/${duelId}/transactions/reconciliation`,
      { body: {}, method: 'POST', token },
    );
    if (result.activeTransactionCount === 0 && result.duelStatus === expectedStatus) return;
    await Bun.sleep(2_000);
  }
  throw new Error(`Funding did not finalize into ${expectedStatus}`);
}

async function requestJson<T = unknown>(
  path: string,
  options: {
    body?: unknown;
    idempotencyKey?: string;
    method?: string;
    timeoutMs?: number;
    token?: string;
  } = {},
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    method: options.method ?? 'GET',
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} returned ${response.status}: ${text}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

async function loadKeypair(path: string): Promise<Keypair> {
  const bytes = JSON.parse(await readFile(path, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function uniqueKey(label: string): string {
  return `smoke-${label}-${randomUUID()}`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface WalletChallenge {
  challengeId: string;
  message: string;
}

interface WalletSession {
  token: string;
}

interface Duel {
  id: string;
  status:
    | 'waiting'
    | 'matched'
    | 'committing'
    | 'funded'
    | 'opening'
    | 'awaiting_assets'
    | 'settling'
    | 'settled'
    | 'failed';
  winnerWallet: string | null;
}

interface PreparedTransaction {
  id: string;
  serializedTransactionBase64: string;
}

interface ReconciliationResult {
  activeTransactionCount: number;
  duelStatus: Duel['status'];
}

interface SocialCard {
  imageUrl: string;
  pageUrl: string;
}

interface PublicReceipt {
  availability: { complete: boolean };
  cardActions: {
    availability: string;
    cards: Array<{
      assetReference: string;
      displayName: string;
      owner: { address: string };
    }>;
  };
  duel: { status: string };
  fees: { finalizedSides: number };
}
