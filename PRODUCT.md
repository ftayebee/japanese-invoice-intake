# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated by the implementation brief: a TypeScript application using React and Vite for the browser UI, with a lightweight Node.js/Express server. The application is local-first and has no deployment target or database requirement.

## Users

The primary users are accounting staff at Sample Trading Co., Ltd. who currently enter varied Japanese supplier invoices by hand during monthly close. The secondary audience is the interview evaluator, who needs to understand the engineering decisions and verify the workflow in a short demo.

## Product Purpose

Reduce manual invoice entry and duplicate-payment risk by turning PDF and scanned Japanese invoices into accounting-system-ready data. Success means reliable extraction, visible deterministic checks, safe exception handling, and registration only after the data is valid or explicitly reviewed.

## Positioning

The product is an evidence-led intake desk: AI interprets document layouts, but deterministic rules and human approval control what may reach the accounting system.

The standing visual commitment is the polished SaaS standard, played straight. Ramp, Xero, and Linear set the craft benchmark: compact operational hierarchy, restrained neutral surfaces, crisp typography, familiar controls, and decisive state feedback without ornamental metaphor.

## Operating Context

- Inputs are 12 supplied Japanese invoices in selectable-text PDF, image-only PDF, multi-page PDF, and JPG formats.
- Staff need to inspect extracted fields alongside the source document, correct mistakes, understand warnings, and register safe invoices.
- The existing accounting system is represented by the fixed local API documented in `TAKE_HOME.md`.
- The intended interview demonstration takes no more than three minutes and includes success, duplicate, unknown-partner, mixed-tax, and Japanese-era-date cases.

## Capabilities and Constraints

- Use TypeScript for the application and keep the architecture realistic for an approximately eight-hour take-home.
- Use a server-side LLM/OCR-capable provider configured by environment variable; no provider key is bundled.
- Preserve API credentials on the server and do not change the supplied accounting API behavior.
- Match only partners returned by the partner master; never invent partner codes.
- Validate dates, lines, tax groups, totals, and duplicates independently of AI output.
- Support review/edit/approval states without adding authentication, cloud infrastructure, queues, or a database.
- The exact auto-registration threshold is an implementation decision; the chosen policy must remain visible and documented.

## Evidence on Hand

- `TAKE_HOME.md` is the authoritative requirement, API reference, and submission template.
- `invoices/` contains the complete 12-document evaluation set.
- No existing product UI, brand system, customer claims, production metrics, or deployment evidence exists and none should be fabricated.

## Product Principles

1. Never let unverified AI output reach accounting.
2. Make every blocked or review state explainable to accounting staff.
3. Preserve source fidelity, including null fields, mixed tax rates, negative lines, handwriting, and page order.
4. Prefer deterministic checks and controlled matching over opaque confidence claims.
5. Keep the happy path quick without hiding the exceptions that matter.

## Accessibility & Inclusion

The web interface should be keyboard operable, use semantic controls, maintain visible focus and sufficient contrast, and avoid relying on color alone for invoice status.
