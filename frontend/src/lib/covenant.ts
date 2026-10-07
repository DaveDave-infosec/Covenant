import { readContract, writeContract } from "./genlayer";
import {
  MONITOR_CONTRACT_ADDRESS,
  VAULT_CONTRACT_ADDRESS,
} from "./constants";

export type Tier = "satisfied" | "minor" | "material" | "critical";

export interface MonitorAgreement {
  id: string;
  provider: string;
  customer: string;
  service_name: string;
  endpoint: string;
  latency_ms: string;
  required_fields: string;
  freshness_desc: string;
  function_desc: string;
  exception_desc: string;
  compared_fields: string;
  checkpoint_count: string;
  contested_count: string;
  uncontested_count: string;
}

// A checkpoint carries TWO independently reasoned readings of the same
// evidence. When their tiers differ the checkpoint is contested, and the
// divergence note says what they disagreed about.
export interface MonitorCheckpoint {
  tier: string;
  usability: string;
  latency: string;
  schema: string;
  freshness: string;
  functional: string;
  exception: string;
  strict_tier: string;
  strict_reasoning: string;
  lenient_tier: string;
  lenient_reasoning: string;
  contested: boolean;
  divergence_note: string;
}

export interface VaultAgreement {
  id: string;
  provider: string;
  customer: string;
  payment: string;
  bond: string;
  payment_locked: boolean;
  bond_locked: boolean;
  status: string;
  outcome: string;
  monitor_id: string;
  checkpoints_required: string;
  start_cp: string;
  start_uncontested: string;
  settled_cp_count: string;
  settled_contested: string;
}

export interface VaultSettlement {
  outcome: string;
  provider_net: string;
  customer_total: string;
  bond_to_provider: string;
  fee_charged: string;
  status: string;
  settled_contested: string;
}

// What the vault needs before it will settle, in one read.
export interface SettleProgress {
  uncontested: string;
  contested: string;
  required: string;
  ready: boolean;
}

// ================= READS =================

export async function getMonitorAgreement(agreementId: string): Promise<MonitorAgreement> {
  return (await readContract({
    address: MONITOR_CONTRACT_ADDRESS,
    functionName: "get_agreement",
    args: [agreementId],
  })) as MonitorAgreement;
}

export async function getMonitorCheckpoint(agreementId: string, index: number): Promise<MonitorCheckpoint> {
  return (await readContract({
    address: MONITOR_CONTRACT_ADDRESS,
    functionName: "get_checkpoint",
    args: [agreementId, index],
  })) as MonitorCheckpoint;
}

export async function getMonitorCheckpointCount(agreementId: string): Promise<number> {
  const n = await readContract({
    address: MONITOR_CONTRACT_ADDRESS,
    functionName: "get_checkpoint_count",
    args: [agreementId],
  });
  return Number(n);
}

export async function getMonitorCheckpointTier(agreementId: string, index: number): Promise<string> {
  const t = await readContract({
    address: MONITOR_CONTRACT_ADDRESS,
    functionName: "get_checkpoint_tier",
    args: [agreementId, index],
  });
  return String(t ?? "");
}

export async function isCheckpointContested(agreementId: string, index: number): Promise<boolean> {
  const c = await readContract({
    address: MONITOR_CONTRACT_ADDRESS,
    functionName: "is_checkpoint_contested",
    args: [agreementId, index],
  });
  return Boolean(c);
}

export async function getUncontestedCount(agreementId: string): Promise<number> {
  const n = await readContract({
    address: MONITOR_CONTRACT_ADDRESS,
    functionName: "get_uncontested_count",
    args: [agreementId],
  });
  return Number(n);
}

export async function getContestedCount(agreementId: string): Promise<number> {
  const n = await readContract({
    address: MONITOR_CONTRACT_ADDRESS,
    functionName: "get_contested_count",
    args: [agreementId],
  });
  return Number(n);
}

export async function getMonitorAgreementCount(): Promise<number> {
  const n = await readContract({
    address: MONITOR_CONTRACT_ADDRESS,
    functionName: "get_agreement_count",
    args: [],
  });
  return Number(n);
}

export async function getVaultAgreementCount(): Promise<number> {
  const n = await readContract({
    address: VAULT_CONTRACT_ADDRESS,
    functionName: "get_agreement_count",
    args: [],
  });
  return Number(n);
}

export async function getVaultAgreement(agreementId: string): Promise<VaultAgreement> {
  return (await readContract({
    address: VAULT_CONTRACT_ADDRESS,
    functionName: "get_agreement",
    args: [agreementId],
  })) as VaultAgreement;
}

