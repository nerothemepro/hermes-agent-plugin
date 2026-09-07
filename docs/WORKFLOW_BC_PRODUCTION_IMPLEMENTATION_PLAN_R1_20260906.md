# Workflow B/C Production Implementation Plan R1

Date: 2026-09-06
Status: IMPLEMENTING
Scope: complete the controller-facing production path after Workflow A graduation. This plan does not authorize a media render or social publish.

## Goal

Enable the three-workflow Telegram model without treating a staging smoke as a production capability:

- Workflow B dispatches only a bounded HerVid task from an approved, hash-pinned Story Lock handoff.
- Workflow B accepts only a deterministic result envelope containing a real capture manifest or a quality-verified video package; owner gates remain Asset Lock and Picture Lock.
- Workflow C dispatches only a bounded HerSocial preparation task from an approved Picture Lock handoff and Story Lock input.
- Workflow C produces checked, immutable payload packets only. Platform publishing stays disabled and outside this release.

## Non-goals

- No unattended video render.
- No automatic social upload, schedule, or publish retry.
- No fallback to model-authored paths, hashes, metrics, or gate state.
- No mutation of an accepted upstream run.

## Design

### Shared production adapter

Replace the Workflow-A-specific reconciler with a table-driven reconciler. Each entry pins:

| Workflow | Native profile | Board | Task | Required candidate files | Next owner gate |
| --- | --- | --- | --- | --- | --- |
| research_and_story | herresearch | default | research_story | production-brief.json | story_lock |
| video_production | hervid | default | capture_assets or assemble_video | capture-manifest.json / video-quality-package.json | asset_lock / picture_lock |
| social_distribution | hersocial | default | prepare_social | social-payload-package.json | preparation_complete |

The adapter accepts a candidate only when the native card identity, controller mapping, run-root containment, task attempt, file SHA-256, and result schema all agree. A missing candidate is pending; an invalid candidate is reported once and never retried by the monitor.

### Workflow B task contract

capture_assets is limited to real product evidence. Its candidate must include capture-manifest.json, with source paths, command receipts, SHA-256 values, viewport/crop metadata, privacy outcome, and a declaration that no product behavior was fabricated.

assemble_video may run only after exact Asset Lock approval. Its candidate must include video-master.mp4, quality-report.json, review-frames.json, and an evidence manifest binding the output to the accepted capture-manifest SHA. The validator must require all video-quality gates to pass; a failing report blocks before Picture Lock.

HerVid receives a task-local project directory and an explicit invocation of supported sdtk-marketing video project and quality commands. It may not use generated visuals for evidence-capture claims.

### Workflow C task contract

prepare_social produces checked youtube.json, facebook.json, and x.json, plus social-payload-package.json that binds the exact upstream brief and Picture-Locked MP4 hashes. It calls only sdtk-marketing video social generate, validate, and prepare or equivalent deterministic local helpers.

This release ends at a social_ready owner review packet. The current platform publish stages remain disabled rather than pretending the package has published.

## Delivery slices

1. Generalize production profiles, native result reconciliation, monitor notification formatting, and regression coverage for B/C.
2. Add typed B/C finalizers with path, identity, SHA, upstream-lock, capture/privacy, and quality validation.
3. Materialize workflow-specific native task instructions that call supported SDTK-Marketing commands only.
4. Add disposable B and C E2E tests. B uses a local deterministic fixture and must reach Asset then Picture Lock; C produces checked payload packets without publish capability.
5. Deploy only after source tests pass. Run staging disposable smoke; production feature flags remain disabled until owner reviews the E2E evidence.

## Acceptance gates

- A repeated approval packet with a different Telegram message id is a no-op.
- A stale Story Lock brief cannot dispatch B.
- Missing or invalid capture or quality evidence cannot open Picture Lock.
- C cannot prepare from a non-Picture-Locked video handoff.
- C cannot upload or publish in this release.
- A restart cannot create a duplicate native card or duplicate notification.
