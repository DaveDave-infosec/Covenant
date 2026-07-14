import { useEffect, useRef } from "react";

export type Tier = "satisfied" | "minor" | "material" | "critical";

export interface StripCheckpoint {
  tier: Tier;
}

export interface StripSettlement {
  outcome: Tier;
  provider: string;
  customer: string;
  bond: string;
}

export interface CovenantStripProps {
  serviceName: string;
  caseId: string;
  payment: string;
  bondAmount: string;
  latencyMs: string;
  totalCheckpoints: number;
  checkpoints: StripCheckpoint[];
  activeIndex: number | null;
  settlement: StripSettlement | null;
  bondLocked: boolean;
}

const TIER_LABEL: Record<Tier, string> = {
  satisfied: "Satisfied",
  minor: "Minor degradation",
  material: "Material breach",
  critical: "Critical failure",
};

const TIER_SEVERITY: Record<Tier, number> = {
  satisfied: 4,
  minor: 10,
  material: 18,
  critical: 26,
};

export default function CovenantStrip(props: CovenantStripProps) {
  const {
    serviceName,
    caseId,
    payment,
    bondAmount,
    latencyMs,
    totalCheckpoints,
    checkpoints,
    activeIndex,
    settlement,
    bondLocked,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const tRef = useRef<number>(0);
  const sevRef = useRef<number[]>([]);
  sevRef.current = checkpoints.map((c) => TIER_SEVERITY[c.tier]);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const context = canvasEl.getContext("2d");
    if (!context) return;
    const canvas: HTMLCanvasElement = canvasEl;
    const ctx: CanvasRenderingContext2D = context;

    function size() {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = r.width * dpr;
      canvas.height = r.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();
    window.addEventListener("resize", size);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function frame() {
      const r = canvas.getBoundingClientRect();
      const w = r.width;
      const h = r.height;
      const t = tRef.current;
      const sev = sevRef.current;
      const n = Math.max(totalCheckpoints, 1);

      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(124,111,168,0.45)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const seg = Math.floor((x / w) * n);
        let amp = 6;
        if (sev[seg] !== undefined) amp = sev[seg];
        const y =
          h / 2 +
          Math.sin(x * 0.05 + t * 0.06) * amp +
          Math.sin(x * 0.013 + t * 0.02) * 3;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      const lead = (t * 2) % w;
      const ly = h / 2 + Math.sin(lead * 0.05 + t * 0.06) * 6;
      ctx.fillStyle = "rgba(155,141,203,0.9)";
      ctx.beginPath();
      ctx.arc(lead, ly, 2.5, 0, Math.PI * 2);
      ctx.fill();

      tRef.current = t + 1;
      if (!reduce) rafRef.current = requestAnimationFrame(frame);
    }
    frame();

    return () => {
      window.removeEventListener("resize", size);
      cancelAnimationFrame(rafRef.current);
    };
  }, [totalCheckpoints]);

  const segments = [];
  for (let i = 0; i < totalCheckpoints; i++) {
    const cp = checkpoints[i];
    const isActive = activeIndex === i && !cp;
    let cls = "cov-seg";
    let tierText = "·";
    if (cp) {
      cls += " filled " + cp.tier;
      tierText = cp.tier;
    } else if (isActive) {
      cls += " active";
      tierText = "···";
    }
    segments.push(
      <div className={cls} key={i}>
        <div className="cov-cap" />
        <div className="cov-fill" />
        <span className="cov-idx">{String(i + 1).padStart(2, "0")}</span>
        <span className="cov-tier">{tierText}</span>
      </div>
    );
  }

  const laneLive = activeIndex !== null;

  return (
    <div className="cov-strip-card">
      <style>{STRIP_CSS}</style>

      <div className="cov-signed">
        <div className="cov-signed-left">
          <div className="cov-seal">§</div>
          <div>
            <div className="cov-signed-title">{serviceName}</div>
            <div className="cov-signed-meta">
              bond {bondAmount} · {bondLocked ? "locked" : "unlocked"} · case #{caseId}
            </div>
          </div>
        </div>
        <div className="cov-signed-terms">
          <div className="cov-term">
            <div className="cov-term-label">Payment</div>
            <div className="cov-term-val">{payment}</div>
          </div>
          <div className="cov-term">
            <div className="cov-term-label">Latency max</div>
            <div className="cov-term-val">{latencyMs}ms</div>
          </div>
          <div className="cov-term">
            <div className="cov-term-label">Checkpoints</div>
            <div className="cov-term-val">{totalCheckpoints}</div>
          </div>
        </div>
      </div>

      <div className="cov-lane">
        <div className="cov-lane-label">Checkpoint telemetry</div>
        <div className={"cov-lane-status" + (laneLive ? " live" : "")}>
          <span className="cov-ld" />
          <span>{laneLive ? "Measuring" : settlement ? "Complete" : "Idle"}</span>
        </div>
        <canvas className="cov-signal" ref={canvasRef} />
        <div className="cov-segments">{segments}</div>
      </div>

      <div className="cov-settle" style={{ opacity: settlement ? 1 : 0.3 }}>
        <div className="cov-settle-outcome">
          <span
            className="cov-dot"
            style={{ background: settlement ? `var(--${settlement.outcome}-lit)` : "var(--text-faint)" }}
          />
          <div>
            <div className="cov-settle-label">Settlement</div>
            <div
              className="cov-settle-tier"
              style={{ color: settlement ? `var(--${settlement.outcome}-lit)` : "var(--text-dim)" }}
            >
              {settlement ? TIER_LABEL[settlement.outcome] : "Pending"}
            </div>
          </div>
        </div>
        <div className="cov-settle-splits">
          <div className="cov-term">
            <div className="cov-split-label">Provider</div>
            <div className="cov-split-val">{settlement ? settlement.provider : "—"}</div>
          </div>
          <div className="cov-term">
            <div className="cov-split-label">Customer</div>
            <div className="cov-split-val">{settlement ? settlement.customer : "—"}</div>
          </div>
          <div className="cov-term">
            <div className="cov-split-label">Bond</div>
            <div className="cov-split-val">{settlement ? settlement.bond : "—"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const STRIP_CSS = `
.cov-strip-card{
  background:linear-gradient(180deg,#1C232C,#161C24);
  border:1px solid var(--rule);border-radius:6px;overflow:hidden;
  box-shadow:0 20px 60px -20px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.03);
}
.cov-signed{
  display:flex;align-items:center;justify-content:space-between;padding:18px 22px;
  border-bottom:1px solid var(--rule);
  background:linear-gradient(180deg, rgba(124,111,168,0.10), rgba(124,111,168,0.02));
  position:relative;
}
.cov-signed::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:1px;
  background:linear-gradient(90deg, transparent, rgba(124,111,168,0.5), transparent);}
.cov-signed-left{display:flex;align-items:center;gap:13px;}
.cov-seal{
  width:34px;height:34px;border-radius:50%;border:1.5px solid var(--violet);
  display:flex;align-items:center;justify-content:center;color:var(--violet-lit);
  font-family:var(--font-display);font-size:15px;
  background:radial-gradient(circle at 50% 40%, rgba(124,111,168,0.22), transparent);
  box-shadow:0 0 20px -4px rgba(124,111,168,0.5), inset 0 0 12px -6px rgba(124,111,168,0.6);
}
.cov-signed-title{font-family:var(--font-display);font-weight:500;font-size:15.5px;color:var(--text-bright);}
.cov-signed-meta{font-family:var(--font-mono);font-size:11px;color:var(--violet-lit);letter-spacing:0.05em;margin-top:3px;}
.cov-signed-terms{display:flex;gap:24px;}
.cov-term{text-align:right;}
.cov-term-label{font-family:var(--font-mono);font-size:9.5px;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-faint);margin-bottom:4px;}
.cov-term-val{font-family:var(--font-mono);font-size:13.5px;color:var(--text);}
.cov-lane{
  position:relative;padding:30px 22px 24px;
  background:
    repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(42,51,61,0.6) 39px, rgba(42,51,61,0.6) 40px),
    repeating-linear-gradient(0deg, transparent, transparent 15px, rgba(42,51,61,0.35) 15px, rgba(42,51,61,0.35) 16px),
    #10151A;
}
.cov-lane-label{position:absolute;top:10px;left:22px;font-family:var(--font-mono);font-size:9.5px;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-faint);z-index:3;}
.cov-lane-status{position:absolute;top:10px;right:22px;z-index:3;font-family:var(--font-mono);font-size:9.5px;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-dim);display:flex;align-items:center;gap:6px;}
.cov-ld{width:6px;height:6px;border-radius:50%;background:var(--text-faint);}
.cov-lane-status.live .cov-ld{background:var(--satisfied-lit);box-shadow:0 0 8px var(--satisfied-lit);animation:cov-blink 1.2s infinite;}
.cov-signal{position:absolute;left:22px;right:22px;top:30px;height:70px;z-index:1;pointer-events:none;width:calc(100% - 44px);}
.cov-segments{display:flex;gap:7px;position:relative;z-index:2;}
.cov-seg{
  flex:1;height:70px;border-radius:4px;border:1px solid var(--rule);
  background:linear-gradient(180deg,#1B222B,#161C23);position:relative;overflow:hidden;
  display:flex;align-items:flex-end;justify-content:center;padding-bottom:8px;
  transition:transform .18s ease, border-color .3s ease, box-shadow .3s ease;
}
.cov-seg:hover{transform:translateY(-3px);}
.cov-fill{position:absolute;inset:0;opacity:0;transition:opacity .6s ease;}
.cov-cap{position:absolute;top:0;left:0;right:0;height:3px;background:var(--text-faint);transition:background .4s ease, box-shadow .4s ease;}
.cov-idx{position:absolute;top:8px;left:9px;font-family:var(--font-mono);font-size:10px;color:var(--text-faint);}
.cov-tier{font-family:var(--font-mono);font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-faint);z-index:2;}
.cov-seg.active{border-color:var(--violet);box-shadow:0 0 24px -6px rgba(124,111,168,0.6), inset 0 0 20px -10px rgba(124,111,168,0.5);animation:cov-breathe 1.1s ease-in-out infinite;}
@keyframes cov-breathe{0%,100%{box-shadow:0 0 20px -8px rgba(124,111,168,0.5), inset 0 0 18px -12px rgba(124,111,168,0.4);}50%{box-shadow:0 0 30px -4px rgba(124,111,168,0.75), inset 0 0 24px -8px rgba(124,111,168,0.6);}}
.cov-seg.active .cov-tier{color:var(--violet-lit);}
.cov-seg.filled{animation:cov-lockin .5s ease;}
@keyframes cov-lockin{0%{transform:scale(1.04);}40%{transform:scale(1.0);}}
.cov-seg.filled.satisfied .cov-fill{opacity:0.22;background:radial-gradient(circle at 50% 120%, var(--satisfied-lit), var(--satisfied) 70%);}
.cov-seg.filled.minor .cov-fill{opacity:0.22;background:radial-gradient(circle at 50% 120%, var(--minor-lit), var(--minor) 70%);}
.cov-seg.filled.material .cov-fill{opacity:0.22;background:radial-gradient(circle at 50% 120%, var(--material-lit), var(--material) 70%);}
.cov-seg.filled.critical .cov-fill{opacity:0.24;background:radial-gradient(circle at 50% 120%, var(--critical-lit), var(--critical) 70%);}
.cov-seg.filled.satisfied .cov-cap{background:var(--satisfied-lit);box-shadow:0 0 12px var(--satisfied);}
.cov-seg.filled.minor .cov-cap{background:var(--minor-lit);box-shadow:0 0 12px var(--minor);}
.cov-seg.filled.material .cov-cap{background:var(--material-lit);box-shadow:0 0 12px var(--material);}
.cov-seg.filled.critical .cov-cap{background:var(--critical-lit);box-shadow:0 0 12px var(--critical);}
.cov-seg.filled.satisfied .cov-tier{color:var(--satisfied-lit);}
.cov-seg.filled.minor .cov-tier{color:var(--minor-lit);}
.cov-seg.filled.material .cov-tier{color:var(--material-lit);}
.cov-seg.filled.critical .cov-tier{color:var(--critical-lit);}
.cov-settle{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-top:1px solid var(--rule);background:linear-gradient(180deg,#151B22,#12171D);transition:opacity .5s;}
.cov-settle-outcome{display:flex;align-items:center;gap:12px;}
.cov-dot{width:11px;height:11px;border-radius:50%;}
.cov-settle-label{font-family:var(--font-mono);font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin-bottom:3px;}
.cov-settle-tier{font-family:var(--font-display);font-weight:500;font-size:16px;}
.cov-settle-splits{display:flex;gap:22px;}
.cov-split-label{font-family:var(--font-mono);font-size:9.5px;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-faint);margin-bottom:4px;}
.cov-split-val{font-family:var(--font-mono);font-size:13.5px;color:var(--text);}
@media (max-width:640px){
  .cov-signed{flex-direction:column;align-items:flex-start;gap:14px;}
  .cov-settle{flex-direction:column;align-items:flex-start;gap:14px;}
}
`;
