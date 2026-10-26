# What Can I Watch Today? — Deployment Guide

A single Cloudflare Worker (`worker.js`) that:
- Polls ESPN's free scoreboard API for MLB, WNBA, NBA, men's and women's college basketball and volleyball, NFL, College Football (incl. Boise State), NHL, Formula 1, MLS, NWSL, and four European soccer leagues + Champions League.
- Optionally lists upcoming Super Smash Bros. and other FGC tournaments from start.gg in the main, tomorrow, and scores views, with game and stream filters.
- Filters every game against your services (Antenna / Paramount+ Essential / Peacock Premium / Prime Video / MLB.TV / YouTube free / Apple TV / Tubi free).
- Serves a JSON API at `/api/data` (edge-cached 10 minutes, no DB) and a dark, TV-friendly HTML page at `/`.
- Includes a **Tomorrow's Feed** view for games scheduled on the next America/Boise calendar day.

## Files
- `worker.js` — everything: fetch logic, filtering rules, JSON API, and the embedded HTML/CSS/JS frontend.
- `AGENTS.md` — architecture map, API contracts, data-source guidance, secret handling, and local validation commands for coding agents and maintainers.
- `docker-compose.yml` and `Dockerfile` — run the local dashboard continuously in Docker.
- `my_services_map.json` — human-readable copy of the matching rules and toggle behavior (documentation only; the real logic lives in `SERVICES` and `matchServices()` inside `worker.js`).

## Deploy (Cloudflare Workers, free tier is plenty)

### 1. Install Wrangler (Cloudflare's CLI)
```bash
npm install -g wrangler
```

### 2. Log in
```bash
wrangler login
```
This opens a browser to authorize Wrangler against your Cloudflare account (free account is fine).

### 3. Set up the project folder
```bash
mkdir sports-dashboard && cd sports-dashboard
# copy worker.js, wrangler.toml, and my_services_map.json into this folder
```

The included `wrangler.toml` configures the local worker:
```toml
name = "sports-dashboard"
main = "worker.js"
compatibility_date = "2026-10-25"
```

### 4. Test locally
```bash
wrangler dev
```
Visit the printed `http://localhost:8787` URL. Note: local `wrangler dev` doesn't have Cloudflare's edge cache (`caches.default`), so `/api/data` will hit ESPN fresh every load while testing — that's expected and fine.

### Optional: enable FGC tournaments from start.gg

The dashboard lists start.gg tournaments for Smash and selected fighting games taking place in the next 7 days. Both views have FGC filters for all games, Smash, other FGC, and stream-listed tournaments only. Listings are grouped into Boise-local Today and Tomorrow sections; later events are collapsed to keep the page compact. It also shows the tournament's listed stream names and platforms when provided. start.gg requires an API token; create one in [Developer Settings](https://start.gg/admin/profile/developer). Do not paste the token into chat or put it in frontend code.

For local Wrangler or Docker Compose use, create a `.dev.vars` file in the project root (next to `wrangler.toml`) containing:

```text
STARTGG_API_TOKEN="paste-your-token-here"
```

Wrangler reads `.dev.vars` for local development. The Compose service bind-mounts the project folder, so the same file is available in the container. Restart Wrangler/Compose after adding the file. `.dev.vars` is excluded from version control.

For a future Cloudflare deployment, set the secret with `npx wrangler secret put STARTGG_API_TOKEN`; this project has not been deployed. Without a token, the dashboard shows setup instructions and all ESPN features continue to work. start.gg coverage depends on organizers listing their tournaments and event games there; it does not provide live match scores or a reliable live/on-air state. A tournament within its listed start/end time is labeled as being in a scheduled active window, not confirmed live. Tournament stream listings are separate from the TV-service matching rules: Twitch/YouTube channels are displayed as tournament stream links, do not affect ESPN game buckets or service toggles, and are not guaranteed to be live or available for every event.

## Keep the local dashboard running with Docker Compose

Docker Compose builds a Debian-based Node.js image with CA certificates required by the Workers runtime, runs Wrangler in a container, and restarts it if the container or Docker restarts. From the project folder:

```bash
docker compose up -d
docker compose logs -f sports-dashboard
```

Open `http://localhost:8787` on the host computer, or `http://<host-LAN-IP>:8787` from another device on the same network (for example, `http://192.168.4.34:8787`). The LAN address can change if your router assigns the computer a new IP. Make sure Docker is running and that the host firewall permits inbound connections on port 8787.

Useful commands:

```bash
docker compose ps
docker compose logs -f sports-dashboard
docker compose restart sports-dashboard
docker compose down
```

`docker compose down` stops and removes the container, but leaves the small npm cache volume in place. To recreate the container after changing `worker.js`, use `docker compose up -d --force-recreate`; the worker source is bind-mounted, so file edits are also visible to Wrangler while it runs. This is a local development server, not a Cloudflare deployment.

