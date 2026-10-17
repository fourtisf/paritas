# Design system

ALFA's direction, in his order of feedback:
1. Premium, better than the reference (iridius.xyz).
2. **Not** like the reference.
3. Not colourful/holographic ("norak"). Not black-and-gold, and not light or white.
4. **Premium black** with **moving 3D**.

The prototypes are the source of truth. This page summarises them so you do not drift.

## Tokens
These are in `apps/web/src/styles/tokens.css`, copied exactly from the prototype.

- **Surfaces:**
  - `--bg #050506`
  - `--bg-2 #0A0A0C`
  - `--s1 #0F0F12`
  - `--s2 #16161A`
  - `--s3 #1F1F24`
  - lines `--line #1E1E23` and `--line-2 #2C2C33`
- **Text:**
  - `--text #F5F5F7`
  - `--text-2 #A3A3AC`
  - `--muted #6C6C76`
- **Signals (the only colour):**
  - up `#3FD49A`
  - down `#F2677A`
  - warning `#F2A285`
- **Sessions:**
  - regular green
  - extended steel `#8C9BB4`
  - overnight `#5E6475`
  - closed `#26262C`
- **Venues:**
  - vault `#F5F5F7`
  - Uniswap `#8A8A93`
  - maker `#6E8FB8`
- **"Holo"** is now a white-to-silver gradient (`--holo`), and **chrome** is a silver band. Use them for primary buttons, foil edges and the logo mark only.
- **Font:**
  - **Archivo** with the width axis.
  - Headings and big numbers use `font-stretch: 115–125%`.
  - Numbers use `font-variant-numeric: tabular-nums` (`.num`).
- **Texture:** a 5% SVG noise on `body::before`.

## Logo
ALFA chose the **guilloché seal** (logo round 2, concept F). It is the site's guilloché rosette inside a reeded ring, with the tagline on the ring. It replaces the bare rosette mark that the prototypes and `docs/screenshots/` still show.

- **In the app and landing (16–48 px):** `SealMark` (`components/brand/Seal.tsx`) is the double ring, the rosette and a white heart, with no ring text. The wordmark stays the live text "Paritas" in Archivo at `font-stretch: 125%`.
- **Favicon:** `app/icon.svg` (small seal on a black disc). The iOS icon is `app/apple-icon.png` (full seal, 180 px).
- **Files in `public/brand/` (served at `/brand/...`):**
  - `paritas-seal.svg`: full seal, silver, transparent. The ring text is outlined, so no font is needed.
  - `paritas-seal-ink.svg`: the same seal in ink `#050506`, for light backgrounds only (print, partner pages).
  - `paritas-mark.svg`: the small seal.
  - `paritas-seal-2048.png`: full seal, transparent.
  - `paritas-x-profile.png`: X profile photo, 1000 × 1000. X crops it to a circle, so the reeded edge sits at 86% of the radius.
- **Rules:**
  - Do not recolour the seal, put it on a colour, or add effects (glow, 3D, gold).
  - Use the full seal at 96 px and up. Below that, use the small seal.
  - The ring text reads "PARITAS · THE BEST PRICE ON EVERY STOCK TOKEN · ROBINHOOD CHAIN".

## Components
Port these from the prototype CSS; the class names are already there:
- top bar: logo, nav pill, session dial, settings, connect
- watchlist
- market header with the spinning 3D coin
- chart (SVG area with gradient)
- venue ladder (lanes, band, zero line, marks)
- trade ticket ("perforated" receipt look, `.perf`)
- cost lines (`.lns .ln`)
- price-limit bar (`.lim`)
- notes (`.note-cyan`, `.note-lav`)
- tape table (`.t`)
- tiles with tilt and glare (`data-tilt`)
- vault list and detail with donut
- portfolio cards (`.pcard`)
- modals and flow steps
- success burst
- toasts
- settings rows and switches
- empty states with the guilloché rosette

## Motion and 3D
- **Landing:**
  - the guilloché tube core is chrome with low env intensity
  - coins face the camera with a small oscillation and a periodic flip
  - each section sets a camera pose (`data-pose`) and exposure, so text always sits on dark space
  - bloom `UnrealBloomPass(.32, .55, .9)`
- **Platform:**
  - coin carousel on Markets: drag with inertia, the front coin opens the market
  - spinning coin in the trade header
  - coin burst on success
  - tilt and glare on tiles
- Reduced motion: keep 3D static and drop the tilt.
- No WebGL: show the `.no-gl` poster.

## Layout checks
- Grids use `minmax(0,1fr)`; there is never horizontal scroll at 390px.
- Mobile top bar hides the breadcrumbs and the dial text.
- The mobile landing hero has a 330px top pad so the 3D core never sits on the headline.
