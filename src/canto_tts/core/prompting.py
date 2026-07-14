"""canto-tts control-prompt wrapper.

This module turns an L2 control dict into the OPTIONAL message fields the
MOSS-TTS-Nano model already understands (`instruction`, `tokens`), so callers
get deterministic, byte-identical control conditioning.

  - MOSS dataset OPTIONAL_MESSAGE_FIELDS already includes ("instruction","Instruction")
    and ("tokens","Tokens") -> pure text append, zero model change.
  - `<pause-*>` markers live INSIDE `text` (tokenizer surgery, separate concern).
  - `Language` stays None end-to-end.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Union

from canto_tts.core import control_schema as cs

# accept either a pre-formatted instruction string or a control dict
Control = Union[str, Dict[str, str], None]


def _instruction_str(control: Control) -> Optional[str]:
    """Normalize control (dict | str | None) -> instruction string or None.

    None / empty  -> None  (unconditional; field omitted downstream)
    dict          -> cs.format_instruction(dict)
    str           -> validated round-trip (parse then re-format for canonical order)
    """
    if control is None:
        return None
    if isinstance(control, str):
        parsed = cs.parse_instruction(control)          # validates
        formatted = cs.format_instruction(parsed)       # canonical order
        return formatted or None
    formatted = cs.format_instruction(control)
    return formatted or None


def build_control_fields(control: Control = None, tokens: Optional[int] = None) -> Dict[str, Any]:
    """The SHARED control payload used by BOTH train dataset and infer.

    Returns only the fields that are set (None omitted).

    >>> build_control_fields({"emotion": "serious"}, tokens=120)
    {'instruction': 'emotion=serious', 'tokens': 120}
    >>> build_control_fields(None)
    {}
    """
    out: Dict[str, Any] = {}
    instr = _instruction_str(control)
    if instr is not None:
        out["instruction"] = instr
    if tokens is not None:
        out["tokens"] = int(tokens)
    return out


def build_dataset_record(
    text_phoneme: str,
    *,
    control: Control = None,
    tokens: Optional[int] = None,
    **passthrough: Any,
) -> Dict[str, Any]:
    """Build a training-dataset record: phoneme text + optional control fields + passthrough.

    >>> r = build_dataset_record("<o-g> <r-am> <t1>", control={"rate": "fast"}, tokens=42, audio="a.wav")
    >>> r["text"], r["instruction"], r["tokens"], r["audio"]
    ('<o-g> <r-am> <t1>', 'rate=fast', 42, 'a.wav')
    """
    record: Dict[str, Any] = {"text": text_phoneme}
    record.update(build_control_fields(control, tokens))
    record.update(passthrough)
    return record


# ---------------------------------------------------------------------------
# Shared suffix renderer.
#
# MOSS renders the "- Instruction:\n...- Text:\n<text>" block; this is the
# SINGLE SOURCE both training and inference delegate to.
# ---------------------------------------------------------------------------

SUFFIX_FIELD_ORDER = (
    ("instruction", "Instruction"),
    ("tokens", "Tokens"),
    ("quality", "Quality"),
    ("sound_event", "Sound Event"),
    ("ambient_sound", "Ambient Sound"),
    ("language", "Language"),
)


def render_suffix_prefix(fields: Optional[Dict[str, Any]] = None) -> str:
    """Render "\\n- Instruction:\\n...\\n- Text:\\n" (NO text value appended).

    Byte-identical to the bundled MOSS prompting.py's `USER_TEMPLATE_AFTER_REFERENCE`
    when `fields` is None/empty. Only `instruction`/`language` vary in practice;
    canto-tts always leaves quality/sound_event/ambient_sound as None.
    """
    fields = fields or {}
    lines = [""]
    for field_name, display_name in SUFFIX_FIELD_ORDER:
        value = fields.get(field_name)
        lines.append(f"- {display_name}:")
        lines.append("None" if value in (None, "") else str(value))
    lines.append("- Text:")
    lines.append("")
    return "\n".join(lines)


def render_suffix_text(record: Dict[str, Any]) -> str:
    """Full suffix INCLUDING text — drop-in replacement for dataset-side
    `_build_suffix_text(record)`. `record` may carry any SUFFIX_FIELD_ORDER
    keys plus the required `text`.
    """
    fields = {name: record.get(name) for name, _ in SUFFIX_FIELD_ORDER}
    return render_suffix_prefix(fields) + str(record["text"])
