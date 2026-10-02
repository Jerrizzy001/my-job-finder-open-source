# Screenshots and the demo GIF

Everything in `docs/media/` is captured from a real run, with the fictional example profile:

1. `jobfinder init && jobfinder run --limit 5` in an empty folder (the terminal frame is that run's real output).
2. `jobfinder serve`, then headless Chrome at 1280×800:

```bash
chrome --headless=new --hide-scrollbars --window-size=1280,800 --virtual-time-budget=5000 \
  --screenshot=jobs.png "http://127.0.0.1:4321/#/jobs/<id>"
```

Add `--force-dark-mode` for the dark frame. `#/jobs/<id>?stage=drafted` opens a drafted job.

3. The extension frame is the real form filler and review panel (`packages/extension/src/form.ts` and `panel.ts`) run against the synthetic Ashby-shaped page in `packages/extension/test/fixtures/`, with an answer package from the local server.

4. The GIF, with no image tools installed:

```bash
node scripts/make-gif.ts docs/media/demo.gif 960 terminal.png:9 jobs.png:9 drafted.png:9 dark.png:7 preferences.png:8 profile.png:7 extension.png:11
```
