# Workspace Creation Wizard Redesign Plan

## 1) Current State Analysis

### Entry points and surface composition

- `MissionControlShell` mounts two separate dialogs:
  - `WorkspaceCreateDialog` for quick/basic creation.
  - `WorkspacePlannerDialog` for planner/advanced creation.
- The handoff from Basic to Advanced is implemented as a close/open transition (`onOpenAdvanced`) instead of a mode switch within one shared surface.
- Command bar exposes both actions independently (`Create workspace` and `Advanced setup`), reinforcing two-product perception.

### Basic mode implementation (`WorkspaceCreateDialog`)

- Current model is a compact traditional form:
  - `name`, `source`, `goal` input fields.
  - inferred name/template from simple heuristics.
  - static auto-setup summary cards.
- Submission path:
  - Builds `WorkspaceCreateInput` directly in the client.
  - Posts to `/api/workspaces` with `stream: true`.
  - Streams NDJSON progress into `OperationProgress`.
- Hardcoded creation defaults:
  - `teamPreset: "solo"`, `modelProfile: "balanced"`, plus default rules.
- Source parser is local and heuristic-driven (`analyzeSourceInput`), with inference for repo vs website vs folder.

### Advanced mode implementation (`WorkspacePlannerDialog`)

- This is already a conversational planner, but not visually/structurally unified with Basic.
- It contains two internal submodes:
  - `guided` (chat + compact controls).
  - `advanced` (chat + stage rail + heavy section forms).
- Planner state lifecycle:
  - Create/load plan via `/api/planner` and `/api/planner/:planId`.
  - Submit turns via `/api/planner/:planId/turn`.
  - Optional simulate/save/review/deploy actions.
- Uses a very large single component (`~3172` lines), mixing shell, state orchestration, chat panel, and full editor forms.

### Backend and plan state model

- Two creation backends coexist:
  - Direct workspace create (`/api/workspaces`) for Basic.
  - Planner plan lifecycle + deploy (`/api/planner/*`) for Advanced.
- Planner domain model (`WorkspacePlan`) is already rich and suitable as a canonical workspace draft model:
  - intake, company, product, workspace, team, operations, deploy, conversation.
- Planner orchestration (`lib/openclaw/planner.ts`) already maps conversation + inferred context into structured plan fields and can deploy to actual workspace.

### Reusable vs replace candidates

**Highly reusable**
- Planner domain and APIs (`WorkspacePlan`, planner routes, deploy pipeline).
- `OperationProgress` for create/deploy streaming feedback.
- Shared preset/types (`workspace-presets`, `types`).
- Existing source/template inference logic (can be repackaged).

**Refactor/replace recommended**
- Replace split dialog architecture (Basic dialog + Planner dialog) with one wizard shell.
- Break up `WorkspacePlannerDialog` monolith into composable subcomponents/hooks.
- Replace Basic form visual language with chat-native interaction cards and composer patterns.
- Reduce direct inline plan mutation patterns scattered in UI; move to draft actions/reducer style.

## 2) Product / UX Redesign Plan

### North star

Create one **Create Workspace Wizard** surface with a shared chatbot-inspired visual grammar:
- single modal/sheet shell,
- single conversation timeline language,
- single composer/input affordance,
- mode-specific capabilities layered in the same layout.

### Reference fidelity decision

