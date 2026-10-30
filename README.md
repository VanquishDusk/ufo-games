# SKYWATCH '97 *(working title)*

A first-person UFO photography game set in **Cedar Hollow**, a sleepy suburb in the fall of 1997.
People keep seeing things in the sky. Nobody has a decent picture. You have a cheap camera,
twenty-five bucks and a dial-up modem.

You photograph the strange stuff, then sell it from your home computer to tabloids,
researchers and the local news. Better photos pay more, and better gear takes better photos.

> **UFOs are not in the game yet.** Everything around them is: the town, the day/night
> cycle, the camera, photo grading, the economy and the UI. Spawning a UFO and making it
> sellable is one call; see [Adding UFOs](#adding-ufos).

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/ (relative paths, works on any static host)
```

Add `?debug` to the URL for dev keys: `[` / `]` change the hour, `\` toggles 30x time,
**F9 spawns a glowing TEST ORB** (a stand-in anomaly worth $60, used to test grading
and selling end to end), and F10 adds $500.

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

**The look.** The world renders to a ~300-line buffer and is upscaled with nearest filtering,
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
- *Sell* from **UFO-NET** on your home PC. Buyers: Lenny's BBS (pays $1–4 for spooky shots,
  3 a day, the only income until UFOs exist), The Weekly Probe (tabloid, tolerates blur),
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

## Adding UFOs

Anything becomes photographable by pushing a subject into `world.subjects`:

```js
world.subjects.push({
  id: 'ufo-17',               // unique
  label: 'Saucer',            // shown on the photo report
  category: 'anomaly',        // 'anomaly' = buyers pay for it ('landmark' = flavor only)
  value: 120,                 // base $ for a perfect shot
  sightingId: 'night4-a',     // repeat shots of one sighting sell for less
  radius: 6,                  // world-space size in meters, used for framing math
  pos: someVector3,           // or getPos: (camera, out) => out.copy(...) for movers
  isActive: () => ufo.visible,// optional: only counts while true
  selfLuminous: true,         // optional: exposure matters less for glowing things
});
```

That's all the camera and economy need. A photo's value is `value` × how big, centered and
unblocked it is × sharpness × exposure, adjusted per buyer. The debug TEST ORB in `main.js`
(`_debug`) is a working example. For glowing lights, `world.glows.add(pos, color, size)`
gives you an additive point sprite that `world.glows.set(i, intensity)` can animate.

Natural places to start: the corn field behind your house (`ZONES.corn`), the empty field
west of Oak St (`ZONES.field`), the radio mast, and the water tower.

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
  camera/
    PhotoCamera.js     gear state: raise, zoom, AF, sway, breath, flash, film, tripod...
    Developer.js       offscreen render + metering + VHS shader + date stamp -> JPEG
    PhotoAnalyzer.js   subject detection, occlusion, grading  <- UFO hook lives here
  game/                items/catalog, buyers & pricing, save-state shape, calendar
  audio/Audio.js       fully synthesized sound (crickets, birds, shutter, modem...)
  ui/                  HUD + viewfinder, menus (album, home, UFO-NET PC, store), touch controls
```
