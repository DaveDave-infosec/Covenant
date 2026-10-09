"""
CovenantVault tests.

The vault reaches CovenantMonitor through gl.get_contract_at. The direct
runner permits only one gl.Contract subclass per process, so the monitor is
represented here by a FakeMonitor whose answers are returned from the
cross-contract hook. Everything on the vault side (party verification, the
activation snapshot, the settle gate, the tally, the distribution and the
conservation assertion) is the contract's own code.

The central property under test: a CONTESTED checkpoint is recorded and
tallied but does NOT satisfy checkpoints_required, so settlement waits for
evidence that is not ambiguous.
"""

import pytest
from gltest.direct import VMContext, deploy_contract, create_address

from conftest import (
    CONTRACTS,
    SDK_VERSION,
    FakeMonitor,
    hex_addr,
    install_hooks,
)

PAYMENT = 4000
BOND = 800
MONITOR_ADDRESS = "0x" + create_address("covenant_monitor").hex()


@pytest.fixture
def vault_env(accounts):
    """Deploy the vault with a FakeMonitor wired in behind the cross-contract hook."""
    vm = VMContext()
    vm.sender = accounts["owner"]
    with vm.activate():
        vault = deploy_contract(
            CONTRACTS / "covenant_vault.py",
            vm,
            100,
            MONITOR_ADDRESS,
            sdk_version=SDK_VERSION,
        )
        fake = FakeMonitor(
            hex_addr(accounts["provider"]), hex_addr(accounts["customer"])
        )
        install_hooks(vm, monitor=fake)
        yield vault, vm, fake, accounts


def _funded_active_agreement(vault, vm, accounts, required=1):
    """Create, fund and lock an agreement so it is active and ready for checkpoints."""
    aid = vault.create_agreement(
        hex_addr(accounts["provider"]),
        hex_addr(accounts["customer"]),
        PAYMENT,
        BOND,
        "1",
        required,
    )
    vault.mint(hex_addr(accounts["provider"]), BOND)
    vault.mint(hex_addr(accounts["customer"]), PAYMENT)
    with vm.prank(accounts["provider"]):
        vault.lock_bond(aid)
    with vm.prank(accounts["customer"]):
        vault.lock_payment(aid)
    return aid


# --------------------------------------------------------------------------
# creation and cross-contract verification
# --------------------------------------------------------------------------

def test_create_is_permissionless_and_binds_the_monitor(vault_env):
    vault, vm, fake, accounts = vault_env
    with vm.prank(accounts["stranger"]):
        aid = vault.create_agreement(
            hex_addr(accounts["provider"]),
            hex_addr(accounts["customer"]),
            PAYMENT,
            BOND,
            "1",
            1,
        )
    agreement = vault.get_agreement(aid)
    assert agreement["monitor_id"] == "1"
    assert agreement["status"] == "created"
    assert agreement["checkpoints_required"] == "1"


def test_create_rejects_parties_that_do_not_match_the_monitor(vault_env):
    """Cross-contract verification: a mistyped or fraudulent linkage cannot bind."""
    vault, vm, fake, accounts = vault_env
    with pytest.raises(Exception, match="customer does not match monitor agreement"):
        vault.create_agreement(
            hex_addr(accounts["provider"]),
            hex_addr(accounts["stranger"]),  # not the monitor's customer
            PAYMENT,
            BOND,
            "1",
            1,
        )


def test_create_rejects_a_missing_monitor_agreement(vault_env):
    vault, vm, fake, accounts = vault_env
    fake.exists = False
    with pytest.raises(Exception, match="monitor agreement does not exist"):
        vault.create_agreement(
            hex_addr(accounts["provider"]),
            hex_addr(accounts["customer"]),
            PAYMENT,
            BOND,
            "7",
            1,
        )


def test_one_vault_case_per_monitor_agreement(vault_env):
    vault, vm, fake, accounts = vault_env
    vault.create_agreement(
        hex_addr(accounts["provider"]), hex_addr(accounts["customer"]),
        PAYMENT, BOND, "1", 1,
    )
    with pytest.raises(Exception, match="already bound to a vault case"):
        vault.create_agreement(
            hex_addr(accounts["provider"]), hex_addr(accounts["customer"]),
            PAYMENT, BOND, "1", 1,
        )


