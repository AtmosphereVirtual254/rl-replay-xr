# RL Replay XR

Rocket League replay viewer for the browser and WebXR (Apple Vision Pro, Quest). Static site, no build step.

**Open:** drop a `.replay` on the page, use *Open .replay*, or pass `?replay=<url>` (`?replay=sample` loads a test replay).

Parsing runs in a worker via [subtr-actor](https://github.com/rlrml/subtr-actor)'s WASM build (vendored, MIT). Rendering is three.js.

## Desktop

| | |
|---|---|
| Space | play / pause |
| ← / → | ∓5 s |
| 0 | orbit camera |
| 1–8 | ball cam behind that player |

Timeline ticks are goals, coloured by scoring team.

## XR

*Enter VR* (Vision Pro, Quest) or *Enter AR* (Quest passthrough) appears when the browser supports it.

- The arena starts as a 1.5 m table in front of you; *Pitch* switches to 1 uu = 1 cm, standing at the sideline.
- Pinch/trigger the panel: −10 s, play, +10 s, speed, Table/Pitch, rotate 45°. Pinch-drag the timeline to scrub.
- Pinch (or grip) anywhere else and drag to move the arena; two hands scale and rotate it.
- Quest: right stick left/right scrubs.

WebXR needs a secure context, so serve over HTTPS (GitHub Pages works) or `localhost`:

```sh
python3 -m http.server   # → http://localhost:8000
```

## Coordinates

Everything under `root` stays in RL units and RL's left-handed z-up frame; `root` is rotated to y-up and mirrored on x, so raw positions and quaternions from the replay are used as-is.
