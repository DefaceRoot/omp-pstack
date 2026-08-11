---
name: control-ui
description: Build or adapt a local browser/CDP harness to drive and inspect a web, IDE, or Electron UI. Use for local UI verification, screenshots, accessibility snapshots, perf profiles, visual diffs, or reproducing UI bugs.
---

# Control UI

Use local browser automation to verify UI behavior with evidence. First reuse the repo's own Playwright, browser, or Electron harness if it exists; otherwise assemble a temporary local harness around the app's dev server or Chromium debug port.

## What It Is Used For

- Reproducing UI bugs that depend on real browser focus, keyboard input, scrolling, resizing, or rendering.
- Verifying visual or accessibility changes with screenshots and snapshots.
- Checking local web, IDE, or Electron behavior before shipping.
- Capturing console logs, network logs, CPU profiles, traces, or heap snapshots.
- Creating before/after evidence for `verify-this`.

## Setup Pattern

1. Start the app locally using the repo's documented dev command.
2. Discover existing local harnesses: Playwright tests, Cypress specs, Storybook, browser scripts, Electron launch scripts, or snapshot tools.
3. For a web app, connect to the local URL with the existing browser tooling.
4. For Electron/Chromium, enable a remote debugging port when supported.
5. Select the correct page by stable app markers, not by tab order alone.
6. Prefer accessibility roles, labels, and stable `data-*` selectors over coordinates.

## OMP-Native Browser Harness

Use OMP's native `browser` tool before assembling a one-off script:

1. Start a dev server or Electron process with `hub start`; use its log pattern and port readiness checks instead of sleeping.
2. Call `browser` with action `open` once. Supply the local URL for a web app, or `app.cdp_url` for an existing Chromium DevTools Protocol endpoint.
3. Call `browser` with action `run` and begin with `tab.observe()` or `tab.ariaSnapshot()` to read the current accessibility structure.
4. Act through stable accessibility references, roles, labels, or `data-*` selectors. Re-observe after navigation or re-rendering because references can become stale.
5. Use `tab.screenshot()` only when visual appearance is evidence; use structural observations for state and accessibility checks.
6. Reuse the named browser tab for the full interaction, then close it and stop the process with `hub stop`.

Use `read` to inspect repository scripts and configuration. Reserve `bash` for short, non-interactive commands; dev servers and debug processes belong in `hub` so their readiness, logs, input, and cleanup stay managed.

## Generic Web Harness

With OMP, open the local URL through the native `browser` tool, observe the page, act on the latest structure, and take a screenshot after the state change when visual evidence is required. A native run can use helpers such as:

```javascript
await tab.observe();
await tab.click("aria/Submit");
await tab.screenshot({ fullPage: true });
```

Do not add Playwright as a project dependency just for this probe unless the user asks. Prefer OMP's native browser or existing dev dependencies already available in the environment.

## Generic CDP Harness

For Electron or a Chromium app launched with `--remote-debugging-port=<port>`, call OMP `browser` with action `open` and `app.cdp_url` set to `http://127.0.0.1:<debug-port>`. Inspect the available page with `tab.observe()` and select the surface by stable app content or accessibility markers rather than tab order.

If the repository already provides Playwright and its own harness, `chromium.connectOverCDP(...)` remains an appropriate repo-native path. Do not add it solely for the probe.

## Interaction Loop

1. Capture a page snapshot or screenshot before acting.
2. Choose a target from the latest page structure.
3. Perform exactly one structural action: click, type, keypress, drag, scroll, navigate, or resize.
4. Capture a fresh snapshot/screenshot.
5. Verify the expected state change.
6. Save artifacts for before/after comparisons when the user asked for proof.

## CDP Capabilities

Use raw CDP only when higher-level browser APIs are insufficient:

- Performance: CPU profiles, traces, paint flashing, FPS meter, layout shift inspection.
- Memory: heap snapshots and forced GC for leak investigations.
- Network: request blocking, throttling, cache disablement, request/response logs.
- Rendering: viewport changes, color scheme emulation, reduced motion, accessibility checks.
- Debugging: console streaming, exception capture, DOM snapshots.

## Page Selection

When multiple app windows/tabs share a debug port:

- Prefer a positive marker for the surface under test, such as an app root selector.
- Use a negative marker to avoid the wrong surface when necessary.
- If no page matches, list available page titles and URLs instead of guessing.

## Guardrails

- Do not rely on stale element references after navigation or structural changes.
- Avoid coordinate clicks unless a fresh screenshot was captured immediately before the click.
- Keep test data local and disposable.
- Do not store screenshots or heap snapshots from privacy-sensitive workspaces unless the user explicitly agrees.
- Do not hard-code selectors, ports, or script paths from another repository. Discover the current repo's local app markers.
- Clean up dev servers, debug sessions, and temp profiles when done.
