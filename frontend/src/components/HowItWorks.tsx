export default function HowItWorks() {
  return (
    <section style={{ maxWidth: 760 }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>How it works</div>
      <h1 style={{ marginBottom: 14 }}>Sampled checkpoints, judged live, settled by consensus</h1>
      <p className="muted" style={{ fontSize: 15, lineHeight: 1.7, marginBottom: 36 }}>
        Covenant turns a service-level agreement into something that settles itself. Neither the
        provider nor the customer judges whether the service was delivered — Covenant fetches the
        live service at each checkpoint and GenLayer validators reach consensus on what they see.
        The settlement follows the recorded verdicts, not anyone's say-so.
      </p>

      <div className="hiw-step">
        <div className="hiw-num">01</div>
        <div>
          <h3>Both parties lock terms up front</h3>
          <p className="muted">
            The monitored endpoint, the six performance checks, exception windows, payment, and bond
            are all fixed on-chain at creation. Neither party can move the goalposts mid-agreement.
            The customer locks payment; the provider locks a performance bond.
          </p>
        </div>
      </div>

      <div className="hiw-step">
        <div className="hiw-num">02</div>
        <div>
          <h3>Each checkpoint fetches the live service</h3>
          <p className="muted">
            At each checkpoint, Covenant fetches the locked endpoint itself — it never trusts a
            screenshot or a "we were up" claim from either side. Validators independently judge six
            things in context: whether the response was usable, within latency, schema-intact, fresh,
            functionally working, and whether any agreed exception applies.
          </p>
        </div>
      </div>

      <div className="hiw-step">
        <div className="hiw-num">03</div>
        <div>
          <h3>Consensus produces one verdict per checkpoint</h3>
          <p className="muted">
            Validators reach agreement on a health tier — satisfied, minor, material, or critical —
            with recorded reasoning and a minority note. Each checkpoint is judged independently; the
            contract accumulates the sequence in on-chain storage.
          </p>
        </div>
      </div>

      <div className="hiw-step">
        <div className="hiw-num">04</div>
        <div>
          <h3>Settlement is a deterministic tally</h3>
          <p className="muted">
            When the agreement closes, the vault tallies the recorded verdicts with fixed arithmetic —
            no fresh judgment — and distributes payment, service credit, compensation, and bond
            accordingly. A healthy record pays the provider in full; a critical one refunds the
            customer and slashes the bond.
          </p>
        </div>
      </div>

      <h2 style={{ marginTop: 44, marginBottom: 18 }}>The four outcomes</h2>
      <div className="outcome-grid">
        <div className="outcome-card">
          <span className="tier-chip tier-satisfied">satisfied</span>
          <p className="muted">Provider paid in full, bond returned.</p>
        </div>
        <div className="outcome-card">
          <span className="tier-chip tier-minor">minor</span>
          <p className="muted">Provider paid reduced, customer credited, bond returned.</p>
        </div>
        <div className="outcome-card">
          <span className="tier-chip tier-material">material</span>
          <p className="muted">Provider reduced, customer compensated, part of the bond penalized.</p>
        </div>
        <div className="outcome-card">
          <span className="tier-chip tier-critical">critical</span>
          <p className="muted">Payment refunded, bond slashed to the customer, agreement terminated.</p>
        </div>
      </div>

      <h2 style={{ marginTop: 44, marginBottom: 18 }}>Honest limitations</h2>
      <div className="stack" style={{ gap: 14 }}>
        <div className="limit-card">
          <h3>Sampled, not continuous</h3>
          <p className="muted">
            Performance is measured by the checkpoints defined in the agreement, not by 24/7 global
            monitoring. Both parties agree up front that sampling at checkpoints is the measurement
            method — it's the contract, not a gap being papered over.
          </p>
        </div>

        <div className="limit-card">
          <h3>API service agreements only</h3>
          <p className="muted">
            V1 is scoped to API services, where the evidence is digital, fetchable, and structured.
            Other service types (RPC, oracles, indexers, storage gateways) are the V2 direction, on
            the same settlement engine.
          </p>
        </div>

        <div className="limit-card" style={{ borderColor: "var(--violet-dim)" }}>
          <h3>Settlement is owner-relayed in V1 — and here's exactly what that means</h3>
          <p className="muted">
            An operator triggers checkpoints and settlement. This is worth being precise about,
            because it's the one centralized step. What the operator <em>can</em> do: relay a
            checkpoint run and call settle. What the operator <em>cannot</em> do:
          </p>
          <ul className="limit-list">
            <li>choose an outcome — settlement is deterministic arithmetic over the recorded verdicts, so a critical record cannot be made to pay out as satisfied;</li>
            <li>rewrite or delete a verdict — checkpoints only append, and each verdict came from validator consensus, not the operator;</li>
            <li>touch locked funds arbitrarily — there is no withdraw or drain, only the settlement math, which conserves exactly;</li>
            <li>change the rules after deployment — the contracts are immutable, with no upgrade path.</li>
          </ul>
          <p className="muted" style={{ marginTop: 10 }}>
            So the operator relays consensus into settlement; it does not decide the result. Fully
            trustless, automatic settlement — removing even that relay — is the V2 target.
          </p>
        </div>
      </div>

      <style>{HIW_CSS}</style>
    </section>
  );
}

const HIW_CSS = `
.hiw-step{display:flex;gap:18px;margin-bottom:26px;}
.hiw-num{font-family:var(--font-mono);font-size:13px;color:var(--violet-lit);letter-spacing:0.1em;padding-top:2px;min-width:26px;}
.hiw-step h3{margin-bottom:6px;}
.hiw-step p{font-size:14px;line-height:1.65;}
.outcome-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;}
.outcome-card{border:1px solid var(--rule);border-radius:6px;padding:16px;background:var(--surface-raise);}
.outcome-card p{font-size:13px;margin-top:10px;line-height:1.55;}
.limit-card{border:1px solid var(--rule);border-radius:6px;padding:18px;background:var(--surface-raise);}
.limit-card h3{margin-bottom:8px;}
.limit-card p{font-size:14px;line-height:1.65;}
.limit-list{margin:10px 0 0;padding-left:18px;}
.limit-list li{font-size:13.5px;line-height:1.6;color:var(--text-dim);margin-bottom:6px;}
.limit-card em{color:var(--text-bright);font-style:normal;font-weight:500;}
@media (max-width:640px){.outcome-grid{grid-template-columns:1fr;}}
`;