The target is **not** a loose inspiration pass. The wizard should be a **high-fidelity adaptation** of the [chatbot.ai-sdk.dev](https://chatbot.ai-sdk.dev/) UI language:
- closely match its shell structure, spacing rhythm, panel proportions, composer treatment, message cadence, suggestion chip behavior, and overall polish;
- keep the visual system recognizably aligned with the reference so quality does not degrade through over-interpretation;
- only diverge where the domain requires it (workspace blueprint panel, mode switch, create/deploy controls, planner readiness states).

This means the final result should feel materially closer to the reference product than to the current AgentOS dialogs.

### Unified flow

1. **Start screen (inside same wizard):**
   - “How do you want to start?” segmented selector: `Basic` | `Advanced`.
   - Both choices shown as variants, not separate products.
   - Keep one persistent “Architect” identity in header.

2. **Basic mode (fast path):**
   - Conversational quick intake (1–2 prompt turns max) OR guided chips + one textarea.
   - Keep instant defaults and fast submission.
   - Show compact “workspace draft” preview card (name, template, source, target path, selected defaults).
   - CTA remains “Create workspace now”.

3. **Advanced mode (architect co-design):**
   - Full conversational architect flow.
   - Right panel shows live structured draft (“Workspace Blueprint”) updating in real time.
   - Expand/collapse detail sections instead of dumping all enterprise forms immediately.

4. **Mode switching behavior:**
   - In-place toggle at top (no modal close/open).
   - Preserve shared draft context and conversation.
   - If switching Basic → Advanced: hydrate planner draft from quick inputs and add a system note like “Imported quick setup assumptions”.
   - If switching Advanced → Basic: keep only fast-path-compatible fields and show non-blocking notice about omitted advanced config.

### Should Basic use conversational patterns?

Yes—lightweight conversational UI is recommended:
- Keep speed via suggested prompts/chips and one concise input composer.
- Avoid old form look; align message bubbles, cards, typography, and interaction feedback with Advanced.
- Basic should feel like “quick architect kickoff”, not “legacy form mode”.

### Should Advanced include a live structured draft beside chat?

Yes—required for coherence and trust:
- Conversational planning alone can feel opaque.
- Side-by-side `Chat` + `Draft` pattern mirrors the reference product language while fitting this domain.
- Draft panel should expose readiness state, unresolved decisions, and deploy blockers continuously.

## 3) UI / Component Architecture Plan

### Proposed top-level hierarchy

- `WorkspaceWizardDialog` (new single entry dialog)
  - `WorkspaceWizardHeader`
    - Architect identity, mode switch, status chips, stage chipline
  - `WorkspaceWizardBody`
    - `WorkspaceWizardChatPane`
      - message list
      - suggestions
      - composer
    - `WorkspaceWizardDraftPane`
      - draft summary (always visible)
      - section cards (expandable)
      - blockers/readiness
  - `WorkspaceWizardFooter`
    - mode-aware primary CTA (`Create now` / `Request review` / `Deploy`)

### Basic-specific subcomponents

- `BasicQuickStartCard` (template/source chips + quick assumptions)
- `BasicDraftPreview` (small structured output)
- `BasicCreateActionBar` (fast submit + optional “open advanced details”)

### Advanced-specific subcomponents

- `AdvancedDraftInspector` (company/product/workspace/team/operations/deploy)
- `AdvancedReviewPanel` (warnings/blockers + deploy gates)
- `ArchitectAdvisorNotes` (optional collapsible)

### Shared/chatbot-inspired primitives

- `WizardMessageList`
- `WizardMessageBubble`
- `WizardComposer` (textarea + send button + quick actions)
- `WizardSuggestionChips`
- `WizardStatusBadgeRow`
- `WizardProgressStream` (wrapping `OperationProgress`)

### Reference implementation strategy

Do **not** pull the reference repository UI wholesale into this codebase.

Recommended approach:
- inspect the `vercel/ai-chatbot` component structure and reproduce the relevant UI primitives locally;
- keep the markup, layout logic, spacing, and interaction patterns close to the reference where practical;
- avoid importing reference-specific app structure, chat state model, auth/data concerns, or heavy dependencies just to inherit the look.

In practice this is a **selective reimplementation with high visual fidelity**, not a low-effort port and not an abstract reinterpretation.

### Reference parity map

The following areas should intentionally stay **very close** to the reference UI:

- **Wizard shell:** overall frame, max width, panel split, header density, footer/composer anchoring.
- **Chat pane:** empty state composition, message spacing, assistant/user block rhythm, streaming/loading presentation.
- **Composer:** textarea framing, submit affordance, attachment/action slot treatment, focus/disabled states.
- **Suggestion chips:** visual styling, spacing, hover/pressed states, wrap behavior, placement near the composer.
- **Status chrome:** subtle badges, pills, separators, muted metadata treatment.
- **Motion:** initial reveal, message insertion, panel transition, non-intrusive loading animation cadence.

The following areas should stay **reference-aligned but product-adapted**:

- **Draft pane:** replace the reference's generic side content with a workspace blueprint/readiness panel.
- **Mode switch:** fit naturally into the same shell without looking like a product-level tab system.
- **Primary actions:** `Create workspace`, `Review`, `Deploy` should use the reference button language, but reflect planner/create semantics.
- **Workspace cards:** template/source/goal summaries should inherit reference card styling rather than introduce a second design language.

The following areas should be **ours**, while still matching the same visual system:

- planner stage semantics;
- workspace readiness/blocker presentation;
- advanced configuration expansion behavior;
- deployment/progress streaming states.

### Visual rules to carry over

Use these as the default implementation baseline unless the product-specific layout forces an explicit exception.

- **Viewport shell:** full-height modal/sheet behavior with a `flex` column layout and sticky top/bottom regions, mirroring the reference's `h-dvh` chat shell behavior.
- **Primary content width:** keep the main conversation lane visually constrained around the reference's `max-w-4xl` rhythm; do not let chat content become a wide dashboard canvas.
- **Greeting/empty state width:** use a slightly narrower measure, aligned with the reference's `max-w-3xl`, so the initial state reads as intentional editorial content rather than generic onboarding copy.
- **Header density:** keep header height compact, in the reference range of roughly `py-1.5` with tight horizontal padding; avoid tall modal headers.
- **Message list spacing:** preserve the reference cadence of `gap-4` on small screens and a slightly roomier `gap-6` feel on larger screens.
- **Horizontal padding:** chat lane should stay close to the reference rhythm of `px-2` mobile and `px-4` desktop.
- **Composer frame:** use a bordered `rounded-xl` container with light shadow, `p-3` outer padding, subtle border hover treatment, and no heavy inset styling.
- **Textarea sizing:** keep the composer input at approximately `44px` collapsed height, `text-base`, single-line by default, growing only as needed rather than starting as a large box.
- **Composer toolbar:** small, low-noise control row with roughly `p-1` padding and compact `h-8` controls.
- **Submit control:** compact circular or near-circular primary send control in the reference scale (`size-8`), not a full-width CTA inside the composer.
- **Suggestion chips:** rounded-full chips, compact spacing (`gap-2`), medium horizontal padding (`px-4`), and lightweight outline styling.
- **Assistant message treatment:** default to largely unboxed/transparent assistant text blocks with a compact avatar/icon rail, matching the reference's “content first” feel.
- **User message treatment:** keep user replies as compact colored bubbles with tighter padding (`px-3 py-2`) and a more rounded bubble silhouette (`rounded-2xl`) than the composer.
- **Avatar/icon size:** stay near the reference `size-8` footprint for the Architect glyph and assistant markers.
- **Panel corners:** use `rounded-lg` for smaller cards and controls, `rounded-xl` for main containers, `rounded-2xl` only where the message language specifically calls for it.
- **Borders and chrome:** prefer thin, low-contrast borders and muted separators; do not introduce thick card outlines or high-contrast panel boxing.
- **Typography scale:** keep greeting lines in the `text-xl` to `text-2xl` range, metadata and helper copy in `text-sm`, and input/body copy in `text-base`.
- **Motion language:** use short fade/translate entrances similar to the reference (`~200-300ms`, `y: 10-20`), plus restrained stagger for suggestion cards (`~50ms` offsets).
- **Scroll affordances:** preserve subtle floating affordances like the compact “scroll to bottom” button rather than loud sticky controls.

### Product-specific dimensional adaptations

Where the workspace wizard must diverge from the reference, use these rules:

- **Draft pane width:** on desktop, keep the workspace blueprint pane in a narrow-inspector range of roughly `360-420px`; the chat lane should remain visually dominant.
- **Split ratio:** target an approximate `60/40` or `65/35` chat-to-draft split on large screens; avoid equal-width panes.
- **Mobile behavior:** stack into a single-column chat-first flow, with the draft pane accessible as a secondary sheet/section instead of forcing a cramped split view.
- **Mode switch placement:** place the `Basic | Advanced` switch inside the same compact header chrome, not as a large segmented control block in the body.
- **Primary wizard CTA:** outside the composer, use reference-aligned compact action buttons, but keep final create/review/deploy actions visually separated from message sending.

### What to adapt from existing components

- Reuse `OperationProgress` as-is (styling tweaks only if needed).
- Reuse planner stage/readiness helpers with extraction to `lib/openclaw/planner-presenters.ts`.
- Reuse source analysis and inference logic by extracting from create dialog into shared util.

### What to rewrite

- Replace `WorkspaceCreateDialog` UI implementation entirely.
- Decompose `WorkspacePlannerDialog` into modular components; keep behavior but move orchestration into hook/reducer.
- Replace stage rail + heavy form-first advanced layout with chat-first + live draft layout.

## 4) State / Data Flow Plan

### Canonical state strategy

Adopt **planner draft (`WorkspacePlan`) as canonical wizard draft** for both modes.

### State layers

1. **Shared wizard state**
- `mode: "basic" | "advanced"`
- `planId`
- `plan` (canonical draft)
- `conversation`
- `isSending`, `isSaving`, `isDeploying`, `progress`
- `ui`: active pane, selected draft section, transient notices

2. **Basic-only UI state**
- quick prompt text
- selected quick template/source chips
- quick create confidence/errors
- inferred values pending confirmation

3. **Advanced-only UI state**
- expanded section panels
- inspector filters
- simulation/advisor visibility

### Draft behavior

- All inputs (Basic + Advanced) map into `WorkspacePlan` patches.
- Build a small mapping layer:
  - `applyBasicInputToPlan(plan, basicInput)`
  - `toWorkspaceCreateInput(plan)` for fast-path create
- Keep a `draft provenance` note list (which fields were inferred vs user-confirmed).

### Architect conversation mapping

- Continue using planner turn endpoint for semantic extraction.
- Add client-side optimistic patches for explicit UI toggles (template/source/mode chips) before assistant response returns.
- Represent uncertain extractions as `needs-confirmation` items surfaced in draft pane.

### Mode switching transform rules

- **Basic → Advanced**: no loss; retain all draft fields.
- **Advanced → Basic**: keep canonical plan in memory, but Basic UI renders only fast-path fields; show “Advanced details preserved” badge.
- Prevent destructive resets unless user starts a new wizard draft.

## 5) Refactor / Implementation Strategy

### Recommended approach: staged incremental refactor on a new unified shell

Not a one-shot rewrite of backend logic. Keep planner/workspace APIs, replace surface architecture progressively.

### Step-by-step implementation plan

1. **Foundation extraction**
- Extract shared inference utilities from `workspace-create-dialog.tsx`.
- Extract planner presentation helpers from `workspace-planner-dialog.tsx`.
- Introduce `useWorkspaceWizardDraft` hook for plan load/create/update/send/deploy actions.

2. **Unified shell introduction**
- Create `WorkspaceWizardDialog` behind feature flag (or internal toggle).
- Mount from `MissionControlShell` in place of both current dialogs.
- Keep old dialogs temporarily for fallback.

3. **Basic mode migration onto canonical draft**
- Rebuild Basic as chat-inspired quick intake in new shell.
- Route Basic create through canonical plan -> `WorkspaceCreateInput` mapper.
- Preserve streaming progress UX.

4. **Advanced mode migration**
- Move existing advanced chat orchestration into shared hook.
- Rebuild layout to chat + live draft panel.
- Port deploy review/deploy controls with unchanged backend endpoints.

5. **Consolidation and cleanup**
- Remove old `WorkspaceCreateDialog` and `WorkspacePlannerDialog`.
- Remove duplicate open states and split action wiring in shell/command bar.
- Keep one entry action: `Create workspace` with internal mode switch.

6. **Polish and hardening**
- Keyboard flow, focus management, animation parity, loading/error empty states.
- Telemetry for mode usage, switch rates, and create success time.
- Visual QA for coherent system feel.

### Technical risks / dependencies

- Large planner component decomposition risk (regression from hidden coupling).
- State synchronization risk between chat turns and direct UI edits.
- Persisted old planner drafts in localStorage may conflict with new wizard ids/semantics.
- Need clear migration logic for existing unfinished planner drafts.
- Potential API shape pressure if Basic needs “plan-first then create” endpoint optimization.

## 6) Deliverables

### Proposed file/component tree

```text
components/mission-control/workspace-wizard/
  workspace-wizard-dialog.tsx
  workspace-wizard-header.tsx
  workspace-wizard-mode-switch.tsx
  workspace-wizard-empty-state.tsx
  workspace-wizard-chat-pane.tsx
  workspace-wizard-draft-pane.tsx
  workspace-wizard-footer.tsx
  wizard-message-list.tsx
  wizard-message-bubble.tsx
  wizard-composer.tsx
  wizard-suggestion-chips.tsx
  wizard-status-badge-row.tsx
  wizard-progress-stream.tsx
  basic/
    basic-quick-start-card.tsx
    basic-draft-preview.tsx
  advanced/
    advanced-draft-inspector.tsx
    advanced-review-panel.tsx
    architect-advisor-notes.tsx

hooks/
  use-workspace-wizard-draft.ts

lib/openclaw/
  workspace-wizard-mappers.ts
  workspace-wizard-inference.ts
  planner-presenters.ts
```

### Phased roadmap

- **Phase 0 (1-2 days):** extraction + hook scaffold + reference parity audit of the target UI primitives.
- **Phase 1 (2-4 days):** Basic mode rebuilt in unified shell.
- **Phase 2 (4-6 days):** Advanced mode rebuilt (chat + live draft).
- **Phase 3 (1-2 days):** remove legacy dialogs, wire command bar and shell to one entry.
- **Phase 4 (2-3 days):** UX polish, QA, instrumentation, and side-by-side parity pass against the reference UI.

### Risk list

- Monolith breakup regressions in advanced behaviors.
- Inconsistent draft mutations if reducer/actions are not enforced early.
- Mode-switch confusion if not paired with explicit preservation copy.
- UI performance if draft pane re-renders excessively on each token/turn.

### Open questions / assumptions

- Should Basic always create immediately, or optionally produce a planner draft first and confirm?
- Is “simulate team” still required in the new UX, or can it be hidden behind an advanced action menu?
- Do we keep localStorage plan resume behavior as-is, or tie drafts to wizard sessions with expiration?
- Should deploy remain inside wizard or become post-create step after workspace exists?
- What level of advisor visibility is desired by default in Advanced?

## Final recommendation

Use a **single unified WorkspaceWizardDialog** with a canonical `WorkspacePlan` draft for both Basic and Advanced. Keep backend planner/create services, but rebuild the surface into a chat-first architecture with a live structured draft pane. Implement incrementally with a new shell + shared hook, then migrate each mode and remove legacy dialogs. This gives the strongest UX coherence with lowest backend churn and best long-term maintainability.
