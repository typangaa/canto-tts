# Project: canto-tts-desktop Post-Phase 3 Bug Fixes

## Architecture
- React Frontend (`desktop/src`) <-> Tauri v2 Rust Shell (`desktop/src-tauri`) <-> Python API Engine (`src/canto_tts`)

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | R1 Fix React Rules of Hooks Violation in EngineBanner (B1) | Move useMemo above `if (engineState === "connected") return null;` in `EngineBanner.tsx` | M1 | request |
| 2 | R2 Fix Premature Blob URL Revocation in BatchTab (B2) | Track Object URLs in `useRef<Set<string>>` and revoke only on unmount in `BatchTab.tsx` | M2 | request |
| 3 | R3 Remove Misleading Candidate Path in Factory (B3) | Clean up dead candidate path (`factory_file.parent.parent / "onnx_weights"`) in `factory.py` | M3 | request |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Requirement R1 (B1) | Fix Rules of Hooks in `desktop/src/components/EngineBanner.tsx` | none | DONE |
| M2 | Requirement R2 (B2) | Blob URL cleanup in `desktop/src/components/BatchTab.tsx` | none | DONE |
| M3 | Requirement R3 (B3) | Candidate path cleanup in `src/canto_tts/backends/factory.py` | none | DONE |
| M4 | Final Acceptance Verification | Verification bar (`npx tsc`, `npm run build`, `cargo check`, `CantoTTS()`) | M1, M2, M3 | DONE |

## Interface Contracts
### React EngineBanner (R1)
- All React hooks (`useMemo`, etc.) must be unconditionally invoked at top-level before any early return statements.

### React BatchTab (R2)
- Audio Blob Object URLs generated for batch items must be registered in a `useRef<Set<string>>` ref and only revoked in a cleanup function returned by `useEffect` on component unmount (`[]` dependency array).

### Python Backend Factory (R3)
- Path resolution candidate list must only contain valid, existing candidate locations (excluding `src/canto_tts/onnx_weights` which does not exist).

## Code Layout
- `desktop/src/components/EngineBanner.tsx` (M1: EngineBanner React hooks)
- `desktop/src/components/BatchTab.tsx` (M2: BatchTab Blob URL lifecycle)
- `src/canto_tts/backends/factory.py` (M3: ONNX backend candidate paths)