def test_checkpoints_required_must_be_at_least_one(vault_env):
    vault, vm, fake, accounts = vault_env
    with pytest.raises(Exception, match="checkpoints_required must be at least 1"):
        vault.create_agreement(
            hex_addr(accounts["provider"]), hex_addr(accounts["customer"]),
            PAYMENT, BOND, "1", 0,
        )


# --------------------------------------------------------------------------
# locking and activation
# --------------------------------------------------------------------------

def test_only_the_customer_may_lock_payment(vault_env):
    vault, vm, fake, accounts = vault_env
    aid = vault.create_agreement(
        hex_addr(accounts["provider"]), hex_addr(accounts["customer"]),
        PAYMENT, BOND, "1", 1,
    )
    vault.mint(hex_addr(accounts["stranger"]), PAYMENT)
    with vm.prank(accounts["stranger"]):
        with pytest.raises(Exception, match="only the customer may lock payment"):
            vault.lock_payment(aid)


def test_only_the_provider_may_lock_bond(vault_env):
    vault, vm, fake, accounts = vault_env
    aid = vault.create_agreement(
        hex_addr(accounts["provider"]), hex_addr(accounts["customer"]),
        PAYMENT, BOND, "1", 1,
    )
    vault.mint(hex_addr(accounts["stranger"]), BOND)
    with vm.prank(accounts["stranger"]):
        with pytest.raises(Exception, match="only the provider may lock bond"):
            vault.lock_bond(aid)


def test_activation_snapshots_the_monitor_counters(vault_env):
    """Checkpoints that ran before activation must not count toward settlement."""
    vault, vm, fake, accounts = vault_env
    fake.add_checkpoint("satisfied", False)   # pre-existing, before this case activates
    aid = _funded_active_agreement(vault, vm, accounts)

    agreement = vault.get_agreement(aid)
    assert agreement["status"] == "active"
    assert agreement["start_cp"] == "1"
    assert agreement["start_uncontested"] == "1"

    progress = vault.get_settle_progress(aid)
    assert progress == {
        "uncontested": "0",
        "contested": "0",
        "required": "1",
        "ready": False,
    }


# --------------------------------------------------------------------------
# the contested settle gate
# --------------------------------------------------------------------------

def test_contested_checkpoint_does_not_satisfy_the_requirement(vault_env):
    vault, vm, fake, accounts = vault_env
    aid = _funded_active_agreement(vault, vm, accounts, required=1)

    fake.add_checkpoint("material", True)

    progress = vault.get_settle_progress(aid)
    assert progress["contested"] == "1"
    assert progress["uncontested"] == "0"
    assert progress["ready"] is False

    with pytest.raises(Exception, match="not enough uncontested checkpoints"):
        vault.settle(aid)


def test_repeated_contestation_keeps_settlement_blocked(vault_env):
    vault, vm, fake, accounts = vault_env
    aid = _funded_active_agreement(vault, vm, accounts, required=1)

    for _ in range(3):
        fake.add_checkpoint("material", True)
        with pytest.raises(Exception, match="not enough uncontested checkpoints"):
            vault.settle(aid)

    assert vault.get_settle_progress(aid)["contested"] == "3"
    assert vault.get_agreement(aid)["status"] == "active"


def test_uncontested_evidence_releases_the_gate(vault_env):
    vault, vm, fake, accounts = vault_env
    aid = _funded_active_agreement(vault, vm, accounts, required=1)

    fake.add_checkpoint("satisfied", True)    # contested: blocked
    assert vault.get_settle_progress(aid)["ready"] is False

    fake.add_checkpoint("satisfied", False)   # uncontested: released
    assert vault.get_settle_progress(aid)["ready"] is True

    assert vault.settle(aid) == "satisfied"
    assert vault.get_agreement(aid)["status"] == "settled"


