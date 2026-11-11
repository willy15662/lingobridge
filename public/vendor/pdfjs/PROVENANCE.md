# PDF.js provenance

This directory contains separately licensed Mozilla PDF.js libraries and assets.

- Upstream project: Mozilla PDF.js (`https://github.com/mozilla/pdf.js`).
- Both module headers declare PDF.js version **5.4.322**, build **657a18d7a**, copyright 2024 Mozilla Foundation, Apache License 2.0.
- The two JavaScript modules (`pdf.mjs` and `pdf.worker.mjs`) are unmodified. Their original license headers remain intact. `LICENSE` contains the full Apache 2.0 license text.
- CMaps are unmodified; their Adobe license is preserved at `cmaps/LICENSE`.
- Standard fonts are unmodified; their notices are preserved as `LICENSE_FOXIT` and `LICENSE_LIBERATION` in `standard_fonts/`.
- No viewer UI, scripting sandbox or WASM decoder is included.

SHA-256:

| File | SHA-256 |
| --- | --- |
| pdf.mjs | `7c1a3c19fb241266bf3b9dd8b9315f8929c233315c3d30b55c7a02dc6adc5dae` |
| pdf.worker.mjs | `209a7ef55a4929b7b9be7aad8e1eb9723644bea93425adfd933f383cfdb06d86` |

Its `getDocument` accepts in-memory bytes and does not perform generic URL networking. The local document adapter supplies only user-selected bytes and local worker/CMap/font paths. Evaluation, WASM, XFA and font-face loading are disabled. The adapter uses only text extraction, not viewer APIs or drawing operations.

The modules require `Promise.withResolvers`, so PDF text extraction requires Chrome 124 or newer even though other extension features target Chrome 120. Update these files as a matched main/worker pair and rerun PDF tests when upgrading.