export async function getVaultSettlement(agreementId: string): Promise<VaultSettlement> {
  return (await readContract({
    address: VAULT_CONTRACT_ADDRESS,
    functionName: "get_settlement",
    args: [agreementId],
  })) as VaultSettlement;
}

// The contested gate, in one call: how much uncontested evidence exists,
// how much was contested, how much is required, and whether settle is open.
export async function getSettleProgress(agreementId: string): Promise<SettleProgress> {
  return (await readContract({
    address: VAULT_CONTRACT_ADDRESS,
    functionName: "get_settle_progress",
    args: [agreementId],
  })) as SettleProgress;
}

export async function getBalance(account: string): Promise<string> {
  const b = await readContract({
    address: VAULT_CONTRACT_ADDRESS,
    functionName: "balance_of",
    args: [account],
  });
  return String(b);
}

// ================= ON-CHAIN RECORD SCAN =================
//
// The vault stores its monitor_id on-chain, so pairing is exact. Each vault
// agreement names its monitor directly; we fetch that monitor by id.
//
// SETTLED-ENTRY CACHE: a settled agreement is immutable by contract law, so
// once read it is cached in localStorage and never fetched again. The cache
// key embeds both contract addresses, so a redeploy auto-invalidates it. A
// scan costs one count plus only the unsettled or uncached vaults and their
// monitors, and gets cheaper as more agreements settle.

export interface RecordEntry {
  vaultId: string;
  monitorId: string | null;
  vault: VaultAgreement;
  monitor: MonitorAgreement | null;
  settlement: VaultSettlement | null;
  progress: SettleProgress | null;
}

const CACHE_KEY =
  "covenant_record_v3_" + VAULT_CONTRACT_ADDRESS + "_" + MONITOR_CONTRACT_ADDRESS;

interface RecordCache {
  version: number;
  entries: Record<string, RecordEntry>;
}

function loadCache(): RecordCache {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return { version: 3, entries: {} };
    const parsed = JSON.parse(raw) as RecordCache;
    if (!parsed || parsed.version !== 3 || typeof parsed.entries !== "object") {
      return { version: 3, entries: {} };
    }
    return parsed;
  } catch {
    return { version: 3, entries: {} };
  }
}

function saveCache(cache: RecordCache): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // storage full or unavailable — the cache is an optimization, never load-bearing
  }
}

