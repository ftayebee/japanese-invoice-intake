# Submission

- Name: **MD. FAHIM TAYEBEE**
- Submission date (YYYY-MM-DD): 2026-08-23
- Hours actually spent: **4 hours**
- Repository / how to run it: Run `npm ci`, copy `.env.example` to `.env`, replace the `LLM_API_KEY` placeholder with your provider key, then run `npm run dev`; open `http://127.0.0.1:5173`.

## 1. Understanding the request

The client described a manual-entry bottleneck: accounting staff receive inconsistent Japanese invoices and retype them into an existing system. The worthwhile problem is narrower than “OCR an invoice.” It is to reduce entry time without increasing duplicate-payment or incorrect-posting risk.

I set out to build an evidence-led intake desk. AI interprets varied document layouts, but deterministic code and an explicit reviewer control identity, dates, arithmetic, tax rounding, duplicates, and the final accounting write. Success is not maximum automatic posting; it is making safe invoices quick and unsafe or uncertain invoices obvious and recoverable.

## 2. What you would have asked the client

| What you wanted to ask | The assumption you made | Why |
|---|---|---|
| What monthly volume and close-period latency should the system support? | Optimize this take-home for small batches, bound extraction concurrency at two, and describe the changes needed at 1,000 invoices/month. | The supplied set is 12 files and no service-level target was given; unbounded provider calls would be unsafe. |
| Which invoices, if any, may post without a person? | Only high-confidence, warning-free, deterministically valid invoices can become `READY`; handwriting, fuzzy identity, warnings, or confidence below 0.88 require review. | False positives are more costly than one extra review in accounts payable. |
| Does handwriting override printed invoice content? | Printed values stay authoritative. Handwriting is extracted separately and always surfaced to the reviewer. | The samples contain both a received mark and a bank-detail correction, but no policy establishes handwriting as posting authority. |
| What should happen when the supplier is not in the partner master? | Hold the invoice in review and allow selection of an existing partner only; never invent a partner code. | The accounting API rejects unknown codes and partner creation is outside the stated scope. |
| What is the exact tax-rounding convention? | Reproduce the supplied API: sum lines by tax code, floor each group's tax, then add the groups. | Recalculating per line or rounding instead of flooring can produce a plausible but rejected total. |
| What retention, audit, and access-control policies apply? | Keep the demo local and in memory, keep secrets server-side, and explicitly scope production auth, durable storage, and audit trails out. | These require client policy and infrastructure decisions that are not justified inside the expected eight hours. |

## 3. Scoping decisions

**What you built**

- Multi-file PDF/JPG intake with size, count, decode, and magic-byte validation.
- Selectable-text PDF extraction and full-page vision fallback for scanned/image PDFs; all pages are preserved.
- Server-side OpenAI Responses API extraction into a strict Zod schema, with one bounded retry.
- Japanese/Reiwa date normalization, conservative partner-master matching, JPY/tax/totals validation, and local plus remote duplicate detection.
- Visible queue states, source preview, editable invoice and line fields, warnings, handwriting, validation evidence, approval, retry, and guarded registration.
- A server-only accounting proxy using the supplied API unchanged.
- Network-free domain, HTTP-boundary, real-document-routing, and workflow-state tests, plus a live 12-sample acceptance runner.

I prioritized safe end-to-end behavior first: document boundary, provider boundary, deterministic controls, accounting integration, then operator ergonomics and documentation.

**What you left out, and why**

- Authentication, roles, SSO, and approval segregation: client identity policy was not supplied.
- Database, object storage, durable queue, and deployment: the assignment is a local demo and those would consume most of the time without improving the core decision flow.
- Partner creation and tax-code administration: the supplied accounting API exposes both as read-only masters.
- Provider fine-tuning or a large labelled evaluation set: the twelve samples are useful acceptance cases, not enough evidence for model training.
- Automatic posting of uncertain documents: intentionally rejected as an unsafe optimization.

## 4. Design and technology choices

The browser uploads one or more files to an Express server. The server validates the actual bytes, then uses PDF.js to read every text-layer page. A PDF without meaningful text is rendered page-by-page with `@napi-rs/canvas`; JPGs go directly to vision after decode/dimension checks. The provider receives either complete extracted text or every page image and must return a strict structured object.

The result then passes through pure TypeScript domain functions: NFKC/date normalization, partner matching in safety order (registration number, official name, alias, conservative fuzzy suggestion), line and totals validation, and duplicate checks. The React interface keeps the source beside the editable result. Only a valid, non-duplicate, reviewed invoice can call the server's accounting registration route.

I chose React + Vite for a compact, responsive operator interface and Express for an explicit server-side security boundary. I chose the OpenAI Responses API with a vision-capable `gpt-5.6-luna` default because one structured multimodal call can handle Japanese text, irregular tables, scans, and handwriting while keeping cost low; the model and base URL are configurable. I used Zod both for the provider response and external HTTP responses so type claims are checked at runtime.

I decided against browser-side provider calls because they expose credentials and bypass validation. I also decided against relying on local Tesseract alone: it is useful for plain OCR but does not by itself solve supplier/recipient disambiguation, multi-layout table reconstruction, or handwriting interpretation. I did not use an ORM or workflow framework because the local, in-memory scope does not justify them.

## 5. How you used AI, and how you checked it

**What you delegated to AI**

At runtime, AI receives the complete invoice content and extracts supplier evidence, invoice metadata, every line, visible totals, confidence, warnings, and handwriting annotations. The prompt explicitly forbids inventing values, converting missing quantity/price to `1`, dropping continuation pages, flattening negative discounts, or silently applying handwriting.

