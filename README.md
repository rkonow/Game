# Hivefall

A browser prototype for one idea: **command a squad from a top-down RTS view, then drop into any marine and fight in first person**, without pausing the battle. Colonial marines vs. an alien swarm on a dusty mining planet.

Everything is original procedural art (shapes plus generated colour and normal-map textures) built with [Three.js](https://threejs.org/) (vendored in `vendor/`, MIT). There is no build step.

## Run it

Any static file server works. From the repo root:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

To try it on a phone, open the same URL from a device on your network, or publish the repo with GitHub Pages (Settings → Pages → deploy from branch, root folder).

## How it plays

One loop: **hold the relays, drop the shield, destroy the hive.**

- Three comms relays **A B C** sit in the middle. **Only a marine you control in first person can capture a relay** (stand on it for ~3s). Aliens take relays just by standing on them, so you have to go back and defend.
- Hold **all three** and the bio-shield over the hive goes down; your squad charges it. Lose a relay and the shield comes back.
- **Commander view:** move the squad and spend 💠 ore: **Marine** (20, frag grenade), **Juggernaut** (35, heavy armour, energy wall), **Ranger** (30, long range, scope). Ore trickles in, faster for every relay you hold.
- **First person:** x2 damage while you're in control. Rally the squad to where you aim, or swap to another marine.
- **Switching** is free any time, with a slow-motion swoop. If your marine goes down you wait 5s. Alerts ("The swarm is hitting relay B!") have a **Drop in** button that puts you in the nearest marine.
- The swarm (**Skitters**, armoured **Brutes**, acid-spitting **Spitters**) attacks in growing waves, each heading for a relay, and the **Hive Tyrant** comes out to hunt the marine you're controlling.
- Marines are smart: they shoot while moving, stop to return fire, go after snipers, dodge grenades, focus the wounded and patch themselves up out of combat.

## Campaign

**Campaign** on the menu opens the Kepler sector map: five missions, unlocked in order, each with its own goal and twist.

| # | Mission | Mode | Goal | Twist |
|---|---|---|---|---|
| 1 | Crash Site (story) | Live | Fight through the canyons to the colony relay | Its own map, checkpoints, scripted radio and a plot twist |
| 2 | Hold the Line | Tactics | Keep the outpost standing for 6 rounds | Two extra aliens every round |
| 3 | Tyrant Hunt | Live | Kill the Hive Tyrant | It comes out at 45s with 50% more health |
| 4 | Blackout | Live | Survive 3 minutes | Dust storm: very short sight lines |
| 5 | Hivefall | Tactics | Destroy the hive | The Tyrant every 3 rounds |

Story missions build their own map (canyon walls, camps) and run a script of objectives. Each checkpoint you reach is saved: if the squad is wiped out you restart from it with the same marines, and nobody is lost on a failed attempt. There are no reinforcements in story missions.

Your squad persists between missions. Every marine has a name and earns XP from kills and missions: Private → Corporal → Sergeant → Lieutenant, each rank adding health and damage. You pick who deploys in the briefing. **A marine killed in a mission is gone for good**, and the debrief lists kills, promotions and the fallen. Reinforcements you deploy and who survive join the roster, and fresh recruits keep the squad at six. Progress is saved in the browser; **New campaign** starts over.

## Hero kits (first person)

Each marine you control has two abilities on cooldowns and an ultimate (★) that charges while you deal damage, get kills, capture relays, and slowly over time. Ultimate charge stays on the marine, so in Tactics it carries over between rounds.

| Marine | Q | E (or right click) | ★ Ultimate (X) |
|---|---|---|---|
| Marine | Frag grenade | Combat roll: quick dash, can't be hit | Drone swarm: 5 drones hunt aliens and detonate |
| Juggernaut | Energy wall: blocks swarm fire in front of you | Shield charge: knocks aliens over and stuns them | Shockwave: stuns every alien in a cone for 3s |
| Ranger | Scope (headshots x2.5) | Jump jet: leap onto containers and huts | Recon scan: aliens marked through walls, shots pierce |

## Tactics mode (turn-based + tower defense)

Pick **Tactics** on the menu. The battle **pauses** between 20-second live rounds.

1. **Plan (paused):** drag from a marine to where it should go (a preview shows each spot, red if aliens can hit it), **Hold**, **Grenade**, spend ore and pick one **★ Hero**.
   - Deploy: Marine 20, Juggernaut 35, Ranger 30 (keys 1-3).
   - Build on your half: **Autoturret** 40, **Mortar** 55 (long-range splash), **Stasis pylon** 25 (slows aliens around it) (keys 4-6).
   - **Upgrade** selected marines and turrets up to ★3 (U).
2. **Go:** 20 seconds of live combat. Everything acts on its orders at once while you play the hero in first person.
3. **Between rounds:** ore income, your marines heal 25%, and a bigger wave leaves the hive; every 5th round brings the Hive Tyrant.

Win: hold all 3 relays to drop the hive's bio-shield, then destroy the hive. Lose: your outpost falls, or you have no marines and no ore to deploy more.

## Controls

| | Desktop | Touch |
|---|---|---|
| Select | Left click, drag a box, Shift to add, **Q** all, or click a portrait in the unit card | Tap a marine, drag a box, **All**, or tap a portrait |
| Drag-to-move | Drag from a marine to a spot: a ghost preview shows where each marine lands and warns when aliens can shoot there | Same, with one finger |
| Move / attack | Right click ground / enemy, **X** then click for attack-move | Tap ground / enemy while marines are selected, **Attack-move** |
| Deploy | **1** marine, **2** juggernaut, **3** ranger | Buttons in the bottom tray |
| Camera | WASD / arrows, middle-drag, wheel zoom, click minimap | Two-finger pan, pinch zoom, tap minimap |
| Drop in | **F** or double-click a marine | Double-tap a marine or **Drop in** |
| First person | WASD, mouse (pointer lock), click or Space to fire | Left stick, drag anywhere on the right to aim, hold **FIRE** (also aims while held); all at once, multitouch |
| Extras | **Q**/**E** abilities, **X** ultimate, **R** rally, **C** swap, **F**/**Tab** back | Ability buttons and **★** above FIRE, **Rally squad**, **Swap marine**, **◀ Command** |

## Graphics

Physically based materials lit by a low alien sun and an environment map baked from the procedural sky; generated colour and normal maps for regolith, rock, metal plates and corrugated containers. Around the colony: drill rigs, a refinery, habitat domes, a crashed freighter, mesas and a ringed gas giant. Units march and scuttle, kick up dust, flinch when hit and tumble when killed; held relays get a light column.

**Fancy** graphics add bloom, colour grading and a vignette through a post-processing pass (`vendor/jsm`, three.js r170 addons). The menu toggle switches between fancy and fast, and the game drops to fast by itself if the frame rate stays low. Add `?fancy=1` or `?fancy=0` to the URL to force a mode.

## Code map

- `index.html`, `style.css`: page, HUD and touch controls.
- `vendor/`: three.js and the post-processing addons (imports rewritten to relative paths, no build step).
- `src/main.js`: everything else: world, procedural planet art, marines, aliens and roles, relays and capture, A* pathfinding on a 1×1 grid, unit AI and swarm waves, RTS input and shop, FPS possession and abilities, camera transitions, alerts, HUD and minimap.

`window.__game` exposes a few hooks for automated smoke tests.

## Ideas for next steps

- Crouch/cover in FPS and line-of-sight-based fog (walls block vision).
- Resources and building, to make the RTS half deeper.
- Network play: one player commands, others possess units.
