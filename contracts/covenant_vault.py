# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *

VAULT_KEY = "__vault__"


class CovenantVault(gl.Contract):
    fee_bps: u256
    fee_wallet: str
    monitor: Address

    balances: TreeMap[str, u256]
    agreement_count: u256

    v_provider: TreeMap[str, str]
    v_customer: TreeMap[str, str]
    v_payment: TreeMap[str, u256]
    v_bond: TreeMap[str, u256]
    v_payment_locked: TreeMap[str, bool]
    v_bond_locked: TreeMap[str, bool]
    v_status: TreeMap[str, str]
    v_outcome: TreeMap[str, str]

    v_monitor_id: TreeMap[str, str]
    monitor_id_used: TreeMap[str, bool]
    v_checkpoints_required: TreeMap[str, u256]
    v_start_cp: TreeMap[str, u256]
    v_start_uncontested: TreeMap[str, u256]
    v_settled_cp_count: TreeMap[str, u256]
    v_settled_contested: TreeMap[str, u256]

    v_provider_net: TreeMap[str, u256]
    v_customer_total: TreeMap[str, u256]
    v_bond_to_provider: TreeMap[str, u256]
    v_fee_charged: TreeMap[str, u256]

    def __init__(self, fee_bps: u256, monitor_address: str):
        deployer = gl.message.sender_address.as_hex.lower()
        self.fee_wallet = deployer
        self.fee_bps = fee_bps
        self.monitor = Address(monitor_address)
        self.agreement_count = u256(0)

    @gl.public.write
    def mint(self, to_address: str, amount: u256) -> None:
        to_addr = to_address.lower()
        cur = int(self.balances[to_addr]) if to_addr in self.balances else 0
        self.balances[to_addr] = u256(cur + int(amount))

    @gl.public.view
    def balance_of(self, account: str) -> u256:
        acct = account.lower()
        return self.balances[acct] if acct in self.balances else u256(0)

    @gl.public.write
    def create_agreement(
        self,
        provider: str,
        customer: str,
        payment: u256,
        bond: u256,
        monitor_id: str,
        checkpoints_required: u256,
    ) -> str:
        assert int(checkpoints_required) >= 1, "checkpoints_required must be at least 1"
        assert not self.monitor_id_used.get(monitor_id, False), "monitor agreement already bound to a vault case"

        mon = gl.get_contract_at(self.monitor)
        exists = mon.view().get_exists(monitor_id)
        assert exists, "monitor agreement does not exist"

        m = mon.view().get_agreement(monitor_id)
        prov = provider.lower()
        cust = customer.lower()
        assert str(m["provider"]).lower() == prov, "provider does not match monitor agreement"
        assert str(m["customer"]).lower() == cust, "customer does not match monitor agreement"

        idx = u256(int(self.agreement_count) + 1)
        self.agreement_count = idx
        aid = str(idx)

        self.v_provider[aid] = prov
        self.v_customer[aid] = cust
        self.v_payment[aid] = payment
        self.v_bond[aid] = bond
        self.v_payment_locked[aid] = False
        self.v_bond_locked[aid] = False
        self.v_status[aid] = "created"
        self.v_outcome[aid] = ""
        self.v_monitor_id[aid] = monitor_id
        self.monitor_id_used[monitor_id] = True
        self.v_checkpoints_required[aid] = checkpoints_required
        self.v_start_cp[aid] = u256(0)
        self.v_start_uncontested[aid] = u256(0)
        self.v_settled_cp_count[aid] = u256(0)
        self.v_settled_contested[aid] = u256(0)

        return aid

    @gl.public.write
    def lock_payment(self, agreement_id: str) -> None:
        aid = agreement_id
        assert self.v_status.get(aid, "") == "created", "agreement not in created state"
        assert not self.v_payment_locked.get(aid, False), "payment already locked"

        caller = gl.message.sender_address.as_hex.lower()
        assert caller == self.v_customer[aid], "only the customer may lock payment"

        amount = int(self.v_payment[aid])
        bal = int(self.balances[caller]) if caller in self.balances else 0
        assert bal >= amount, "insufficient balance for payment"

        self.balances[caller] = u256(bal - amount)
        vbal = int(self.balances[VAULT_KEY]) if VAULT_KEY in self.balances else 0
        self.balances[VAULT_KEY] = u256(vbal + amount)

        self.v_payment_locked[aid] = True
        self._maybe_activate(aid)

    @gl.public.write
    def lock_bond(self, agreement_id: str) -> None:
        aid = agreement_id
        assert self.v_status.get(aid, "") == "created", "agreement not in created state"
        assert not self.v_bond_locked.get(aid, False), "bond already locked"

        caller = gl.message.sender_address.as_hex.lower()
        assert caller == self.v_provider[aid], "only the provider may lock bond"

        amount = int(self.v_bond[aid])
        bal = int(self.balances[caller]) if caller in self.balances else 0
        assert bal >= amount, "insufficient balance for bond"

        self.balances[caller] = u256(bal - amount)
        vbal = int(self.balances[VAULT_KEY]) if VAULT_KEY in self.balances else 0
        self.balances[VAULT_KEY] = u256(vbal + amount)

        self.v_bond_locked[aid] = True
        self._maybe_activate(aid)

    def _maybe_activate(self, aid: str) -> None:
        if self.v_payment_locked.get(aid, False) and self.v_bond_locked.get(aid, False):
            self.v_status[aid] = "active"
            mon = gl.get_contract_at(self.monitor)
            mid = self.v_monitor_id[aid]
            self.v_start_cp[aid] = u256(int(mon.view().get_checkpoint_count(mid)))
            self.v_start_uncontested[aid] = u256(int(mon.view().get_uncontested_count(mid)))

    @gl.public.write
    def settle(self, agreement_id: str) -> str:
        aid = agreement_id
        assert self.v_status.get(aid, "") == "active", "agreement not active"

        mon = gl.get_contract_at(self.monitor)
        monitor_id = self.v_monitor_id[aid]

        total = int(mon.view().get_checkpoint_count(monitor_id))
        start = int(self.v_start_cp.get(aid, u256(0)))

        total_unc = int(mon.view().get_uncontested_count(monitor_id))
        start_unc = int(self.v_start_uncontested.get(aid, u256(0)))
        uncontested = total_unc - start_unc

        required = int(self.v_checkpoints_required.get(aid, u256(1)))
        assert uncontested >= required, "not enough uncontested checkpoints; contested evidence requires another checkpoint"

        # A contested checkpoint is recorded, but it takes NO part in the
        # outcome: it is excluded from the denominator AND from every severity
        # count. Evidence whose two readings could not agree must not move
        # money in either direction, so the tally runs only on the checkpoints
        # both readings agreed about.
        n = 0
        c_minor = 0
        c_material = 0
        c_critical = 0
        contested_seen = 0
        for i in range(start, total):
            if mon.view().is_checkpoint_contested(monitor_id, u256(i)):
                contested_seen += 1
                continue
            n += 1
            t = str(mon.view().get_checkpoint_tier(monitor_id, u256(i))).lower().strip()
            if t == "minor":
                c_minor += 1
            elif t == "material":
                c_material += 1
            elif t == "critical":
                c_critical += 1
            elif t != "satisfied":
                c_material += 1

        # the denominator is the uncontested evidence, by construction
        assert n == uncontested, "tally denominator must equal the uncontested count"

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
        else:
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
        self.v_settled_cp_count[aid] = u256(n)
        self.v_settled_contested[aid] = u256(contested_seen)
        self.v_outcome[aid] = outcome
        self.v_status[aid] = "settled"

        return outcome

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
            "monitor_id": self.v_monitor_id.get(aid, ""),
            "checkpoints_required": str(self.v_checkpoints_required.get(aid, u256(0))),
            "start_cp": str(self.v_start_cp.get(aid, u256(0))),
            "start_uncontested": str(self.v_start_uncontested.get(aid, u256(0))),
            "settled_cp_count": str(self.v_settled_cp_count.get(aid, u256(0))),
            "settled_contested": str(self.v_settled_contested.get(aid, u256(0))),
        }

    @gl.public.view
    def get_settle_progress(self, agreement_id: str) -> dict:
        aid = agreement_id
        mon = gl.get_contract_at(self.monitor)
        mid = self.v_monitor_id.get(aid, "")
        if mid == "":
            return {"uncontested": "0", "contested": "0", "required": "0", "ready": False}
        total_unc = int(mon.view().get_uncontested_count(mid))
        start_unc = int(self.v_start_uncontested.get(aid, u256(0)))
        total_cp = int(mon.view().get_checkpoint_count(mid))
        start_cp = int(self.v_start_cp.get(aid, u256(0)))
        unc = total_unc - start_unc
        req = int(self.v_checkpoints_required.get(aid, u256(1)))
        return {
            "uncontested": str(unc),
            "contested": str((total_cp - start_cp) - unc),
            "required": str(req),
            "ready": unc >= req,
        }

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
            "settled_contested": str(self.v_settled_contested.get(aid, u256(0))),
        }

    @gl.public.view
    def get_agreement_count(self) -> u256:
        return self.agreement_count

    @gl.public.view
    def get_fee_wallet(self) -> str:
        return self.fee_wallet

    @gl.public.view
    def get_fee_bps(self) -> u256:
        return self.fee_bps

    @gl.public.view
    def get_monitor_address(self) -> str:
        return self.monitor.as_hex
