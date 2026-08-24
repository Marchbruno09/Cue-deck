# Boss AI Continuous Enterprise Management - Design Spec

> Human-readable design narrative. The machine-readable execution contract is `spec_lock.md`; if the two diverge, `spec_lock.md` is authoritative.

## I. Project Information

| Item | Value |
| ---- | ----- |
| **Project Name** | Boss AI Continuous Enterprise Management |
| **Canvas Format** | PPT 16:9 (1280x720) |
| **Page Count** | 1 slide |
| **Design Style** | Pyramid communication mode with Swiss-minimal visual treatment |
| **Target Audience** | CEOs, senior enterprise leaders, enterprise transformation leaders, and investment decision-makers |
| **Use Case** | Executive product positioning: distinguish Boss AI from task-oriented executive assistants and explain its continuous enterprise-management architecture |
| **Created Date** | 2026-08-05 |

---

## II. Canvas Specification

| Property | Value |
| -------- | ----- |
| **Format** | PPT 16:9 |
| **Dimensions** | 1280x720 |
| **viewBox** | `0 0 1280 720` |
| **Margins** | 56px left/right, 44px top, 34px bottom |
| **Content Area** | 1168x642 |

---

## III. Visual Theme

### Theme Style

- **Mode**: pyramid - state the conclusion first, then support it with the capability architecture and source-backed proof.
- **Visual style**: swiss-minimal - grid-led alignment, sharp geometry, generous but purposeful whitespace, and no decorative effects.
- **Theme**: Light theme.
- **Tone**: Executive, precise, enterprise-grade, and evidence-backed.
- **Visual hierarchy**: The action title is the first read; the Boss AI stack is the dominant visual; the Hermes/OpenClaw comparison and source evidence are secondary reads.

### Color Scheme

| Role | HEX | Purpose |
| ---- | --- | ------- |
| **Background** | `#F7F9F8` | Quiet canvas field |
| **Surface** | `#FFFFFF` | Capability tiers and proof strip |
| **Secondary bg** | `#EDF3F1` | Muted comparison and governance areas |
| **Primary** | `#145849` | Boss AI architecture, titles, and continuous sensing |
| **Accent** | `#064FA0` | CEO interface and decision emphasis |
| **Body text** | `#1F2B2B` | Main copy |
| **Secondary text** | `#5E6A68` | Supporting labels and evidence |
| **Border/divider** | `#B7D3CD` | Structural dividers and envelope outline |
| **Grid** | `#DDE7E4` | Fine rules and subtle connectors |

### Gradient Scheme

No gradients. Use solid fills, hairline rules, and controlled fill opacity only.

---

## IV. Typography System

### Font Plan

**Typography direction**: PPT-safe humanist sans contrast - Trebuchet MS for the action title and emphasis, Arial for body content.

| Role | Chinese | English | Fallback tail |
| ---- | ------- | ------- | ------------- |
| **Title** | Microsoft YaHei | Trebuchet MS, Arial | sans-serif |
| **Body** | Microsoft YaHei | Arial | sans-serif |
| **Emphasis** | Microsoft YaHei | Trebuchet MS, Arial | sans-serif |
| **Code** | - | Consolas, Courier New | monospace |

**Per-role font stacks**:

- Title: `"Trebuchet MS", Arial, "Microsoft YaHei", sans-serif`
- Body: `Arial, "Microsoft YaHei", sans-serif`
- Emphasis: `"Trebuchet MS", Arial, "Microsoft YaHei", sans-serif`
- Code: `Consolas, "Courier New", monospace`

### Font Size Hierarchy

**Baseline**: Body font size = 20px.

| Purpose | Size | Weight |
| ------- | ---- | ------ |
| Action title | 38px | Bold |
| Section / takeaway | 24px | Bold |
| Body content | 20px | Regular |
| Annotation / evidence | 16px | Regular |
| Small capability label | 14px | SemiBold |

**Formula rendering policy**: `text-only`. The source contains no formula-worthy expressions.

---

## V. Layout Principles

### Page Structure

- **Header area (44-142px)**: exact user-provided action title across the full width, with a short primary-color rule beneath it.
- **Content area (168-610px)**: asymmetric 35:65 composition. Left side contrasts task agents with continuous management and carries three supporting arguments. Right side contains the Boss AI capability stack.
- **Evidence area (628-686px)**: full-width source-proof strip with the document's explicit distinction and five named capabilities.
- **Architecture treatment**: Four operating tiers rise from Ontology to GUI/Dialogue, which is labelled as the CEO interface. Enterprise Engineering & Service is the enclosing fifth capability, preserving the source definition without inventing a sixth module.

### Layout Pattern Library

| Pattern | Usage in this deck |
| ------- | ------------------ |
| **Asymmetric split (35:65)** | Muted task-agent comparison on the left; dominant Boss AI architecture on the right |
| **Layered stack** | Ontology -> Wiki Brain -> Decision & Action -> GUI/Dialogue / CEO interface |
| **Governance envelope** | Enterprise Engineering & Service surrounds the operating stack |
| **Bottom proof strip** | Two evidence statements form a compact, source-backed footer |

### Spacing Specification

| Element | Current Project |
| ------- | --------------- |
| Safe margin from canvas edge | 56px horizontal, 44px top, 34px bottom |
| Content block gap | 28px |
| Icon-text gap | 12px |
| Capability tier gap | 8px |
| Divider weight | 1-2px |
| Corner radius | 0-6px; sharp by default |

