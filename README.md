# Invoice Intake

An evidence-led intake desk for Japanese supplier invoices. It accepts PDF and JPG files, uses a vision-capable LLM for structured extraction, applies deterministic accounting checks, routes uncertainty to human review, blocks duplicates, and registers only safe invoices with the supplied local accounting API.

## Quick start

Requirements: Node.js 20+, npm, Python 3.11+, and an OpenAI API key with access to the configured vision model.

```powershell
npm ci
Copy-Item .env.example .env
# Open .env and replace only the LLM_API_KEY placeholder with your provider key.
# Keep .env local; never commit it.
npm run dev
```

Open `http://127.0.0.1:5173`. The command starts all three local processes:

- React/Vite web app on port 5173
- TypeScript/Express application server on port 3001
- supplied accounting API on port 8080

The accounting API uses the assignment-provided local key `demo-key-1234`. It remains server-side.

On macOS or Linux, use `cp .env.example .env` instead of `Copy-Item`. The optional
variables in `.env.example` are commented out so the validated defaults below are
used unless you deliberately override them.

## Useful commands

```powershell
npm test              # deterministic unit and server tests
npm run typecheck     # server and browser TypeScript checks
npm run build         # typecheck plus production Vite build
npm run check         # tests plus build
npm run verify:samples # process and assert all 12 samples against a running app
```

`verify:samples` intentionally refuses to run unless the LLM and accounting API are available. It clears the current in-memory session, loads all supplied invoices, waits for processing, prints a result table, and checks the assignment's multi-page, mixed-tax, handwriting, alias, duplicate, image-only PDF, unknown-supplier, Japanese-era, null-pricing, and negative-discount cases.

## Processing flow

```text
PDF / JPG
   │
   ├─ selectable PDF ── PDF.js text from every page
   └─ scan / image PDF ─ full-page render for vision
   │
strict schema extraction (server-side OpenAI Responses API)
   │
date normalization ─ partner-master match ─ accounting validation
   │                                      │
local + accounting duplicate check       └─ tax groups and totals recalculated
   │
READY / NEEDS_REVIEW / DUPLICATE / INVALID
   │
human correction and approval when required
   │
guarded POST to the supplied accounting API
```

AI is limited to document interpretation. Partner identity, date conversion, allowed tax codes, integer rules, line arithmetic, per-tax-code floor rounding, totals, duplicate identity, and registration eligibility are deterministic TypeScript functions with focused tests.

## Review policy

An invoice enters `NEEDS_REVIEW` when any of these is true:

- extraction confidence is below 0.88;
- the provider or document parser reports a warning;
- handwriting is present;
- partner matching used controlled fuzzy similarity;
- a deterministic field or accounting validation fails.

Unknown suppliers are never assigned an invented code. Duplicate invoices cannot be approved or registered. Review approval is only possible after deterministic errors are resolved; registration is only possible from `READY`.

## Document handling

- Accepts genuine PDF, JPG, and JPEG payloads only; MIME type and magic bytes must agree.
- Maximum upload size defaults to 15 MB per file, with at most 12 files per request.
- Selectable PDFs use all text-layer pages. If a meaningful text layer is absent, every page is rendered at vision-friendly resolution.
- JPG dimensions and decoding are validated before any provider call.
- Printed invoice values remain authoritative; handwriting is returned separately for the reviewer.
- Missing quantity or unit price remains `null`; negative discount lines remain negative.
- Uploaded source buffers stay in server memory and are exposed only through an inline preview route.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `LLM_API_KEY` | none | Required server-side provider credential |
| `LLM_MODEL` | `gpt-5.6-luna` | Vision-capable structured extraction model |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | Responses API base URL |
| `ACCOUNTING_API_BASE_URL` | `http://localhost:8080` | Supplied accounting system |
| `ACCOUNTING_API_KEY` | `demo-key-1234` | Assignment-provided local API credential |
| `SERVER_PORT` | `3001` | Express application port |
| `MAX_UPLOAD_MB` | `15` | Per-file upload ceiling |

No environment value is shipped to the browser bundle.

## Architecture and boundaries

- `web/` — React operator interface
- `server/` — upload boundary, document parsing, provider call, workflow state, and accounting proxy
- `shared/domain/` — pure normalization, matching, validation, totals, and duplicate rules
- `tests/` — domain and network-free server/workflow tests
- `scripts/verify-samples.ts` — live 12-document acceptance runner
- `accounting_api.py` — supplied API copied exactly from the assignment Markdown

The take-home intentionally uses an in-memory document store. There is no application authentication, database, durable job queue, or deployment configuration. Restarting the Node process clears intake records; restarting the Python process clears registered mock invoices. In production, source files, revisions, approvals, provider traces, and accounting responses would need durable encrypted storage and an audit log.

## Failure behavior

Provider, parsing, validation, and accounting errors are mapped to safe workflow states and user-facing recovery messages. The server never returns raw stack traces. Registration failures keep the reviewed invoice available for retry, while an accounting `DUPLICATE_INVOICE` response becomes a terminal duplicate state.

## Test scope

The test suite covers Japanese/Reiwa date normalization, alias and fuzzy partner matching, mixed-rate and negative-line tax arithmetic, null pricing, all-pages aggregation, duplicate keys, DTO mapping, real assignment PDF/JPG routing, MIME spoofing, filename sanitization, API envelopes, and workflow/registration state transitions. Provider quality is checked separately by `npm run verify:samples` because it requires a real model call and the supplied corpus.
