# Vanguard Shift

A quick browser prototype for one idea: **command a squad from a top-down RTS view, then drop into any soldier and fight in first person**, without pausing the battle.

Everything is original placeholder art (simple shapes) built with [Three.js](https://threejs.org/) (vendored in `vendor/`, MIT). There is no build step.

## Run it

Any static file server works. From the repo root:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

To try it on a phone, open the same URL from a device on your network, or publish the repo with GitHub Pages (Settings → Pages → deploy from branch, root folder).

## How it plays

The core loop is switching views, and each view can do things the other can't.

- **Command view only sees what your units see.** Fog of war hides enemies outside your army's sight. Enemy snipers outrange your sight and shoot from the dark.
- **First person reveals and leads.** Any hidden enemy you look at becomes visible to the whole army for a few seconds (scouts spot further, scoped snipers further still). **Mark (T)** an enemy so every unit focuses it. **Rally (R)** sends your squad to wherever you aim.
- **Overdrive** fills while you command and drains while you possess (x2 damage, faster fire). You need 30% to drop in, kills refund some, and at 0 you are pulled back out. If your soldier dies the link breaks: you lose 25% and wait 8s to relink.
- **The enemy post is shielded.** Only a soldier you control can disable it: get next to it and **plant a charge (G)**. The shield stays down for 25s and the whole army rushes in.
- **Command-only powers** spend command points (CP), which build over time and from kills: **Artillery** (needs vision on the target), **Cover** walls, and instant **Reinforcements**.
- **The drop-in is a moment:** the camera swoops down onto the soldier while the battle runs in slow motion. A radio feed tells you what's happening elsewhere ("Squad under fire behind you", "Command post under attack!").
- **Roles** each play differently in first person: Trooper (frag grenade), Heavy (armor up, half damage), Scout (dash, long sight), Sniper (scope, headshots x2.5), Medic (heal beam, heal pulse, revives fallen allies). Downed allies leave a green marker for 14s that a medic can revive.
- **The enemy commander mirrors you.** Every ~80s it drops into a gold **elite** soldier that hunts whichever unit you're controlling. You get a 5-second warning; killing it pays out Overdrive and CP.
- Your post sends a reinforcement every 9s, cycling through all roles. The enemy attacks in growing waves down three lanes.

## Controls

| | Desktop | Touch |
|---|---|---|
| Select | Left click, drag a box, Shift to add, **Q** all | Tap a unit, drag a box, **Select all** |
| Move / attack | Right click ground / enemy, Ctrl+right click or **X** for attack-move | Tap ground / enemy while units are selected, **Attack-move** button |
| Powers | **1** artillery, **2** cover, **3** reinforce | Buttons on the right |
| Camera | WASD / arrows, middle-drag, wheel zoom, click minimap | Two-finger pan, pinch zoom, tap minimap |
| Possess | **F** or double-click a unit | Double-tap a unit or **Possess** |
| FPS move / aim / fire | WASD, mouse (pointer lock), click or Space | Left stick, drag right side, hold **FIRE** |
| FPS extras | **Q** ability, **T** mark, **G** plant, **R** rally, **E** swap, **F**/**Tab** back | **Ability**, **Mark**, **Plant charge**, **Rally squad**, **Swap unit**, **◀ Command** |

## Code map

- `index.html`, `style.css`: page, HUD and touch controls.
- `src/main.js`: everything else: world, units and roles, A* pathfinding and fog of war on a 1×1 grid, unit AI, RTS input and powers, FPS possession and abilities, camera transitions, radio, HUD and minimap.

`window.__game` exposes a few hooks for automated smoke tests.

## Ideas for next steps

- Crouch/cover in FPS and line-of-sight-based fog (walls block vision).
- Resources and building, to make the RTS half deeper.
- Network play: one player commands, others possess units.
