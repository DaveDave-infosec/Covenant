## Trust model

Covenant decentralizes the two things that matter — the judgment and the money path — and is honest about what it does not.

**Decentralized:**

- **Judgment.** Verdicts come from GenLayer validator consensus fetching the live service. No party, including the deployer, can choose or overwrite a verdict.
- **Creation** is permissionless. Anyone can register an agreement; it moves no funds, and the vault rejects any agreement whose parties do not match the referenced monitor agreement.
- **Checkpoints** are permissionless. Anyone can trigger a measurement; the caller has no influence on the result.
- **Settlement** is permissionless. Anyone can settle once the agreed checkpoint count is met — proven on-chain by a wallet that was neither party nor deployer successfully settling an agreement ([settlement transaction](https://explorer-studio.genlayer.com/tx/0x29d881888c25f9e499e7728ce32979793372f2e6dc2a13a0622c65cd7d03099e)).

**The "owner" holds no authority.** The deployer address is only the fee beneficiary (a 1% protocol fee on provider proceeds) and the wallet the demo UI gates its operator console on — a frontend convenience, not a contract power. The contracts contain no owner-only settlement or verdict path.

**Disclosed limitations (v1 on-chain scope):**

- **The token is an open testnet faucet.** `mint` is unrestricted so reviewers can self-fund. In production this would be a deposit of a real token, not a faucet.
- **No checkpoint spacing is enforced.** An agreement requiring N checkpoints can have all N run in quick succession; the contract does not require them to be spread over time. A production version would enforce block-time spacing.
- **Conservation is enforced as a precondition.** Settlement reverts if the vault cannot fully fund the payout, so an underfunded agreement cannot settle — correct, but it means funding must complete before settlement.

## Verification

Every decentralization claim here is verifiable in the repo or on-chain:

- **Settlement consumes authenticated monitor verdicts, cross-contract.**
  `CovenantVault.settle()` reads each verdict directly from the monitor via
  `gl.get_contract_at(self.monitor).view().get_checkpoint_tier(...)` — it never
  accepts a tier from its caller, and no `record_checkpoint` relay exists. See
  [`contracts/covenant_vault.py`](./contracts/covenant_vault.py), function `settle`.

- **Permissionless settlement, proven on-chain.** A bystander wallet
  (`0xc47F4102428E65E671379453F39b26eb744d96C9`) — neither party nor deployer —
  settled a live agreement:
  [settlement transaction](https://explorer-studio.genlayer.com/tx/0x29d881888c25f9e499e7728ce32979793372f2e6dc2a13a0622c65cd7d03099e)
  (SUCCESS, `"satisfied"`, FINALIZED).

- **Full lifecycle test.** [`tests/test_lifecycle.py`](./tests/test_lifecycle.py)
  verifies the real on-chain settled agreement — asserting permissionless
  settlement (settler is neither party nor deployer), verdict authentication
  (settled outcome derives from the monitor's recorded tier), and exact value
  conservation. Runs keyless against live contract state.
  [`tests/README.md`](./tests/README.md) documents the on-chain evidence.

## Deployed contracts

GenLayer Studio Network · Chain ID 61999 (hex `0xF22F`)

| Contract | Address |
|----------|---------|
| CovenantMonitor | `0x906Dd97DEd78B3B9FB198a5227A831b70f8b1180` |
| CovenantVault | `0xd0cED4dd1Fb3605686d057c883A4DDd1bE81b71d` |

Proven on-chain: all four settlement tiers, permissionless creation with cross-contract verification, permissionless settlement by a non-party, and exact value conservation across every settlement.

## Running the frontend

```bash
cd frontend
npm install
npm run dev
```

The app connects to the GenLayer Studio Network via an injected wallet (e.g. MetaMask) and will prompt to add the network on first connect. Contract addresses are compiled in from `src/lib/constants.ts`.

## Using it

Covenant has a specific lifecycle — create, fund, lock, checkpoint, settle — with different actions belonging to different parties. **See [GUIDE.md](./GUIDE.md) for a full step-by-step walkthrough**, including which wallet performs each action and how to read the on-chain record.

## Tech stack

React + TypeScript + Vite frontend, `genlayer-js` for contract calls, two GenLayer intelligent contracts in Python. The frontend reads every agreement live from the contracts — the on-chain record is not a cached feed.

---

Built on the GenLayer Studio Network.
