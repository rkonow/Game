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

## Hero kits (first person)

Each bird you control has two abilities on cooldowns and an ultimate (★) that charges while you deal damage, get kills, capture nests, and slowly over time. Ultimate charge stays on the bird, so in Tactics it carries over between rounds.

| Bird | Q | E (or right click) | ★ Ultimate (X) |
|---|---|---|---|
| Duck | Egg bomb | Dive roll: quick dash, can't be hit | Duckling swarm: 5 ducklings run at hens and pop |
| Goose | Wing wall: blocks hen fire in front of you | Charge: knocks hens over and stuns them | The HONK: stuns every hen in a cone for 3s |
| Heron | Scope (headshots x2.5) | Stilt jump: leap onto hay bales and sheds | Hawk eye: hens marked through walls, shots pierce |

AI ducks and hens throw the odd egg bomb too.

## Tactics mode (turn-based + tower defense)

Pick **Tactics** on the menu. The battle **freezes** between 20-second live rounds (bullets hang in the air, a grid appears).

1. **Plan (frozen):** re-arrange your flock (tap/right-click to send birds somewhere, **Hold**, **🥚 Egg bomb**), spend corn in the shop, and pick one **★ Hero**.
   - Buy birds: Duck 20, Goose 35, Heron 30 (keys 1-3).
   - Build towers on your half: **Corn turret** 40 (shoots), **Egg mortar** 55 (long-range splash), **Scarecrow** 25 (slows hens around it) (keys 4-6).
   - **⬆ Upgrade** selected birds and towers up to ★3: more health and damage, towers gain range (U).
2. **Go:** 20 seconds of live combat. Everything acts on its orders at once while you play the hero in first person, with one rally call per round.
3. **Between rounds:** +20 corn, +15 per nest you hold, +4 per hen plucked; your birds heal 25%. A new, bigger hen wave leaves the coop every round; from round 3 some raid your towers and barn, and every 5th round brings the Big Rooster.

Win: hold all 3 nests to crack the coop's eggshell, then destroy the coop. Lose: your barn falls, or you have no birds and no corn to hatch more.

## Controls

| | Desktop | Touch |
|---|---|---|
| Select | Left click, drag a box, Shift to add, **Q** all | Tap a bird, drag a box, **Select all** |
| Move / attack | Right click ground / enemy, **X** then click for attack-move | Tap ground / enemy while birds are selected, **Attack-move** |
| Buy birds | **1** duck, **2** goose, **3** heron | Buttons on the right |
| Camera | WASD / arrows, middle-drag, wheel zoom, click minimap | Two-finger pan, pinch zoom, tap minimap |
| Drop in | **F** or double-click a bird | Double-tap a bird or **Drop in** |
| First person | WASD, mouse (pointer lock), click or Space to fire | Left stick, drag anywhere on the right to aim, hold **FIRE** (also aims while held); all at once, multitouch |
| Extras | **Q**/**E** abilities, **X** ultimate, **R** rally, **C** swap, **F**/**Tab** back | Ability buttons and **★** above FIRE, **Rally flock**, **Swap bird**, **◀ Command** |

## Graphics

Cartoon look: toon shading with ink outlines, a sky dome, swaying grass and wheat, a water shader on the pond, windmills, a silo, a farmhouse, hills and a drifting balloon. Birds blink, waddle, kick up dust, squash when hit and tumble when knocked out; held nests get a light column and confetti.

**Fancy** graphics add bloom, colour grading and a vignette through a post-processing pass (`vendor/jsm`, three.js r170 addons). The menu toggle switches between fancy and fast, and the game drops to fast by itself if the frame rate stays low. Add `?fancy=1` or `?fancy=0` to the URL to force a mode.

## Code map

- `index.html`, `style.css`: page, HUD and touch controls.
- `vendor/`: three.js and the post-processing addons (imports rewritten to relative paths, no build step).
- `src/main.js`: everything else: world, procedural farm art, birds and roles, nests and capture, A* pathfinding on a 1×1 grid, unit AI and hen waves, RTS input and shop, FPS possession and abilities, camera transitions, alerts, HUD and minimap.

`window.__game` exposes a few hooks for automated smoke tests.

## Ideas for next steps

- Crouch/cover in FPS and line-of-sight-based fog (walls block vision).
- Resources and building, to make the RTS half deeper.
- Network play: one player commands, others possess units.
