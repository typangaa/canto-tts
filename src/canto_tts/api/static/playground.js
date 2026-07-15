"use strict";

/* ──────────────────────────────────────────────────────────────
   AppState — single source of truth for all dynamic UI state.
   render() is called whenever state changes; it reconciles the
   DOM from state rather than scattering direct DOM writes.
   ────────────────────────────────────────────────────────────── */
const state = {
  quality:         "",          // matches <select> value; "" means null / fast
  isSynthesizing:  false,
  lastAudioUrl:    null,        // blob URL of most-recent synthesis
  debugInfo:       null,        // { phonemes, latencyMs, qualityMode } | null
  history:         [],          // array of HistoryEntry objects (newest first)
};

/* Maximum entries kept in session history.
   When a 9th entry would be added the oldest is dropped and its
   blob URL is revoked to free the browser's memory. */
const HISTORY_MAX = 8;
const MAX_CHARS   = 500;

/* ── DOM refs ───────────────────────────────────────────────── */
const form         = document.getElementById("synth-form");
const textarea     = document.getElementById("text-input");
const charCount    = document.getElementById("char-count");
const btn          = document.getElementById("synth-btn");
const statusEl     = document.getElementById("status");
const audioSec     = document.getElementById("audio-section");
const player       = document.getElementById("player");
const dlLink       = document.getElementById("download-link");
const qualitySel   = document.getElementById("quality-select");
const debugSection = document.getElementById("debug-section");
const histSection  = document.getElementById("history-section");
const histList     = document.getElementById("history-list");

/* ── Example chip sentences ─────────────────────────────────── */
const CHIPS = [
  "多謝晒，今日天氣幾好。",
  "我哋一齊去 IFC food court 食飯。",
  "早晨，今日開會定幾點？",
  "呢個 project 幾時 deadline 呀？",
  "唔該幫我叫杯凍檸茶，走冰。",
];

/* ── Quality mode labels for display ────────────────────────── */
const QUALITY_LABELS = {
  "":              "Fast",
  "duration_filter": "Balanced",
  "best_of_n":    "Best",
};

/* ══════════════════════════════════════════════════════════════
   render() — reconcile the whole UI from state.
   Keep it simple: rebuild sections that vary, leave static HTML
   sections (header, warning, form structure) untouched.
   ══════════════════════════════════════════════════════════════ */
function render() {
  /* Button + textarea disabled state */
  btn.disabled      = state.isSynthesizing;
  textarea.disabled = state.isSynthesizing;

  /* Char counter */
  const n = textarea.value.length;
  charCount.textContent = `${n} / ${MAX_CHARS}`;
  charCount.classList.toggle("over", n > MAX_CHARS);

  /* Audio section visibility */
  audioSec.style.display = state.lastAudioUrl ? "block" : "none";
  if (state.lastAudioUrl) {
    player.src  = state.lastAudioUrl;
    dlLink.href = state.lastAudioUrl;
  }

  /* Debug accordion */
  if (state.debugInfo) {
    debugSection.style.display = "block";
    const db = state.debugInfo;
    document.getElementById("debug-phonemes").textContent =
      db.phonemes  !== null ? db.phonemes  : "—";
    document.getElementById("debug-latency").textContent =
      db.latencyMs !== null ? `${db.latencyMs} ms` : "—";
    document.getElementById("debug-quality-mode").textContent =
      db.qualityMode !== null ? db.qualityMode : "—";
  } else {
    debugSection.style.display = "none";
  }

  /* History section */
  if (state.history.length === 0) {
    histSection.style.display = "none";
    return;
  }
  histSection.style.display = "block";

  /* Rebuild the history list entirely on each render.
     This is intentionally simple — it's a demo page, not a
     production app, and history is capped at 8 entries so the
     cost of a full rebuild is negligible. */
  histList.innerHTML = "";
  for (const entry of state.history) {
    histList.appendChild(buildHistoryCard(entry));
  }
}

