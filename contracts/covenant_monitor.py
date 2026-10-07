# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import json


class CovenantMonitor(gl.Contract):
    agreement_count: u256
    ag_provider: TreeMap[str, str]
    ag_customer: TreeMap[str, str]
    ag_exists: TreeMap[str, bool]

    ag_endpoint: TreeMap[str, str]
    ag_service_name: TreeMap[str, str]
    ag_latency_ms: TreeMap[str, u256]
    ag_required_fields: TreeMap[str, str]
    ag_freshness_desc: TreeMap[str, str]
    ag_function_desc: TreeMap[str, str]
    ag_exception_desc: TreeMap[str, str]
    ag_compared_fields: TreeMap[str, str]

    cp_count: TreeMap[str, u256]
    cp_tier: TreeMap[str, str]
    cp_usability: TreeMap[str, str]
    cp_latency: TreeMap[str, str]
    cp_schema: TreeMap[str, str]
    cp_freshness: TreeMap[str, str]
    cp_functional: TreeMap[str, str]
    cp_exception: TreeMap[str, str]

    cp_strict_tier: TreeMap[str, str]
    cp_strict_reason: TreeMap[str, str]
    cp_lenient_tier: TreeMap[str, str]
    cp_lenient_reason: TreeMap[str, str]
    cp_contested: TreeMap[str, bool]
    cp_divergence: TreeMap[str, str]

    ag_contested_count: TreeMap[str, u256]
    ag_uncontested_count: TreeMap[str, u256]

    def __init__(self):
        self.agreement_count = u256(0)

    @gl.public.write
    def create_agreement(
        self,
        provider: str,
        customer: str,
        service_name: str,
        endpoint: str,
        latency_ms: u256,
        required_fields: str,
        freshness_desc: str,
        function_desc: str,
        exception_desc: str,
        compared_fields: str,
    ) -> str:
        idx = u256(int(self.agreement_count) + 1)
        self.agreement_count = idx
        aid = str(idx)

        self.ag_provider[aid] = provider.lower()
        self.ag_customer[aid] = customer.lower()
        self.ag_service_name[aid] = service_name
        self.ag_endpoint[aid] = endpoint
        self.ag_latency_ms[aid] = latency_ms
        self.ag_required_fields[aid] = required_fields
        self.ag_freshness_desc[aid] = freshness_desc
        self.ag_function_desc[aid] = function_desc
        self.ag_exception_desc[aid] = exception_desc
        self.ag_compared_fields[aid] = compared_fields
        self.ag_exists[aid] = True
        self.cp_count[aid] = u256(0)
        self.ag_contested_count[aid] = u256(0)
        self.ag_uncontested_count[aid] = u256(0)

        return aid

    @gl.public.write
    def run_checkpoint(self, agreement_id: str) -> str:
        aid = agreement_id
        assert self.ag_exists.get(aid, False), "agreement does not exist"

        endpoint = self.ag_endpoint[aid]
        service_name = self.ag_service_name[aid]
        latency_threshold = int(self.ag_latency_ms[aid])
        required_fields = self.ag_required_fields[aid]
        freshness_desc = self.ag_freshness_desc[aid]
        function_desc = self.ag_function_desc[aid]
        exception_desc = self.ag_exception_desc[aid]

        def fetch_endpoint() -> str:
            response = gl.nondet.web.get(endpoint)
            body = response.body.decode("utf-8", errors="ignore")
            if len(body) > 2000:
                body = body[:2000]
            return body

        body = gl.eq_principle.strict_eq(fetch_endpoint)

        def build_prompt() -> str:
            return f"""You are auditing ONE checkpoint of a live API service against an agreed service-level contract. You have fetched the service yourself. Judge only the evidence below.

SERVICE: {service_name}
ENDPOINT: {endpoint}
LATENCY THRESHOLD (agreed max): {latency_threshold} ms

AGREED TERMS:
- Required response fields: {required_fields}
- Data freshness rule: {freshness_desc}
- Core function the endpoint must perform: {function_desc}
- Agreed exceptions (provider NOT responsible if these apply): {exception_desc}

LIVE RESPONSE BODY (first 2000 chars):
{body}

First judge these SIX checks, deciding "pass" or "fail" for each:
1. usability - did the endpoint return valid, USABLE data?
2. latency - assume acceptable UNLESS the body indicates a timeout or slow-response error.
3. schema - are the required fields present and correctly structured?
4. freshness - is the data current per the freshness rule?
5. functional - did the endpoint perform its documented core function?
6. exception - "pass" means NO agreed exception applies; "fail" means one DOES apply and excuses the provider.

Then produce TWO INDEPENDENT READINGS of this same evidence. These are not a verdict and a rebuttal. They are two good-faith auditors applying the contract with different but defensible standards. Reason each one through on its own terms.

STRICT READING: hold the service tightly to the literal agreed terms. Any requirement not clearly met counts against the provider. Give no benefit of the doubt for ambiguity.

LENIENT READING: judge whether the service substantively delivered what the customer was promised. Tolerate immaterial deviations. Give the benefit of the doubt where the contract is ambiguous or where an agreed exception plausibly applies.

Assign each reading ONE tier:
- "satisfied" - service healthy, material checks pass
- "minor" - small degradation, still usable
- "material" - meaningful breach (broken schema, unusable response, impaired function)
- "critical" - service effectively down

The two readings may land on the SAME tier. If the evidence is clear, they should. Only diverge when the evidence genuinely supports more than one conclusion. Do not manufacture disagreement.

Return ONLY one JSON object with these keys: usability, latency, schema, freshness, functional, exception (each exactly "pass" or "fail"), strict_tier, strict_reasoning, lenient_tier, lenient_reasoning, divergence_note. strict_tier and lenient_tier are each one of satisfied|minor|material|critical. strict_reasoning and lenient_reasoning are 1-2 sentences each, grounded in the actual response body. divergence_note states in one sentence what the two readings disagreed about, or is an empty string if they agree."""

        task = (
            "Judge the six service-level checks against the fetched response body, "
            "then produce two independent readings of the same evidence (a strict "
            "reading and a lenient reading), each with its own tier and reasoning, "
            "as one JSON object."
        )
        criteria_check = (
            "The response is exactly one valid JSON object with keys usability, "
            "latency, schema, freshness, functional, exception, strict_tier, "
            "strict_reasoning, lenient_tier, lenient_reasoning, divergence_note. "
            "Each of the six checks is exactly pass or fail. strict_tier and "
            "lenient_tier are each one of satisfied, minor, material, critical. "
            "strict_reasoning and lenient_reasoning are non-empty strings grounded "
            "in the actual response body, and each must justify its own tier on its "
            "own terms. If strict_tier and lenient_tier differ, divergence_note is "
            "non-empty and names what the readings disagreed about."
        )

        raw = gl.eq_principle.prompt_non_comparative(
            build_prompt,
            task=task,
            criteria=criteria_check,
        )

        start = raw.find("{")
        end = raw.rfind("}")
        assert start >= 0 and end > start, "verdict was not readable JSON"
        parsed = json.loads(raw[start:end + 1])

        def tier_of(value: str) -> str:
            t = str(value).lower().strip()
            if t in ("satisfied", "minor", "material", "critical"):
                return t
            return "material"

        strict_tier = tier_of(parsed["strict_tier"])
        lenient_tier = tier_of(parsed["lenient_tier"])
        strict_reason = str(parsed["strict_reasoning"])
        lenient_reason = str(parsed["lenient_reasoning"])
        divergence = str(parsed.get("divergence_note", ""))

        contested = strict_tier != lenient_tier

        cp_idx = int(self.cp_count.get(aid, u256(0)))
        key = aid + ":" + str(cp_idx)

        self.cp_tier[key] = strict_tier
        self.cp_usability[key] = str(parsed["usability"])
        self.cp_latency[key] = str(parsed["latency"])
        self.cp_schema[key] = str(parsed["schema"])
        self.cp_freshness[key] = str(parsed["freshness"])
        self.cp_functional[key] = str(parsed["functional"])
        self.cp_exception[key] = str(parsed["exception"])

        self.cp_strict_tier[key] = strict_tier
        self.cp_strict_reason[key] = strict_reason
        self.cp_lenient_tier[key] = lenient_tier
        self.cp_lenient_reason[key] = lenient_reason
        self.cp_contested[key] = contested
        self.cp_divergence[key] = divergence if contested else ""

        self.cp_count[aid] = u256(cp_idx + 1)
        if contested:
            self.ag_contested_count[aid] = u256(int(self.ag_contested_count.get(aid, u256(0))) + 1)
        else:
            self.ag_uncontested_count[aid] = u256(int(self.ag_uncontested_count.get(aid, u256(0))) + 1)

        return strict_tier

    @gl.public.view
    def get_agreement(self, agreement_id: str) -> dict:
        aid = agreement_id
        assert self.ag_exists.get(aid, False), "agreement does not exist"
        return {
            "id": aid,
            "provider": self.ag_provider[aid],
            "customer": self.ag_customer[aid],
            "service_name": self.ag_service_name[aid],
            "endpoint": self.ag_endpoint[aid],
            "latency_ms": str(self.ag_latency_ms[aid]),
            "required_fields": self.ag_required_fields[aid],
            "freshness_desc": self.ag_freshness_desc[aid],
            "function_desc": self.ag_function_desc[aid],
            "exception_desc": self.ag_exception_desc[aid],
            "compared_fields": self.ag_compared_fields[aid],
            "checkpoint_count": str(self.cp_count.get(aid, u256(0))),
            "contested_count": str(self.ag_contested_count.get(aid, u256(0))),
            "uncontested_count": str(self.ag_uncontested_count.get(aid, u256(0))),
        }

    @gl.public.view
    def get_checkpoint(self, agreement_id: str, index: u256) -> dict:
        key = agreement_id + ":" + str(int(index))
        return {
            "tier": self.cp_tier.get(key, ""),
            "usability": self.cp_usability.get(key, ""),
            "latency": self.cp_latency.get(key, ""),
            "schema": self.cp_schema.get(key, ""),
            "freshness": self.cp_freshness.get(key, ""),
            "functional": self.cp_functional.get(key, ""),
            "exception": self.cp_exception.get(key, ""),
            "strict_tier": self.cp_strict_tier.get(key, ""),
            "strict_reasoning": self.cp_strict_reason.get(key, ""),
            "lenient_tier": self.cp_lenient_tier.get(key, ""),
            "lenient_reasoning": self.cp_lenient_reason.get(key, ""),
            "contested": self.cp_contested.get(key, False),
            "divergence_note": self.cp_divergence.get(key, ""),
        }

    @gl.public.view
    def get_checkpoint_tier(self, agreement_id: str, index: u256) -> str:
        key = agreement_id + ":" + str(int(index))
        return self.cp_tier.get(key, "")

    @gl.public.view
    def is_checkpoint_contested(self, agreement_id: str, index: u256) -> bool:
        key = agreement_id + ":" + str(int(index))
        return self.cp_contested.get(key, False)

    @gl.public.view
    def get_uncontested_count(self, agreement_id: str) -> u256:
        return self.ag_uncontested_count.get(agreement_id, u256(0))

    @gl.public.view
    def get_contested_count(self, agreement_id: str) -> u256:
        return self.ag_contested_count.get(agreement_id, u256(0))

    @gl.public.view
    def get_checkpoint_count(self, agreement_id: str) -> u256:
        return self.cp_count.get(agreement_id, u256(0))

    @gl.public.view
    def get_agreement_count(self) -> u256:
        return self.agreement_count

    @gl.public.view
    def get_exists(self, agreement_id: str) -> bool:
        return self.ag_exists.get(agreement_id, False)
