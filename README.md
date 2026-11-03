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

**Campaign** on the menu opens the Kepler sector map: five missions, unlocked in order, each with its own goal and twist. **The campaign is turn-based on both sides**, played from the command view.

| # | Mission | Goal | Twist |
|---|---|---|---|
| 1 | Crash Site (story) | Fight through the canyons to the colony relay | Its own map, checkpoints, scripted radio and a plot twist |
| 2 | Hold the Line | Hold the outpost for 6 turns | More aliens every turn |
| 3 | Tyrant Hunt | Kill the Hive Tyrant | It comes out on turn 3 with 50% more health |
| 4 | Blackout | Survive 8 turns | Dust storm: very short sight lines |
| 5 | Hivefall | Destroy the hive | The Tyrant every 4 turns |

### Turns

- **Your turn:** each marine has **2 actions**. Move inside the blue ring (1 action) or dash to the yellow ring (2). Shooting, **Overwatch**, **Hunker down** and **Grenade** end that marine's turn, so move first, then act.
- **Hit chance** comes from the marine's aim, range and the target's **cover**: half cover (low barriers, ◐) −20%, full cover (containers, huts, rock, ●) −40%. Cover only counts on the side facing the shooter, so get around it: a target with no cover is **flanked** and much easier to crit. Hover (or tap once) on a spot to see the path and the cover you would have there; tap an alien once to see the odds, again to fire.
- **Overwatch** shoots the first alien that moves in range during their turn (at −15% aim). **Hunker down** makes a marine much harder to hit until your next turn. Marines carry one frag grenade per mission: it always hits everything in the blast.
- **Fog of war:** aliens are hidden until one of your marines has them in sight (16m, less in the storm). When a pack is spotted the camera cuts over the spotter's shoulder to show it.
- **Class abilities:** Marine **frag grenade** (1, or 2 with Grenadier), Juggernaut **Shield wall** (hunkers and covers every marine within 3.5m, every 3 turns), Ranger **Aimed shot** (both actions, +20 aim and +20 crit, every 2 turns). Key **G**.
- **Perks:** at each promotion a marine picks one of two perks on the sector map: Sprinter, Grenadier, Shredder, Flanker, Double tap, Lightning reflexes, Iron skin, Breacher, Squadsight, Deadeye.
- **Focus ◆:** kills and crits earn Focus (max 4). **Drop in** costs 2.
- **Special aliens:** the **Burrower** tunnels under walls (watch for its dust trail), ignores overwatch and claws whoever it surfaces next to; the **Warden** shields every alien within 5m (20 damage per turn); the **Egg sac** hatches a Skitter every turn, three at most.
- **⏩ Fast** (Space) speeds up alien turns and skips their shot camera. The first story mission shows short coach cards, which you can hide.
- **Alien turn:** aliens sit still until they see you, then the whole pack wakes up and scrambles for cover. On their turn each one moves toward you, looks for cover and flanks, and shoots when the odds are good. Their spitters set up overwatch too.
- Relays and the story relay are captured by ending turns with a marine on them. Ore buys reinforcements during your turn. Loot left on the ground fades after three turns.
- The shot camera cuts over the shooter's shoulder for every shot.
- **Drop in · 20s** (F): once per turn, a marine with actions left can be played **live in first person for 20 seconds**. Everything fights in real time (both sides hold their ground and shoot back, relays capture as in Live battle), then the battle freezes and the turns resume. That marine's turn is used up; **◀ Command** ends it early.

Story missions build their own map (canyon walls, camps) and run a script of objectives. Each checkpoint you reach is saved: if the squad is wiped out you restart from it with the same marines, and nobody is lost on a failed attempt. Ore buys reinforcements, which a dropship drops at your last checkpoint.

Your squad persists between missions. Every marine has a name and earns XP from kills and missions: Private → Corporal → Sergeant → Lieutenant, each rank adding health and damage. You pick who deploys in the briefing. **A marine killed in a mission is gone for good**, and the debrief lists kills, promotions and the fallen. Reinforcements you deploy and who survive join the roster, and fresh recruits keep the squad at six. Progress is saved in the browser; **New campaign** starts over.

### Loot

