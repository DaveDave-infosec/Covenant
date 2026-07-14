# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import json


class CovenantMonitor(gl.Contract):
    # ---- agreement identity + parties ----
    agreement_count: u256
    ag_provider: TreeMap[str, str]
    ag_customer: TreeMap[str, str]
    ag_exists: TreeMap[str, bool]

    # ---- locked SLA terms (flat parallel TreeMaps, keyed by agreement id) ----
    ag_endpoint: TreeMap[str, str]
    ag_service_name: TreeMap[str, str]
    ag_latency_ms: TreeMap[str, u256]
    ag_required_fields: TreeMap[str, str]
    ag_freshness_desc: TreeMap[str, str]
    ag_function_desc: TreeMap[str, str]
    ag_exception_desc: TreeMap[str, str]
    ag_compared_fields: TreeMap[str, str]

    # ---- checkpoint verdict history (flat parallel TreeMaps) ----
    # keyed by "<agreement_id>:<checkpoint_index>"
    cp_count: TreeMap[str, u256]
    cp_tier: TreeMap[str, str]
    cp_usability: TreeMap[str, str]
    cp_latency: TreeMap[str, str]
    cp_schema: TreeMap[str, str]
    cp_freshness: TreeMap[str, str]
    cp_functional: TreeMap[str, str]
    cp_exception: TreeMap[str, str]
    cp_reasoning: TreeMap[str, str]
    cp_minority: TreeMap[str, str]
    cp_latency_ms: TreeMap[str, str]

    def __init__(self):
        self.agreement_count = u256(0)

    # ---------------------------------------------------------------
    # Create + lock an agreement
    # ---------------------------------------------------------------
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

        return aid

    # ---------------------------------------------------------------
    # Run one checkpoint — INDEPENDENT consensus (Architecture A).
    # Two-stage, matching the proven pattern:
    #   1. strict_eq web fetch of the live locked endpoint
    #   2. prompt_non_comparative judges the six checks; the inner fn
    #      RETURNS the prompt string (it does NOT call the LLM itself)
    # ---------------------------------------------------------------
    @gl.public.write
    def run_checkpoint(self, agreement_id: str) -> str:
        aid = agreement_id
        assert self.ag_exists.get(aid, False), "agreement does not exist"

        # copy locked terms to locals (self not accessible in non-det block)
        endpoint = self.ag_endpoint[aid]
        service_name = self.ag_service_name[aid]
        latency_threshold = int(self.ag_latency_ms[aid])
        required_fields = self.ag_required_fields[aid]
        freshness_desc = self.ag_freshness_desc[aid]
        function_desc = self.ag_function_desc[aid]
        exception_desc = self.ag_exception_desc[aid]

        # --- Stage 1: fetch the live endpoint (strict_eq — page text is stable) ---
        def fetch_endpoint() -> str:
            response = gl.nondet.web.get(endpoint)
            body = response.body.decode("utf-8", errors="ignore")
            if len(body) > 2000:
                body = body[:2000]
            return body

        body = gl.eq_principle.strict_eq(fetch_endpoint)

        # --- Stage 2: judge the six checks (prompt_non_comparative) ---
        def build_prompt() -> str:
            return f"""You are an independent service-level auditor judging ONE checkpoint of a live API service. You have fetched the service yourself; judge only what you see, in context. Do not trust any party's claims — only this fetched response.

SERVICE: {service_name}
ENDPOINT: {endpoint}
LATENCY THRESHOLD (agreed max): {latency_threshold} ms

AGREED TERMS:
- Required response fields: {required_fields}
- Data freshness rule: {freshness_desc}
- Core function the endpoint must perform: {function_desc}
- Agreed exceptions (maintenance / usage limits — provider NOT responsible if these apply): {exception_desc}

LIVE RESPONSE BODY (first 2000 chars):
{body}

Judge these SIX checks. For each, decide "pass" or "fail":
1. usability — did the endpoint return valid, USABLE data (not a 200 with empty/garbage body)?
2. latency — assume latency is acceptable UNLESS the body itself indicates a timeout or slow-response error; if the body is a normal successful response, mark "pass".
3. schema — are the required fields present and correctly structured (no breaking change)?
4. freshness — is the data current per the freshness rule?
5. functional — did the endpoint actually perform its documented core function?
6. exception — does an agreed exception apply that excuses any failure? "pass" means NO exception applies (normal operation); "fail" means an exception DOES apply and the provider is not responsible.

Then assign ONE overall health tier:
- "satisfied" — all material checks pass, service healthy
- "minor" — small degradation, service still usable
- "material" — meaningful breach (broken schema, unusable response, core function impaired)
- "critical" — service effectively down or completely broken

If an agreed exception applies, lean toward "satisfied" for the excused incident.

Return ONLY one JSON object with these keys: tier (satisfied|minor|material|critical), usability (pass|fail), latency (pass|fail), schema (pass|fail), freshness (pass|fail), functional (pass|fail), exception (pass|fail), reasoning (1-2 sentences grounded in the actual response body), minority_note (one sentence giving the strongest argument for the opposite verdict, or an empty string)."""

        task = (
            "Judge the six service-level checks for this checkpoint against the "
            "fetched live response body and the agreed terms, then output the "
            "verdict as one JSON object."
        )
        criteria_check = (
            "The response is exactly one valid JSON object with keys tier, "
            "usability, latency, schema, freshness, functional, exception, "
            "reasoning, minority_note. tier is one of satisfied, minor, material, "
            "critical. Each of the six checks is exactly pass or fail. reasoning "
            "is a non-empty string grounded in the actual response body."
        )

        raw = gl.eq_principle.prompt_non_comparative(
            build_prompt,
            task=task,
            criteria=criteria_check,
        )

        parsed = json.loads(raw)

        tier = str(parsed["tier"])
        usability = str(parsed["usability"])
        latency = str(parsed["latency"])
        schema = str(parsed["schema"])
        freshness = str(parsed["freshness"])
        functional = str(parsed["functional"])
        exception = str(parsed["exception"])
        reasoning = str(parsed["reasoning"])
        minority = str(parsed["minority_note"])

        # store the verdict in flat parallel TreeMaps
        cp_idx = int(self.cp_count.get(aid, u256(0)))
        key = aid + ":" + str(cp_idx)

        self.cp_tier[key] = tier
        self.cp_usability[key] = usability
        self.cp_latency[key] = latency
        self.cp_schema[key] = schema
        self.cp_freshness[key] = freshness
        self.cp_functional[key] = functional
        self.cp_exception[key] = exception
        self.cp_reasoning[key] = reasoning
        self.cp_minority[key] = minority
        self.cp_latency_ms[key] = "0"

        self.cp_count[aid] = u256(cp_idx + 1)

        return tier

    # ---------------------------------------------------------------
    # Views
    # ---------------------------------------------------------------
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
            "reasoning": self.cp_reasoning.get(key, ""),
            "minority_note": self.cp_minority.get(key, ""),
            "observed_latency_ms": self.cp_latency_ms.get(key, ""),
        }

    @gl.public.view
    def get_checkpoint_count(self, agreement_id: str) -> u256:
        return self.cp_count.get(agreement_id, u256(0))

    @gl.public.view
    def get_agreement_count(self) -> u256:
        return self.agreement_count
