"""L2 control schema — single source of truth for canto-tts control tags.

instruction = "key=value" pairs joined by "; ", KNOWN attributes only,
FIXED order: emotion; rate; pitch; energy. Values are ENGLISH enums (never
Hanzi -> avoids re-introducing Mandarin prior). "" (empty) = unconditional.

Pure functions, no external deps.
"""
from __future__ import annotations

from typing import Dict, Optional

# --- attribute order is part of the contract (deterministic instruction strings) ---
ATTR_ORDER = ("emotion", "rate", "pitch", "energy")

# --- allowed enum values per attribute ---
ENUMS: Dict[str, tuple] = {
    "emotion": ("neutral", "serious", "gentle", "lively", "sad", "angry"),
    "rate":    ("slow", "normal", "fast"),
    "pitch":   ("low", "normal", "high"),
    "energy":  ("low", "normal", "high"),   # optional attribute
}

# --- discrete pause tokens (need tokenizer surgery) ---
PAUSE_TOKENS = ("<pause-short>", "<pause-long>")


class ControlSchemaError(ValueError):
    """Raised on unknown attribute or out-of-enum value."""


def is_valid(attr: str, value: str) -> bool:
    return attr in ENUMS and value in ENUMS[attr]


def format_instruction(control: Optional[Dict[str, str]]) -> str:
    """dict -> instruction string in fixed ATTR_ORDER, skipping None/missing.

    >>> format_instruction({"emotion": "serious", "rate": "fast"})
    'emotion=serious; rate=fast'
    >>> format_instruction(None)
    ''
    >>> format_instruction({})
    ''
    """
    if not control:
        return ""
    unknown = set(control) - set(ENUMS)
    if unknown:
        raise ControlSchemaError(f"unknown control attribute(s): {sorted(unknown)}")
    parts = []
    for attr in ATTR_ORDER:
        val = control.get(attr)
        if val is None:
            continue
        if not is_valid(attr, val):
            raise ControlSchemaError(f"invalid value {val!r} for {attr!r}; allowed: {ENUMS[attr]}")
        parts.append(f"{attr}={val}")
    return "; ".join(parts)


def parse_instruction(text: Optional[str]) -> Dict[str, str]:
    """instruction string -> dict. Inverse of format_instruction for valid input.

    >>> parse_instruction("emotion=serious; rate=fast")
    {'emotion': 'serious', 'rate': 'fast'}
    >>> parse_instruction("") == parse_instruction(None) == {}
    True
    """
    if not text or not text.strip():
        return {}
    out: Dict[str, str] = {}
    for chunk in text.split(";"):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "=" not in chunk:
            raise ControlSchemaError(f"malformed control chunk (no '='): {chunk!r}")
        attr, val = (s.strip() for s in chunk.split("=", 1))
        if not is_valid(attr, val):
            raise ControlSchemaError(f"invalid control pair: {attr}={val}")
        out[attr] = val
    return out
