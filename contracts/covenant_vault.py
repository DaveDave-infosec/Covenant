# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *

# fixed internal-ledger key for funds held by the vault itself.
# no real wallet address can equal this (wallets are 0x-hex), so no collision.
VAULT_KEY = "__vault__"


class CovenantVault(gl.Contract):
    owner: str
    fee_bps: u256                   # protocol fee in basis points (100 = 1%)
    fee_wallet: str                 # where protocol fees accrue (owner by default)

    # ---- internal token ledger (the vault IS the token — Holdline pattern) ----
    balances: TreeMap[str, u256]

    agreement_count: u256

    # ---- agreement core (flat parallel TreeMaps, keyed by agreement id str) ----
    v_provider: TreeMap[str, str]
    v_customer: TreeMap[str, str]
    v_payment: TreeMap[str, u256]           # customer's locked service payment
    v_bond: TreeMap[str, u256]              # provider's locked performance bond
    v_payment_locked: TreeMap[str, bool]
    v_bond_locked: TreeMap[str, bool]
    v_status: TreeMap[str, str]             # "created" | "active" | "settled"
    v_outcome: TreeMap[str, str]            # final tier once settled

    # ---- recorded checkpoint verdicts (flat parallel TreeMaps) ----
    # keyed by "<agreement_id>:<checkpoint_index>"
    v_cp_count: TreeMap[str, u256]
    v_cp_tier: TreeMap[str, str]

    # ---- final distribution record (keyed by agreement id) ----
    v_provider_net: TreeMap[str, u256]
    v_customer_total: TreeMap[str, u256]
    v_bond_to_provider: TreeMap[str, u256]
    v_fee_charged: TreeMap[str, u256]

    def __init__(self, fee_bps: u256):
        owner_addr = gl.message.sender_address.as_hex.lower()
        self.owner = owner_addr
        self.fee_wallet = owner_addr
        self.fee_bps = fee_bps
        self.agreement_count = u256(0)

    # ---------------------------------------------------------------
    # Internal token ledger (Holdline pattern — the vault IS the token)
    # ---------------------------------------------------------------
    @gl.public.write
    def mint(self, to_address: str, amount: u256) -> None:
        to_addr = to_address.lower()
        cur = int(self.balances[to_addr]) if to_addr in self.balances else 0
        self.balances[to_addr] = u256(cur + int(amount))

    @gl.public.view
    def balance_of(self, account: str) -> u256:
        acct = account.lower()
        return self.balances[acct] if acct in self.balances else u256(0)

    # ---------------------------------------------------------------
    # Create the agreement record (parties + amounts). Owner/relay only.
    # ---------------------------------------------------------------
    @gl.public.write
    def create_agreement(
        self,
        provider: str,
        customer: str,
        payment: u256,
        bond: u256,
    ) -> str:
        sender = gl.message.sender_address.as_hex.lower()
        assert sender == self.owner, "only owner may create agreements"

        idx = u256(int(self.agreement_count) + 1)
        self.agreement_count = idx
        aid = str(idx)

        self.v_provider[aid] = provider.lower()
        self.v_customer[aid] = customer.lower()
        self.v_payment[aid] = payment
        self.v_bond[aid] = bond
        self.v_payment_locked[aid] = False
        self.v_bond_locked[aid] = False
        self.v_status[aid] = "created"
        self.v_outcome[aid] = ""
        self.v_cp_count[aid] = u256(0)

        return aid

    # ---------------------------------------------------------------
    # Customer locks the service payment (internal balance move into vault).
    # Caller must be the customer on the agreement.
    # ---------------------------------------------------------------
    @gl.public.write
    def lock_payment(self, agreement_id: str) -> None:
        aid = agreement_id
        assert self.v_status.get(aid, "") == "created", "agreement not in created state"
        assert not self.v_payment_locked.get(aid, False), "payment already locked"

        caller = gl.message.sender_address.as_hex.lower()
        assert caller == self.v_customer[aid], "only the customer may lock payment"

        amount = int(self.v_payment[aid])
        bal = int(self.balances[caller]) if caller in self.balances else 0
        assert bal >= amount, "insufficient genUSDC balance for payment"

        # move from customer into the vault's own balance
        self.balances[caller] = u256(bal - amount)
        vbal = int(self.balances[VAULT_KEY]) if VAULT_KEY in self.balances else 0
        self.balances[VAULT_KEY] = u256(vbal + amount)

        self.v_payment_locked[aid] = True
        self._maybe_activate(aid)

    # ---------------------------------------------------------------
    # Provider locks the performance bond (internal balance move into vault).
    # Caller must be the provider on the agreement.
    # ---------------------------------------------------------------
    @gl.public.write
    def lock_bond(self, agreement_id: str) -> None:
        aid = agreement_id
        assert self.v_status.get(aid, "") == "created", "agreement not in created state"
        assert not self.v_bond_locked.get(aid, False), "bond already locked"

        caller = gl.message.sender_address.as_hex.lower()
        assert caller == self.v_provider[aid], "only the provider may lock bond"

        amount = int(self.v_bond[aid])
        bal = int(self.balances[caller]) if caller in self.balances else 0
        assert bal >= amount, "insufficient genUSDC balance for bond"

        self.balances[caller] = u256(bal - amount)
        vbal = int(self.balances[VAULT_KEY]) if VAULT_KEY in self.balances else 0
        self.balances[VAULT_KEY] = u256(vbal + amount)

        self.v_bond_locked[aid] = True
        self._maybe_activate(aid)

    def _maybe_activate(self, aid: str) -> None:
        if self.v_payment_locked.get(aid, False) and self.v_bond_locked.get(aid, False):
            self.v_status[aid] = "active"

    # ---------------------------------------------------------------
    # Record a checkpoint verdict into the vault (owner/relay only).
    # ---------------------------------------------------------------
    @gl.public.write
    def record_checkpoint(self, agreement_id: str, tier: str) -> None:
        sender = gl.message.sender_address.as_hex.lower()
        assert sender == self.owner, "only owner may record checkpoints"

        aid = agreement_id
        assert self.v_status.get(aid, "") == "active", "agreement not active"
        assert tier in ("satisfied", "minor", "material", "critical"), "invalid tier"

        cp_idx = int(self.v_cp_count.get(aid, u256(0)))
        key = aid + ":" + str(cp_idx)
        self.v_cp_tier[key] = tier
        self.v_cp_count[aid] = u256(cp_idx + 1)

    # ---------------------------------------------------------------
    # Final settlement — DETERMINISTIC tally, all internal balance moves.
    # ---------------------------------------------------------------
    @gl.public.write
    def settle(self, agreement_id: str) -> str:
        sender = gl.message.sender_address.as_hex.lower()
        assert sender == self.owner, "only owner may settle"

        aid = agreement_id
        assert self.v_status.get(aid, "") == "active", "agreement not active"

        n = int(self.v_cp_count.get(aid, u256(0)))
        assert n > 0, "no checkpoints recorded"

        c_minor = 0
        c_material = 0
        c_critical = 0
        for i in range(n):
            key = aid + ":" + str(i)
            t = self.v_cp_tier.get(key, "")
            if t == "minor":
                c_minor += 1
            elif t == "material":
                c_material += 1
            elif t == "critical":
                c_critical += 1

        if c_critical >= 1 or (c_material * 2) > n:
            outcome = "critical"
        elif c_material >= 1 or (c_minor * 2) > n:
            outcome = "material"
        elif c_minor >= 1:
            outcome = "minor"
        else:
            outcome = "satisfied"

        payment = int(self.v_payment[aid])
        bond = int(self.v_bond[aid])

        if outcome == "satisfied":
            provider_gross = payment
            customer_back = 0
            bond_to_provider = bond
            bond_penalty = 0
        elif outcome == "minor":
            credit = payment * 5 // 100
            provider_gross = payment - credit
            customer_back = credit
            bond_to_provider = bond
            bond_penalty = 0
        elif outcome == "material":
            comp = payment * 20 // 100
            provider_gross = payment - comp
            customer_back = comp
            penalty = bond * 50 // 100
            bond_to_provider = bond - penalty
            bond_penalty = penalty
        else:  # critical
            provider_gross = 0
            customer_back = payment
            bond_to_provider = 0
            bond_penalty = bond

        fee_bps = int(self.fee_bps)
        fee = provider_gross * fee_bps // 10000
        provider_net = provider_gross - fee
        customer_total = customer_back + bond_penalty

        provider = self.v_provider[aid]
        customer = self.v_customer[aid]

        # pull the total settlement amount out of the vault's balance and
        # distribute internally
        total_out = provider_net + customer_total + bond_to_provider + fee
        vbal = int(self.balances[VAULT_KEY]) if VAULT_KEY in self.balances else 0
        assert vbal >= total_out, "vault balance below settlement total"
        self.balances[VAULT_KEY] = u256(vbal - total_out)

        if provider_net > 0:
            pbal = int(self.balances[provider]) if provider in self.balances else 0
            self.balances[provider] = u256(pbal + provider_net)
        if bond_to_provider > 0:
            pbal2 = int(self.balances[provider]) if provider in self.balances else 0
            self.balances[provider] = u256(pbal2 + bond_to_provider)
        if customer_total > 0:
            cbal = int(self.balances[customer]) if customer in self.balances else 0
            self.balances[customer] = u256(cbal + customer_total)
        if fee > 0:
            fw = self.fee_wallet
            fbal = int(self.balances[fw]) if fw in self.balances else 0
            self.balances[fw] = u256(fbal + fee)

        self.v_provider_net[aid] = u256(provider_net)
        self.v_customer_total[aid] = u256(customer_total)
        self.v_bond_to_provider[aid] = u256(bond_to_provider)
        self.v_fee_charged[aid] = u256(fee)
        self.v_outcome[aid] = outcome
        self.v_status[aid] = "settled"

        return outcome

    # ---------------------------------------------------------------
    # Views
    # ---------------------------------------------------------------
    @gl.public.view
    def get_agreement(self, agreement_id: str) -> dict:
        aid = agreement_id
        return {
            "id": aid,
            "provider": self.v_provider.get(aid, ""),
            "customer": self.v_customer.get(aid, ""),
            "payment": str(self.v_payment.get(aid, u256(0))),
            "bond": str(self.v_bond.get(aid, u256(0))),
            "payment_locked": self.v_payment_locked.get(aid, False),
            "bond_locked": self.v_bond_locked.get(aid, False),
            "status": self.v_status.get(aid, ""),
            "outcome": self.v_outcome.get(aid, ""),
            "checkpoint_count": str(self.v_cp_count.get(aid, u256(0))),
        }

    @gl.public.view
    def get_checkpoint_tier(self, agreement_id: str, index: u256) -> str:
        key = agreement_id + ":" + str(int(index))
        return self.v_cp_tier.get(key, "")

    @gl.public.view
    def get_settlement(self, agreement_id: str) -> dict:
        aid = agreement_id
        return {
            "outcome": self.v_outcome.get(aid, ""),
            "provider_net": str(self.v_provider_net.get(aid, u256(0))),
            "customer_total": str(self.v_customer_total.get(aid, u256(0))),
            "bond_to_provider": str(self.v_bond_to_provider.get(aid, u256(0))),
            "fee_charged": str(self.v_fee_charged.get(aid, u256(0))),
            "status": self.v_status.get(aid, ""),
        }

    @gl.public.view
    def get_agreement_count(self) -> u256:
        return self.agreement_count

    @gl.public.view
    def get_owner(self) -> str:
        return self.owner

    @gl.public.view
    def get_fee_bps(self) -> u256:
        return self.fee_bps
