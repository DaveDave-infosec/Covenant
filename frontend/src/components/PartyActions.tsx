import { useState } from "react";
import { lockPayment, lockBond } from "../lib/covenant";

interface PartyActionsProps {
  account: string;
  vaultId: string;
  provider: string;
  customer: string;
  paymentLocked: boolean;
  bondLocked: boolean;
  onLocked: (which: "payment" | "bond") => void;
}

export default function PartyActions(props: PartyActionsProps) {
  const { account, vaultId, provider, customer, paymentLocked, bondLocked } = props;
  const [busy, setBusy] = useState<null | "payment" | "bond">(null);
  const [msg, setMsg] = useState<string | null>(null);

  const acct = account.toLowerCase();
  const isCustomer = acct === customer.toLowerCase();
  const isProvider = acct === provider.toLowerCase();

  if (!isCustomer && !isProvider) return null;

  async function doLock(which: "payment" | "bond") {
    setBusy(which);
    setMsg(null);
    try {
      if (which === "payment") await lockPayment(account, vaultId);
      else await lockBond(account, vaultId);
      setMsg(`${which} locked.`);
      props.onLocked(which);
    } catch (e: any) {
      setMsg(`Lock ${which} failed: ` + (e?.message ?? String(e)));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel panel-pad" style={{ marginTop: 24, borderColor: "var(--violet-dim)" }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div className="eyebrow" style={{ color: "var(--violet)" }}>Party actions</div>
        <span className="faint mono" style={{ fontSize: 10 }}>
          {isCustomer && isProvider ? "you are both parties" : isCustomer ? "you are the customer" : "you are the provider"}
        </span>
      </div>

      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        {isCustomer && (
          <button
            className="btn"
            onClick={() => doLock("payment")}
            disabled={busy !== null || paymentLocked}
          >
            {paymentLocked ? "Payment locked ✓" : busy === "payment" ? "Locking…" : "Lock payment"}
          </button>
        )}
        {isProvider && (
          <button
            className="btn"
            onClick={() => doLock("bond")}
            disabled={busy !== null || bondLocked}
          >
            {bondLocked ? "Bond locked ✓" : busy === "bond" ? "Locking…" : "Lock bond"}
          </button>
        )}
      </div>

      {msg && (
        <div className="mono" style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 12 }}>{msg}</div>
      )}
    </div>
  );
}
