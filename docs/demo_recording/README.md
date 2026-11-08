# Backup recording of the demo

`smartedu_demo_run.webm` (18.9 MB, 1280x720, about 6.5 minutes, no sound) is the whole of
[../DEMO_SCRIPT.md](../DEMO_SCRIPT.md) performed in a real browser on 2026-11-08 by `evaluation/demo_run.js`
(Playwright, Chromium), right after `npm run demo:reset`. Play it if the laptop, the services or the projector
fail during the presentation (any modern browser plays .webm: drag the file onto a browser window, or open it in
VLC).

The run checked what the audience should see at every step: 35 / 35 checks passed (`run.json` has each step
with its time). The pauses stand in for the presenter talking (`TALK_SCALE=2.5`); the clicks alone take about
40 seconds.

Re-record: `cd backend; npm run demo:reset -- --yes; $env:TALK_SCALE="2.5"; node ../evaluation/demo_run.js;
npm run demo:reset -- --yes`.
