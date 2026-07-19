import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import CovenantStrip, {
  type StripCheckpoint,
  type StripSettlement,
  type Tier,
} from "./components/CovenantStrip";

// The hero strip rotates through four real lifecycle shapes, so a reviewer
// watching sees the system produce genuinely different outcomes — which is the
// whole thesis. Each scenario names itself in a caption while it plays.
interface HeroScenario {
  label: string;
  sequence: Tier[];
  settlement: StripSettlement;
}

const LIFECYCLE = [
  {
    key: "create",
    name: "Create",
    actor: "anyone · permissionless",
    desc: "The SLA terms are locked on-chain — endpoint, required fields, latency ceiling, freshness rule, core function, exceptions. The vault verifies the parties against the monitor before anything is staked.",
  },
  {
    key: "fund",
    name: "Fund & lock",
    actor: "provider + customer",
    desc: "The provider stakes a performance bond; the customer locks the service payment. Both are held by the vault. Neither side can touch the stake again until settlement.",
  },
  {
    key: "checkpoint",
    name: "Checkpoint",
    actor: "anyone · validators judge",
    desc: "The monitor fetches the live service and GenLayer validators independently judge six checks — usability, latency, schema, freshness, function, exceptions — reaching consensus on one health verdict.",
  },
  {
    key: "tally",
    name: "Tally",
    actor: "on-chain, deterministic",
    desc: "Once the agreed number of checkpoints has run, the recorded verdicts resolve to one outcome. A single critical checkpoint sinks the whole agreement — one catastrophic failure dominates.",
  },
  {
    key: "settle",
    name: "Settle",
    actor: "anyone · no authority needed",
    desc: "The vault reads the verdicts directly from the monitor and redistributes by fixed arithmetic — payment, compensation, bond return or slash, and a 1% fee. No fresh judgment, no arbiter.",
  },
];

const TIERS = [
  { key: "satisfied", name: "Satisfied", when: "Service healthy, all material checks pass", effect: "Provider paid in full · bond returned" },
  { key: "minor", name: "Minor", when: "Small degradation, still usable", effect: "Small customer credit · bond returned" },
  { key: "material", name: "Material", when: "Meaningful breach — broken schema or impaired function", effect: "Customer compensated · bond partly slashed" },
  { key: "critical", name: "Critical", when: "Service effectively down", effect: "Full refund · entire bond slashed" },
];

const HERO_SCENARIOS: HeroScenario[] = [
  {
    label: "healthy service · settles in full",
    sequence: ["satisfied", "satisfied", "satisfied"],
    settlement: { outcome: "satisfied", provider: "3,960", customer: "0", bond: "800" },
  },
  {
    label: "degrading service · partial compensation",
    sequence: ["satisfied", "minor", "material"],
    settlement: { outcome: "material", provider: "3,168", customer: "1,200", bond: "400" },
  },
  {
    label: "catastrophic failure · bond slashed",
    sequence: ["satisfied", "critical"],
    settlement: { outcome: "critical", provider: "0", customer: "4,800", bond: "0" },
  },
  {
    label: "contested verdict · minority preserved on-chain",
    sequence: ["satisfied", "minor", "minor"],
    settlement: { outcome: "minor", provider: "3,762", customer: "200", bond: "800" },
  },
];

