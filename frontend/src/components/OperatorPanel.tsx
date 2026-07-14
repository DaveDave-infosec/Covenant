import { useState } from "react";
import {
  createMonitorAgreement,
  createVaultAgreement,
  mint,
  lockPayment,
  lockBond,
  runCheckpoint,
  settleVault,
  getVaultSettlement,
  type CreateAgreementParams,
} from "../lib/covenant";

interface OperatorPanelProps {
  account: string;
  onAgreementCreated: (monitorId: string, vaultId: string, params: CreateAgreementParams) => void;
  onCheckpointRecorded: (tier: string) => void;
  onSettled: (outcome: string, provider: string, customer: string, bond: string) => void;
  onLocked: (which: "payment" | "bond") => void;
  onReattach: (monitorId: string, vaultId: string) => void;
  monitorId: string | null;
  vaultId: string | null;
  bondLocked: boolean;
  paymentLocked: boolean;
  hasCheckpoint: boolean;
  settleReady?: boolean;
  settled?: boolean;
}

type Busy =
  | null
  | "create"
  | "mint-provider"
  | "mint-customer"
  | "lock-payment"
  | "lock-bond"
  | "checkpoint"
  | "settle"
  | "refresh";

const DEFAULTS: CreateAgreementParams = {
  provider: "",
  customer: "",
  serviceName: "GitHub Repo API — service agreement",
  endpoint: "https://api.github.com/repos/genlayerlabs/genlayer-node",
  latencyMs: 5000,
  requiredFields: "name,id,full_name,updated_at",
  freshnessDesc:
    "The updated_at field should be a valid recent ISO timestamp reflecting repository activity.",
  functionDesc:
    "Return structured JSON metadata about the repository including its name, id, and last update time.",
  exceptionDesc:
    "Scheduled maintenance windows are excused. Customer exceeding rate limits is the customer's responsibility.",
  comparedFields: "full_name",
  payment: 5000,
  bond: 1000,
  checkpointsRequired: 1,
};

