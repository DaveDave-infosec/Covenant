import { useEffect, useState } from "react";
import CovenantStrip, {
  type StripCheckpoint,
  type StripSettlement,
  type Tier,
} from "./CovenantStrip";
import {
  scanOnChainRecord,
  getMonitorCheckpoint,
  type RecordEntry,
} from "../lib/covenant";
import {
  MONITOR_CONTRACT_ADDRESS,
  VAULT_CONTRACT_ADDRESS,
} from "../lib/constants";

interface CheckpointDetail {
  tier: string;
  reasoning: string;
  minority: string;
  checks: { label: string; value: string }[];
}

interface EntryDetails {
  checkpoints: StripCheckpoint[];
  details: CheckpointDetail[];
}

interface OnChainRecordProps {
  account: string | null;
  onLoad: (monitorId: string, vaultId: string) => void;
}

type Filter = "all" | "yours";

export default function OnChainRecord({ account, onLoad }: OnChainRecordProps) {
  const [entries, setEntries] = useState<RecordEntry[]>([]);
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsCache, setDetailsCache] = useState<Record<string, EntryDetails>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      const final = await scanOnChainRecord((partial) => setEntries(partial));
      setEntries(final);
    } catch (e: any) {
      setError(e?.message ?? "Could not read the on-chain record.");
    } finally {
      setScanning(false);
    }
  }

  useEffect(() => {
    scan();
  }, []);

  const acct = (account ?? "").toLowerCase();

  function roleOf(entry: RecordEntry): "provider" | "customer" | "both" | null {
    if (!acct) return null;
    const p = (entry.vault.provider || "").toLowerCase() === acct;
    const c = (entry.vault.customer || "").toLowerCase() === acct;
    if (p && c) return "both";
    if (p) return "provider";
    if (c) return "customer";
    return null;
  }

  const yoursCount = entries.filter((e) => roleOf(e) !== null).length;
  const showFilter = acct !== "" && yoursCount > 0;
  const effectiveFilter: Filter = showFilter ? filter : "all";
  const visible =
    effectiveFilter === "yours" ? entries.filter((e) => roleOf(e) !== null) : entries;

  const openEntries = visible.filter((e) => e.vault.status !== "settled");
  const settledEntries = visible.filter((e) => e.vault.status === "settled");

  async function toggleExpand(entry: RecordEntry) {
    const id = entry.vaultId;
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);

    if (detailsCache[id]) return;
    setDetailLoading(id);
    try {
      const loaded = await loadEntryDetails(entry);
      setDetailsCache((prev) => ({ ...prev, [id]: loaded }));
    } catch {
      setDetailsCache((prev) => ({ ...prev, [id]: { checkpoints: [], details: [] } }));
    } finally {
      setDetailLoading(null);
    }
  }

  async function loadEntryDetails(entry: RecordEntry): Promise<EntryDetails> {
    if (entry.monitor && entry.monitorId) {
      const n = Number(entry.monitor.checkpoint_count) || 0;
      const idx: number[] = [];
      for (let i = 0; i < n; i++) idx.push(i);
      const cps = await Promise.all(idx.map((i) => getMonitorCheckpoint(entry.monitorId!, i)));
      return {
        checkpoints: cps.map((cp) => ({ tier: normTier(cp.tier) })),
        details: cps.map((cp) => ({
          tier: cp.tier,
          reasoning: cp.reasoning,
          minority: cp.minority_note,
          checks: [
            { label: "usability", value: cp.usability },
            { label: "latency", value: cp.latency },
            { label: "schema", value: cp.schema },
            { label: "freshness", value: cp.freshness },
            { label: "functional", value: cp.functional },
            { label: "exception", value: cp.exception },
          ],
        })),
      };
    }
    // v2: every vault stores its monitor_id, so an unpaired entry is an
    // error case only — no vault-side tier fallback exists. Show nothing.
    return { checkpoints: [], details: [] };
  }

  function normTier(raw: string): Tier {
    const t = (raw || "").toLowerCase().trim();
    if (t === "satisfied" || t === "minor" || t === "material" || t === "critical") return t;
    return "material";
  }

  function fmt(v: string): string {
    const n = Number(v);
    return isNaN(n) ? v : n.toLocaleString();
  }

  function shortAddr(a: string): string {
    return a.slice(0, 8) + "…" + a.slice(-6);
  }

  function cpCountOf(entry: RecordEntry): string {
    return entry.monitor?.checkpoint_count ?? "0";
  }

  function settlementOf(entry: RecordEntry): StripSettlement | null {
    const s = entry.settlement;
    if (!s || (s.status !== "settled" && entry.vault.status !== "settled")) return null;
    return {
      outcome: normTier(s.outcome),
      provider: fmt(s.provider_net),
      customer: fmt(s.customer_total),
      bond: fmt(s.bond_to_provider),
    };
  }

  function statusChip(entry: RecordEntry) {
    const status = entry.vault.status || "created";
    if (status === "settled") {
      const tier = normTier(entry.vault.outcome);
      return <span className={"tier-chip tier-" + tier}>{tier}</span>;
    }
    return <span className={"rec-status rec-" + status}>{status}</span>;
  }

  function renderRow(entry: RecordEntry) {
    const open = expandedId === entry.vaultId;
    const role = roleOf(entry);
    const det = detailsCache[entry.vaultId];
    const isDetLoading = detailLoading === entry.vaultId;
    const settlement = settlementOf(entry);
    const serviceName = entry.monitor?.service_name || `Agreement #${entry.vaultId}`;

    return (
      <div key={entry.vaultId} className="rec-row">
        <button className="rec-head" onClick={() => toggleExpand(entry)} aria-expanded={open}>
          <span className="row" style={{ gap: 10, flexWrap: "wrap", minWidth: 0 }}>
            {statusChip(entry)}
            <span className="rec-name">{serviceName}</span>
            <span className="mono faint" style={{ fontSize: 11 }}>
              vault #{entry.vaultId}
              {entry.monitorId ? ` · monitor #${entry.monitorId}` : " · unpaired"}
            </span>
            {role && (
              <span className="rec-role">
                you · {role === "both" ? "both parties" : role}
              </span>
            )}
          </span>
          <span className="row" style={{ gap: 14, flexShrink: 0 }}>
            <span className="mono faint" style={{ fontSize: 11 }}>
              {fmt(entry.vault.payment)} / {fmt(entry.vault.bond)}
            </span>
            <span className="mono faint" style={{ fontSize: 11 }}>
              cp {cpCountOf(entry)}
            </span>
            <span className="cp-chevron" style={{ transform: open ? "rotate(90deg)" : "none" }}>›</span>
          </span>
        </button>

        {open && (
          <div className="rec-body">
            <CovenantStrip
              serviceName={serviceName}
              caseId={entry.vaultId}
              payment={fmt(entry.vault.payment)}
              bondAmount={fmt(entry.vault.bond)}
              latencyMs={entry.monitor?.latency_ms || "0"}
              totalCheckpoints={Math.max(det?.checkpoints.length ?? 0, 1)}
              checkpoints={det?.checkpoints ?? []}
              activeIndex={null}
              settlement={settlement}
              bondLocked={entry.vault.bond_locked}
            />

            {isDetLoading && (
              <div className="mono faint" style={{ fontSize: 11, marginTop: 12 }}>
                loading checkpoint verdicts…
              </div>
            )}

            {det && det.details.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Validator reasoning · from consensus</div>
                {det.details.map((d, i) => (
                  <ReasoningDrawer key={i} detail={d} index={i} last={i === det.details.length - 1} />
                ))}
              </div>
            )}

            <div className="rec-foot">
              <div className="mono faint" style={{ fontSize: 11, lineHeight: 1.7 }}>
                vault <span className="addr">{shortAddr(VAULT_CONTRACT_ADDRESS)}</span> · get_agreement({entry.vaultId})
                {entry.monitorId && (
                  <>
                    <br />
                    monitor <span className="addr">{shortAddr(MONITOR_CONTRACT_ADDRESS)}</span> · get_agreement({entry.monitorId})
                  </>
                )}
              </div>
              {entry.monitorId ? (
                <button className="btn" onClick={() => onLoad(entry.monitorId!, entry.vaultId)}>
                  Load into console
                </button>
              ) : (
                <span className="mono faint" style={{ fontSize: 10.5 }}>
                  no monitor pair — read-only
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (error && entries.length === 0) {
    return (
      <div className="panel panel-pad" style={{ borderColor: "var(--rule)" }}>
        <div className="label" style={{ marginBottom: 8 }}>On-chain record unavailable</div>
        <div className="mono muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>{error}</div>
        <button className="btn" style={{ marginTop: 12 }} onClick={scan}>↻ Retry</button>
        <style>{RECORD_CSS}</style>
      </div>
    );
  }

  return (
    <div>
      <div className="row" style={{ gap: 10, marginBottom: 14, flexWrap: "wrap", justifyContent: "space-between" }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <span className="verified-badge">
            <span className="verified-dot" /> On-chain record
          </span>
          <span className="mono faint" style={{ fontSize: 11 }}>
            every agreement, read live from the contracts · not a replay
          </span>
          {scanning && (
            <span className="rec-scanning mono" style={{ fontSize: 11 }}>scanning…</span>
          )}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {showFilter && (
            <div className="rec-filter">
              <button
                className={"rec-filter-btn" + (effectiveFilter === "all" ? " active" : "")}
                onClick={() => setFilter("all")}
              >
                All ({entries.length})
              </button>
              <button
                className={"rec-filter-btn" + (effectiveFilter === "yours" ? " active" : "")}
                onClick={() => setFilter("yours")}
              >
                Yours ({yoursCount})
              </button>
            </div>
          )}
          <button className="btn" style={{ padding: "5px 10px", fontSize: 11 }} onClick={scan} disabled={scanning}>↻</button>
        </div>
      </div>

      {error && entries.length > 0 && (
        <div className="mono" style={{ fontSize: 11.5, color: "var(--critical-lit)", marginBottom: 10 }}>
          Partial read — {error}
        </div>
      )}

      {entries.length === 0 && scanning && (
        <div className="panel panel-pad center" style={{ padding: "32px 22px" }}>
          <div className="label" style={{ marginBottom: 8 }}>Reading the on-chain record…</div>
          <div className="mono faint" style={{ fontSize: 12 }}>
            rows appear as agreements load
          </div>
        </div>
      )}

      {entries.length === 0 && !scanning && !error && (
        <div className="panel panel-pad">
          <div className="mono muted" style={{ fontSize: 12.5 }}>No agreements on the contracts yet.</div>
        </div>
      )}

      {(openEntries.length > 0 || settledEntries.length > 0) && (
        <>
          {openEntries.length > 0 && (
            <div style={{ marginBottom: settledEntries.length > 0 ? 18 : 0 }}>
              <div className="rec-section-head">
                <span className="eyebrow">Open</span>
                <span className="mono faint" style={{ fontSize: 11 }}>
                  {openEntries.length} awaiting action or checkpoints
                </span>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                {openEntries.map((e) => renderRow(e))}
              </div>
            </div>
          )}

          {openEntries.length === 0 && effectiveFilter === "yours" && (
            <div className="panel panel-pad" style={{ marginBottom: settledEntries.length > 0 ? 18 : 0 }}>
              <div className="mono muted" style={{ fontSize: 12.5 }}>
                Nothing open for the connected wallet — all your agreements are settled.
              </div>
            </div>
          )}

          {settledEntries.length > 0 && (
            <div>
              <button
                className="rec-archive-toggle"
                onClick={() => setArchiveOpen(!archiveOpen)}
                aria-expanded={archiveOpen}
              >
                <span className="row" style={{ gap: 10 }}>
                  <span className="eyebrow">Settled</span>
                  <span className="mono faint" style={{ fontSize: 11 }}>
                    {settledEntries.length} archived · verdicts final
                  </span>
                </span>
                <span className="cp-chevron" style={{ transform: archiveOpen ? "rotate(90deg)" : "none" }}>›</span>
              </button>
              {archiveOpen && (
                <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                  {settledEntries.map((e) => renderRow(e))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <style>{RECORD_CSS}</style>
    </div>
  );
}

function ReasoningDrawer({ detail, index, last }: { detail: CheckpointDetail; index: number; last: boolean }) {
  const [open, setOpen] = useState(false);
  const d = detail;
  return (
    <div className="cp-detail" style={{ marginBottom: last ? 0 : 10 }}>
      <button className="cp-detail-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <span className={"tier-chip tier-" + d.tier}>{d.tier}</span>
          <span className="mono faint" style={{ fontSize: 11 }}>checkpoint {String(index + 1).padStart(2, "0")}</span>
        </span>
        <span className="cp-chevron" style={{ transform: open ? "rotate(90deg)" : "none" }}>›</span>
      </button>

      {open && (
        <div className="cp-detail-body">
          <div className="check-grid">
            {d.checks.map((c) => (
              <div key={c.label} className={"check-cell " + (c.value === "pass" ? "pass" : "fail")}>
                <span className="check-label">{c.label}</span>
                <span className="check-val">{c.value}</span>
              </div>
            ))}
          </div>

          <div className="reason-block">
            <div className="label" style={{ marginBottom: 6 }}>Reasoning</div>
            <p className="mono" style={{ fontSize: 12.5, lineHeight: 1.65, color: "var(--text)" }}>{d.reasoning}</p>
          </div>

          {d.minority && (
            <div className="reason-block" style={{ marginTop: 10 }}>
              <div className="label" style={{ marginBottom: 6 }}>Minority note</div>
              <p className="mono" style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text-dim)" }}>{d.minority}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const RECORD_CSS = `
.verified-badge{
  display:inline-flex;align-items:center;gap:7px;
  font-family:var(--font-mono);font-size:11px;letter-spacing:0.08em;text-transform:uppercase;
  color:var(--satisfied-lit);border:1px solid var(--rule);border-radius:999px;padding:5px 12px;
  background:rgba(78,154,117,0.08);
}
.verified-dot{width:7px;height:7px;border-radius:50%;background:var(--satisfied-lit);box-shadow:0 0 8px var(--satisfied-lit);}
.rec-scanning{color:var(--violet-lit);animation:recPulse 1.2s ease-in-out infinite;}
@keyframes recPulse{0%,100%{opacity:0.35;}50%{opacity:1;}}
.rec-section-head{
  display:flex;align-items:center;gap:12px;margin-bottom:8px;padding:0 2px;
}
.rec-archive-toggle{
  width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;
  background:none;border:1px dashed var(--rule);border-radius:6px;cursor:pointer;
  padding:10px 14px;transition:background .15s;text-align:left;
}
.rec-archive-toggle:hover{background:rgba(124,111,168,0.06);}
.rec-row{border:1px solid var(--rule);border-radius:6px;overflow:hidden;background:var(--surface-raise);}
.rec-head{
  width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;
  background:none;border:none;cursor:pointer;padding:12px 14px;
  transition:background .15s;text-align:left;
}
.rec-head:hover{background:rgba(124,111,168,0.06);}
.rec-name{font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px;}
.rec-role{
  font-family:var(--font-mono);font-size:9.5px;letter-spacing:0.08em;text-transform:uppercase;
  color:var(--violet-lit);border:1px solid var(--violet-dim);border-radius:999px;padding:3px 9px;
}
.rec-status{
  font-family:var(--font-mono);font-size:10px;letter-spacing:0.08em;text-transform:uppercase;
  border:1px solid var(--rule);border-radius:999px;padding:3px 10px;color:var(--text-dim);
}
.rec-created{color:var(--text-dim);}
.rec-active{color:var(--satisfied-lit);border-color:rgba(78,154,117,0.35);}
.rec-body{padding:14px;border-top:1px solid var(--rule);}
.rec-foot{
  margin-top:14px;padding:12px 14px;border:1px dashed var(--rule);border-radius:6px;
  display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
}
.rec-filter{display:inline-flex;border:1px solid var(--rule);border-radius:6px;overflow:hidden;}
.rec-filter-btn{
  background:none;border:none;cursor:pointer;padding:5px 12px;
  font-family:var(--font-mono);font-size:11px;color:var(--text-dim);
}
.rec-filter-btn.active{background:rgba(124,111,168,0.12);color:var(--violet-lit);}
.check-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;}
.check-cell{
  display:flex;align-items:center;justify-content:space-between;
  border:1px solid var(--rule);border-radius:4px;padding:7px 10px;
  font-family:var(--font-mono);font-size:11px;
}
.check-label{color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;font-size:9.5px;}
.check-val{font-size:11px;}
.check-cell.pass .check-val{color:var(--satisfied-lit);}
.check-cell.fail .check-val{color:var(--critical-lit);}
.check-cell.pass{border-color:rgba(78,154,117,0.3);}
.check-cell.fail{border-color:rgba(188,74,63,0.3);}
.reason-block{background:#10151A;border:1px solid var(--rule);border-radius:4px;padding:12px 14px;}
.cp-detail{border:1px solid var(--rule);border-radius:6px;overflow:hidden;background:var(--surface-raise);}
.cp-detail-head{
  width:100%;display:flex;align-items:center;justify-content:space-between;
  background:none;border:none;cursor:pointer;padding:12px 14px;
  transition:background .15s;
}
.cp-detail-head:hover{background:rgba(124,111,168,0.06);}
.cp-chevron{font-family:var(--font-mono);font-size:16px;color:var(--text-dim);transition:transform .2s var(--ease);line-height:1;}
.cp-detail-body{padding:0 14px 14px;}
.addr{color:var(--violet-lit);}
@media (max-width:640px){.check-grid{grid-template-columns:repeat(2,1fr);}.rec-name{max-width:160px;}}
`;