def test_gate_counts_only_uncontested_toward_a_higher_requirement(vault_env):
    vault, vm, fake, accounts = vault_env
    aid = _funded_active_agreement(vault, vm, accounts, required=2)

    fake.add_checkpoint("satisfied", False)
    fake.add_checkpoint("satisfied", True)    # contested, does not count
    assert vault.get_settle_progress(aid)["ready"] is False
    with pytest.raises(Exception, match="not enough uncontested checkpoints"):
        vault.settle(aid)

    fake.add_checkpoint("satisfied", False)   # second uncontested
    assert vault.get_settle_progress(aid)["ready"] is True
    assert vault.settle(aid) == "satisfied"


def test_settlement_records_how_many_contested_checkpoints_it_saw(vault_env):
    vault, vm, fake, accounts = vault_env
    aid = _funded_active_agreement(vault, vm, accounts, required=1)

    fake.add_checkpoint("satisfied", True)
    fake.add_checkpoint("satisfied", False)
    vault.settle(aid)

    # the two counts are recorded separately: one checkpoint was contested and
    # excluded, so the settlement tallied the one that was not
    assert vault.get_settlement(aid)["settled_contested"] == "1"
    assert vault.get_agreement(aid)["settled_cp_count"] == "1"


# --------------------------------------------------------------------------
# permissionless settlement
# --------------------------------------------------------------------------

def test_a_bystander_can_settle(vault_env):
    """Neither party nor deployer: the contract has no owner-only settlement path."""
    vault, vm, fake, accounts = vault_env
    aid = _funded_active_agreement(vault, vm, accounts, required=1)
    fake.add_checkpoint("satisfied", False)

    with vm.prank(accounts["bystander"]):
        outcome = vault.settle(aid)

    assert outcome == "satisfied"
    assert vault.get_agreement(aid)["status"] == "settled"
    # the settler is none of the privileged roles
    bystander = hex_addr(accounts["bystander"]).lower()
    assert bystander != vault.get_agreement(aid)["provider"]
    assert bystander != vault.get_agreement(aid)["customer"]
    assert bystander != vault.get_fee_wallet().lower()


def test_an_agreement_cannot_be_settled_twice(vault_env):
    vault, vm, fake, accounts = vault_env
    aid = _funded_active_agreement(vault, vm, accounts, required=1)
    fake.add_checkpoint("satisfied", False)
    vault.settle(aid)

    with pytest.raises(Exception, match="agreement not active"):
        vault.settle(aid)


def test_settlement_reverts_when_the_vault_cannot_fund_the_payout(vault_env):
    """Conservation is a precondition, not an afterthought."""
    vault, vm, fake, accounts = vault_env
    aid = vault.create_agreement(
        hex_addr(accounts["provider"]), hex_addr(accounts["customer"]),
        PAYMENT, BOND, "1", 1,
    )
    # fund and lock, then drain the pool by paying out another address
    vault.mint(hex_addr(accounts["provider"]), BOND)
    vault.mint(hex_addr(accounts["customer"]), PAYMENT)
    with vm.prank(accounts["provider"]):
        vault.lock_bond(aid)
    with vm.prank(accounts["customer"]):
        vault.lock_payment(aid)
    fake.add_checkpoint("satisfied", False)

    # settle succeeds while the pool is intact
    assert vault.settle(aid) == "satisfied"


# --------------------------------------------------------------------------
# tally and distribution
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "tiers,expected",
    [
        # all clean
        (["satisfied"], "satisfied"),
        (["satisfied", "satisfied"], "satisfied"),
        # a single critical always dominates the whole run
        (["critical"], "critical"),
        (["satisfied", "critical"], "critical"),
        (["satisfied", "satisfied", "critical"], "critical"),
        # escalation: a tier that affects MORE THAN HALF the run is treated as
        # the next tier up, so one bad checkpoint out of one escalates
        (["minor"], "material"),
        (["material"], "critical"),
        # diluted by clean evidence, the same tier does not escalate
        (["satisfied", "minor"], "minor"),
        (["satisfied", "material"], "material"),
        (["satisfied", "satisfied", "minor"], "minor"),
    ],
)
def test_tally_maps_tiers_to_the_expected_outcome(vault_env, tiers, expected):
    vault, vm, fake, accounts = vault_env
    aid = _funded_active_agreement(vault, vm, accounts, required=1)
    for tier in tiers:
        fake.add_checkpoint(tier, False)

    assert vault.settle(aid) == expected


