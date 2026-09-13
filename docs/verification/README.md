# Desktop verification harness (personal fork)

Headless-Chrome harness used while building this fork's desktop control changes.
It serves `public/control` over HTTP, drives the page with puppeteer-core, and
asserts the binary input frames the controller actually sends.

## Requirements
- Node 20+ (tested on 24.x)
- `puppeteer-core` plus a Chrome/Chromium binary — set the `CHROME` constant in
  the script to your local binary (the committed value is machine-specific)
- Nothing else listening on `PORT` (default 8766)

## Run
```bash
node docs/verification/check-desktop.mjs
```

## What it asserts
| id | assertion |
| --- | --- |
| A | pointer lock targets the trackpad |
| B / B2 | relative-move frames while locked / unlock |
| C / D / E | right / middle / left click button indices |
| F | two-finger tap sends a right click |
| G | touch keeps "Hold left", hides "Capture pointer" |
| H | trackpad geometry in both modes |
| I | no page errors |
| J | left click still works while pointer-locked (`setPointerCapture` must be skipped) |
| K / L / M | volume slider drag to 25 % / 80 %, volume + button |
| N | press + move + release sends MOUSE_DOWN(0x03), deltas, MOUSE_UP(0x04) |
| O | a press that does not move still sends CLICK(0x06) |
| P | sticky "Hold left" toggles MOUSE_DOWN / MOUSE_UP |
| Q | taps are suppressed while the sticky left button is held |

## Gotcha
The stub HTTP server must answer the auth handshake (`auth_ok`). Otherwise the
controller's `isAuthenticated` guard drops every input frame and the input
assertions fail for the wrong reason.
