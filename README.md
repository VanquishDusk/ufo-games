# SKYWATCH '97 *(working title)*

A first-person UFO photography game set in **Cedar Hollow**, a sleepy suburb in the fall of 1997.
People keep seeing things in the sky. Nobody has a decent picture. You have a cheap camera,
twenty-five bucks and a dial-up modem.

You photograph the strange stuff, then sell it from your home computer to tabloids,
researchers and the local news. Better photos pay more, and better gear takes better photos.

Three kinds of craft show up, rarely, and one at a time. See [UFOs](#ufos).

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/ (relative paths, works on any static host)
```

### GitHub Pages

The source runs as-is on a plain static host, no build needed: `index.html` uses an import
map to load three.js from jsDelivr, and the stylesheet is a normal `<link>`. To publish, go to
**Settings → Pages**, set **Source: Deploy from a branch**, pick this branch and `/ (root)`, and
save. The game appears at `https://<user>.github.io/ufo-games/` a minute or two later.
(`.nojekyll` stops Pages from running Jekyll over the files. If you bump three in
`package.json`, bump the version in the import map too.)

Add `?debug` (or `#debug`) to the URL for dev keys: `[` / `]` change the hour, `\` toggles
30x time, **1–8 spawn a saucer / cigar / triangle / sphere / V / dots / '47 / Phoenix nearby, N cycles through every type**, F8 gives one of every lure, F9 spawns a glowing test
orb, and F10 adds $500.

## Controls

| Key | Action |
| --- | --- |
| WASD | Walk |
| Shift | Sprint. **While aiming: hold your breath** (steadier, drains a meter) |
| Space / C | Jump / crouch (crouching steadies your hands) |
| Right mouse (hold) or Q (toggle) | Raise camera |
| Left mouse | Take photo |
| Wheel, `+`, `-` | Zoom (when your camera has zoom) |
| G | Flash mode: auto, on, off |
| R | Swap film roll (cycles film types, wastes unused frames) |
| F / B / T | Flashlight / binoculars / tripod (once you own them) |
| L | Use a lure: pick one from the list; each needs the right time and place |
| E | Interact (doors, store, payphone, packages) |
| Tab or P | Photo album |
| H | Toggle hints |
| Esc | Pause |

Touch devices get an on-screen stick, drag-to-look, and CAM / SNAP / ZOOM buttons.

## What's in this build

**The town.** A procedurally laid out (but fixed-seed) 1997 suburb: four streets, a cul-de-sac,
46 houses with vinyl siding, gable and hip roofs, garages, shutters, chimneys, satellite dishes,
picket and privacy fences, pumpkins on porches, above-ground pools, swing sets and minivans.
There's also a park with a gazebo, playground and ball field, the 24-hour **Qwik Stop** gas
station, a water tower, a blinking radio mast on the horizon, power lines, and a dry October
corn field behind your house. The corn slows you down and is taller than you.

**Day/night.** One real second is one game minute, so a day lasts 24 minutes. The sky runs
through sunrise, day, golden hour, dusk and night, with stars, a moon that drifts night to night,
and moving clouds. Families turn lights on and off on their own schedules, TVs flicker blue
through windows, porch lights and jack-o'-lanterns come on, street lamps warm up (one of them
flickers), and the nearest lamps actually light the scene around you.

**The look.** The world renders to a ~360-line buffer and is upscaled with nearest filtering,
4x4 ordered dithering and a 5-bit-per-channel palette. Vertices snap to a coarse grid for that
PS1 wobble, and every texture is a tiny procedural canvas. Resolution and wobble are adjustable
in Settings.

**The camera.** Raise it and you get a 4:3 viewfinder with a camcorder-style OSD: flash state,
ISO and shutter speed, frames left, zoom bar, a steadiness meter, autofocus brackets and the
date. Photography works roughly like a real camera:

- **Exposure.** When you shoot, the scene is metered and the camera lengthens the shutter until
  it gets a good exposure or hits its slowest speed. At night a cheap camera on slow film
  underexposes. Faster film (ISO 800/1600) and slower shutters fix that.
- **Blur.** Your hands sway (more when zoomed, walking or out of breath). Blur is that sway
  multiplied by the shutter time, so slow night exposures smear unless you hold your breath,
  crouch or use a tripod.
- **Focus.** Autofocus locks after you hold steady for a moment. Snap too soon and it's soft.
- **Flash** only reaches a few meters. It helps with the porch, not the sky.

**The photo.** Each shot is rendered offscreen at 640x480 and then run through a two-pass
"VHS dub" shader: motion blur and defocus, a film-like highlight shoulder, chroma bleed,
edge-enhancement halo, per-line jitter, a rolling tracking band, head-switch tearing at the
bottom, dropouts, grain and scanlines. A camcorder OSD timestamp (`PM 10:42 / OCT. 3 1997`) is
burned in. Photos are saved as JPEGs in IndexedDB and can be exported from the album.

**Grading.** `PhotoAnalyzer` finds every registered *subject* in frame. It scores how big and
centered each one is, raycasts against the town to see how much of it is blocked, and grades
the photo S through F on sharpness, exposure and framing.

**Economy and progression.**
- *Sell* from **UFO-NET** on your home PC. Buyers: Lenny's BBS (pays $1–4 for spooky
  non-UFO shots, 3 a day, and half price for real sightings), The Weekly Probe (tabloid, tolerates blur),
  Dr. Ingrid Vos (pays well, wants sharp evidence), KCHV Channel 7 (unlocks after 3 sightings
  sold) and a locked `???` buyer as a story hook. Reputation raises prices, and repeat photos of
  the same sighting are discounted.
- *Buy* film and a flashlight at the Qwik Stop, or mail-order gear from the Skywatcher Supply
  Co. catalog. Orders land on your porch at 8 AM the next day: a 3x zoom point-and-shoot, an SLR,
  200mm and 500mm lenses, a tripod, binoculars, a stabilizer grip and a pro flash.
- *Inbox* email from Lenny, the Probe and the catalog sets up the premise and the tips.
- *Sleep* at home to skip to dusk, midnight or morning. Knock on neighbors' doors for gossip
  (some of it is UFO lore). Feed 35¢ to the payphone at the Qwik Stop.

Settings and progress save automatically (localStorage for state, IndexedDB for photos).

## UFOs

Sightings are rare: one craft at a time, with several game hours (several real minutes) between
them. Night is busiest, and daytime sightings are rarer. The first night always brings a saucer
a few minutes after dark. Each sighting has subtle cues instead of a HUD marker: dogs start
barking, crickets go silent, street lamps flicker underneath, and there's a hum.

| Type | When | How it moves | Base value |
| --- | --- | --- | --- |
| **Saucer** (silver disc, dome, ports) | Any time, mostly night | Glides in and decelerates to a hover over the corn, the west field, the water tower or the park. Wobbles, slowly spins, banks into motion. Snaps 40–100 m sideways in about half a second, then hovers again (1–3 times). At night it sometimes sinks to ~20 m over the field with its underside lit. Leaves with a violent acceleration. Rim lights chase at night. | $150 |
| **Cigar** (metallic tube) | Mostly day and dusk | High (160–240 m), slow straight drift, lazy tilting and yawing. Flashes a sun glint when its angle lines up with you and the sun. Stops dead for a while, drifts on, then usually winks out (sometimes climbs away). Silent. | $130 |
| **Black triangle** (42 m, matte black) | Night only | Slow, silent cruise over town at 75–125 m with a low hum you feel. Stops, rotates in place, carries on along a new heading, sometimes leaving in a hurry. White corner lights, pulsing red center. | $210 |
| **Sphere** (chrome orb, spiral grooves) | Rare; mostly day | Drops straight down out of the sky and stops dead: no bob, barely any drift, slowly turning. Its surface is a live reflection of the town and sky around it. Glides on a smooth curve to a new spot (once or twice), then shoots straight up and is gone. | $320 |
| **V / boomerang** (huge dark chevron) | Dusk and night | Glides apex-first in a dead-straight line at constant speed, completely silent, five steady lights along its arms. On its way out the lights go dark one by one, and then it's gone. | $230 |
| **Circling lights** (3–5 white dots) | Common; dusk and night | Very high. The dots circle one another, reverse direction, and one sometimes darts out of the group and back. The cluster drifts, then scatters in all directions or fades. Easy to mistake for stars, and you need zoom to get more than specks. | $70 |

### More craft, by tier

Every craft has a rarity tier, shown on the photo card and in the album: common, uncommon, rare,
epic or legend. Odds depend on the time of day.

| Type | Tier | When | How it moves | Base value |
| --- | --- | --- | --- | --- |
| **Orange orbs** | Common | Dusk, night | 2–4 fire-orange lights rise from behind the trees and drift downwind in a loose line, flickering, then burn out one at a time. | $55 |
| **Moving star** | Common | Night | A star-like point crosses the sky in a straight line, stops dead, turns sharply and accelerates away. | $45 |
| **Tic Tac** | Rare | Day, dusk | White featureless capsule over the fields. Holds dead still with a faint tremble, then jumps 10–35 m in a fraction of a second, over and over. Leaves by vanishing sideways. | $380 |
| **Ring of lights** | Rare | Dusk, night | A wheel of red, green and white lights sinks slowly out of the sky, spins faster and faster, tilts its face toward you, flashes once and shoots straight up. | $420 |
| **The Cloud Ship** | Epic | Any time | A perfectly smooth lenticular cloud forms over town and doesn't drift. A colossal dark hull pokes out of it, light flickers inside, and three scout orbs drop out, buzz around the neighborhood and return. Then the cloud dissolves. | $950 |
| **The Harvester** | Epic | Night | A dark lens comes in low over the corn and shines a beam straight down for half a minute. Afterwards, the corn underneath is flattened into a **crop circle** that stays for three days and can be photographed ($160). | $850 |

### Legends

Two legendary craft exist. Each scheduled sighting has a 1.5% chance of being one (from day 2
on): the Phoenix Lights at night, the '47 Visitor by day. That works out to roughly one a
week of game time. The reliable way is a **lure** (see below), which gives a 60% chance the
legend turns up within the next game hour or so. Lenny's email on day 3 explains it all. The
first legend photo unlocks **M. Gray**, who buys only legends, at 2.5x.

| Legend | When / lure | How it moves | Base value |
| --- | --- | --- | --- |
| **The '47 Visitor** (flat heel-shaped wing, small fin underneath) | Day. Signal mirror, $60 | Streaks in from the horizon, flies 2–3 fast, wide circles overhead while fluttering and dipping like a skipped stone and flashing in the sun, then leaves in a straight line at absurd speed. Fast enough that you need to pan with it for a sharp shot. | $1200 |
| **The Phoenix Lights** (seven amber lights on an enormous, nearly invisible V) | Night. Road flares, $90 | Drifts slowly, almost straight overhead, blotting out stars. Moves off toward the horizon, its lights settle into a hanging row, and then they go out one by one, left to right. | $1500 |

### Lures

Lures are one-use items from the Skywatcher catalog on your PC (delivered overnight). Press **L**
somewhere open (the corn, the field west of Oak St, or the park), pick a lure, and wait: if it
works, its craft shows up nearby within about an hour of game time. Only one lure can be out at
a time, and the list tells you why a lure can't be used yet (wrong time of day, wrong place).
They're defined in `src/game/lures.js`.

| Lure | Price | Calls | When / where | Odds |
| --- | --- | --- | --- | --- |
| Paper sky lanterns | $20 | Orange orbs | Night, open | 85% |
| "Contact" cassette tape | $25 | Circling lights | Night, open | 85% |
| Chrome hubcap | $55 | Metallic sphere | Day, open | 70% |
| Aircraft strobe beacon | $75 | Ring of lights | Night, open | 70% |
| Radar reflector kite | $90 | Tic Tac | Day, open | 70% |
| Signal mirror | $60 | The '47 Visitor (legend) | Day, open | 60% |
| Road flares (3-pack) | $90 | The Phoenix Lights (legend) | Night, open | 60% |
| Surveyor stakes & twine | $160 | The Harvester | Night, **in the corn** | 55% |
| Surplus weather balloon | $180 | The Cloud Ship | Any time, open | 55% |

Photo grading is pan-aware: tracking a fast mover with the camera cancels out its motion blur.

Buyers have tastes: the Probe pays extra for saucers and Vs, Dr. Vos for spheres, triangles and
cigars, and KCHV for spheres and daylight cigars. Nobody pays much for dots. Repeat shots of the same sighting sell for less. A craft that's moving
fast across the frame comes out smeared ("Subject moving"), so the saucer's darts and the
cigar's exit are hard to catch.

Flight plans and scheduling live in `src/ufo/UFOManager.js`; models are in `src/ufo/models.js`.

### Adding more types

Write a `Craft` subclass that builds its flight plan from timed segments (`this.seg(dur, fn)`,
`this.hover(point, dur)`), add a model, and register it in `UFO_TYPES`. The manager registers
every type as a photo subject. Anything else can become photographable the same way:

```js
world.subjects.push({
  id: 'ufo-17', label: 'Saucer', kind: 'saucer',
  category: 'anomaly',        // 'anomaly' = buyers pay for it ('landmark' = flavor only)
  value: 120,                 // base $ for a perfect shot
  sightingId: 'night4-a',     // repeat shots of one sighting sell for less
  radius: 6,                  // world-space size in meters, for framing math
  pos: someVector3,           // or getPos: (camera, out) => ... for movers
  getVel: () => velocity,     // optional: enables subject motion blur
  isActive: () => visible,    // optional
  selfLuminous: true,         // optional: exposure matters less for glowing things
});
```

## Code map

```
src/
  main.js              Game class: boot, modes (title/play/menu), loop, actions
  core/                Input (pointer lock + drag-look fallback + touch), storage, events, RNG
  render/
    RetroPipeline.js   low-res render target -> dithered, quantized upscale
    materials.js       shared materials + PS1 vertex-snap / foliage-sway shader patches
    textures.js        procedural canvas textures (siding, shingles, grass, corn, moon...)
    glows.js           additive light sprites + animated instanced colors
  world/
    layout.js          streets, lots, zones, sidewalks; player's house selection
    houses.js          house generator
    props.js           streets, lamps, power lines, trees, cars, park, store, towers, corn, hills
    Sky.js             time-of-day palette, sky dome, stars, moon, clouds, sun/moon light
    World.js           builds the town; animates windows, lamps, beacons
    geo.js             geometry batching (merged + spatially chunked meshes)
    Colliders.js       2.5D circle/oriented-box collisions on a grid
  player/Player.js     first-person movement, head bob, look velocity
  ufo/
    UFOManager.js      sighting scheduler, flight plans per type, cues, photo subjects
    models.js          saucer / cigar / black triangle models + light markers
  camera/
    PhotoCamera.js     gear state: raise, zoom, AF, sway, breath, flash, film, tripod...
    Developer.js       offscreen render + metering + VHS shader + date stamp -> JPEG
    PhotoAnalyzer.js   subject detection, occlusion, grading  <- UFO hook lives here
  game/                items/catalog, buyers & pricing, save-state shape, calendar
  audio/Audio.js       fully synthesized sound (crickets, birds, shutter, modem...)
  ui/                  HUD + viewfinder, menus (album, home, UFO-NET PC, store), touch controls
```