I also used an AI coding assistant to inspect the assignment and samples, scaffold the TypeScript application, propose domain boundaries, implement focused modules, generate tests, and review the operator flow. I kept generated work in small, independently testable pieces rather than accepting a monolithic implementation.

**How you verified the output**

- The provider response must satisfy a strict runtime schema; malformed output never enters the workflow.
- Dates, partner codes, allowed tax codes, integer constraints, line multiplication, per-tax-group flooring, totals, and duplicate identity are recalculated independently.
- Real sample files verify routing: the first three use PDF text, invoice 02 has two pages, invoice 09 uses rendered vision, and JPGs decode as images.
- Network-free workflow tests exercise `READY`, `NEEDS_REVIEW`, approval, unknown partner, local duplicate, registration failure, and accounting duplicate transitions.
- `npm run verify:samples` processes all twelve real documents with a configured provider and asserts each supplied edge case rather than checking only that a JSON object was returned.

**A case where the AI got it wrong** (one example is enough, if you have one)

On `invoice_12`, the model read the supplier name and every financial value correctly, including the negative discount, but transcribed the registration number as `T5050000505` instead of master value `T5050005000505`. The matcher deliberately refuses name fallback when a supplied registration number is unknown, so the invoice stayed in `NEEDS_REVIEW` instead of silently mapping to a plausible partner. The reviewer can compare the source, select the existing partner explicitly, and revalidate. This is the control working as intended: confidence was 0.98, but deterministic identity evidence overruled it.

## 6. Integrating with the accounting system

I copied the supplied Python API exactly, kept its credential on the Node server, parsed every response envelope, and mapped failures to safe workflow states. Before `POST /invoices`, the app validates known partner code, canonical dates, JPY currency, required line fields, `T10`/`T08`, integer amounts, line arithmetic where quantity and unit price exist, group-level floor tax, subtotal, and total. It checks the same partner-code/invoice-number uniqueness locally and against `GET /invoices`; the API's own `DUPLICATE_INVOICE` remains the final idempotency guard.

The table below is from a live run of all twelve files with `gpt-5.6-luna`, not guessed from the source documents. All deterministic acceptance assertions passed.

| Invoice | Result | How you handled it |
|---|---|---|
| invoice_01 | `READY` | Text PDF; matched P-1001, 3 lines, ¥334,400. |
| invoice_02 | `READY` | Read both pages and all 26 lines; matched P-1004, ¥1,560,988. |
| invoice_03 | `READY` | Preserved T10 and T08 lines and recalculated the groups; ¥125,357. |
| invoice_04 | `NEEDS_REVIEW` | Values are valid, but the handwritten received mark is surfaced for review. |
| invoice_05 | `NEEDS_REVIEW` | Preserved two lump-sum quantity/unit-price pairs as `null`; warning requires review. |
| invoice_06 | `NEEDS_REVIEW` | Resolved to P-1001; a lump-sum line warning requires review. |
| invoice_07 | `DUPLICATE` | Matched invoice_01's partner and invoice number; posting is blocked. |
| invoice_08 | `NEEDS_REVIEW` | Mixed T08/T10 values validate; handwritten bank correction stays separate. |
| invoice_09 | `NEEDS_REVIEW` | Used rendered PDF vision; source total is ¥1 above deterministic group-floor math and is flagged. |
| invoice_10 | `NEEDS_REVIEW` | Unknown supplier registration number stays unmatched; no partner code is invented. |
| invoice_11 | `READY` | Converted Reiwa 8 dates to 2026 ISO dates; matched P-1002, ¥125,070. |
| invoice_12 | `NEEDS_REVIEW` | Preserved the -¥30,000 discount; blocked a misread registration number despite the correct supplier name. |

## 7. Cost, limits, and risk in production

- **Cost per invoice** (and what makes it up): Estimated about **$0.003–$0.01** at the default model, assuming roughly 8k–25k input/vision tokens and 1.5k structured output tokens. At listed rates of $0.20/M input and $1.20/M output, an 8k + 1.5k case is about $0.0034. Actual image tokenization and retry frequency must be measured from provider billing.
- **Monthly cost at 1,000 invoices per month**: Roughly **$3.40–$10** in model calls, before storage, compute, monitoring, and support. A 2% one-retry rate adds about 2% to provider cost.
- **Processing time per invoice**: The measured 12-file run completed in **36.68 seconds** with concurrency two. Individual processing averaged **5.69 seconds** (3.74–11.32 seconds).
- **Where this breaks first**: Unfamiliar layouts/poor scans and provider rate limits first; then the in-memory store and single Node process at operational scale. Policy gaps around ambiguous handwriting and supplier onboarding are a larger business risk than raw throughput.
- **How you would find out if something was registered incorrectly**: Persist the immutable source hash, original file, provider request/response IDs, extracted object, validation version, every human edit, approval identity/time, exact outbound DTO, and accounting response. Alert on validation overrides and reconcile posted totals/duplicate keys against the accounting system. The take-home exposes the decision evidence but does not implement durable audit storage.

## 8. What you would do with another 8 hours

1. Add Postgres/object storage, idempotent durable jobs, source hashes, and an append-only audit trail, because recovery and accountability come before more automation.
2. Build a labelled regression set from reviewed invoices with field-level accuracy, false-ready rate, latency, and cost dashboards, because safe thresholds need evidence rather than intuition.
3. Add authentication/roles and a production pilot workflow with supplier onboarding and configurable approval policy, because the remaining uncertainty is organizational as much as technical.
