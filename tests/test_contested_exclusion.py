"""
Contested checkpoints must take NO part in the outcome.

The settle gate in test_vault.py decides WHEN an agreement may settle. These
tests cover the separate question of WHAT it settles to. A checkpoint whose two
readings could not agree is recorded, but it must be excluded from the outcome
denominator and from every severity count: evidence the contract itself
declared unresolved must not move money in either direction.

The flaw these were written against cut both ways. A contested adverse reading
dragged an otherwise clean run into a penalty, and contested checkpoints padded
the denominator so a real breach was softened. Both are covered below.
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

# a satisfied settlement at the 1% protocol fee
SATISFIED_PROVIDER_NET = 3960

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
    """Create, fund and lock an agreement so it is active and ready to settle."""
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


def test_a_contested_adverse_tier_cannot_spoil_a_satisfied_payout(vault_env):
    """
    One contested checkpoint whose strict reading was material, followed by
    enough uncontested satisfied evidence. The contested checkpoint must not
    appear in the tally at all, so the agreement settles satisfied and the
    provider is paid in full.
    """
    vault, vm, fake, accounts = vault_env
    aid = _funded_active_agreement(vault, vm, accounts, required=1)

    fake.add_checkpoint("material", True)    # excluded entirely
    fake.add_checkpoint("satisfied", False)  # the only evidence that counts

    outcome = vault.settle(aid)

    assert outcome == "satisfied", (
        f"a contested material reading changed the outcome to {outcome}; "
        "contested evidence must not count toward severity"
    )
    settlement = vault.get_settlement(aid)
    assert settlement["provider_net"] == str(SATISFIED_PROVIDER_NET)
    assert settlement["customer_total"] == "0"
    assert settlement["bond_to_provider"] == str(BOND)
    assert settlement["settled_contested"] == "1"


def test_a_contested_critical_tier_cannot_spoil_a_satisfied_payout(vault_env):
    """The same with the most severe tier, which normally dominates outright."""
    vault, vm, fake, accounts = vault_env
    aid = _funded_active_agreement(vault, vm, accounts, required=2)

    fake.add_checkpoint("critical", True)
    fake.add_checkpoint("satisfied", False)
    fake.add_checkpoint("satisfied", False)

    outcome = vault.settle(aid)

    assert outcome == "satisfied", (
        f"a contested critical reading changed the outcome to {outcome}"
    )
    assert vault.get_settlement(aid)["provider_net"] == str(SATISFIED_PROVIDER_NET)


def test_contested_checkpoints_are_excluded_from_the_denominator(vault_env):
    """
    Exclusion must apply to the denominator too, not only the severity counts.

    One uncontested minor out of one counting checkpoint escalates to material
    under the (count * 2) > n rule. Padding the run with contested checkpoints
    must not dilute that denominator and soften the outcome.
    """
    vault, vm, fake, accounts = vault_env
    aid = _funded_active_agreement(vault, vm, accounts, required=1)

    fake.add_checkpoint("satisfied", True)
    fake.add_checkpoint("satisfied", True)
    fake.add_checkpoint("minor", False)

    outcome = vault.settle(aid)

    assert outcome == "material", (
        f"contested checkpoints diluted the denominator; outcome was {outcome}, "
        "but one minor out of one counting checkpoint must escalate to material"
    )


def test_an_adverse_uncontested_tier_still_counts(vault_env):
    """
    The exclusion must not become a loophole. Evidence both readings agreed on
    is real evidence, and it penalises exactly as before.
    """
    vault, vm, fake, accounts = vault_env
    aid = _funded_active_agreement(vault, vm, accounts, required=1)

    fake.add_checkpoint("material", False)
    fake.add_checkpoint("satisfied", False)

    outcome = vault.settle(aid)

    assert outcome == "material"
    settlement = vault.get_settlement(aid)
    assert settlement["customer_total"] == str(PAYMENT * 20 // 100 + BOND * 50 // 100)


def test_value_is_conserved_when_contested_evidence_is_excluded(vault_env):
    """Excluding checkpoints from the tally must not leak or mint value."""
    vault, vm, fake, accounts = vault_env
    aid = _funded_active_agreement(vault, vm, accounts, required=1)

    fake.add_checkpoint("critical", True)
    fake.add_checkpoint("minor", True)
    fake.add_checkpoint("satisfied", False)

    vault.settle(aid)

    settlement = vault.get_settlement(aid)
    total_out = (
        int(settlement["provider_net"])
        + int(settlement["customer_total"])
        + int(settlement["bond_to_provider"])
        + int(settlement["fee_charged"])
    )
    assert total_out == PAYMENT + BOND
    assert settlement["settled_contested"] == "2"
