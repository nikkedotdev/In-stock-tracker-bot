# Track Status Observability Design

**Date:** 2026-03-18

**Goal:** Make `tracks` rows explainable without changing the bot's overall structure by keeping `status` as-is and adding diagnostic fields that separate stock ambiguity from fetch failures.

## Problem

The current `tracks.status` field overloads multiple concerns:

- stock result: `AVAILABLE`, `NOT_AVAILABLE`, `COMING_SOON`
- parser uncertainty: `UNKNOWN`
- operational failure: `ERROR`
- workflow state inferred indirectly from `next_check_at = NULL` and missing variant selection

This makes live rows hard to interpret. For example:

- a row waiting for variant selection appears the same as a row whose HTML could not be classified
- a row blocked by Cloudflare challenge appears the same as a row rate-limited by the origin

## Constraints

- Preserve the current bot architecture and status transition model.
- Avoid a broad refactor of parsing, storage, alerts, and UI.
- Improve observability first; do not attempt to solve Jellycat bot mitigation in this change.

## Approved Approach

Keep `status` unchanged and add three nullable columns to `tracks`:

- `last_http_status INTEGER`
- `last_error_kind TEXT`
- `state_reason TEXT`

### Existing `status`

Keep the current values:

- `UNKNOWN`
- `NOT_AVAILABLE`
- `COMING_SOON`
- `AVAILABLE`
- `ERROR`

### New Field Semantics

- `last_http_status`
  - Raw HTTP status code from the last failed fetch when available.
  - Examples: `403`, `429`.

- `last_error_kind`
  - Broad technical category for the last failure.
  - Proposed values:
    - `HTTP`
    - `TIMEOUT`
    - `NETWORK`
    - `PARSE`
    - `UNKNOWN_ERROR`

- `state_reason`
  - Human-meaningful explanation for a non-ideal row state.
  - Proposed values:
    - `PENDING_VARIANT`
    - `UNCLASSIFIED_HTML`
    - `UNSUPPORTED_SITE`
    - `RATE_LIMITED`
    - `CLOUDFLARE_CHALLENGE`
    - `FETCH_BLOCKED`
    - `TIMEOUT`
    - `NETWORK_ERROR`
    - `MANUAL_REVIEW`

## Behavior Rules

### New Track

- Default:
  - `status=UNKNOWN`
  - `last_http_status=NULL`
  - `last_error_kind=NULL`
  - `state_reason=NULL`

### Waiting For Variant Selection

- If a track is inserted with multiple variant options and no selection:
  - `status=UNKNOWN`
  - `state_reason=PENDING_VARIANT`
  - `next_check_at=NULL`

### Successful Fetch With Classified Stock

- When a fetch succeeds and stock is classified as `AVAILABLE`, `NOT_AVAILABLE`, or `COMING_SOON`:
  - clear `last_http_status`
  - clear `last_error_kind`
  - clear `state_reason` unless a manual-review signal should remain visible

### Successful Fetch But Still Unknown

- If fetch succeeds but parsing does not confidently classify stock:
  - `status=UNKNOWN`
  - `state_reason=UNSUPPORTED_SITE` when the host has no dedicated profile
  - otherwise `state_reason=UNCLASSIFIED_HTML`

### HTTP 429

- `status=ERROR`
- `last_http_status=429`
- `last_error_kind=HTTP`
- `state_reason=RATE_LIMITED`

### HTTP 403

- If response or HTML shows Cloudflare mitigation/challenge indicators:
  - `status=ERROR`
  - `last_http_status=403`
  - `last_error_kind=HTTP`
  - `state_reason=CLOUDFLARE_CHALLENGE`

- Otherwise:
  - `status=ERROR`
  - `last_http_status=403`
  - `last_error_kind=HTTP`
  - `state_reason=FETCH_BLOCKED`

### Timeout

- `status=ERROR`
- `last_http_status=NULL`
- `last_error_kind=TIMEOUT`
- `state_reason=TIMEOUT`

### Network Failure

- `status=ERROR`
- `last_http_status=NULL`
- `last_error_kind=NETWORK`
- `state_reason=NETWORK_ERROR`

## UI Guidance

`/list` should keep the current primary status line and add a short explanatory suffix when relevant.

Examples:

- `UNKNOWN (pending variant)`
- `UNKNOWN (unsupported site)`
- `ERROR (403 cloudflare challenge)`
- `ERROR (429 rate limited)`

This preserves familiarity while making rows understandable during triage.

## Scope Exclusions

This change does not:

- add a browser-backed Jellycat fetch path
- redesign the full status model into separate stock and operational states
- alter alerting semantics

## Expected Outcome

After this change, current confusing live rows should become self-explanatory:

- parked Jellycat rows become `UNKNOWN` + `PENDING_VARIANT`
- unsupported hosts become `UNKNOWN` + `UNSUPPORTED_SITE`
- Jellycat bot-blocked rows become `ERROR` + `403` + `CLOUDFLARE_CHALLENGE`
