# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from dataclasses import dataclass
import json


@allow_storage
@dataclass
class Identity:
    owner: Address
    platform: str
    profile_url: str
    handle: str
    verified: bool
    verified_at: u64
    verification_msg: str
    confidence: str
    reasoning: str


@allow_storage
@dataclass
class VerificationRequest:
    requester: Address
    platform: str
    profile_url: str
    expected_msg: str
    timestamp: u64
    status: str  # "pending", "verified", "rejected"


@allow_storage
@dataclass
class TrustedVerifier:
    address: Address
    name: str
    active: bool
    verifications_count: u64


class SoulVerify(gl.Contract):
    identities: TreeMap[str, Identity]
    verification_requests: TreeMap[str, VerificationRequest]
    trusted_verifiers: TreeMap[str, TrustedVerifier]
    owner: Address
    total_verifications: u64
    min_confidence: str  # "low", "medium", "high"

    def __init__(self):
        self.owner = gl.transaction.sender
        self.total_verifications = u64(0)
        self.min_confidence = "medium"

    @gl.public.write
    def register_identity(
        self,
        platform: str,
        profile_url: str,
        expected_msg: str,
    ) -> str:
        sender = gl.transaction.sender
        key = f"{sender.as_hex}:{platform}"

        if key in self.identities:
            raise Exception("Identity already registered for this platform")

        now = u64(int(gl.vm.get_timestamp()))

        def leader_fn():
            web = gl.nondet.web.get(profile_url)
            content = web.body.decode("utf-8", errors="ignore")[:8000]

            prompt = (
                f"You are verifying a user's identity on {platform}.\n\n"
                f"Profile URL: {profile_url}\n\n"
                f"Profile Content:\n{content}\n\n"
                f"Look for this verification message in the profile: \"{expected_msg}\"\n\n"
                f"Determine if:\n"
                f"1. The profile exists and is accessible\n"
                f"2. The verification message is present (in bio, posts, or any visible content)\n"
                f"3. The profile appears to belong to a real person (not obviously fake)\n\n"
                f"Reply with JSON:\n"
                f'{{"verified": true/false, "confidence": "high"/"medium"/"low", '
                f'"reasoning": "brief explanation of what you found"}}\n'
                f"If the profile is inaccessible or doesn't exist, reply with:\n"
                f'{{"verified": false, "confidence": "high", "reasoning": "profile not found or inaccessible"}}'
            )

            resp = gl.nondet.exec_prompt(prompt, response_format="json")
            return resp

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            try:
                mine = leader_fn()
                return leader_result.calldata["verified"] == mine["verified"]
            except Exception:
                return False

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        if isinstance(result, gl.vm.Return):
            verified = result.calldata.get("verified", False)
            confidence = result.calldata.get("confidence", "low")
            reasoning = result.calldata.get("reasoning", "")
        else:
            verified = False
            confidence = "low"
            reasoning = "Verification failed or timed out"

        self.identities[key] = Identity(
            owner=sender,
            platform=platform,
            profile_url=profile_url,
            handle=self._extract_handle(profile_url, platform),
            verified=verified,
            verified_at=now,
            verification_msg=expected_msg,
            confidence=confidence,
            reasoning=reasoning,
        )

        if verified:
            self.total_verifications = self.total_verifications + u64(1)

        return json.dumps({
            "verified": verified,
            "confidence": confidence,
            "reasoning": reasoning,
        })

    @gl.public.write
    def verify_identity(
        self,
        user_address: str,
        platform: str,
    ) -> str:
        key = f"{user_address}:{platform}"
        assert key in self.identities, "Identity not registered"

        identity = self.identities[key]

        def leader_fn():
            web = gl.nondet.web.get(identity.profile_url)
            content = web.body.decode("utf-8", errors="ignore")[:8000]

            prompt = (
                f"Re-verify this identity on {platform}.\n\n"
                f"Profile URL: {identity.profile_url}\n"
                f"Previously verified message: \"{identity.verification_msg}\"\n\n"
                f"Current Profile Content:\n{content}\n\n"
                f"Is the verification message still present and the identity still valid?\n\n"
                f"Reply with JSON:\n"
                f'{{"still_valid": true/false, "confidence": "high"/"medium"/"low", '
                f'"reasoning": "brief explanation"}}'
            )

            resp = gl.nondet.exec_prompt(prompt, response_format="json")
            return resp

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            try:
                mine = leader_fn()
                return leader_result.calldata["still_valid"] == mine["still_valid"]
            except Exception:
                return False

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        if isinstance(result, gl.vm.Return):
            still_valid = result.calldata.get("still_valid", False)
            confidence = result.calldata.get("confidence", "low")
            reasoning = result.calldata.get("reasoning", "")
        else:
            still_valid = False
            confidence = "low"
            reasoning = "Re-verification failed or timed out"

        self.identities[key].verified = still_valid
        self.identities[key].confidence = confidence
        self.identities[key].reasoning = reasoning

        return json.dumps({
            "still_valid": still_valid,
            "confidence": confidence,
            "reasoning": reasoning,
        })

    @gl.public.view
    def check_identity(self, user_address: str, platform: str) -> str:
        key = f"{user_address}:{platform}"
        if key not in self.identities:
            return json.dumps({"registered": False})

        id = self.identities[key]
        return json.dumps({
            "registered": True,
            "verified": id.verified,
            "platform": id.platform,
            "handle": id.handle,
            "confidence": id.confidence,
            "reasoning": id.reasoning,
            "verified_at": str(id.verified_at),
        })

    @gl.public.view
    def get_user_identities(self, user_address: str) -> str:
        result = []
        for key, identity in self.identities.items():
            if user_address in key:
                result.append({
                    "platform": identity.platform,
                    "handle": identity.handle,
                    "verified": identity.verified,
                    "confidence": identity.confidence,
                    "verified_at": str(identity.verified_at),
                })
        return json.dumps(result)

    @gl.public.view
    def get_verified_users(self) -> str:
        result = []
        for key, identity in self.identities.items():
            if identity.verified:
                result.append({
                    "address": identity.owner.as_hex,
                    "platform": identity.platform,
                    "handle": identity.handle,
                    "confidence": identity.confidence,
                })
        return json.dumps(result)

    @gl.public.view
    def get_total_verifications(self) -> u64:
        return self.total_verifications

    @gl.public.view
    def get_owner(self) -> str:
        return self.owner.as_hex

    @gl.public.write
    def set_min_confidence(self, confidence: str):
        assert gl.transaction.sender == self.owner, "Only owner"
        assert confidence in ("low", "medium", "high"), "Invalid confidence level"
        self.min_confidence = confidence

    def _extract_handle(self, url: str, platform: str) -> str:
        parts = url.rstrip("/").split("/")
        if len(parts) > 0:
            return parts[-1]
        return "unknown"
