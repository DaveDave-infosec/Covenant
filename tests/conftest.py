"""
Shared fixtures for the Covenant test suite.

The GenLayer direct runner allows only ONE gl.Contract subclass per process,
so the monitor tests and the vault tests live in separate modules and pytest
runs them in separate processes (see pytest.ini / the -p no:randomly note in
tests/README.md).

Two non-obvious pieces of plumbing live here:

1. ExecPromptTemplate hook
   gl.eq_principle.prompt_non_comparative emits an "ExecPromptTemplate"
   gl_call, which the direct runner does not handle natively. The hook
   answers it with a canned verdict so tests can drive the contract's REAL
   run_checkpoint code path with arbitrary strict/lenient readings.
   This path expects calldata.encode({"ok": <str>}).

2. CallContract hook (FakeMonitor)
   The vault reaches the monitor through gl.get_contract_at. Because both
   contracts cannot be loaded together, the vault's cross-contract calls are
   answered by a FakeMonitor object. This path expects a status-prefixed
   result: bytes([0]) + calldata.encode(<value>).
"""

import json
from pathlib import Path

import pytest
from gltest.direct import VMContext, deploy_contract, create_address, create_test_addresses

SDK_VERSION = "v0.2.0"
CONTRACTS = Path(__file__).resolve().parent.parent / "contracts"


def hex_addr(raw: bytes) -> str:
    """create_test_addresses returns raw 20-byte values; contracts take hex strings."""
    return "0x" + raw.hex()


def verdict(
    strict_tier: str,
    lenient_tier: str,
    *,
    strict_reasoning: str = "Strict reading of the agreed terms.",
    lenient_reasoning: str = "Lenient reading of the agreed terms.",
    divergence_note: str = "",
    checks: str = "pass",
) -> str:
    """Build a leader-result JSON string with two modeled readings."""
    if strict_tier != lenient_tier and not divergence_note:
        divergence_note = "The readings differ on how strictly the terms are applied."
    return json.dumps(
        {
            "usability": checks,
            "latency": checks,
            "schema": checks,
            "freshness": checks,
            "functional": checks,
            "exception": checks,
            "strict_tier": strict_tier,
            "strict_reasoning": strict_reasoning,
            "lenient_tier": lenient_tier,
            "lenient_reasoning": lenient_reasoning,
            "divergence_note": divergence_note,
        }
    )


class VerdictQueue:
    """Feeds successive checkpoint verdicts to the contract under test."""

    def __init__(self):
        self._queue = []
        self.default = verdict("satisfied", "satisfied")

    def push(self, value: str) -> None:
        self._queue.append(value)

    def next(self) -> str:
        return self._queue.pop(0) if self._queue else self.default


class FakeMonitor:
    """
    Stands in for CovenantMonitor when testing the vault.

    Only the methods the vault actually calls are implemented. Tests append
    checkpoints directly, which is what lets them exercise contested and
    uncontested settlement paths deterministically.
    """

    def __init__(self, provider: str, customer: str, exists: bool = True):
        self.provider = provider.lower()
        self.customer = customer.lower()
        self.exists = exists
        self.tiers: list[str] = []
        self.contested: list[bool] = []

    def add_checkpoint(self, tier: str, contested: bool) -> None:
        self.tiers.append(tier)
        self.contested.append(contested)

    # --- the cross-contract surface the vault depends on ---
    def get_exists(self, agreement_id):
        return self.exists

    def get_agreement(self, agreement_id):
        return {"provider": self.provider, "customer": self.customer}

    def get_checkpoint_count(self, agreement_id):
        return len(self.tiers)

    def get_uncontested_count(self, agreement_id):
        return sum(1 for c in self.contested if not c)

    def get_checkpoint_tier(self, agreement_id, index):
        return self.tiers[int(index)]

    def is_checkpoint_contested(self, agreement_id, index):
        return self.contested[int(index)]


def install_hooks(vm, *, verdicts: VerdictQueue = None, monitor: FakeMonitor = None):
    """Route ExecPromptTemplate and CallContract gl_calls to test doubles."""
    from genlayer.py import calldata

    def hook(_vm, request):
        if not isinstance(request, dict):
            return None

        if "ExecPromptTemplate" in request and verdicts is not None:
            # nondet decoder expects {"ok": <response>}
            return calldata.encode({"ok": verdicts.next()})

        if "CallContract" in request and monitor is not None:
            cd = request["CallContract"]["calldata"]
            fn = getattr(monitor, cd["method"])
            result = fn(*cd.get("args", []))
            # sub-VM decoder expects ResultCode.RETURN (0) + calldata
            return bytes([0]) + calldata.encode(result)

        return None

    vm._gl_call_hook = hook


@pytest.fixture
def accounts():
    """Named test accounts used across the suite."""
    raw = create_test_addresses(6)
    return {
        "owner": raw[0],
        "provider": raw[1],
        "customer": raw[2],
        "bystander": raw[3],
        "stranger": raw[4],
    }
