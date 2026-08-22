---
name: Invoice Intake
description: A compact evidence-led accounting review desk.
colors:
  action-blue: "#1768e5"
  action-blue-deep: "#1155bd"
  canvas-cloud: "#f5f6f8"
  surface-white: "#ffffff"
  ink: "#171a22"
  muted-ink: "#697180"
  divider: "#e3e6eb"
  valid-green: "#157956"
  review-amber: "#a66308"
  blocked-red: "#bc3445"
typography:
  title:
    fontFamily: "IBM Plex Sans, Yu Gothic UI, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "IBM Plex Sans, Yu Gothic UI, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "IBM Plex Sans, Yu Gothic UI, Segoe UI, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.2
rounded:
  control: "7px"
  surface: "11px"
spacing:
  tight: "6px"
  control: "10px"
  surface: "14px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.surface-white}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "34px"
  panel:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "14px"
---

# Design System: Invoice Intake

## Overview

**Creative North Star: "The Evidence Desk"**

This system is a polished accounting workspace played straight: compact, neutral, and decisive. It borrows the operational confidence of Ramp, the accounting clarity of Xero, and the reduced chrome of Linear without imitating any product's branding.

Every visual device helps a reviewer compare evidence, understand a state, or take the next safe action. Decoration stays subordinate to the real invoice, extracted values, deterministic checks, and registration guardrail.

**Key Characteristics:**

- Dense but calm operational hierarchy
- Simultaneous source and record comparison
- Cool neutral surfaces with one blue action voice
- Status expressed with icon, color, and plain-language copy
- Tabular numbers and crisp one-pixel dividers

## Colors

The palette is a cool cloud-and-ink neutral system with blue reserved for interaction and semantic colors reserved for state.

### Primary

- **Action Blue:** Drives upload, approval, registration, focus, and the current extraction-confidence indicator.

### Secondary

- **Valid Green:** Marks deterministic success and completed workflow states.
- **Review Amber:** Marks exceptions that need a human decision.
- **Blocked Red:** Marks invalid or failed states that prevent posting.

### Neutral

- **Canvas Cloud:** Separates the application frame from white working surfaces.
- **Surface White:** Holds panels, controls, and document work areas.
- **Ink:** Carries primary content and numeric emphasis.
- **Muted Ink:** Carries metadata and supporting copy.
- **Divider:** Provides most structural separation without heavy shadows.

**The One Action Voice Rule.** Blue means interactive progress; it is not used as general decoration.

## Typography

**Display Font:** IBM Plex Sans (with Japanese UI and system fallbacks)  
**Body Font:** IBM Plex Sans (with Japanese UI and system fallbacks)  
**Label/Mono Font:** IBM Plex Mono for the small environment identifier only

**Character:** The type system is compact, technical, and highly legible. Weight and tabular alignment create hierarchy more often than dramatic scale.

### Hierarchy

- **Title** (600, 14px): panel and workflow headings.
- **Body** (400, 11px): operational copy, warnings, and source metadata.
- **Label** (600, 9–10px): fields, table headers, and status copy.
- **Metric** (700, 17–20px): batch counts and currency summaries with tabular numerals.

**The Quiet Hierarchy Rule.** Prefer weight, alignment, and proximity over oversized headings or uppercase prefaces.

## Layout

The desktop workspace uses a four-card summary row above a three-column reconciliation grid: queue, source, and accounting editor. At widths below 900px, those areas stack in the same reading order. At widths below 520px, forms and totals become single-column while wide line items scroll inside their own bounded table.

Spacing follows a compact 6/10/14px rhythm. The working viewport is intentionally dense so source evidence and the guarded action remain available without navigating to another screen.

**The Evidence Beside Action Rule.** On desktop, the source and editable record remain simultaneously visible.

## Elevation & Depth

The system is flat by default. One-pixel dividers and cool tonal changes establish structure; a low ambient shadow is reserved for major panels and transient notifications.

**The Border Before Shadow Rule.** Use dividers for routine hierarchy and shadow only when a surface must read above the canvas.

## Shapes

Controls use compact 6–7px corners. Major working surfaces use 10–11px corners. Statuses use short rounded rectangles rather than fully pill-shaped containers, keeping the interface operational rather than playful.

## Components

### Buttons

- **Shape:** Compact gently rounded controls (7px) at 34px height.
- **Primary:** White copy on Action Blue, reserved for the next safe workflow step.
- **Hover / Focus:** Darken blue on hover; use a visible cool-blue focus ring for keyboard navigation.
- **Secondary / Ghost:** White bordered controls for alternatives and transparent controls for low-priority actions.

### Chips

- **Style:** Short status rectangles pair a Lucide icon, semantic copy, tinted background, and matching foreground.
- **State:** Color is never the only differentiator.

### Cards / Containers

- **Corner Style:** Calm surface radius (10–11px).
- **Background:** White on the cloud canvas.
- **Shadow Strategy:** Low ambient lift only for major working panes.
- **Border:** A crisp neutral one-pixel edge.
- **Internal Padding:** Usually 10–14px, reduced in dense table rows.

### Inputs / Fields

- **Style:** White fill, neutral one-pixel stroke, 6px corners, and compact 29–32px height.
- **Focus:** Blue border plus a restrained pale-blue outer ring.
- **Error / Disabled:** Blocking context appears in adjacent plain-language notices; disabled actions remain visibly present at reduced opacity.

### Navigation

The application header stays 54–58px tall. Desktop shows service health and secondary batch actions; mobile keeps the brand and the primary upload action.

### Reconciliation Workspace

The queue preserves row identity and status, the source pane displays the original document at useful scale, and the editor keeps validation evidence above editable accounting fields. Approval and registration remain anchored at the editor foot.

## Do's and Don'ts

### Do:

- **Do** keep source evidence, validation, and the editable record in one continuous workflow.
- **Do** use icons and text together for every consequential status.
- **Do** keep numeric columns tabular and right-aligned where comparison matters.
- **Do** contain dense table overflow locally on narrow screens.

### Don't:

- **Don't** use blue for decorative emphasis or secondary status.
- **Don't** hide invalid, duplicate, handwritten, or unknown-partner evidence behind a modal.
- **Don't** add ornamental metaphors, gradients, or exaggerated shadows to routine accounting surfaces.
- **Don't** allow status color alone to communicate whether registration is safe.