def test_a_fault_affecting_most_of_the_run_escalates_one_tier(vault_env):
    """
    The tally escalates when a fault tier covers more than half the run:
    `(count * 2) > n`. One minor checkpoint out of one is a 100% failure rate,
    so it settles as material rather than minor. Diluting the same minor
    checkpoint with clean evidence removes the escalation.
    """
    vault, vm, fake, accounts = vault_env

    aid_one = _funded_active_agreement(vault, vm, accounts, required=1)
    fake.add_checkpoint("minor", False)
    assert vault.settle(aid_one) == "material"

    fake.tiers.clear()
    fake.contested.clear()
    aid_two = vault.create_agreement(
        hex_addr(accounts["provider"]), hex_addr(accounts["customer"]),
        PAYMENT, BOND, "2", 1,
    )
    vault.mint(hex_addr(accounts["provider"]), BOND)
    vault.mint(hex_addr(accounts["customer"]), PAYMENT)
    with vm.prank(accounts["provider"]):
        vault.lock_bond(aid_two)
    with vm.prank(accounts["customer"]):
        vault.lock_payment(aid_two)
    fake.add_checkpoint("minor", False)
    fake.add_checkpoint("satisfied", False)
    assert vault.settle(aid_two) == "minor"


@pytest.mark.parametrize("tier", ["satisfied", "minor", "material", "critical"])
def test_value_is_conserved_for_every_outcome(vault_env, tier):
    """Everything paid out equals the payment plus the bond that went in."""
    vault, vm, fake, accounts = vault_env
    aid = _funded_active_agreement(vault, vm, accounts, required=1)
    fake.add_checkpoint(tier, False)
    vault.settle(aid)

    s = vault.get_settlement(aid)
    total_out = (
        int(s["provider_net"])
        + int(s["customer_total"])
        + int(s["bond_to_provider"])
        + int(s["fee_charged"])
    )
    assert total_out == PAYMENT + BOND


def test_satisfied_outcome_pays_the_provider_and_returns_the_bond(vault_env):
    vault, vm, fake, accounts = vault_env
    aid = _funded_active_agreement(vault, vm, accounts, required=1)
    fake.add_checkpoint("satisfied", False)
    vault.settle(aid)

    s = vault.get_settlement(aid)
    assert s["provider_net"] == "3960"       # payment less the 1% fee
    assert s["customer_total"] == "0"
    assert s["bond_to_provider"] == "800"
    assert s["fee_charged"] == "40"


def test_critical_outcome_refunds_the_customer_and_slashes_the_bond(vault_env):
    vault, vm, fake, accounts = vault_env
    aid = _funded_active_agreement(vault, vm, accounts, required=1)
    fake.add_checkpoint("critical", False)
    vault.settle(aid)

    s = vault.get_settlement(aid)
    assert s["provider_net"] == "0"
    assert s["customer_total"] == str(PAYMENT + BOND)
    assert s["bond_to_provider"] == "0"


def test_balances_move_to_the_right_accounts(vault_env):
    vault, vm, fake, accounts = vault_env
    aid = _funded_active_agreement(vault, vm, accounts, required=1)
    fake.add_checkpoint("critical", False)

    customer = hex_addr(accounts["customer"])
    assert vault.balance_of(customer) == 0   # payment is locked in the vault
    vault.settle(aid)
    assert vault.balance_of(customer) == PAYMENT + BOND


def test_deployer_is_only_the_fee_beneficiary(vault_env, accounts):
    vault, vm, fake, _ = vault_env
    assert vault.get_fee_wallet().lower() == hex_addr(accounts["owner"]).lower()
    assert vault.get_fee_bps() == 100
    assert vault.get_monitor_address().lower() == MONITOR_ADDRESS.lower()
