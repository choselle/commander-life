# Commander Life

A tabletop Magic: The Gathering life counter, designed iPad-Mini-first for a
device lying flat in the middle of the table. Commander damage per individual
commander (partners supported), Monarch, poison/energy/experience/rad/tax
counters, game + turn timers, undo/history, Scryfall commander art backgrounds,
offline-capable PWA.

## Develop

```sh
npm install
npm run dev
```

`dev` runs with `--host`, so the printed Network URL can be opened from an iPad
on the same Wi-Fi.

## Build

```sh
npm run build   # static output in dist/
npm run preview # serve the production build locally (tests the service worker)
```

## Deploy to Cloudflare Pages

Everything is static — no functions, no environment variables, no secrets.

**Option A — Git integration (recommended):** push this folder to a GitHub
repo, then in the Cloudflare dashboard create a Pages project from it with:

- Build command: `npm run build`
- Build output directory: `dist`

**Option B — direct upload from your machine:**

```sh
npx wrangler login
npm run deploy
```

No `_redirects` file is needed (single page, no client-side routing).

## Notes

- Card data comes from the public, keyless [Scryfall API](https://scryfall.com/docs/api);
  failures degrade to name-only manual entry.
- The service worker precaches the app shell and caches commander artwork
  (capped at 120 images) so previously used commanders work offline.
- Game state persists to `localStorage`; refreshing or reopening resumes the
  active game.