Dead aliens drop loot: **ore** (cyan crystal), **medkits** (+35% health), **ultimate cells** (+20% ★) and rare **relics** (purple; the Hive Tyrant always drops one). Walk a marine over it to pick it up. Relics stay with that marine for the rest of the campaign: Chitin Plate (+10% health), Acid Gland (+10% damage), Hive Lens (+6% accuracy) and Neural Node (ultimate charges 25% faster). Loot drops in every mode.

## Hero kits (first person)

Each marine you control has two abilities on cooldowns and an ultimate (★) that charges while you deal damage, get kills, capture relays, and slowly over time. Ultimate charge stays on the marine, so in Tactics it carries over between rounds.

| Marine | Q | E (or right click) | ★ Ultimate (X) |
|---|---|---|---|
| Marine | Frag grenade | Combat roll: quick dash, can't be hit | Drone swarm: 5 drones hunt aliens and detonate |
| Juggernaut | Energy wall: blocks swarm fire in front of you | Shield charge: knocks aliens over and stuns them | Shockwave: stuns every alien in a cone for 3s |
| Ranger | Scope (precision hits x2.8) | Jump jet: leap onto containers and huts | Recon scan: aliens marked through walls, shots pierce |

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
| Extras | **Q**/**E** abilities, **X** ultimate, **R** reload, **G** rally, right mouse aim down sights, **C** swap, **F**/**Tab** back | Ability buttons and **★** above FIRE, **Rally squad**, **Swap marine**, **◀ Command** |
| Campaign turns | Click a marine, click ground to move (hover shows path and cover), click an alien twice to shoot; **F** drop in live for 20s, **O** overwatch, **H** hunker, **G** class ability, **Space** fast alien turns, **G** grenade, **Tab** next marine, **Enter** end turn | Tap a marine, tap a spot or alien once to preview and again to confirm; one finger pans; buttons in the command bar |

## Graphics

Physically based materials lit by a low alien sun and an environment map baked from the procedural sky; generated colour and normal maps for regolith, rock, metal plates and corrugated containers. Around the colony: drill rigs, a refinery, habitat domes, a crashed freighter, mesas and a ringed gas giant. Units march and scuttle, kick up dust, flinch when hit and tumble when killed; held relays get a light column.

Three graphics levels (menu toggle, saved): **Ultra** (default on desktop) adds ambient occlusion (GTAO), 4K shadows that follow the camera and denser ground detail; **Fancy** (default on phones) adds bloom, colour grading and a vignette through a post-processing pass (`vendor/jsm`, three.js r170 addons). The menu toggle switches between fancy and fast, and the game drops to fast by itself if the frame rate stays low. Add `?gfx=ultra|fancy|fast` to the URL to force a level.

## Music

An original, dark cinematic score synthesized live with WebAudio (no audio files): a low drone and a string ensemble in a big hall reverb over a slow D-minor progression, a pulsing low ostinato with distant sonar pings in the field, and war drums with brass swells once aliens close in on your squad. Toggle it on the title screen.

Guns in first person have aim down sights (right mouse; the Ranger keeps its scope), magazines and reloads (**R**), recoil, brass, a muzzle light and layered gunshots.
Each class has its own gun: the Marine fires a 3-round pulse rifle, the Heavy a pump shotgun, the Ranger a rail rifle and the elite an auto rifle. Every gun has precision hits: shoot an alien's head, eyes or horns for bigger yellow damage numbers and a bright ping. Recoil climbs straight up and settles fast, near misses bend onto the body (more on touch), and the last alien you hit shows a health bar that drains in two steps.
On the turn-based map your marines are drawn twice as big so you can find them on a phone.

## Code map

- `index.html`, `style.css`: page, HUD and touch controls.
- `vendor/`: three.js and the post-processing addons (imports rewritten to relative paths, no build step).
- `src/main.js`: everything else: world, procedural planet art, marines, aliens and roles, relays and capture, A* pathfinding on a 1×1 grid, unit AI and swarm waves, RTS input and shop, FPS possession and abilities, camera transitions, alerts, HUD and minimap.

`window.__game` exposes a few hooks for automated smoke tests.

## Ideas for next steps

- Crouch/cover in FPS and line-of-sight-based fog (walls block vision).
- Resources and building, to make the RTS half deeper.
- Network play: one player commands, others possess units.
