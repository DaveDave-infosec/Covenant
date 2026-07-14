import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { getAddress } from "viem";
import { STUDIO_CHAIN_HEX } from "./constants";

// ------------------------------------------------------------------
// Read-only client at module level — no account needed for view methods.
// ------------------------------------------------------------------
export const publicClient: any = createClient({ chain: studionet } as any);

// ------------------------------------------------------------------
// Write-client factory — genlayer-js 1.x requires the account at
// createClient time (never per-call). One client per connected account.
// ------------------------------------------------------------------
let cachedWriteClient: any = null;
let cachedAccount: string | null = null;

export function getWalletClient(account: string): any {
  // viem rejects lowercase addresses on writes with a misleading error —
  // normalize to EIP-55 checksum (proven fix from prior builds).
  const acct = getAddress(account);
  if (cachedWriteClient && cachedAccount === acct) {
    return cachedWriteClient;
  }
  cachedWriteClient = createClient({
    chain: studionet,
    account: acct as `0x${string}`,
  } as any);
  cachedAccount = acct;
  return cachedWriteClient;
}

// ------------------------------------------------------------------
// EIP-6963 wallet discovery — find an injected provider even when
// multiple wallets are present. Falls back to window.ethereum.
// ------------------------------------------------------------------
function getInjectedProvider(): any {
  const eth = (window as any).ethereum;
  if (!eth) {
    throw new Error(
      "No wallet detected. Install a browser wallet (e.g. MetaMask) to continue."
    );
  }
  return eth;
}

// ------------------------------------------------------------------
// Connect wallet + ensure Studio network. Returns the lowercased address.
// ------------------------------------------------------------------
export async function connectWallet(): Promise<string> {
  const eth = getInjectedProvider();
  const accounts: string[] = await eth.request({
    method: "eth_requestAccounts",
  });
  if (!accounts || accounts.length === 0) {
    throw new Error("No account returned from wallet.");
  }
  await ensureStudioChain();
  return accounts[0].toLowerCase();
}

export async function getCurrentAccount(): Promise<string | null> {
  const eth = (window as any).ethereum;
  if (!eth) return null;
  try {
    const accounts: string[] = await eth.request({ method: "eth_accounts" });
    if (accounts && accounts.length > 0) return accounts[0].toLowerCase();
  } catch {
    // ignore
  }
  return null;
}

// Subscribe to wallet account changes. Returns an unsubscribe function.
export function onAccountChange(cb: (account: string | null) => void): () => void {
  const eth = (window as any).ethereum;
  if (!eth || !eth.on) return () => {};
  const handler = (accounts: string[]) => {
    if (accounts && accounts.length > 0) cb(accounts[0].toLowerCase());
    else cb(null);
  };
  eth.on("accountsChanged", handler);
  return () => {
    if (eth.removeListener) eth.removeListener("accountsChanged", handler);
  };
}

async function ensureStudioChain(): Promise<void> {
  const eth = getInjectedProvider();
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIO_CHAIN_HEX }],
    });
  } catch (err: any) {
    // 4902 = chain not added to the wallet yet.
    if (err && err.code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: STUDIO_CHAIN_HEX,
            chainName: "GenLayer Studio Network",
            nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
            rpcUrls: ["https://studio.genlayer.com/api"],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

// ------------------------------------------------------------------
// Read concurrency limiter — the Studio node has 8 execution slots
// shared by everyone. The record scan alone can fire 20+ parallel
// reads, which overflows the slots and surfaces as
// "Server busy: all 8 execution slots occupied". Cap our in-flight
// reads at 4 (headroom for writes and other users); queue the rest.
// ------------------------------------------------------------------
const MAX_CONCURRENT_READS = 4;
let activeReads = 0;
const readQueue: (() => void)[] = [];

function acquireReadSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (activeReads < MAX_CONCURRENT_READS) {
      activeReads++;
      resolve();
    } else {
      readQueue.push(() => {
        activeReads++;
        resolve();
      });
    }
  });
}

function releaseReadSlot(): void {
  activeReads--;
  const next = readQueue.shift();
  if (next) next();
}

// ------------------------------------------------------------------
// Read a view method through the limiter, with exponential backoff +
// jitter — a busy server gets progressively longer, de-synchronized
// waits instead of a flat 600ms retry burst that re-collides. The
// slot is released while backing off so waiting retries don't starve
// the queue.
// ------------------------------------------------------------------
const READ_ATTEMPTS = 6;
const BACKOFF_BASE_MS = 400;
const BACKOFF_CAP_MS = 5000;

export async function readContract(params: {
  address: string;
  functionName: string;
  args?: any[];
}): Promise<any> {
  const { address, functionName, args = [] } = params;
  let lastErr: any = null;
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
    await acquireReadSlot();
    try {
      const result = await publicClient.readContract({
        address: address as `0x${string}`,
        functionName,
        args,
      });
      return result;
    } catch (err) {
      lastErr = err;
    } finally {
      releaseReadSlot();
    }
    const backoff = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), BACKOFF_CAP_MS);
    const jitter = Math.random() * 250;
    await sleep(backoff + jitter);
  }
  throw lastErr;
}

// ------------------------------------------------------------------
// Write a method: send the tx, then poll the receipt until ACCEPTED.
// ------------------------------------------------------------------
export async function writeContract(params: {
  account: string;
  address: string;
  functionName: string;
  args?: any[];
}): Promise<any> {
  const { account, address, functionName, args = [] } = params;
  const wallet = getWalletClient(account);

  const txHash = await wallet.writeContract({
    address: address as `0x${string}`,
    functionName,
    args,
    value: 0n,
  } as any);

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    status: "ACCEPTED",
    retries: 40,
    interval: 3000,
  });

  return { txHash, receipt };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
