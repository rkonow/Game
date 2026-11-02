# Fowl Play

A quick browser prototype for one idea: **command a flock from a top-down RTS view, then drop into any bird and fight in first person**, without pausing the battle. Ducks vs. hens, fighting over eggs.

Everything is original procedural art (simple shapes and canvas textures) built with [Three.js](https://threejs.org/) (vendored in `vendor/`, MIT). There is no build step.
## Run it

Any static file server works. From the repo root:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

To try it on a phone, open the same URL from a device on your network, or publish the repo with GitHub Pages (Settings → Pages → deploy from branch, root folder).

## How it plays

One loop: **sit on the nests, crack the shell, raid the coop.**

- Three nests **A B C** sit in the middle. **Only a duck you control in first person can claim a nest** (stand on it for ~3s). Hens claim nests just by standing on them, so you have to go back and defend.
- Hold **all three** and the eggshell dome over the hen coop cracks; your flock charges the coop. Lose a nest and the shell comes back.
- **Commander view:** move the flock and spend 🌽 corn on birds: **Duck** (20, egg bomb), **Goose** (35, tough, honk shield), **Heron** (30, long range, scope and beak shots). Corn trickles in, faster for every nest you hold.
- **Duck mode (first person):** x2 damage while you're in control. Rally the flock to where you aim, or swap to another bird.
- **Switching** is free any time, with a slow-motion swoop. If your bird gets cooked you wait 5s. Alerts ("Hens are pecking at nest B!") have a **Drop in** button that puts you in the nearest bird.
- Hens attack in growing waves, each heading for a nest, and every ~90s the **Big Rooster** comes out to hunt the bird you're controlling.

## Controls

| | Desktop | Touch |
|---|---|---|
| Select | Left click, drag a box, Shift to add, **Q** all | Tap a bird, drag a box, **Select all** |
| Move / attack | Right click ground / enemy, **X** then click for attack-move | Tap ground / enemy while birds are selected, **Attack-move** |
| Buy birds | **1** duck, **2** goose, **3** heron | Buttons on the right |
| Camera | WASD / arrows, middle-drag, wheel zoom, click minimap | Two-finger pan, pinch zoom, tap minimap |
| Drop in | **F** or double-click a bird | Double-tap a bird or **Drop in** |
| First person | WASD, mouse (pointer lock), click or Space to fire | Left stick, drag anywhere on the right to aim, hold **FIRE** (also aims while held); all at once, multitouch |
| Extras | **Q** ability, **R** rally, **E** swap, **F**/**Tab** back | **Ability**, **Rally flock**, **Swap bird**, **◀ Command** |

## Code map

- `index.html`, `style.css`: page, HUD and touch controls.
- `src/main.js`: everything else: world, procedural farm art, birds and roles, nests and capture, A* pathfinding on a 1×1 grid, unit AI and hen waves, RTS input and shop, FPS possession and abilities, camera transitions, alerts, HUD and minimap.

`window.__game` exposes a few hooks for automated smoke tests.

## Ideas for next steps

- Crouch/cover in FPS and line-of-sight-based fog (walls block vision).
- Resources and building, to make the RTS half deeper.
- Network play: one player commands, others possess units.
