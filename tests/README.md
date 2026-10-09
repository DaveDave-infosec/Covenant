# Covenant — tests and on-chain evidence

Two layers of verification, both runnable.

| File | What it proves | Needs |
|------|----------------|-------|
| `test_monitor.py` | The monitor's real `run_checkpoint` path: two readings, contested detection, counters | nothing |
| `test_vault.py` | The vault's real settlement path: the contested gate, permissionless settle, conservation | nothing |
| `test_contested_exclusion.py` | Contested checkpoints take no part in the outcome: excluded from the denominator and every severity count | nothing |
| `test_onchain.py` | The same properties on the live contracts, against real settled and blocked agreements | network access |

```bash
pip install genlayer-test==0.29.2
python -m pytest tests/test_monitor.py tests/test_vault.py tests/test_contested_exclusion.py -q   # 49 passed
python -m pytest tests/test_onchain.py -q                                                          # 5 passed
```

The first run downloads the GenLayer SDK (around 200 MB) and takes a few
minutes with no output. Later runs finish in seconds.

## Deployed contracts

GenLayer Studio Network, chain 61999.

| Contract | Address |
|----------|---------|
| CovenantMonitor | `0x18ECD959aE09E1B61A5DBDb89B733Bf39a161728` |
| CovenantVault | `0x8c668Ebc2A0F0fA9Cc2b6CD4a60ca202a1085f83` |

The sources in `contracts/` are the sources deployed at those addresses.

## What the tests actually run

The contract logic tests are not a reimplementation. They load
`contracts/covenant_monitor.py` and `contracts/covenant_vault.py` into an
in-process GenLayer VM and call them.

Two parts of a checkpoint are non-deterministic, so they are supplied by the
test: the live web fetch, and the validator verdict. Everything between those
two points is the contract's own code, including prompt construction, JSON
extraction, tier normalisation, contested detection and all the settlement
arithmetic.

The GenLayer SDK permits only one contract class per process, so the monitor
and the vault are tested in separate modules. Where the vault reaches the
monitor through `gl.get_contract_at`, the call is answered from an explicit
test-controlled monitor state. That is what allows a test to place the monitor
in a state, such as "three checkpoints, two of them contested", that would
otherwise take a long sequence of live transactions to reach.

## The property that matters

A checkpoint is **contested** when a strict reading and a lenient reading of
the same fetched evidence reach different tiers. A contested checkpoint is
recorded and counted in the tally, but it does **not** satisfy
`checkpoints_required`. Settlement waits for evidence that is not ambiguous.

Both directions are covered:

- `test_contested_checkpoint_does_not_satisfy_the_requirement` — settlement
  reverts with `not enough uncontested checkpoints; contested evidence
  requires another checkpoint`
- `test_an_uncontested_checkpoint_releases_the_gate` — the same agreement
  settles once clear evidence arrives

## On-chain evidence

`test_onchain.py` reads two real agreements on the deployed vault.

**Vault agreement #2 — blocked.** Bound to a monitor agreement whose terms are
deliberately ambiguous: a required field the endpoint does not return, against
an exception clause that excuses absent upstream metadata. Both checkpoints run
against it were contested, so it remains `active` with its uncontested count
below its requirement. A settle attempt failed with the assertion above.

**Vault agreement #1 — released.** Bound to a monitor agreement with clear
terms and a static endpoint. Its checkpoint was uncontested, the requirement
was met, and it settled `satisfied`.

The same mechanism produced both outcomes. The difference was the evidence.

## Trust properties asserted

- Creation, checkpoint execution and settlement are permissionless. The
  bystander settlement test asserts the settler is neither party nor the fee
  wallet.
- Settlement consumes verdicts read from the monitor cross-contract. The vault
  has no method that accepts a tier from its caller.
- Value is conserved for every outcome tier, and settlement reverts rather than
  paying out from a vault that cannot fund it.
- The deployer holds no authority. It is the fee beneficiary and nothing else.

## A note on the tally

The outcome rule escalates when a fault tier covers more than half a run. One
minor checkpoint out of one settles as `material`; one material out of one
settles as `critical`. Adding clean evidence removes the escalation. This is
intentional, and `test_the_tally_escalates_when_a_fault_tier_dominates`
documents it.
