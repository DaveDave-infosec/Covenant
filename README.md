# Covenant

**Consensus-enforced settlement for API service-level agreements.**

A provider stakes a performance bond. A customer locks payment. At sampled
checkpoints, GenLayer validators fetch the live service themselves and judge
what was actually delivered. The contract redistributes payment, compensation
and bond by that measurement. No arbiter, no reported metrics, no appeal to
anyone's dashboard.

Live: https://covenant-genlayer.vercel.app

## What makes it GenLayer-native

A single model, asked a subjective question, returns one confident answer and
hides its own doubt. Covenant asks the question twice.

Every checkpoint produces **two independently reasoned readings of the same
fetched evidence**:

- a **strict** reading, holding the service to the literal agreed terms
- a **lenient** reading, judging whether the service substantively delivered
  what was promised

Both are validated by consensus and stored on-chain as fields of the leader
result. When they reach the same tier, the evidence is clear. When they split,
the checkpoint is marked **contested**: it is recorded in full, with the
reasoning from both sides and a note saying where they diverged, but it **does
not satisfy the agreement**. Settlement waits for evidence that both standards
share.

That is the whole idea. Ambiguous evidence buys time, not a payout.

A real contested checkpoint, readable now at `get_checkpoint(2, 0)` on the
monitor:

| | Strict reading | Lenient reading |
|---|---|---|
| **Tier** | Material breach | Satisfied |
| **Reasoning** | The response lacks the required `priority` field, violating the schema requirement, and the exception clause applies, indicating a material breach. | Although `priority` is missing, the contract treats optional metadata as excusable, and the core todo data is present, so the service meets the promised functionality. |

Vault agreement #2 is bound to that monitor agreement. Every checkpoint on it
has been contested, so it remains active and unsettled with its funds locked. A
settle attempt reverts with `not enough uncontested checkpoints; contested
evidence requires another checkpoint`.

## The lifecycle

1. **Create** — permissionless. SLA terms are locked on the monitor. The vault
   verifies the parties against that monitor agreement cross-contract before
   binding to it.
2. **Fund and lock** — the provider stakes the bond, the customer locks payment.
   Both are held by the vault until settlement.
3. **Checkpoint** — permissionless. The monitor fetches the live service,
   validators judge six checks, and produce the two readings.
4. **Agree or contest** — matching tiers count toward the agreement. Diverging
   tiers are recorded as contested and do not count.
5. **Tally** — once enough uncontested checkpoints have run, the recorded
   verdicts resolve to one outcome. A single critical checkpoint dominates.
6. **Settle** — permissionless. The vault reads verdicts from the monitor and
   redistributes by fixed arithmetic.

## Settlement tiers

| Tier | When | Effect |
|------|------|--------|
| satisfied | Service healthy, material checks pass | Provider paid in full, bond returned |
| minor | Small degradation, still usable | Small customer credit, bond returned |
| material | Meaningful breach | Customer compensated 20%, half the bond slashed |
| critical | Service effectively down | Full refund, entire bond slashed |

The tally escalates when a fault tier covers more than half a run: one minor
checkpoint out of one settles as material, one material out of one settles as
critical. Adding clean evidence removes the escalation. This is intentional and
covered by a test.

## Trust model

**Decentralized:**

- **Judgment.** Verdicts come from GenLayer validator consensus fetching the
  live service. No party, including the deployer, can choose or overwrite a
  verdict.
- **Creation** is permissionless. It moves no funds, and the vault rejects any
  agreement whose parties do not match the referenced monitor agreement.
- **Checkpoints** are permissionless. The caller has no influence on the result.
- **Settlement** is permissionless, once enough uncontested evidence exists.

**The deployer holds no authority.** It is the fee beneficiary (1% of provider
proceeds) and the address the demo UI gates its operator console on, which is a
frontend convenience, not a contract power. There is no owner-only settlement
path and no method that accepts a verdict from its caller.

**Disclosed limitations:**

- **The token is an open testnet faucet.** `mint` is unrestricted so reviewers
  can self-fund. In production this would be a deposit of a real token.
- **No checkpoint spacing is enforced.** An agreement requiring N checkpoints
  can have all N run in quick succession. A production version would enforce
  block-time spacing.
- **Contestation is unbounded.** A permanently ambiguous agreement can stay
  contested indefinitely. Funds stay locked rather than being misallocated,
  which is the safe failure, but there is no timeout that forces resolution.
- **Conservation is enforced as a precondition.** Settlement reverts if the
  vault cannot fully fund the payout, so funding must complete first.

## Verification

Every claim above is checkable in the repo or on-chain.

**Settlement consumes authenticated monitor verdicts, cross-contract.**
`CovenantVault.settle()` reads each verdict directly from the monitor via
`gl.get_contract_at(self.monitor).view().get_checkpoint_tier(...)`. It never
accepts a tier from its caller, and no relay method exists. See
[`contracts/covenant_vault.py`](./contracts/covenant_vault.py), function
`settle`.

**Permissionless settlement, proven on-chain.** A bystander wallet
(`0xc47F4102428E65E671379453F39b26eb744d96C9`), neither party nor deployer,
settled a live agreement:
[settlement transaction](https://explorer-studio.genlayer.com/tx/0x29d881888c25f9e499e7728ce32979793372f2e6dc2a13a0622c65cd7d03099e)
(SUCCESS, `"satisfied"`, FINALIZED).

**54 tests, no skips.**

```bash
pip install genlayer-test==0.29.2
python -m pytest tests/test_monitor.py tests/test_vault.py tests/test_contested_exclusion.py -q   # 49 passed
python -m pytest tests/test_onchain.py -q                       # 5 passed
```

The first 49 load the real contracts into an in-process GenLayer VM and call
them. The last 5 read the live contracts and verify that vault #2 is blocked by
contested evidence while vault #1 settled on clear evidence. See
[`tests/README.md`](./tests/README.md).

## Deployed contracts

GenLayer Studio Network, chain 61999 (hex `0xF22F`).

| Contract | Address |
|----------|---------|
| CovenantMonitor | `0x18ECD959aE09E1B61A5DBDb89B733Bf39a161728` |
| CovenantVault | `0x8c668Ebc2A0F0fA9Cc2b6CD4a60ca202a1085f83` |

The sources in `contracts/` are the sources deployed at those addresses.

## Running the frontend

```bash
cd frontend
npm install
npm run dev
```

The app connects to the GenLayer Studio Network through an injected wallet and
will prompt to add the network on first connect. Contract addresses are
compiled in from `src/lib/constants.ts`.

## Using it

Covenant has a specific lifecycle, and different actions belong to different
parties. See [GUIDE.md](./GUIDE.md) for a step-by-step walkthrough, including
which wallet performs each action and how to read the on-chain record.

## Tech stack

React, TypeScript and Vite on the frontend, `genlayer-js` for contract calls,
two GenLayer intelligent contracts in Python. The frontend reads every agreement
live from the contracts; the on-chain record is not a cached feed.

---

Built on the GenLayer Studio Network.