export function clearRecordCache(): void {
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

// onPartial (optional) is called with a newest-first snapshot as entries
// become available — cached settled entries arrive first, before any network
// read completes. The returned promise resolves with the complete final list.
export async function scanOnChainRecord(
  onPartial?: (entries: RecordEntry[]) => void
): Promise<RecordEntry[]> {
  const cache = loadCache();

  const vCount = await getVaultAgreementCount();

  const byVaultId: Record<string, RecordEntry> = {};
  const toFetch: string[] = [];

  for (let i = 1; i <= vCount; i++) {
    const id = String(i);
    const cached = cache.entries[id];
    if (cached && cached.vault && cached.vault.status === "settled") {
      byVaultId[id] = cached;
    } else {
      toFetch.push(id);
    }
  }

  const emit = () => {
    if (onPartial) onPartial(snapshot(byVaultId, vCount));
  };
  emit(); // cached settled entries arrive before any network read resolves

  const fetchedVaults = await Promise.all(toFetch.map((id) => getVaultAgreement(id)));

  const monitorIds = fetchedVaults.map((v) => (v.monitor_id || "").trim());
  const monitors = await Promise.all(
    monitorIds.map((mid) =>
      mid ? getMonitorAgreement(mid).catch(() => null) : Promise.resolve(null)
    )
  );

  // an open agreement needs its settle progress so the record can show
  // whether it is waiting on uncontested evidence
  const progresses = await Promise.all(
    fetchedVaults.map((v) =>
      v.status === "active"
        ? getSettleProgress(v.id).catch(() => null)
        : Promise.resolve(null)
    )
  );

  for (let i = 0; i < fetchedVaults.length; i++) {
    const v = fetchedVaults[i];
    const mid = monitorIds[i];
    byVaultId[v.id] = {
      vaultId: v.id,
      monitorId: mid || null,
      vault: v,
      monitor: monitors[i],
      settlement: null,
      progress: progresses[i],
    };
    emit();
  }

  const newlySettled = fetchedVaults.filter((v) => v.status === "settled");
  const settlements = await Promise.all(
    newlySettled.map((v) => getVaultSettlement(v.id))
  );
  for (let i = 0; i < newlySettled.length; i++) {
    const entry = byVaultId[newlySettled[i].id];
    entry.settlement = settlements[i];
    cache.entries[entry.vaultId] = entry;
  }
  if (newlySettled.length > 0) saveCache(cache);
  emit();

  return snapshot(byVaultId, vCount);
}

function snapshot(byVaultId: Record<string, RecordEntry>, vCount: number): RecordEntry[] {
  const out: RecordEntry[] = [];
  for (let i = vCount; i >= 1; i--) {
    const e = byVaultId[String(i)];
    if (e) out.push(e);
  }
  return out;
}

// ================= WRITES =================

export interface CreateAgreementParams {
  provider: string;
  customer: string;
  serviceName: string;
  endpoint: string;
  latencyMs: number;
  requiredFields: string;
  freshnessDesc: string;
  functionDesc: string;
  exceptionDesc: string;
  comparedFields: string;
  payment: number;
  bond: number;
  checkpointsRequired: number;
}

export async function createMonitorAgreement(account: string, p: CreateAgreementParams): Promise<string> {
  await writeContract({
    account,
    address: MONITOR_CONTRACT_ADDRESS,
    functionName: "create_agreement",
    args: [
      p.provider,
      p.customer,
      p.serviceName,
      p.endpoint,
      p.latencyMs,
      p.requiredFields,
      p.freshnessDesc,
      p.functionDesc,
      p.exceptionDesc,
      p.comparedFields,
    ],
  });
  const count = await getMonitorAgreementCount();
  return String(count);
}

// The vault create takes the monitor_id it binds to plus the agreed
// checkpoints_required. The contract verifies the parties against that
// monitor agreement cross-contract, so the monitor must be created first.
export async function createVaultAgreement(
  account: string,
  p: CreateAgreementParams,
  monitorId: string
): Promise<string> {
  await writeContract({
    account,
    address: VAULT_CONTRACT_ADDRESS,
    functionName: "create_agreement",
    args: [p.provider, p.customer, p.payment, p.bond, monitorId, p.checkpointsRequired],
  });
  const count = await getVaultAgreementCount();
  return String(count);
}

export async function mint(account: string, toAddress: string, amount: number): Promise<any> {
  return writeContract({
    account,
    address: VAULT_CONTRACT_ADDRESS,
    functionName: "mint",
    args: [toAddress, amount],
  });
}

export async function lockPayment(account: string, agreementId: string): Promise<any> {
  return writeContract({
    account,
    address: VAULT_CONTRACT_ADDRESS,
    functionName: "lock_payment",
    args: [agreementId],
  });
}

export async function lockBond(account: string, agreementId: string): Promise<any> {
  return writeContract({
    account,
    address: VAULT_CONTRACT_ADDRESS,
    functionName: "lock_bond",
    args: [agreementId],
  });
}

// Settle is permissionless and reads verdicts from the monitor itself. It
// reverts unless enough UNCONTESTED checkpoints have run since activation.
export async function settleVault(account: string, agreementId: string): Promise<any> {
  return writeContract({
    account,
    address: VAULT_CONTRACT_ADDRESS,
    functionName: "settle",
    args: [agreementId],
  });
}

// What a finished checkpoint produced: the tier of record, and whether the
// two readings disagreed.
export interface CheckpointResult {
  tier: string;
  contested: boolean;
  strictTier: string;
  lenientTier: string;
  divergenceNote: string;
}

// A checkpoint is a single monitor call. The vault reads the tiers at settle
// time, so there is nothing to record back.
export async function runCheckpoint(
  account: string,
  monitorAgreementId: string
): Promise<CheckpointResult> {
  await writeContract({
    account,
    address: MONITOR_CONTRACT_ADDRESS,
    functionName: "run_checkpoint",
    args: [monitorAgreementId],
  });
  const count = await getMonitorCheckpointCount(monitorAgreementId);
  const latest = await getMonitorCheckpoint(monitorAgreementId, count - 1);
  return {
    tier: normalizeTier(latest.tier),
    contested: Boolean(latest.contested),
    strictTier: normalizeTier(latest.strict_tier),
    lenientTier: normalizeTier(latest.lenient_tier),
    divergenceNote: latest.divergence_note || "",
  };
}

function normalizeTier(raw: string): string {
  const t = (raw || "").toLowerCase().trim();
  if (t === "satisfied" || t === "minor" || t === "material" || t === "critical") {
    return t;
  }
  return "material";
}