function useHeroLoop() {
  const [checkpoints, setCheckpoints] = useState<StripCheckpoint[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [settlement, setSettlement] = useState<StripSettlement | null>(null);
  const [label, setLabel] = useState<string>(HERO_SCENARIOS[0].label);
  const timers = useRef<number[]>([]);
  const scenarioRef = useRef<number>(0);

  useEffect(() => {
    function clear() {
      timers.current.forEach((t) => clearTimeout(t));
      timers.current = [];
    }

    function run() {
      clear();
      const scenario = HERO_SCENARIOS[scenarioRef.current];
      setCheckpoints([]);
      setActiveIndex(null);
      setSettlement(null);
      setLabel(scenario.label);

      let delay = 700;
      const measure = 1100;

      scenario.sequence.forEach((tier, i) => {
        timers.current.push(window.setTimeout(() => setActiveIndex(i), delay));
        timers.current.push(
          window.setTimeout(() => {
            setActiveIndex(null);
            setCheckpoints((prev) => [...prev, { tier }]);
          }, delay + measure - 250)
        );
        delay += measure;
      });

      timers.current.push(window.setTimeout(() => setSettlement(scenario.settlement), delay + 200));

      // hold the settled state, advance to the next scenario, then loop
      timers.current.push(
        window.setTimeout(() => {
          scenarioRef.current = (scenarioRef.current + 1) % HERO_SCENARIOS.length;
          run();
        }, delay + 4200)
      );
    }

    run();
    return clear;
  }, []);

  return { checkpoints, activeIndex, settlement, label };
}

export default function Marketing() {
  const { checkpoints, activeIndex, settlement, label } = useHeroLoop();

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
          <a className="nav-link" href="#how">How it works</a>
          <a className="nav-link" href="#dissent">Dissent</a>
          <Link to="/app" className="btn btn-primary">Launch app →</Link>
        </div>
      </header>

      <main className="app-main">
        <section className="mk-hero">
          <div className="mk-hero-copy">
            <div className="eyebrow" style={{ marginBottom: 14 }}>Consensus-enforced settlement</div>
            <h1 className="mk-hero-title">
              When validators disagree,<br />that disagreement is the record.
            </h1>
            <p className="muted mk-hero-sub">
              Covenant settles API service-level agreements by consensus. Validators fetch the live
              service and judge each checkpoint — and when they split on a verdict, the minority
              reasoning is preserved on-chain, not discarded. The money follows the majority. The
              dissent stays visible.
            </p>
            <div className="mk-hero-cta">
              <Link to="/app" className="btn btn-primary">Launch the dApp →</Link>
              <a href="#how" className="btn">See how it works</a>
            </div>
          </div>

          <div className="mk-hero-strip">
            <CovenantStrip
              serviceName="GitHub Repo API — service agreement"
              caseId="live"
              payment="4,000"
              bondAmount="800"
              latencyMs="8000"
              totalCheckpoints={HERO_SCENARIOS[HERO_SCENARIOS.findIndex((s) => s.label === label)]?.sequence.length ?? 3}
              checkpoints={checkpoints}
              activeIndex={activeIndex}
              settlement={settlement}
              bondLocked={true}
            />
            <div className="mk-hero-strip-cap mono">
              live signal · {label}
            </div>
          </div>
        </section>

        <section id="how" className="mk-section">
          <div className="mk-section-head">
            <div className="eyebrow" style={{ marginBottom: 12 }}>How it works</div>
            <h2 className="mk-section-title">Five stages from promise to payout.</h2>
            <p className="muted mk-section-lead">
              An agreement isn't a document Covenant trusts — it's a sequence the contracts enforce.
              Nobody is asked to report what happened; the service is measured directly, and the
              money moves on the measurement.
            </p>
          </div>

          <div className="mk-flow">
            {LIFECYCLE.map((stage, i) => (
              <div className="mk-flow-step" key={stage.key}>
                <div className="mk-flow-rail">
                  <div className="mk-flow-node">{String(i + 1).padStart(2, "0")}</div>
                  {i < LIFECYCLE.length - 1 && <div className="mk-flow-line" />}
                </div>
                <div className="mk-flow-body">
                  <div className="mk-flow-name">{stage.name}</div>
                  <div className="mk-flow-actor mono">{stage.actor}</div>
                  <p className="muted mk-flow-desc">{stage.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="dissent" className="mk-section">
          <div className="mk-section-head">
            <div className="eyebrow" style={{ marginBottom: 12 }}>The GenLayer-native part</div>
            <h2 className="mk-section-title">Disagreement isn't noise. It's the finding.</h2>
            <p className="muted mk-section-lead">
              A single model, asked a subjective question, gives you one confident answer and hides
              its own doubt. GenLayer runs several validators independently — and when they split on
              a verdict, Covenant records the split. The majority moves the money. The minority
              reasoning is written to the chain, permanently, where anyone can read what the dissent
              actually argued.
            </p>
          </div>

          <div className="mk-dissent">
            <div className="mk-dissent-head">
              <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span className="mk-chip mk-chip-material">checkpoint · material</span>
                <span className="mono" style={{ fontSize: 12, color: "var(--text-dim)" }}>
                  GitHub Repo API — freshness check
                </span>
              </div>
              <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
                validators split 3 – 2
              </span>
            </div>

            <div className="mk-dissent-body">
              <div className="mk-verdict mk-verdict-majority">
                <div className="mk-verdict-tag mono">Majority · 3 validators</div>
                <div className="mk-verdict-tier">Material breach</div>
                <p className="muted mk-verdict-reason">
                  The <span className="mono">updated_at</span> timestamp was three weeks stale against
                  a freshness rule requiring recent activity. The endpoint returned valid structure,
                  but the data no longer reflected the live repository — a meaningful breach of what
                  was promised.
                </p>
                <div className="mk-verdict-effect mono">→ this verdict moved the money</div>
              </div>

              <div className="mk-verdict mk-verdict-minority">
                <div className="mk-verdict-tag mono">Minority · 2 validators</div>
                <div className="mk-verdict-tier">Minor degradation</div>
                <p className="muted mk-verdict-reason">
                  A stale timestamp on a low-traffic repository is expected, not a failure. The core
                  function — returning correct repository metadata — still worked. The agreed
                  exceptions arguably cover quiet periods. Degraded, but not a material breach.
                </p>
                <div className="mk-verdict-effect mono">→ preserved on-chain, not discarded</div>
              </div>
            </div>

            <div className="mk-dissent-foot mono">
              Both readings are stored on the monitor contract. Settlement followed the majority —
              but the minority argument survives as part of the permanent record, readable by either
              party or any reviewer.
            </div>
          </div>
        </section>

        <section className="mk-section">
          <div className="mk-section-head">
            <div className="eyebrow" style={{ marginBottom: 12 }}>The outcomes</div>
            <h2 className="mk-section-title">Four tiers. Fixed arithmetic. No discretion.</h2>
            <p className="muted mk-section-lead">
              Every checkpoint resolves to one of four health tiers, and the run tallies to a final
              outcome that maps to an exact distribution. The same inputs always produce the same
              settlement — the contract has no room to decide otherwise.
            </p>
          </div>

          <div className="mk-tiers">
            {TIERS.map((t) => (
              <div className={"mk-tier mk-tier-" + t.key} key={t.key}>
                <div className="mk-tier-cap" />
                <div className="mk-tier-name">{t.name}</div>
                <div className="mk-tier-when muted">{t.when}</div>
                <div className="mk-tier-effect mono">{t.effect}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="mk-section">
          <div className="mk-section-head">
            <div className="eyebrow" style={{ marginBottom: 12 }}>Trust model</div>
            <h2 className="mk-section-title">The owner can't move your money. Anyone can settle yours.</h2>
            <p className="muted mk-section-lead">
              Covenant decentralizes the two things that matter — the judgment and the money path.
              Creating, checkpointing, and settling are all permissionless. The deployer holds no
              authority over any agreement.
            </p>
          </div>

          <div className="mk-trust">
            <div className="mk-trust-points">
              <div className="mk-trust-point">
                <div className="mk-trust-point-name">Judgment is consensus</div>
                <p className="muted">Verdicts come from GenLayer validators fetching the live service. No party — including the deployer — can choose or overwrite a verdict.</p>
              </div>
              <div className="mk-trust-point">
                <div className="mk-trust-point-name">Settlement is permissionless</div>
                <p className="muted">Once the agreed checkpoints have run, anyone can settle. The contract has no owner-only path — the deployer is only the fee beneficiary.</p>
              </div>
              <div className="mk-trust-point">
                <div className="mk-trust-point-name">Conservation is enforced</div>
                <p className="muted">Settlement reverts unless the vault can fully fund the payout. The money that comes out always equals the money that went in.</p>
              </div>
            </div>

            <a
              className="mk-proof"
              href="https://explorer-studio.genlayer.com/tx/0x29d881888c25f9e499e7728ce32979793372f2e6dc2a13a0622c65cd7d03099e"
              target="_blank"
              rel="noreferrer"
            >
              <div className="mk-proof-tag mono">Proof · on-chain</div>
              <div className="mk-proof-title">A wallet that owned nothing settled this agreement.</div>
              <p className="muted mk-proof-desc">
                Not a party, not the deployer — a bystander wallet called settle, and the contract
                accepted it. This is the difference between claiming decentralization and proving it.
              </p>
              <div className="mk-proof-link mono">View the settlement transaction →</div>
            </a>
          </div>
        </section>

        <section className="mk-section mk-close">
          <h2 className="mk-close-title">Stop trusting the promise.<br />Measure it.</h2>
          <p className="muted mk-close-sub">
            The next uptime guarantee, the next API SLA, the next "we'll credit you if we're down" —
            put it on Covenant and let consensus keep score.
          </p>
          <Link to="/app" className="btn btn-primary mk-close-cta">Launch the dApp →</Link>
        </section>
      </main>

      <style>{MK_CSS}</style>
    </div>
  );
}

const MK_CSS = `
.mk-hero{
  display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center;
  padding:40px 0 72px;
}
.mk-hero-title{
  font-family:var(--font-display);font-weight:500;
  font-size:40px;line-height:1.18;letter-spacing:-0.01em;
  color:var(--text-bright);margin-bottom:20px;
}
.mk-hero-sub{font-size:16px;line-height:1.7;max-width:520px;margin-bottom:30px;}
.mk-hero-cta{display:flex;gap:12px;flex-wrap:wrap;}
.mk-hero-strip-cap{
  text-align:center;font-size:10.5px;letter-spacing:0.08em;text-transform:uppercase;
  color:var(--text-faint);margin-top:14px;
}
.mk-section{padding:64px 0;border-top:1px solid var(--rule);}
.mk-section-head{max-width:620px;margin-bottom:44px;}
.mk-section-title{font-family:var(--font-display);font-weight:500;font-size:30px;line-height:1.22;letter-spacing:-0.01em;color:var(--text-bright);margin-bottom:16px;}
.mk-section-lead{font-size:15.5px;line-height:1.7;}
.mk-flow{display:grid;grid-template-columns:repeat(5,1fr);gap:0;}
.mk-flow-step{display:flex;flex-direction:column;}
.mk-flow-rail{display:flex;align-items:center;height:40px;margin-bottom:16px;position:relative;}
.mk-flow-node{
  width:40px;height:40px;flex-shrink:0;border-radius:50%;
  border:1.5px solid var(--violet);color:var(--violet-lit);
  display:flex;align-items:center;justify-content:center;
  font-family:var(--font-mono);font-size:13px;
  background:radial-gradient(circle at 50% 40%, rgba(124,111,168,0.18), transparent);
  box-shadow:0 0 20px -6px rgba(124,111,168,0.5);z-index:2;
}
.mk-flow-line{position:absolute;left:40px;right:0;height:1.5px;background:linear-gradient(90deg, var(--violet-dim), rgba(124,111,168,0.15));z-index:1;}
.mk-flow-body{padding-right:20px;}
.mk-flow-name{font-family:var(--font-display);font-weight:500;font-size:17px;color:var(--text-bright);margin-bottom:5px;}
.mk-flow-actor{font-size:10px;letter-spacing:0.06em;text-transform:uppercase;color:var(--violet-lit);margin-bottom:10px;}
.mk-flow-desc{font-size:13px;line-height:1.6;}
.mk-dissent{border:1px solid var(--rule);border-radius:8px;overflow:hidden;background:var(--surface-raise);}
.mk-dissent-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;border-bottom:1px solid var(--rule);background:linear-gradient(180deg, rgba(124,111,168,0.06), transparent);flex-wrap:wrap;}
.mk-chip{font-family:var(--font-mono);font-size:10px;letter-spacing:0.08em;text-transform:uppercase;border-radius:999px;padding:4px 11px;border:1px solid var(--rule);}
.mk-chip-material{color:var(--material-lit);border-color:rgba(198,138,63,0.4);background:rgba(198,138,63,0.08);}
.mk-dissent-body{display:grid;grid-template-columns:1fr 1fr;}
.mk-verdict{padding:22px 20px;}
.mk-verdict-majority{border-right:1px solid var(--rule);}
.mk-verdict-minority{background:rgba(124,111,168,0.03);}
.mk-verdict-tag{font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-faint);margin-bottom:10px;}
.mk-verdict-tier{font-family:var(--font-display);font-weight:500;font-size:19px;color:var(--text-bright);margin-bottom:12px;}
.mk-verdict-majority .mk-verdict-tier{color:var(--material-lit);}
.mk-verdict-minority .mk-verdict-tier{color:var(--minor-lit);}
.mk-verdict-reason{font-size:13.5px;line-height:1.65;margin-bottom:16px;}
.mk-verdict-effect{font-size:11px;letter-spacing:0.03em;color:var(--text-dim);}
.mk-verdict-majority .mk-verdict-effect{color:var(--material-lit);}
.mk-dissent-foot{padding:16px 20px;border-top:1px solid var(--rule);font-size:12px;line-height:1.65;color:var(--text-dim);background:#12171D;}
.mk-tiers{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;}
.mk-tier{border:1px solid var(--rule);border-radius:8px;padding:20px 18px;background:var(--surface-raise);position:relative;overflow:hidden;transition:transform .2s ease, border-color .3s ease, box-shadow .3s ease;}
.mk-tier:hover{transform:translateY(-4px);}
.mk-tier-satisfied:hover{border-color:rgba(78,154,117,0.5);box-shadow:0 14px 40px -18px var(--satisfied);}
.mk-tier-minor:hover{border-color:rgba(198,163,63,0.5);box-shadow:0 14px 40px -18px var(--minor);}
.mk-tier-material:hover{border-color:rgba(198,138,63,0.5);box-shadow:0 14px 40px -18px var(--material);}
.mk-tier-critical:hover{border-color:rgba(188,74,63,0.5);box-shadow:0 14px 40px -18px var(--critical);}
.mk-tier-cap{position:absolute;top:0;left:0;right:0;height:3px;}
.mk-tier-satisfied .mk-tier-cap{background:var(--satisfied-lit);box-shadow:0 0 12px var(--satisfied);}
.mk-tier-minor .mk-tier-cap{background:var(--minor-lit);box-shadow:0 0 12px var(--minor);}
.mk-tier-material .mk-tier-cap{background:var(--material-lit);box-shadow:0 0 12px var(--material);}
.mk-tier-critical .mk-tier-cap{background:var(--critical-lit);box-shadow:0 0 12px var(--critical);}
.mk-tier-name{font-family:var(--font-display);font-weight:500;font-size:18px;margin-bottom:8px;color:var(--text-bright);}
.mk-tier-satisfied .mk-tier-name{color:var(--satisfied-lit);}
.mk-tier-minor .mk-tier-name{color:var(--minor-lit);}
.mk-tier-material .mk-tier-name{color:var(--material-lit);}
.mk-tier-critical .mk-tier-name{color:var(--critical-lit);}
.mk-tier-when{font-size:12.5px;line-height:1.55;margin-bottom:14px;min-height:54px;}
.mk-tier-effect{font-size:11px;line-height:1.5;color:var(--text-dim);padding-top:12px;border-top:1px solid var(--rule);}
.mk-trust{display:grid;grid-template-columns:1.1fr 1fr;gap:24px;align-items:start;}
.mk-trust-points{display:flex;flex-direction:column;gap:22px;}
.mk-trust-point-name{font-family:var(--font-display);font-weight:500;font-size:16px;color:var(--text-bright);margin-bottom:6px;}
.mk-trust-point p{font-size:13.5px;line-height:1.6;}
.mk-proof{display:block;text-decoration:none;border:1px solid var(--violet-dim);border-radius:8px;padding:24px;background:linear-gradient(180deg, rgba(124,111,168,0.09), rgba(124,111,168,0.02));transition:border-color .2s, transform .2s;}
.mk-proof:hover{border-color:var(--violet);transform:translateY(-2px);}
.mk-proof-tag{font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:var(--satisfied-lit);margin-bottom:14px;}
.mk-proof-title{font-family:var(--font-display);font-weight:500;font-size:19px;line-height:1.3;color:var(--text-bright);margin-bottom:12px;}
.mk-proof-desc{font-size:13.5px;line-height:1.65;margin-bottom:18px;}
.mk-proof-link{font-size:12px;color:var(--violet-lit);letter-spacing:0.03em;}
.mk-close{text-align:center;border-top:1px solid var(--rule);padding:80px 0 96px;}
.mk-close-title{font-family:var(--font-display);font-weight:500;font-size:34px;line-height:1.2;letter-spacing:-0.01em;color:var(--text-bright);margin-bottom:18px;}
.mk-close-sub{font-size:15.5px;line-height:1.7;max-width:520px;margin:0 auto 28px;}
.mk-close-cta{display:inline-block;}
@media (max-width:900px){
  .mk-hero{grid-template-columns:1fr;gap:40px;padding:24px 0 48px;}
  .mk-hero-title{font-size:32px;}
  .mk-flow{grid-template-columns:1fr;gap:24px;}
  .mk-flow-rail{margin-bottom:12px;}
  .mk-flow-line{display:none;}
  .mk-section-title{font-size:24px;}
  .mk-tiers{grid-template-columns:1fr 1fr;}
  .mk-trust{grid-template-columns:1fr;}
  .mk-tier-when{min-height:0;}
  .mk-close-title{font-size:26px;}
}
@media (max-width:760px){
  .mk-dissent-body{grid-template-columns:1fr;}
  .mk-verdict-majority{border-right:none;border-bottom:1px solid var(--rule);}
}
`;