---

## VI. Icon Usage Specification

### Source

- **Built-in icon library**: `tabler-outline` only.
- **Stroke width**: 2px deck-wide.
- **Usage method**: `<use data-icon="tabler-outline/icon-name" .../>` placeholders, embedded during finalization.
- **Editability**: Icons are embedded as vector graphics that remain movable and scalable; the surrounding architecture, text, and connectors are native editable PowerPoint objects.

### Recommended Icon List

| Purpose | Icon Path | Page |
| ------- | --------- | ---- |
| Ontology | `tabler-outline/schema` | P01 |
| Wiki Brain | `tabler-outline/brain` | P01 |
| Decision and action | `tabler-outline/route` | P01 |
| GUI and dialogue | `tabler-outline/message-circle` | P01 |
| CEO interface | `tabler-outline/user-star` | P01 |
| Enterprise engineering and service | `tabler-outline/settings-ai` | P01 |

---

## VII. Visualization Reference List

Catalog read: 71 templates

| Page | Template | Path | Summary-quote (verbatim from `charts_index.json`) | Usage |
| ---- | -------- | ---- | ------------------------------------------------- | ----- |
| P01 | pyramid_chart | `templates/charts/pyramid_chart.svg` | "Pick for 3-6 stratified hierarchy layers in flat 2D side-view — Maslow's hierarchy, maturity models, value hierarchy, capability tiers, market segments, audience pyramid. Skip for dramatic tone (use pyramid_isometric), flat priority list (use vertical_list), or org reporting (use top_down_tree)." | Structural starting point for the four rising operating tiers; adapt into rectangular tiers inside the fifth governance capability envelope |

Fewer than 3 visualization pages: this deck contains one slide.

**Runners-up considered**:

- `layered_architecture` | rejected for P01: it assumes multiple module cards within 3-4 horizontal layers, while this slide needs one clear capability per tier.
- `module_composition` | rejected for P01: it emphasizes parent-child containment, not the rising progression toward executive interaction.
- `hub_spoke` | rejected for P01: the five capabilities are not equally weighted spokes around one center.

---

## VIII. Image Resource List

No external, generated, or web-sourced images are used. The slide is constructed from native SVG shapes, text, connectors, and the approved vector icon placeholders.

---

## IX. Content Outline

### Part 1: Executive Positioning

#### Slide 01 - Boss AI is a continuous enterprise management system, not another task-oriented executive assistant.

- **Layout**: Asymmetric 35:65 split with a left-side comparison narrative, a dominant capability stack on the right, and a full-width evidence strip at the bottom.
- **Title**: Boss AI is a continuous enterprise management system, not another task-oriented executive assistant.
- **Core message**: Hermes and OpenClaw help executives ask questions and execute tasks, while Boss AI continuously understands and improves the business.
- **Visualization**: `pyramid_chart` adapted as a four-tier operating stack inside the Enterprise Engineering & Service governance envelope.
- **Content**:
  - **Task-oriented assistants**: Hermes and OpenClaw respond to instructions and complete discrete executive tasks.
  - **Continuous enterprise management**: Boss AI continuously senses enterprise changes rather than waiting for a prompt.
  - **Connected management system**: It links enterprise cognition, management judgment, execution, interaction, and production governance.
  - **Business outcome**: Its value is measured by better decisions and business follow-through, not only completed tasks.
  - **Capability stack**: Ontology -> Wiki Brain -> Decision & Action -> GUI/Dialogue, culminating in the CEO interface; Enterprise Engineering & Service encloses and governs the stack.
  - **Evidence 1**: The source explicitly distinguishes an "executive assistant" from an "enterprise management decision system."
  - **Evidence 2**: The source defines five capabilities: Ontology, Wiki Brain, decision and action, GUI/dialogue, and enterprise engineering and service.

---

## X. Speaker Notes Requirements

- **Filename**: `01_boss_ai_continuous_management.md`, generated from `notes/total.md`.
- **Duration**: Approximately 2 minutes.
- **Style**: Executive, conversational, evidence-backed.
- **Purpose**: Persuade the audience that Boss AI should be evaluated as a management operating system rather than as another executive task agent.
- **Structure**: Open with the category distinction, explain the continuous sensing loop, walk from Ontology to the CEO-facing interface, close on decision quality and follow-through.

---

## XI. Technical Constraints Reminder

### SVG Generation Must Follow

1. Use `viewBox="0 0 1280 720"`.
2. Use `<rect>` elements for backgrounds.
3. Wrap text with `<tspan>`; do not use `<foreignObject>`.
4. Use `fill-opacity` / `stroke-opacity`; do not use `rgba()`.
5. Do not use `<style>`, `class`, `textPath`, `animate*`, `script`, or `iframe`.
6. Do not use group opacity.
7. Put top-level visual units in named `<g id="...">` groups for PowerPoint animation mapping.
8. Use only colors, fonts, icons, and chart references listed in `spec_lock.md`.
9. Keep every line of text fully inside the safe area with no clipping or overlap.

### PPT Compatibility Rules

- Preserve text as editable PowerPoint text where possible.
- Use the approved `tabler-outline` placeholders only; do not mix icon libraries.
- Use simple paths, rectangles, lines, and markers compatible with native PPT conversion.
- Keep body text at 20px and annotations at 16px for projected readability.
