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

- You (blue) and the enemy (red) each have a command post. Destroy the red one to win.
- Your post sends a reinforcement every 9 seconds. The enemy attacks in growing waves down three lanes.
- Units fight on their own: idle units engage anything nearby, and hit units fire back.
- **Possess** a soldier to take direct control. While possessed, it deals **2× damage and fires faster**, so dropping in at the right moment turns fights. If the possessed soldier dies you snap back to command view.
- From first person you can still lead: **Rally** sends your selected squad (or nearby units) to attack-move to wherever you aim.

## Controls

| | Desktop | Touch |
|---|---|---|
| Select | Left click, drag a box, Shift to add, **Q** all | Tap a unit, drag a box, **Select all** |
| Move / attack | Right click ground / enemy, Ctrl+right click or **X** for attack-move | Tap ground / enemy while units are selected, **Attack-move** button |
| Camera | WASD / arrows, middle-drag, wheel zoom, click minimap | Two-finger pan, pinch zoom, tap minimap |
| Possess | **F** or double-click a unit | Double-tap a unit or **Possess** |
| FPS move / aim / fire | WASD, mouse (pointer lock), click or Space | Left stick, drag right side, hold **FIRE** |
| FPS extras | **R** rally, **E** swap unit, **F**/**Tab** back | **Rally squad**, **Swap unit**, **◀ Command** |

## Code map

- `index.html`, `style.css`: page, HUD and touch controls.
- `src/main.js`: everything else: world, units, A* pathfinding on a 1×1 grid, unit AI, RTS input, FPS possession, camera transitions, HUD and minimap.

`window.__game` exposes a few hooks for automated smoke tests.

## Ideas for next steps

- Hold-to-zoom aim and cover/crouch in FPS mode.
- More unit roles (medic, scout with longer sight) and fog of war, so possessing a scout reveals the map.
- Resources and building, to make the RTS half deeper.
- Network play: one player commands, others possess units.
