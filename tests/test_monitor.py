"""
CovenantMonitor tests.

These drive the contract's REAL run_checkpoint code path. The live endpoint
fetch is mocked at the web layer and the validator verdict is injected at the
ExecPromptTemplate layer, so everything between (prompt construction, JSON
extraction, tier normalisation, contested detection, counter bookkeeping) is
the contract's own code.

The central property under test: a checkpoint is CONTESTED exactly when the
strict and lenient readings of the same evidence reach different tiers.
"""

import pytest
from gltest.direct import VMContext, deploy_contract

from conftest import (
    CONTRACTS,
    SDK_VERSION,
    FakeMonitor,
    VerdictQueue,
    hex_addr,
    install_hooks,
    verdict,
)

ENDPOINT = "https://api.example.com/v1/todos/1"
BODY = '{"userId":1,"id":1,"title":"delectus aut autem","completed":false}'


@pytest.fixture
def monitor(accounts):
    """Deploy the monitor with one agreement already created."""
    vm = VMContext()
    vm.sender = accounts["owner"]
    with vm.activate():
        contract = deploy_contract(
            CONTRACTS / "covenant_monitor.py", vm, sdk_version=SDK_VERSION
        )
        vm.mock_web(
            r".*api\.example\.com.*",
            {"method": "GET", "status": 200, "body": BODY},
        )
        contract.create_agreement(
            hex_addr(accounts["provider"]),
            hex_addr(accounts["customer"]),
            "Todo Reference API",
            ENDPOINT,
            8000,
            "userId,id,title,completed",
            "Static reference dataset; freshness is not applicable.",
            "Return a todo item with its id, title and completion status.",
            "None.",
            "id",
        )
        yield contract, vm


def test_create_agreement_stores_terms_and_parties(monitor, accounts):
    contract, _ = monitor
    agreement = contract.get_agreement("1")

    assert agreement["provider"] == hex_addr(accounts["provider"]).lower()
    assert agreement["customer"] == hex_addr(accounts["customer"]).lower()
    assert agreement["endpoint"] == ENDPOINT
    assert agreement["checkpoint_count"] == "0"
    assert agreement["contested_count"] == "0"
    assert agreement["uncontested_count"] == "0"


def test_create_agreement_is_permissionless(monitor, accounts):
    """A wallet that is neither party can register an agreement."""
    contract, vm = monitor
    with vm.prank(accounts["stranger"]):
        aid = contract.create_agreement(
            hex_addr(accounts["provider"]),
            hex_addr(accounts["customer"]),
            "second service",
            ENDPOINT,
            8000,
            "id",
            "n/a",
            "fn",
            "none",
            "id",
        )
    assert aid == "2"
    assert contract.get_exists("2") is True


def test_checkpoint_on_missing_agreement_reverts(monitor):
    contract, _ = monitor
    with pytest.raises(Exception, match="agreement does not exist"):
        contract.run_checkpoint("999")


def test_agreeing_readings_produce_an_uncontested_checkpoint(monitor):
    """Clear evidence: both readings land on the same tier, so nothing is contested."""
    contract, vm = monitor
    queue = VerdictQueue()
    queue.push(verdict("satisfied", "satisfied"))
    install_hooks(vm, verdicts=queue)

    tier = contract.run_checkpoint("1")

    assert tier == "satisfied"
    checkpoint = contract.get_checkpoint("1", 0)
    assert checkpoint["strict_tier"] == "satisfied"
    assert checkpoint["lenient_tier"] == "satisfied"
    assert checkpoint["contested"] is False
    assert checkpoint["divergence_note"] == ""
    assert contract.get_uncontested_count("1") == 1
    assert contract.get_contested_count("1") == 0
    assert contract.is_checkpoint_contested("1", 0) is False


def test_diverging_readings_produce_a_contested_checkpoint(monitor):
    """Ambiguous evidence: the readings split, and the split is recorded on-chain."""
    contract, vm = monitor
    queue = VerdictQueue()
    queue.push(
        verdict(
            "material",
            "satisfied",
            strict_reasoning="The required priority field is absent, so the schema requirement fails.",
            lenient_reasoning="Optional metadata is excused and the core function was delivered.",
            divergence_note="The readings differ on whether the missing priority field is material.",
        )
    )
    install_hooks(vm, verdicts=queue)

    tier = contract.run_checkpoint("1")

    # the strict reading is the tier of record
    assert tier == "material"
    checkpoint = contract.get_checkpoint("1", 0)
    assert checkpoint["strict_tier"] == "material"
    assert checkpoint["lenient_tier"] == "satisfied"
    assert checkpoint["contested"] is True
    assert "priority" in checkpoint["divergence_note"]
    assert checkpoint["strict_reasoning"] != checkpoint["lenient_reasoning"]
    assert contract.get_contested_count("1") == 1
    assert contract.get_uncontested_count("1") == 0
    assert contract.is_checkpoint_contested("1", 0) is True


def test_counters_track_a_mixed_run(monitor):
    """Contested and uncontested checkpoints accumulate independently."""
    contract, vm = monitor
    queue = VerdictQueue()
    queue.push(verdict("satisfied", "satisfied"))      # uncontested
    queue.push(verdict("material", "minor"))           # contested
    queue.push(verdict("minor", "minor"))              # uncontested
    install_hooks(vm, verdicts=queue)

    for _ in range(3):
        contract.run_checkpoint("1")

    assert contract.get_checkpoint_count("1") == 3
    assert contract.get_uncontested_count("1") == 2
    assert contract.get_contested_count("1") == 1
    assert contract.is_checkpoint_contested("1", 0) is False
    assert contract.is_checkpoint_contested("1", 1) is True
    assert contract.is_checkpoint_contested("1", 2) is False


def test_unrecognised_tier_defensively_counts_as_material(monitor):
    """A verdict outside the four tiers must not slip through as 'satisfied'."""
    contract, vm = monitor
    queue = VerdictQueue()
    queue.push(verdict("not-a-tier", "not-a-tier"))
    install_hooks(vm, verdicts=queue)

    tier = contract.run_checkpoint("1")

    assert tier == "material"
    assert contract.get_checkpoint("1", 0)["strict_tier"] == "material"


def test_verdict_wrapped_in_code_fences_is_still_parsed(monitor):
    """Leader output is tolerated with surrounding prose or fences."""
    contract, vm = monitor
    queue = VerdictQueue()
    queue.push("Here is the verdict:\n```json\n" + verdict("minor", "minor") + "\n```")
    install_hooks(vm, verdicts=queue)

    tier = contract.run_checkpoint("1")

    assert tier == "minor"
    assert contract.get_checkpoint("1", 0)["contested"] is False


def test_run_checkpoint_is_permissionless(monitor, accounts):
    """Anyone may trigger a measurement; the caller cannot influence the verdict."""
    contract, vm = monitor
    queue = VerdictQueue()
    queue.push(verdict("satisfied", "satisfied"))
    install_hooks(vm, verdicts=queue)

    with vm.prank(accounts["stranger"]):
        tier = contract.run_checkpoint("1")

    assert tier == "satisfied"
    assert contract.get_checkpoint_count("1") == 1
