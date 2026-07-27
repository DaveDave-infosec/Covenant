# Covenant — Lifecycle Test (on-chain evidence)

This documents the full agreement lifecycle executed against the deployed V2
contracts on the GenLayer Studio Network, ending in **permissionless settlement
by a wallet that is neither party nor the deployer**.

Every step below is a real, finalized transaction. Click any hash to verify it
on the GenLayer Studio explorer. The runnable version of this flow is in
[`test_lifecycle.py`](./test_lifecycle.py).

## Deployed contracts (Studio Network, chain 61999)

| Contract | Address |
|----------|---------|
| CovenantMonitor | `0x906Dd97DEd78B3B9FB198a5227A831b70f8b1180` |
| CovenantVault | `0xd0cED4dd1Fb3605686d057c883A4DDd1bE81b71d` |

## How settlement authenticates verdicts

`CovenantVault.settle()` does not accept a verdict from its caller. It reads the
recorded tiers directly from the monitor contract, cross-contract:

```python
mon = gl.get_contract_at(self.monitor)
...
t = str(mon.view().get_checkpoint_tier(monitor_id, u256(i))).lower().strip()
```

There is no `record_checkpoint` method and no owner-supplied tier anywhere in the
vault — the earlier relay pattern was removed. The verdict a settlement acts on
is always the one the monitor's validators reached consensus on. See
[`../contracts/covenant_vault.py`](../contracts/covenant_vault.py), function
`settle`.

## The permissionless-settle proof

The clearest single piece of evidence: an agreement settled by a **bystander
wallet** — not the provider, not the customer, not the deployer.

- **Settling wallet:** `0xc47F4102428E65E671379453F39b26eb744d96C9`
  (a party to nothing, not the deployer)
- **Settlement transaction:**
  [`0x29d881888c25f9e499e7728ce32979793372f2e6dc2a13a0622c65cd7d03099e`](https://explorer-studio.genlayer.com/tx/0x29d881888c25f9e499e7728ce32979793372f2e6dc2a13a0622c65cd7d03099e)
- **Result:** `Execution SUCCESS`, return value `"satisfied"`, `FINALIZED`,
  consensus Accepted across validators.

The vault has no owner-only settlement path. Anyone can settle once the agreed
checkpoint count is met — the contract enforces the agreement's terms, not the
caller's identity.

## Outcomes proven on-chain

All four settlement tiers were exercised end-to-end, with exact value
conservation (money out always equals money in) each time:

| Tier | Scenario | Distribution (payment / bond) |
|------|----------|-------------------------------|
| **satisfied** | Healthy static endpoint | Provider paid in full (minus 1% fee), bond returned |
| **minor** | Slight degradation | Small customer credit, bond returned |
| **material** | Missing required fields | Customer compensated 20%, half the bond slashed |
| **critical** | Dead / 404 endpoint | Full payment refunded, entire bond slashed |

Example — critical settlement: payment 4,000 + bond 800 in; customer received
4,800, provider 0, bond-to-provider 0. Conservation exact.

## Lifecycle summary

1. **Create** — SLA terms locked on the monitor; the vault cross-contract-verifies
   the parties before binding. Permissionless.
2. **Fund & lock** — provider stakes the bond, customer locks the payment. Held by
   the vault; untouchable until settlement.
3. **Checkpoint** — the monitor fetches the live service; GenLayer validators reach
   consensus on one health verdict. Permissionless to trigger; the caller cannot
   influence the result.
4. **Settle** — permissionless once the agreed checkpoint count is met. The vault
   reads verdicts from the monitor cross-contract and distributes by fixed
   arithmetic. Reverts unless the vault can fully fund the payout (conservation
   enforced as a precondition).