export default function OperatorPanel(props: OperatorPanelProps) {
  const { account, monitorId, vaultId, bondLocked, paymentLocked, hasCheckpoint } = props;
  const settled = props.settled ?? false;
  // settleReady comes from App (contract-truthful: checkpoints run >= required).
  // Fall back to hasCheckpoint only if App hasn't supplied it yet.
  const settleReady = props.settleReady ?? hasCheckpoint;
  const [form, setForm] = useState<CreateAgreementParams>({
    ...DEFAULTS,
    provider: account,
    customer: account,
  });
  const [busy, setBusy] = useState<Busy>(null);
  const [log, setLog] = useState<string[]>([]);
  const [reMonitor, setReMonitor] = useState("");
  const [reVault, setReVault] = useState("");

  function pushLog(line: string) {
    setLog((prev) => [line, ...prev].slice(0, 8));
  }

  function set<K extends keyof CreateAgreementParams>(key: K, val: CreateAgreementParams[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function handleCreate() {
    setBusy("create");
    try {
      pushLog("Creating agreement on monitor (locking SLA terms)…");
      const mId = await createMonitorAgreement(account, form);
      pushLog(`Monitor agreement created · id ${mId}`);

      pushLog("Creating agreement on vault (binding monitor, verifying parties)…");
      const vId = await createVaultAgreement(account, form, mId);
      pushLog(`Vault agreement created · id ${vId}`);

      props.onAgreementCreated(mId, vId, form);
      pushLog("Agreement live. Fund and lock to activate.");
    } catch (e: any) {
      pushLog("Create failed: " + (e?.message ?? String(e)));
    } finally {
      setBusy(null);
    }
  }

  async function handleMint(which: "provider" | "customer") {
    const key = which === "provider" ? "mint-provider" : "mint-customer";
    setBusy(key);
    try {
      const addr = which === "provider" ? form.provider : form.customer;
      const amount = which === "provider" ? form.bond : form.payment;
      pushLog(`Minting ${amount} to ${which}…`);
      await mint(account, addr, amount);
      pushLog(`Minted ${amount} to ${which}.`);
    } catch (e: any) {
      pushLog("Mint failed: " + (e?.message ?? String(e)));
    } finally {
      setBusy(null);
    }
  }

  async function handleLock(which: "payment" | "bond") {
    if (!vaultId) return;
    setBusy(which === "payment" ? "lock-payment" : "lock-bond");
    try {
      pushLog(`Locking ${which}…`);
      if (which === "payment") await lockPayment(account, vaultId);
      else await lockBond(account, vaultId);
      pushLog(`${which} locked.`);
      props.onLocked(which);
    } catch (e: any) {
      pushLog(`Lock ${which} failed: ` + (e?.message ?? String(e)));
    } finally {
      setBusy(null);
    }
  }

  async function handleCheckpoint() {
    if (!monitorId) return;
    setBusy("checkpoint");
    try {
      pushLog("Running checkpoint — fetching live endpoint, judging six checks…");
      const tier = await runCheckpoint(account, monitorId);
      pushLog(`Checkpoint recorded · verdict: ${tier}`);
      props.onCheckpointRecorded(tier);
    } catch (e: any) {
      pushLog("Checkpoint failed: " + (e?.message ?? String(e)));
    } finally {
      setBusy(null);
    }
  }

  async function handleSettle() {
    if (!vaultId) return;
    setBusy("settle");
    try {
      pushLog("Settling — reading verdicts from monitor, distributing funds…");
      await settleVault(account, vaultId);

      // VERIFY the settle actually took. A rejected settle (e.g. the agreed
      // checkpoint count isn't met) still returns from the tx call, but the
      // agreement stays active with an empty outcome. Only declare settled if
      // the chain confirms it.
      const settlement = await getVaultSettlement(vaultId);
      const confirmed =
        settlement.status === "settled" && (settlement.outcome || "").trim() !== "";

      if (!confirmed) {
        pushLog(
          "Settle did not take — the agreement is still active. " +
            "The agreed checkpoint count may not be met yet. Run more checkpoints, then settle."
        );
        return;
      }

      const outcome = settlement.outcome;
      pushLog(`Settled · outcome: ${outcome}`);
      props.onSettled(
        outcome,
        settlement.provider_net,
        settlement.customer_total,
        settlement.bond_to_provider
      );
    } catch (e: any) {
      pushLog("Settle failed: " + (e?.message ?? String(e)));
    } finally {
      setBusy(null);
    }
  }

  async function handleRefresh() {
    if (!monitorId || !vaultId) return;
    setBusy("refresh");
    try {
      pushLog("Refreshing state from chain…");
      await props.onReattach(monitorId, vaultId);
      pushLog("State refreshed.");
    } catch (e: any) {
      pushLog("Refresh failed: " + (e?.message ?? String(e)));
    } finally {
      setBusy(null);
    }
  }

  const created = monitorId !== null && vaultId !== null;

  const bothLocked = bondLocked && paymentLocked;
  const runDisabled = busy !== null || !bothLocked || settled;
  const settleDisabled = busy !== null || !settleReady || settled;
  const fundingDisabled = busy !== null || settled;

  let gateHint = "";
  if (settled) {
    gateHint = "This agreement is settled — funds distributed, verdicts final. The console is read-only.";
  } else if (!bothLocked) {
    if (!bondLocked && !paymentLocked) gateHint = "Both parties must lock funds before a checkpoint can run.";
    else if (!bondLocked) gateHint = "Provider must lock the bond before a checkpoint can run.";
    else gateHint = "Customer must lock payment before a checkpoint can run.";
  } else if (!settleReady) {
    gateHint = "The agreed number of checkpoints must run before this agreement can settle.";
  }

  return (
    <div className="panel panel-pad" style={{ marginTop: 24 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 18 }}>
        <div className="eyebrow" style={{ color: "var(--violet)" }}>Operator console</div>
        <div className="row" style={{ gap: 10 }}>
          <span className="faint mono" style={{ fontSize: 10 }}>
            {settled && created ? "settled · read-only" : "create · fund · checkpoint · settle"}
          </span>
          {created && (
            <button
              className="btn"
              style={{ padding: "4px 10px", fontSize: 11 }}
              onClick={handleRefresh}
              disabled={busy !== null}
              title="Re-read locks, checkpoints, and status from the contracts"
            >
              {busy === "refresh" ? "Refreshing…" : "↻ Refresh state"}
            </button>
          )}
        </div>
      </div>

      {!created && (
        <div style={{ marginBottom: 20, paddingBottom: 18, borderBottom: "1px solid var(--rule)" }}>
          <div className="label" style={{ marginBottom: 8 }}>Resume an existing agreement</div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ maxWidth: 140 }}
              placeholder="monitor id"
              value={reMonitor}
              onChange={(e) => setReMonitor(e.target.value.trim())}
            />
            <input
              className="input"
              style={{ maxWidth: 140 }}
              placeholder="vault id"
              value={reVault}
              onChange={(e) => setReVault(e.target.value.trim())}
            />
            <button
              className="btn"
              onClick={() => {
                if (reMonitor && reVault) props.onReattach(reMonitor, reVault);
              }}
              disabled={!reMonitor || !reVault}
            >
              Load
            </button>
          </div>
        </div>
      )}

      {!created && (
        <>
          <div className="field">
            <label className="label">Service name</label>
            <input className="input" value={form.serviceName} onChange={(e) => set("serviceName", e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Monitored endpoint</label>
            <input className="input" value={form.endpoint} onChange={(e) => set("endpoint", e.target.value)} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div className="field">
              <label className="label">Required fields (comma-sep)</label>
              <input className="input" value={form.requiredFields} onChange={(e) => set("requiredFields", e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Compared field (strict-eq)</label>
              <input className="input" value={form.comparedFields} onChange={(e) => set("comparedFields", e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label className="label">Freshness rule</label>
            <textarea className="textarea" value={form.freshnessDesc} onChange={(e) => set("freshnessDesc", e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Core function</label>
            <textarea className="textarea" value={form.functionDesc} onChange={(e) => set("functionDesc", e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Agreed exceptions</label>
            <textarea className="textarea" value={form.exceptionDesc} onChange={(e) => set("exceptionDesc", e.target.value)} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
            <div className="field">
              <label className="label">Latency max (ms)</label>
              <input className="input" type="number" value={form.latencyMs} onChange={(e) => set("latencyMs", Number(e.target.value))} />
            </div>
            <div className="field">
              <label className="label">Payment</label>
              <input className="input" type="number" value={form.payment} onChange={(e) => set("payment", Number(e.target.value))} />
            </div>
            <div className="field">
              <label className="label">Bond</label>
              <input className="input" type="number" value={form.bond} onChange={(e) => set("bond", Number(e.target.value))} />
            </div>
            <div className="field">
              <label className="label">Checkpoints req.</label>
              <input className="input" type="number" min={1} value={form.checkpointsRequired} onChange={(e) => set("checkpointsRequired", Math.max(1, Number(e.target.value)))} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div className="field">
              <label className="label">Provider address</label>
              <input className="input" value={form.provider} onChange={(e) => set("provider", e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Customer address</label>
              <input className="input" value={form.customer} onChange={(e) => set("customer", e.target.value)} />
            </div>
          </div>

          <button className="btn btn-primary" onClick={handleCreate} disabled={busy === "create"} style={{ marginTop: 4 }}>
            {busy === "create" ? "Creating…" : "Create agreement on both contracts"}
          </button>
        </>
      )}

      {created && (
        <>
          <div className="mono" style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 16 }}>
            monitor #{monitorId} · vault #{vaultId}
            {settled && (
              <span style={{ color: "var(--violet-lit)", marginLeft: 10 }}>· settled</span>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <button className="btn" onClick={() => handleMint("provider")} disabled={fundingDisabled}>
              {busy === "mint-provider" ? "Minting…" : "Mint bond → provider"}
            </button>
            <button className="btn" onClick={() => handleMint("customer")} disabled={fundingDisabled}>
              {busy === "mint-customer" ? "Minting…" : "Mint payment → customer"}
            </button>
            <button className="btn" onClick={() => handleLock("payment")} disabled={fundingDisabled || paymentLocked}>
              {paymentLocked ? "Payment locked ✓" : busy === "lock-payment" ? "Locking…" : "Lock payment (customer)"}
            </button>
            <button className="btn" onClick={() => handleLock("bond")} disabled={fundingDisabled || bondLocked}>
              {bondLocked ? "Bond locked ✓" : busy === "lock-bond" ? "Locking…" : "Lock bond (provider)"}
            </button>
          </div>

          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn-primary" onClick={handleCheckpoint} disabled={runDisabled}>
              {busy === "checkpoint" ? "Measuring…" : "▶ Run checkpoint"}
            </button>
            <button className="btn" onClick={handleSettle} disabled={settleDisabled}>
              {busy === "settle" ? "Settling…" : settled ? "Settled ✓" : "Settle agreement"}
            </button>
          </div>

          {gateHint && (
            <div className="faint mono" style={{ fontSize: 11, marginTop: 10 }}>
              {gateHint}
            </div>
          )}
        </>
      )}

      {log.length > 0 && (
        <div style={{ marginTop: 18, borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
          <div className="label" style={{ marginBottom: 8 }}>Activity</div>
          <div className="stack" style={{ gap: 5 }}>
            {log.map((l, i) => (
              <div key={i} className="mono" style={{ fontSize: 11.5, color: i === 0 ? "var(--text)" : "var(--text-faint)" }}>
                {l}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
