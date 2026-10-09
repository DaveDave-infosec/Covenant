"""
Covenant V2 — on-chain verification (keyless, read-only).

The suite in test_monitor.py and test_vault.py proves the contract logic in
process. This file is the complement: it reads the LIVE contracts on the
GenLayer Studio Network and verifies that the dissent mechanism did what the
logic tests say it should, against real agreements that were settled (or
blocked) by real transactions.

No private keys, no funding, no setup. It only reads.

What it verifies:

  1. CONTESTED EVIDENCE BLOCKS SETTLEMENT
     Vault agreement #2 is bound to a monitor agreement whose terms are
     genuinely ambiguous (a required field the endpoint does not return,
     against an exception clause that excuses absent upstream metadata).
     Every checkpoint on it has been contested, so it remains active and
     unsettled: its uncontested count is below its requirement.

  2. UNCONTESTED EVIDENCE RELEASES SETTLEMENT
     Vault agreement #1 is bound to a monitor agreement with clear terms.
     Its checkpoint was uncontested, the requirement was met, and it settled.

  3. THE TWO READINGS ARE REAL AND DISTINCT
     A contested checkpoint carries two independently reasoned verdicts with
     different tiers and a divergence note naming the disagreement.

Run:  python -m pytest tests/test_onchain.py -q
"""

import pytest

from genlayer_py import create_account, create_client
from genlayer_py.chains import studionet

MONITOR = "0x18ECD959aE09E1B61A5DBDb89B733Bf39a161728"
VAULT = "0x8c668Ebc2A0F0fA9Cc2b6CD4a60ca202a1085f83"

CONTESTED_VAULT_ID = "2"   # blocked: every checkpoint contested
SETTLED_VAULT_ID = "1"     # released: uncontested checkpoint, settled


@pytest.fixture(scope="module")
def client():
    """
    Read-only client pointed at the Studio Network, where the contracts live.

    genlayer_py attaches an account to every call, including reads, so a
    throwaway keypair is generated here. It signs nothing, holds nothing and
    is never funded; it only supplies a caller address for view methods.
    """
    return create_client(chain=studionet, account=create_account())


def read(client, address, method, args):
    return client.read_contract(address=address, function_name=method, args=args)


def test_contested_evidence_blocks_settlement(client):
    """An agreement whose evidence keeps splitting does not settle."""
    agreement = read(client, VAULT, "get_agreement", [CONTESTED_VAULT_ID])
    progress = read(client, VAULT, "get_settle_progress", [CONTESTED_VAULT_ID])

    assert agreement["status"] == "active", "the agreement should still be open"
    assert agreement["outcome"] == "", "nothing should have been decided yet"

    contested = int(progress["contested"])
    uncontested = int(progress["uncontested"])
    required = int(progress["required"])

    assert contested >= 1, "this agreement should have contested checkpoints"
    assert uncontested < required, "uncontested evidence has not met the requirement"
    assert progress["ready"] is False, "settlement must not be available"


def test_uncontested_evidence_releases_settlement(client):
    """An agreement with clear evidence meets its requirement and settles."""
    agreement = read(client, VAULT, "get_agreement", [SETTLED_VAULT_ID])
    settlement = read(client, VAULT, "get_settlement", [SETTLED_VAULT_ID])

    assert agreement["status"] == "settled"
    assert settlement["outcome"] != "", "a settled agreement carries an outcome"
    assert int(agreement["settled_cp_count"]) >= int(agreement["checkpoints_required"])


def test_settlement_conserves_value(client):
    """Everything paid out equals the payment and bond that went in."""
    agreement = read(client, VAULT, "get_agreement", [SETTLED_VAULT_ID])
    settlement = read(client, VAULT, "get_settlement", [SETTLED_VAULT_ID])

    total_in = int(agreement["payment"]) + int(agreement["bond"])
    total_out = (
        int(settlement["provider_net"])
        + int(settlement["customer_total"])
        + int(settlement["bond_to_provider"])
        + int(settlement["fee_charged"])
    )

    assert total_out == total_in, f"conservation broken: in {total_in}, out {total_out}"


def test_a_contested_checkpoint_carries_two_distinct_readings(client):
    """The dissent is recorded as data, not summarised away."""
    agreement = read(client, VAULT, "get_agreement", [CONTESTED_VAULT_ID])
    monitor_id = agreement["monitor_id"]
    count = int(read(client, MONITOR, "get_checkpoint_count", [monitor_id]))
    assert count >= 1, "the ambiguous agreement should have checkpoints"

    found = None
    for index in range(count):
        checkpoint = read(client, MONITOR, "get_checkpoint", [monitor_id, index])
        if checkpoint["contested"]:
            found = checkpoint
            break

    assert found is not None, "expected at least one contested checkpoint"
    assert found["strict_tier"] != found["lenient_tier"], "a contested checkpoint splits"
    assert found["strict_reasoning"].strip() != ""
    assert found["lenient_reasoning"].strip() != ""
    assert found["strict_reasoning"] != found["lenient_reasoning"]
    assert found["divergence_note"].strip() != "", "the disagreement is named on-chain"


def test_the_settled_agreement_was_not_contested(client):
    """The checkpoint that satisfied the requirement was agreed on both readings."""
    agreement = read(client, VAULT, "get_agreement", [SETTLED_VAULT_ID])
    monitor_id = agreement["monitor_id"]
    start = int(agreement["start_cp"])
    count = int(read(client, MONITOR, "get_checkpoint_count", [monitor_id]))

    uncontested_after_activation = 0
    for index in range(start, count):
        if not read(client, MONITOR, "is_checkpoint_contested", [monitor_id, index]):
            uncontested_after_activation += 1

    assert uncontested_after_activation >= int(agreement["checkpoints_required"])
