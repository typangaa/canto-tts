#!/usr/bin/env python3
"""
cantophon.py — Cantonese phoneme frontend for canto-tts V1.

Converts Chinese text into a phoneme-token string for MOSS-TTS-Nano, replacing
raw Hanzi (which carries a Mandarin reading prior) with jyutping phonemes split
into Onset / Rime / Tone tokens (decision D1a).

Pipeline:  text --canto_hk_g2p--> jyutping --parse--> [<o-..>][<r-..>][<tN>] ...

Design decisions:
  - D1a: each Chinese syllable -> onset (optional) + rime + tone, all as
         dedicated added tokens. Tone token also acts as syllable delimiter.
  - D3 : Hanzi is NOT kept; only phonemes go into the text field.
  - D4 : English words are kept verbatim (latin); only Chinese spans are
         phonemised. Existing SentencePiece subwords handle English.
  - tones are explicit discrete tokens (key for a tonal language).

Token surface forms (added to the tokenizer as special tokens):
  onset:  <o-b> <o-p> ... <o-ng> <o-gw> <o-kw> ...     (null onset -> emitted as nothing)
  rime:   <r-aa> <r-ai> ... <r-m> <r-ng> (syllabic) ...
  tone:   <t1> .. <t6>

Public API:
  syllable_to_tokens("ngo5")     -> ['<o-ng>', '<r-o>', '<t5>']
  text_to_tokens("我係 OK 喇")    -> ['<o-ng>','<r-o>','<t5>','<o-h>','<r-ai>','<t6>','OK','<r-a>','<t3>', ...]
  text_to_string(text)           -> space-joined string for the JSONL `text` field
  all_phoneme_tokens()           -> sorted list of every special token to add to the tokenizer
"""
from __future__ import annotations

import re
from functools import lru_cache
from typing import List, Optional, Tuple

# ── jyutping inventory (LSHK standard + corpus-validated colloquial 'a') ──────

# Longest-first so multi-char onsets (ng, gw, kw) match before single chars.
ONSETS: List[str] = sorted(
    ["b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "ng", "h",
     "gw", "kw", "w", "z", "c", "s", "j"],
    key=len, reverse=True,
)

RIMES = set("""
a aa aai aau aam aan aang aap aat aak
ai au am an ang ap at ak
e ei eu em eng ep et ek
i iu im in ing ip it ik
o oi ou om on ong op ot ok
oe oeng oet oek
eoi eon eot
u ui un ung ut uk
yu yun yut
m ng
""".split())

# Syllables that ARE a nasal on their own (null onset): 唔 m, 五/吳 ng.
SYLLABIC = {"m", "ng"}

TONES = ["1", "2", "3", "4", "5", "6"]

# A jyutping syllable = lowercase letters + one trailing tone digit.
_SYL_RE = re.compile(r"^[a-z]+[1-6]$")

# Punctuation we pass through verbatim (kept for prosody). Anything not matched
# as jyutping is passed through raw anyway; this set is only for clarity / stats.
_PUNCT = set("，。！？、；：「」『』（）()《》〈〉…—~,.!?;:\"'-")


# ── token surface forms ──────────────────────────────────────────────────────

def _onset_tok(o: str) -> str:
    return f"<o-{o}>"


def _rime_tok(r: str) -> str:
    return f"<r-{r}>"


def _tone_tok(t: str) -> str:
    return f"<t{t}>"


def all_phoneme_tokens() -> List[str]:
    """Every special token to register in the tokenizer (onsets + rimes + tones)."""
    toks = [_onset_tok(o) for o in sorted(ONSETS)]
    toks += [_rime_tok(r) for r in sorted(RIMES)]
    toks += [_tone_tok(t) for t in TONES]
    return toks


# ── parsing ──────────────────────────────────────────────────────────────────

def parse_syllable(syl_no_tone: str) -> Optional[Tuple[Optional[str], str]]:
    """Split a toneless jyutping syllable into (onset|None, rime). None on failure."""
    if syl_no_tone in SYLLABIC:
        return (None, syl_no_tone)
    for on in ONSETS:  # longest-first
        if syl_no_tone.startswith(on):
            rest = syl_no_tone[len(on):]
            if rest in RIMES:
                return (on, rest)
    if syl_no_tone in RIMES:  # null-onset syllable (e.g. 'aa', 'o')
        return (None, syl_no_tone)
    return None


def syllable_to_tokens(jyut: str) -> Optional[List[str]]:
    """'ngo5' -> ['<o-ng>','<r-o>','<t5>'].  Returns None if not parseable."""
    if not _SYL_RE.match(jyut):
        return None
    tone = jyut[-1]
    parsed = parse_syllable(jyut[:-1])
    if parsed is None:
        return None
    onset, rime = parsed
    out: List[str] = []
    if onset is not None:
        out.append(_onset_tok(onset))
    out.append(_rime_tok(rime))
    out.append(_tone_tok(tone))
    return out


# ── full text pipeline ───────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _g2p():
    import canto_hk_g2p as g
    return g.Pipeline()


def jyutping_to_tokens(jyutping: str, *, collect_oov: Optional[set] = None) -> List[str]:
    """
    Convert an already-g2p'd jyutping string (space-separated) into a token list.

    Chinese syllables become onset/rime/tone tokens; English words and
    punctuation are kept verbatim as single raw pieces (sub-tokenised later by
    the existing SentencePiece vocab). Unparseable jyutping is kept raw and, if
    `collect_oov` is given, recorded there.
    """
    out: List[str] = []
    for tok in jyutping.split():
        ph = syllable_to_tokens(tok)
        if ph is not None:
            out.extend(ph)
        else:
            if collect_oov is not None and _SYL_RE.match(tok):
                collect_oov.add(tok)
            out.append(tok)
    return out


def text_to_tokens(text: str, *, collect_oov: Optional[set] = None) -> List[str]:
    """Full INFERENCE pipeline: text -> canto-hk-g2p -> token list."""
    return jyutping_to_tokens(_g2p().convert(text), collect_oov=collect_oov)


def jyutping_to_string(jyutping: str, *, collect_oov: Optional[set] = None) -> str:
    """Space-joined phoneme string from an existing jyutping string (training)."""
    return " ".join(jyutping_to_tokens(jyutping, collect_oov=collect_oov))


def text_to_string(text: str, *, collect_oov: Optional[set] = None) -> str:
    """Space-joined phoneme string from raw text (inference)."""
    return " ".join(text_to_tokens(text, collect_oov=collect_oov))