### 5. Deploy
```bash
wrangler deploy
```
Wrangler prints a URL like `https://sports-dashboard.<your-subdomain>.workers.dev` — that's your dashboard. Bookmark it, pin it as a browser tab, or throw it on a spare tablet/TV browser for a background-sports display.

### 6. (Optional) Custom domain
If you have a domain on Cloudflare already:
```bash
wrangler deploy --routes "sports.yourdomain.com/*"
```
or add a route in the Cloudflare dashboard under Workers & Pages → your worker → Triggers.

## How the filtering actually works

The `SERVICES` array in `worker.js` is the single source of service IDs, display names, match rules, links, and default toggle states. `matchServices()` inspects every broadcast string ESPN returns for a game (from both `broadcasts[].names` and `geoBroadcasts[].media.shortName`) and applies these rules:

| Your service | Matches when broadcast string... | Does NOT match |
|---|---|---|
| **Antenna** | is exactly `ABC`, `CBS`, `NBC`, `FOX`, `CW`, or `ION` | anything with `+` or mentioning Paramount/Peacock in the same string |
| **Paramount+ Essential** | contains `Paramount+` | ...also contains `Showtime` (bundle you don't have) |
| **Peacock Premium** | contains `Peacock` | — |
| **Prime Video** | contains `Prime Video`, `Amazon`, or is exactly `Prime` | — |
| **MLB.TV** | contains `MLB.TV` (case-insensitive) | does not infer availability from a generic MLB listing |
| **YouTube** | contains `YouTube` | — |
| **Apple TV** | is exactly `Apple TV` (case-insensitive; based on the observed ESPN MLS string) | other Apple/MLS labels not confirmed |
| **Tubi (free)** | contains `Tubi` (case-insensitive) | no Tubi broadcasts were seen in the recent MLB/NHL payloads checked |

Prime Video broadcast labels containing `Local` are market-restricted, not nationwide. ESPN returned `Prime Video (Local)` as the **Home** market for Dallas Stars games, which means the Dallas-area feed—not a general Prime Video stream. The matcher now only accepts that local label for the Seattle Kraken, whose Prime Video local stream you confirmed is available to you. Add another team to `PRIME_VIDEO_LOCAL_TEAMS` in `worker.js` only after confirming its local feed is available in your region.

For OTA matches, the card identifies both the network and local station (for example, `Antenna (CBS KBOI 2; local game unconfirmed)` and `Antenna (Fox KNIN 9)`). CBS options carry a warning because ESPN does not identify which regional game KBOI carries.

MLB.TV matches only when ESPN explicitly names `MLB.TV` in a game's broadcast listing. This indicates the service is listed, not guaranteed access: MLB.TV blackout restrictions and subscription requirements may apply.

ESPN's NFL scoreboard currently marks CBS broadcasts as national and does not say which regional game Boise's KBOI affiliate carries. A bare `CBS` match is therefore a network listing, not confirmation of local availability. Weekly listings such as 506 Sports publish regional coverage as map images rather than a structured Boise-to-game mapping; the dashboard does not guess a local CBS game from team locations.

A game with **zero** matches goes to the collapsed "Happening but NOT watchable" bucket instead of being hidden, except Boise State which remains pinned. A game matching only disabled services stays in the collapsed bucket with a reason such as `On Apple TV (toggled off)`. These cards also show ESPN's distinct raw broadcast names for information; this list is not a claim that the listed channels are available to you.

## Service toggles

- Service toggles are collapsed under an **Available services** disclosure by default to save screen space. Open it to reveal one large, keyboard/remote-friendly button per service; native controls support Enter and Space, show ON/OFF text, and keep a visible focus outline. The summary shows how many services are enabled.
- Tubi is included as a free-service filter. A broadcast matches only when ESPN explicitly names Tubi; none was present in the recent MLB/NHL samples checked.
- The Prime Video `Local` label is restricted using the configured `PRIME_VIDEO_LOCAL_TEAMS` list; it is not assumed that a team's home-market feed is available in Boise.
- All services default to ON. Toggle selections are stored in browser `localStorage`; if storage is unavailable, toggles still work for the current page.
- Changing a toggle immediately recomputes the visible buckets from the API's flat `games` list. The page re-evaluates bucket timing every 60 seconds and fetches fresh ESPN data every 10 minutes.
- The `/api/data` `now`, `next`, `tonight`, `not_watchable`, and `boise_state` buckets remain server-computed with all services enabled. The `games` list contains every non-finished game today (plus any finished Boise State game so it stays pinned); `scores` contains all events today, including finished games. Both include event details, and `games` preserves each game's complete matched-service list. The API also returns service metadata and favorite team names. Toggle state is never stored server-side.
- The **Tomorrow's Feed** view uses `tomorrow_games`, a flat list of the next Boise-local day's scheduled ESPN games. It applies the same service toggles and recomputes time buckets in the browser; the existing today buckets and `games`/`scores` contracts are unchanged.
- Boise State remains pinned above the other buckets. If none of its matched services are enabled (or no owned service matched), its card says `Not available with your current services`.
- The **Today's Scores** view groups all of today's events by sport, including finished games and future starts. It ignores service toggles and omits watch links so scores and statuses are easy to scan.
- The same view shows upcoming FGC tournaments for the next 7 days when `STARTGG_API_TOKEN` is configured. It links to the tournament's start.gg page, identifies recognized fighting-game events, and displays tournament-level stream names/platforms when organizers supplied them. These are separate from the owner's TV-service filters and do not imply a live stream, match result, or guaranteed stream availability.
- FGC listings can be filtered by all fighting games, Smash, other FGC, or tournaments with stream listings. These filter preferences are saved in browser local storage. The FGC list is grouped by Boise-local day: today and tomorrow are highlighted separately; later dates are collapsed.
- Use the ☆/★ button beside any team in either view to add or remove it from favorites. Changes are stored in browser `localStorage`; Arizona Cardinals and the requested Idaho teams are initial defaults if no preference has been saved.
- WWE NXT is scheduled Tuesdays at 8 p.m. Eastern on The CW in the official weekly schedule. On Tuesdays the dashboard adds a scheduled event at that time, converted to Boise local time, and matches it to the CW antenna option. This is a recurring schedule entry, not a live match/result feed.
- Sports are a deliberate allowlist of ESPN scoreboard leagues, including F1 sessions and both college-basketball and college-volleyball divisions. The worker does not discover every ESPN sport, so unrelated categories such as motocross are not added automatically.
- ESPN's tested track-and-field scoreboard routes do not work. TheSportsDB lists a Fighting calendar with some pro-wrestling events, but the sampled events had no TV/broadcast fields; neither source is integrated for these sports until its coverage is sufficient for reliable watchability matching.

## Idaho teams and Boise State coverage

- Boise State football (including the `groups=80` FBS query), men's and women's basketball, and women's college volleyball are covered by the existing ESPN scoreboard feeds. The Boise State bucket pins its games even when there is no matching service. Boise State was not present in the tested men's college-volleyball team feed.
- Boise State men's/women's soccer, beach volleyball, and track and field are not currently integrated: the tested ESPN scoreboard routes were invalid or did not provide a usable feed. The general ESPN soccer route for `usa.usl.1` is USL Championship, not USL League One.
- Idaho Steelheads has a TheSportsDB team record and a next-events endpoint, but requests were rate-limited during verification; this is not a dependable feed for the dashboard. Athletic Club Boise has a team record but no upcoming events in the endpoint checked. Boise Hawks did not appear in the team search. No such feeds have been added, so these names are favorites only and will not create events by themselves.
- The requested Idaho teams are included among default favorites so matching team cards will be starred if they appear in supported feeds. A browser with a previously saved favorite list keeps that list; use the star buttons to configure it.

## Buckets & sorting

- **Boise State Today** — non-finished Boise State games stay pinned above all other buckets, including when their services are disabled.
- **Live Now** — games ESPN marks live, plus pregame games whose scheduled start time has passed while waiting for the next data refresh. Formula 1 practice, qualifying, and race sessions use their individual ESPN session start times and statuses.
- **Next Up** — starts within 3 hours and watchable.
- **Tonight / Later Today** — starts later today and watchable.
- **Not Watchable** (collapsed `<details>`) — games with no enabled match, including games whose only matched services are toggled off; US-friendly leagues sort first so 5am Bundesliga doesn't dominate the list.

All times and date checks use `America/Boise` via `Intl.DateTimeFormat` (including the correct MDT/MST abbreviation). The worker queries ESPN for **yesterday/today/tomorrow's UTC-labeled dates** then filters strictly to games whose actual local Boise date is today — this avoids missing late-night games that ESPN tags under a different UTC day.

## Caching

`/api/data` uses Cloudflare's edge Cache API (`caches.default`) with `Cache-Control: public, max-age=600` — so ESPN gets hit at most once every 10 minutes per Cloudflare data center, and the frontend re-fetches every 10 minutes automatically. No KV, no D1, no external DB needed.

## Extending it later
- Add more leagues: just add an entry to the `LEAGUES` array in `worker.js` with ESPN's `sport`/`league` slug.
- Change what you own: add, remove, or edit one entry in `SERVICES` (and update `my_services_map.json` to match, for your own reference).
- Add another sport only after its scoreboard endpoint and event shape are verified. ESPN scoreboard routes tested for WWE/NXT/AEW and track and field were unavailable; TheSportsDB's Fighting calendar returned some wrestling events but no broadcast information in the sample checked.
- College men's and women's volleyball are read from ESPN's `mens-college-volleyball` and `womens-college-volleyball` scoreboards. Broadcast strings are matched against the same service rules as other sports; channels you do not subscribe to appear under Not Watchable.
- Want push notifications when Boise State goes live? That'd need Cloudflare Cron Triggers + something like a Discord/ntfy webhook — happy to build that as a follow-up if useful.