/* Build a single history entry card element */
function buildHistoryCard(entry) {
  const div = document.createElement("div");
  div.className = "history-entry";

  /* Text excerpt */
  const textEl = document.createElement("div");
  textEl.className = "history-text";
  textEl.textContent =
    entry.text.length > 40 ? entry.text.slice(0, 40) + "…" : entry.text;
  div.appendChild(textEl);

  /* Remove button */
  const removeBtn = document.createElement("button");
  removeBtn.className = "history-remove";
  removeBtn.setAttribute("aria-label", "Remove this entry");
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => {
    URL.revokeObjectURL(entry.audioUrl);    // free blob memory
    state.history = state.history.filter(e => e.id !== entry.id);
    render();
  });
  div.appendChild(removeBtn);

  /* Meta row (quality badge + latency) */
  const meta = document.createElement("div");
  meta.className = "history-meta";

  const qBadge = document.createElement("span");
  qBadge.className = "quality-badge";
  qBadge.textContent = (QUALITY_LABELS[entry.quality] ?? entry.quality) || "Fast";
  meta.appendChild(qBadge);

  if (entry.latencyMs !== null) {
    const latEl = document.createElement("span");
    latEl.className = "latency-badge";
    latEl.textContent = `${entry.latencyMs} ms`;
    meta.appendChild(latEl);
  }
  div.appendChild(meta);

  /* Compact audio player — reuses the existing blob URL, no re-fetch */
  const audioWrap = document.createElement("div");
  audioWrap.className = "history-audio";
  const aud = document.createElement("audio");
  aud.controls = true;
  aud.src = entry.audioUrl;
  audioWrap.appendChild(aud);
  div.appendChild(audioWrap);

  return div;
}

/* ══════════════════════════════════════════════════════════════
   Event listeners — mutate state then call render()
   ══════════════════════════════════════════════════════════════ */

/* Character counter */
textarea.addEventListener("input", () => {
  render();
});

/* Quality selector */
qualitySel.addEventListener("change", () => {
  state.quality = qualitySel.value;
});

/* Chip buttons — fill textarea and trigger input event */
document.getElementById("chips-row").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  textarea.value = chip.dataset.sentence;
  textarea.dispatchEvent(new Event("input"));
  textarea.focus();
});

/* Form submit */
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const text = textarea.value.trim();
  if (!text) {
    setStatus("請輸入文字 / Please enter some text.", true);
    return;
  }
  if (text.length > MAX_CHARS) {
    setStatus(`Text too long (max ${MAX_CHARS} characters).`, true);
    return;
  }

  /* Revoke previous main-player blob URL to avoid memory leaks */
  if (state.lastAudioUrl) {
    URL.revokeObjectURL(state.lastAudioUrl);
    state.lastAudioUrl = null;
  }

  state.isSynthesizing = true;
  state.debugInfo = null;
  setStatus('<span class="spinner"></span>Synthesizing…', false, true);
  render();

  /* Map empty string → null as the backend's Pydantic field is str | None */
  const quality = state.quality === "" ? null : state.quality;

  try {
    const resp = await fetch("/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, quality }),
    });

    if (!resp.ok) {
      let detail = `Server error ${resp.status}`;
      try {
        const j = await resp.json();
        if (j.detail) detail = j.detail;
      } catch (_) { /* ignore parse error */ }
      throw new Error(detail);
    }

    /* Read debug headers before consuming the body.
       X-Canto-Phonemes is percent-encoded server-side (phoneme output can
       carry full-width punctuation from the source text, which isn't a
       valid raw HTTP header value) — decode it back here. */
    const phonemesRaw  = resp.headers.get("X-Canto-Phonemes");
    const phonemes     = phonemesRaw !== null ? decodeURIComponent(phonemesRaw) : null;
    const latencyRaw  = resp.headers.get("X-Canto-Latency-Ms")  ?? null;
    const qualityMode = resp.headers.get("X-Canto-Quality-Mode") ?? null;
    const latencyMs   = latencyRaw !== null ? Number(latencyRaw) : null;

    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);

    state.lastAudioUrl = url;
    state.debugInfo = { phonemes, latencyMs, qualityMode };

    /* Prepend to history; cap at HISTORY_MAX entries */
    const entry = {
      id:        Date.now(),
      text:      textarea.value.trim(),
      quality:   state.quality,
      latencyMs,
      audioUrl:  url,
    };
    state.history.unshift(entry);
    if (state.history.length > HISTORY_MAX) {
      /* Drop the oldest entry and revoke its blob URL to free memory.
         HISTORY_MAX is kept low (8) so blob accumulation stays bounded. */
      const oldest = state.history.pop();
      URL.revokeObjectURL(oldest.audioUrl);
    }

    player.play().catch(() => { /* autoplay may be blocked — that's fine */ });
    setStatus("✅ Done! Use the player below to listen.", false);
  } catch (err) {
    setStatus(`❌ ${err.message}`, true);
  } finally {
    state.isSynthesizing = false;
    render();
  }
});

/* ── Helpers ────────────────────────────────────────────────── */
function setStatus(html, isError = false, isHtml = false) {
  statusEl.className = isError ? "error" : "";
  if (isHtml) {
    statusEl.innerHTML = html;
  } else {
    statusEl.textContent = html;
  }
}

/* ── Initial render ─────────────────────────────────────────── */
render();
