import { useState, useEffect, useRef } from "react";
import "./styles/covenant.css";
import { connectWallet, getCurrentAccount, onAccountChange } from "./lib/genlayer";
import { OWNER_ADDRESS } from "./lib/constants";
import CovenantStrip, {
  type StripCheckpoint,
  type StripSettlement,
  type Tier,
} from "./components/CovenantStrip";
import OperatorPanel from "./components/OperatorPanel";
import PartyActions from "./components/PartyActions";
import OnChainRecord from "./components/OnChainRecord";
import HowItWorks from "./components/HowItWorks";
import {
  getVaultSettlement,
  getVaultAgreement,
  getMonitorAgreement,
  getMonitorCheckpointTier,
  type CreateAgreementParams,
} from "./lib/covenant";

type Tab = "agreements" | "how";

const DEMO_TIERS: Tier[] = ["satisfied", "satisfied", "minor", "material", "satisfied", "material"];

interface ActiveAgreement {
  monitorId: string;
  vaultId: string;
  params: CreateAgreementParams;
}

export default function App() {
  const [account, setAccount] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [tab, setTab] = useState<Tab>("agreements");
  const [error, setError] = useState<string | null>(null);

  const [agreement, setAgreement] = useState<ActiveAgreement | null>(null);
  const [checkpoints, setCheckpoints] = useState<StripCheckpoint[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [settlement, setSettlement] = useState<StripSettlement | null>(null);
  const [bondLocked, setBondLocked] = useState(false);
  const [paymentLocked, setPaymentLocked] = useState(false);
  const [agreementSettled, setAgreementSettled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // v2 gate: how many checkpoints this agreement requires, and the monitor
  // checkpoint index it started counting from. settleReady is derived from
  // these against the local checkpoint count — mirroring the contract's rule.
  const [checkpointsRequired, setCheckpointsRequired] = useState(1);
  const [startCp, setStartCp] = useState(0);

  const [reMonitor, setReMonitor] = useState("");
  const [reVault, setReVault] = useState("");

  const [demoRunning, setDemoRunning] = useState(false);
  const timers = useRef<number[]>([]);
  const stripRef = useRef<HTMLDivElement | null>(null);

  const isOwner = account !== null && account === OWNER_ADDRESS.toLowerCase();

  useEffect(() => {
    getCurrentAccount().then((acct) => {
      if (acct) setAccount(acct);
    });
    const unsub = onAccountChange((acct) => setAccount(acct));
    return () => {
      timers.current.forEach((t) => clearTimeout(t));
      unsub();
    };
  }, []);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      const acct = await connectWallet();
      setAccount(acct);
    } catch (e: any) {
      setError(e?.message ?? "Could not connect wallet.");
    } finally {
      setConnecting(false);
    }
  }

  function handleDisconnect() {
    setAccount(null);
    clearAgreement();
    setError(null);
  }

  function shortAddr(a: string): string {
    return a.slice(0, 6) + "…" + a.slice(-4);
  }

  function onAgreementCreated(monitorId: string, vaultId: string, params: CreateAgreementParams) {
    setAgreement({ monitorId, vaultId, params });
    setCheckpoints([]);
    setActiveIndex(null);
    setSettlement(null);
    setBondLocked(false);
    setPaymentLocked(false);
    setAgreementSettled(false);
    setCheckpointsRequired(params.checkpointsRequired || 1);
    setStartCp(0);
  }

  function onCheckpointRecorded(tier: string) {
    setActiveIndex(checkpoints.length);
    window.setTimeout(() => {
      setActiveIndex(null);
      setCheckpoints((prev) => [...prev, { tier: tier as Tier }]);
    }, 500);
  }

  function onLocked(which: "payment" | "bond") {
    if (which === "bond") setBondLocked(true);
    if (which === "payment") setPaymentLocked(true);
  }

  function normTier(raw: string): Tier {
    const t = (raw || "").toLowerCase().trim();
    if (t === "satisfied" || t === "minor" || t === "material" || t === "critical") return t;
    return "material";
  }

  async function onReattach(monitorId: string, vaultId: string, scrollToStrip: boolean = false) {
    setError(null);
    try {
      const v = await getVaultAgreement(vaultId);
      const m = await getMonitorAgreement(monitorId);
      setAgreement({
        monitorId,
        vaultId,
        params: {
          provider: v.provider,
          customer: v.customer,
          serviceName: m.service_name,
          endpoint: m.endpoint,
          latencyMs: Number(m.latency_ms),
          requiredFields: m.required_fields,
          freshnessDesc: m.freshness_desc,
          functionDesc: m.function_desc,
          exceptionDesc: m.exception_desc,
          comparedFields: m.compared_fields,
          payment: Number(v.payment),
          bond: Number(v.bond),
          checkpointsRequired: Number(v.checkpoints_required) || 1,
        },
      });
      setBondLocked(v.bond_locked);
      setPaymentLocked(v.payment_locked);
      setCheckpointsRequired(Number(v.checkpoints_required) || 1);
      setStartCp(Number(v.start_cp) || 0);

      // v2: checkpoint history lives on the MONITOR (vault stores no per-cp
      // tier). Read the monitor's checkpoint count + tiers so the strip shows
      // real history and the Settle gate knows how many have run.
      const cpCount = Number(m.checkpoint_count) || 0;
      const idx: number[] = [];
      for (let i = 0; i < cpCount; i++) idx.push(i);
      const tiers = await Promise.all(idx.map((i) => getMonitorCheckpointTier(monitorId, i)));
      setCheckpoints(tiers.map((t) => ({ tier: normTier(t) })));
      setActiveIndex(null);

      // settled state survives reloads — read it from the chain
      const isSettled = v.status === "settled";
      setAgreementSettled(isSettled);
      if (isSettled) {
        const s = await getVaultSettlement(vaultId);
        setSettlement({
          outcome: normTier(s.outcome),
          provider: formatNum(s.provider_net),
          customer: formatNum(s.customer_total),
          bond: formatNum(s.bond_to_provider),
        });
      } else {
        setSettlement(null);
      }

      if (scrollToStrip) {
        window.setTimeout(() => {
          stripRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 120);
      }
    } catch (e: any) {
      setError("Could not load agreement: " + (e?.message ?? String(e)));
    }
  }

  async function refreshLoadedAgreement() {
    if (!agreement || refreshing) return;
    setRefreshing(true);
    try {
      await onReattach(agreement.monitorId, agreement.vaultId);
    } finally {
      setRefreshing(false);
    }
  }

  async function onSettled(outcome: string, provider: string, customer: string, bond: string) {
    let p = provider, c = customer, b = bond;
    if ((!p || !c) && agreement) {
      try {
        const s = await getVaultSettlement(agreement.vaultId);
        p = s.provider_net; c = s.customer_total; b = s.bond_to_provider;
      } catch {
        // fall through
      }
    }
    setSettlement({
      outcome: (outcome || "material") as Tier,
      provider: formatNum(p),
      customer: formatNum(c),
      bond: formatNum(b),
    });
    setAgreementSettled(true);
  }

  function formatNum(v: string): string {
    if (!v) return "—";
    const n = Number(v);
    return isNaN(n) ? v : n.toLocaleString();
  }

  function runDemo() {
    if (demoRunning) return;
    setDemoRunning(true);
    setSettlement(null);
    setCheckpoints([]);
    setActiveIndex(null);
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];

    let delay = 300;
    const step = 900;
    DEMO_TIERS.forEach((tier, i) => {
      const t1 = window.setTimeout(() => setActiveIndex(i), delay);
      const t2 = window.setTimeout(() => {
        setActiveIndex(null);
        setCheckpoints((prev) => [...prev, { tier }]);
      }, delay + step - 200);
      timers.current.push(t1, t2);
      delay += step;
    });
    const tEnd = window.setTimeout(() => {
      setSettlement({ outcome: "material", provider: "3,960", customer: "1,500", bond: "500" });
      setDemoRunning(false);
    }, delay + 300);
    timers.current.push(tEnd);
  }

  function resetView() {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    setCheckpoints([]);
    setActiveIndex(null);
    setSettlement(null);
    setDemoRunning(false);
  }

  function clearAgreement() {
    setAgreement(null);
    setCheckpoints([]);
    setActiveIndex(null);
    setSettlement(null);
    setBondLocked(false);
    setPaymentLocked(false);
    setAgreementSettled(false);
    setCheckpointsRequired(1);
    setStartCp(0);
    setReMonitor("");
    setReVault("");
  }

  const acctLower = account ? account.toLowerCase() : "";
  const storedProvider = agreement ? agreement.params.provider.toLowerCase() : "";
  const storedCustomer = agreement ? agreement.params.customer.toLowerCase() : "";
  const isProvider = agreement !== null && acctLower !== "" && acctLower === storedProvider;
  const isCustomer = agreement !== null && acctLower !== "" && acctLower === storedCustomer;
  const isParty = isProvider || isCustomer;

  // mirror the contract's settle gate: (checkpoints run since activation) >= required.
  // local checkpoints.length tracks monitor runs since load; startCp is the
  // monitor index at activation. For a freshly created/loaded active agreement
  // both align, so this equals the contract's n >= required.
  const checkpointsRunSinceStart = Math.max(0, checkpoints.length - startCp);
  const settleReady = checkpointsRunSinceStart >= checkpointsRequired;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">§</div>
          <div>
            <div className="brand-name">Covenant</div>
            <div className="brand-tag">Service promises that settle themselves</div>
          </div>
        </div>

        <div className="nav">
          <button className={"nav-link" + (tab === "agreements" ? " active" : "")} onClick={() => setTab("agreements")}>Agreements</button>
          <button className={"nav-link" + (tab === "how" ? " active" : "")} onClick={() => setTab("how")}>How it works</button>
          {account ? (
            <button
              className={"wallet-pill" + (isOwner ? " owner" : "")}
              onClick={handleDisconnect}
              title="Click to disconnect this wallet from the app"
              style={{ cursor: "pointer", border: "none", font: "inherit" }}
            >
              <span className="wallet-dot" />
              <span>{shortAddr(account)}</span>
              {isOwner && <span style={{ color: "var(--violet-lit)" }}>· operator</span>}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleConnect} disabled={connecting}>
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        {error && (
          <div className="panel panel-pad" style={{ marginBottom: 20, borderColor: "var(--critical)", color: "var(--critical-lit)" }}>
            <span className="mono" style={{ fontSize: 13 }}>{error}</span>
          </div>
        )}

        {tab === "agreements" ? (
          <section>
            <div className="eyebrow" style={{ marginBottom: 12 }}>Consensus-enforced settlement</div>
            <h1 style={{ marginBottom: 10 }}>Service-level agreements that settle themselves</h1>
            <p className="muted" style={{ maxWidth: 620, marginBottom: 32, fontSize: 15 }}>
              A provider locks a performance bond, a customer locks payment. Across sampled
              checkpoints, Covenant fetches the live service itself and GenLayer validators judge
              what was actually delivered. Consensus distributes payment, compensation, and bond by
              real measured performance.
            </p>

            <OnChainRecord account={account} onLoad={(m, v) => onReattach(m, v, true)} />

            <div style={{ margin: "36px 0 18px" }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Try it yourself</div>
              <p className="muted" style={{ fontSize: 14 }}>
                Replay the lifecycle below, or expand an agreement in the record above and load it
                to act on it.
              </p>
            </div>

            <div ref={stripRef} style={{ scrollMarginTop: 24 }}>
              <CovenantStrip
                serviceName={agreement?.params.serviceName ?? "Sample service agreement"}
                caseId={agreement?.vaultId ?? "—"}
                payment={agreement ? Number(agreement.params.payment).toLocaleString() : "5,000"}
                bondAmount={agreement ? Number(agreement.params.bond).toLocaleString() : "1,000"}
                latencyMs={agreement ? String(agreement.params.latencyMs) : "5000"}
                totalCheckpoints={agreement ? Math.max(checkpoints.length + (activeIndex !== null ? 1 : 0), 3) : DEMO_TIERS.length}
                checkpoints={checkpoints}
                activeIndex={activeIndex}
                settlement={settlement}
                bondLocked={bondLocked}
              />
            </div>

            {!agreement && (
              <div className="row" style={{ gap: 10, marginTop: 24 }}>
                <button className="btn btn-primary" onClick={runDemo} disabled={demoRunning}>
                  {demoRunning ? "Measuring…" : "▶ Run demo checkpoints"}
                </button>
                <button className="btn" onClick={resetView}>↺ Reset</button>
                <span className="faint mono" style={{ fontSize: 11, marginLeft: 6 }}>
                  Demo replay
                </span>
              </div>
            )}

            {account && !agreement && !isOwner && (
              <div className="panel panel-pad" style={{ marginTop: 24 }}>
                <div className="label" style={{ marginBottom: 8 }}>Load by ID (fallback)</div>
                <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                  <input
                    className="input"
                    style={{ maxWidth: 150 }}
                    placeholder="monitor id"
                    value={reMonitor}
                    onChange={(e) => setReMonitor(e.target.value.trim())}
                  />
                  <input
                    className="input"
                    style={{ maxWidth: 150 }}
                    placeholder="vault id"
                    value={reVault}
                    onChange={(e) => setReVault(e.target.value.trim())}
                  />
                  <button
                    className="btn"
                    onClick={() => { if (reMonitor && reVault) onReattach(reMonitor, reVault, true); }}
                    disabled={!reMonitor || !reVault}
                  >
                    Load
                  </button>
                </div>
                <div className="faint mono" style={{ fontSize: 11, marginTop: 8 }}>
                  Normally you won't need this — your agreements appear in the record above under "Yours".
                </div>
              </div>
            )}

            {agreement && account && (
              <div
                className="panel panel-pad"
                style={{
                  marginTop: 24,
                  borderColor: isParty ? "var(--satisfied)" : "var(--critical)",
                }}
              >
                <div className="label" style={{ marginBottom: 10 }}>
                  Party check {isParty ? "· you're on this agreement" : "· connected wallet is NOT a party"}
                </div>
                <div className="mono" style={{ fontSize: 12, lineHeight: 1.9 }}>
                  <div>
                    <span className="faint">connected&nbsp;&nbsp;</span>
                    {acctLower || "—"}
                  </div>
                  <div>
                    <span className="faint">provider&nbsp;&nbsp;&nbsp;</span>
                    {storedProvider || "—"}
                    <span style={{ color: isProvider ? "var(--satisfied-lit)" : "var(--faint)", marginLeft: 8 }}>
                      {isProvider ? "✓ match" : "·"}
                    </span>
                  </div>
                  <div>
                    <span className="faint">customer&nbsp;&nbsp;&nbsp;</span>
                    {storedCustomer || "—"}
                    <span style={{ color: isCustomer ? "var(--satisfied-lit)" : "var(--faint)", marginLeft: 8 }}>
                      {isCustomer ? "✓ match" : "·"}
                    </span>
                  </div>
                </div>
                {!isParty && (
                  <div className="faint mono" style={{ fontSize: 11, marginTop: 10 }}>
                    Lock controls appear only for the provider or customer stored on this agreement.
                    If your address should be one of these, the stored value differs — check the create form's customer field.
                  </div>
                )}
              </div>
            )}

            {agreement && isParty && !agreementSettled && (
              <PartyActions
                account={account!}
                vaultId={agreement.vaultId}
                provider={agreement.params.provider}
                customer={agreement.params.customer}
                paymentLocked={paymentLocked}
                bondLocked={bondLocked}
                onLocked={onLocked}
              />
            )}

            {isOwner && (
              <OperatorPanel
                account={account!}
                monitorId={agreement?.monitorId ?? null}
                vaultId={agreement?.vaultId ?? null}
                bondLocked={bondLocked}
                paymentLocked={paymentLocked}
                hasCheckpoint={checkpoints.length > 0 || activeIndex !== null}
                settleReady={settleReady}
                settled={agreementSettled}
                onAgreementCreated={onAgreementCreated}
                onCheckpointRecorded={onCheckpointRecorded}
                onSettled={onSettled}
                onLocked={onLocked}
                onReattach={onReattach}
              />
            )}

            {agreement && (
              <div className="row" style={{ marginTop: 18, gap: 10 }}>
                <button className="btn" onClick={refreshLoadedAgreement} disabled={refreshing}>
                  {refreshing ? "Refreshing…" : "↻ Refresh state"}
                </button>
                <button className="btn" onClick={clearAgreement}>
                  ↺ Clear loaded agreement
                </button>
              </div>
            )}
          </section>
        ) : (
          <HowItWorks />
        )}
      </main>

      <footer className="app-footer">
        <span>Covenant · GenLayer Studio Network · chain 61999</span>
        <span>Sampled checkpoint evaluation, not continuous monitoring</span>
      </footer>
    </div>
  );
}
