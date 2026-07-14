# Vendored from OpenMOSS/MOSS-TTS-Nano

Three files are copied, unmodified, from
[`OpenMOSS/MOSS-TTS-Nano`](https://github.com/OpenMOSS/MOSS-TTS-Nano)
(Apache-2.0, same license as this project). They live in **two different
locations** depending on whether they run at packaging time (maintainer-only,
never shipped to end users) or at inference time (ships inside the wheel
every user installs):

- `export_hf_to_tts_onnx.py` (here, `scripts/vendor/openmoss/`) — top-level
  export orchestrator (external-data packing, artifact layout). Only
  `scripts/export_onnx.py` calls this, from a maintainer's source checkout.
- `export_moss_tts_browser_onnx.py` (here, `scripts/vendor/openmoss/`) — the
  actual `torch.onnx.export` tracing code (wraps the GPT-2 global transformer
  + local per-channel transformer as separate exportable graphs: prefill /
  decode_step / local_decoder / local_cached_step / local_fixed_sampled_frame).
  Same maintainer-only scope as above.
- `ort_cpu_runtime.py` — **NOT here**; lives at
  `src/canto_tts/_vendor/openmoss/ort_cpu_runtime.py` instead. This is the
  ONNX Runtime session driver (`OrtCpuRuntime`): manual KV-cache management,
  sampling, and the autoregressive frame-generation loop that drives the
  exported graphs — every end user's `import canto_tts` needs this at
  inference time, so it must ship inside the installed package, not just the
  source checkout. (An earlier version of this project put it here too and
  pointed `onnx_backend.py` at `scripts/vendor/openmoss/` — that only worked
  in editable/dev installs; a real `pip install`-from-wheel has no `scripts/`
  directory at all, caught via a `docker run` smoke test.)

**Why vendored instead of reimplemented**: this is ~1600 lines of validated,
non-trivial torch-tracing and ONNX Runtime driver code that OpenMOSS already
built and tested for MOSS-TTS-Nano's exact architecture (GPT-2 backbone +
local transformer, delay-pattern-free per-channel audio decode). canto-tts's
checkpoint is a fine-tune of the same architecture (added Cantonese phoneme
vocabulary via tokenizer surgery, same `n_vq`/`hidden_size`/layer shapes) —
the export/runtime code is generic over `model.config`, so it works against
our checkpoint unmodified. Reimplementing this would duplicate real
engineering risk for no benefit (same principle this project already applies
to G2P: don't reimplement validated external logic).

`scripts/export_onnx.py` calls `export_hf_to_tts_onnx.py` as a subprocess and
uses `ort_cpu_runtime.OrtCpuRuntime` directly. `src/canto_tts/backends/onnx_backend.py`
also uses `OrtCpuRuntime` as its ONNX Runtime driver at inference time — see
that module's docstring for the (several) ways canto-tts's runtime usage
deviates from OpenMOSS's own `onnx_tts_runtime.py` wrapper (which was NOT
vendored — its WeTextProcessing/voice-preset/browser-download coupling
doesn't match this project's design and was rebuilt from scratch, simpler,
in `onnx_backend.py`).

Not vendored (deliberately): `onnx_tts_runtime.py`, `infer_onnx.py`,
`app_onnx.py`, `text_normalization_pipeline.py` — these couple text
normalization (WeTextProcessing), multi-voice presets, and browser/WASM
concerns that don't apply to canto-tts's single-default-voice, phoneme-only
design.
