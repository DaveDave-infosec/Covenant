Each stage below says which wallet acts.

---

## Step 1 — Create the agreement

**Who:** anyone (in the demo UI, the operator console).

Fill the create form. The fields fall into three groups:

**What's being measured**
- **Service name** — a label.
- **Monitored endpoint** — the live URL validators will fetch.
- **Required fields** — comma-separated fields the response must contain.
- **Compared field** — a field checked for exact stability across the run.

**How it's judged**
- **Freshness rule** — plain-language rule for whether the data is current. If the endpoint is a static resource, say so here so this check always passes.
- **Core function** — what the endpoint is supposed to do.
- **Agreed exceptions** — conditions that excuse a failure (maintenance windows, etc.).
- **Latency max (ms)** — the agreed ceiling.

**The stakes and parties**
- **Payment** — what the customer locks.
- **Bond** — what the provider stakes.
- **Checkpoints req.** — how many checkpoints must run before the agreement can settle. Set this to 2 or more if you want to require sustained measurement.
- **Provider address** — the wallet that will lock the bond.
- **Customer address** — the wallet that will lock the payment. **Paste the real customer wallet here** — this is the single most common mistake; leaving the default makes both parties the same wallet.

Click **Create agreement on both contracts.** Two transactions fire — one to the monitor (terms), one to the vault (parties + stakes). The vault verifies the parties match the monitor agreement, so a mismatched linkage is rejected on-chain. You'll get a monitor ID and a vault ID.

---

## Step 2 — Fund both wallets

**Who:** anyone (it's an open testnet faucet).

Before either side can lock, the tokens must exist. In the operator console:

- **Mint bond → provider** — gives the provider wallet enough to cover the bond.
- **Mint payment → customer** — gives the customer wallet enough to cover the payment.

**Do this before locking.** If a wallet tries to lock funds it doesn't have, the lock fails. And if you skip minting entirely, settlement later will revert — the vault refuses to settle a payout it can't fund.

---

## Step 3 — Lock both sides

Locking moves the staked funds into the vault, where neither party can touch them until settlement. Each side locks its own stake:

- **Lock bond** — **the provider wallet** does this. In the operator console it's a button; as a party, it appears under *Party actions* when the provider wallet is connected.
- **Lock payment** — **the customer wallet** does this.

The agreement only becomes **active** once *both* are locked. At that moment the contract snapshots the current checkpoint count, so only checkpoints run from here on count toward settlement.

**Switching wallets:** if the provider locks first, switch your wallet to the customer to lock payment. Use **↻ Refresh state** to pull the other side's lock without reloading the page.

---

## Step 4 — Run checkpoints

**Who:** anyone.

Click **▶ Run checkpoint.** This fetches the live endpoint and asks GenLayer validators to judge it. After consensus, one verdict is recorded: satisfied, minor, material, or critical. You'll see it appear on the strip.

Run as many as you like, but you must run at least the **checkpoints required** number before settlement unlocks. If you set that to 2, the Settle button stays disabled after one checkpoint — that's the agreement enforcing its own terms, not a bug.

---

## Step 5 — Settle

**Who:** anyone — provider, customer, or a complete outsider.

Once the required checkpoints have run, **Settle agreement** becomes available. Settlement:

1. Reads all the verdicts directly from the monitor.
2. Tallies them into one outcome (a single critical verdict makes the whole outcome critical).
3. Redistributes the money: provider proceeds, customer compensation, bond return or slash, and a 1% protocol fee — all deterministic, all in one transaction.

The agreement flips to **settled** and its console goes read-only. It moves into the **Settled** section of the record with its final tier.

Because settlement is permissionless, you can prove this to yourself: run the checkpoints, then settle from a wallet that is neither party. It works — the contract has no owner-only settlement path.

---

## Reading the on-chain record

The record at the top lists every agreement, newest first:

- **Open** — agreements still in progress. This is your workspace.
- **Settled** — a collapsed archive of finished agreements, each showing its final tier.
- **All / Yours** — when your wallet is a party to something, a filter appears so you can see just your agreements.

Each row expands to show the full telemetry strip, the six-check breakdown per checkpoint, the validator reasoning from consensus, and the settlement split. **Load into console** pulls an agreement into the workspace so you can act on it.

---

## Common gotchas

- **Both parties ended up the same wallet.** You left the customer address at its default. Paste the real customer wallet when creating.
- **A lock failed.** That wallet wasn't funded — mint to it first.
- **Settle is greyed out.** You haven't run the required number of checkpoints yet.
- **Settle "did not take."** The vault couldn't fund the payout — make sure both sides were minted *and* locked. This is the contract correctly refusing an underfunded settlement.
- **You changed wallets and the screen looks stale.** Hit **↻ Refresh state** to re-read from the chain.
