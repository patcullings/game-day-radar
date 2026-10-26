# Agent guide

## Project shape

- This is a single-file Cloudflare Worker project. `worker.js` contains server-side fetch/normalization/API logic and the embedded HTML, CSS, and browser JavaScript. There is no package manifest, bundler, database, or separate frontend.
- `wrangler.toml` configures the Worker. `Dockerfile` and `docker-compose.yml` run local Wrangler on port 8787; source files are bind-mounted into the container.
- `README.md` is the user-facing deployment and feature guide. `my_services_map.json` is documentation only; runtime service matching is implemented in `worker.js`.

## Where to make changes

Most feature work belongs in `worker.js`:

- Add or change ESPN scoreboard feeds in `LEAGUES`; retain the curated allowlist.
- Add or change service matching in `SERVICES`. `matchServices()` applies those rules to broadcast names from `broadcasts[].names` and `geoBroadcasts[].media.shortName`.
- `fetchLeagueEvents()`, `normalizeEvent()`, `normalizeFormulaOneSessions()`, and `buildDashboard()` fetch, normalize, de-duplicate, and group feed data.
- The `HTML` template contains page styles and browser behavior. Frontend functions such as `renderBuckets()`, `renderScores()`, `renderTournamentSections()`, and `gameCard()` build views.
- `fetchFgcTournaments()` is the optional start.gg integration. It is separate from ESPN games and service matching.

Keep changes surgical and preserve existing behavior and API fields. Update `README.md` and `my_services_map.json` when user-visible feature or service behavior changes.

## Data sources and correctness

- ESPN's scoreboard API is undocumented. Before adding a route, sport, or broadcast rule, verify the live route and inspect real payloads, including competition shape and broadcast strings. Do not infer a subscription or local-market entitlement from a channel/team alone.
- The current ESPN feeds are deliberately curated in `LEAGUES`. Some requested categories have no verified feed; do not imply a category is covered just because a favorite or team name exists.
- ESPN event timestamps are grouped using `America/Boise`. Query date labels may be UTC-based, so preserve the actual local-date filtering when changing date handling.
- `groups=80&limit=300` on college football is intentional for the FBS/Boise State coverage.
- start.gg requires `STARTGG_API_TOKEN`, provided locally by `.dev.vars` or in Cloudflare as a Worker secret. Keep it server-side. Tournament stream names/platforms are informational and separate from service toggles; a tournament's schedule window does not prove that a stream is live.
- Do not add credentials to source, logs, examples, browser code, or chat. Never print `.dev.vars` contents.

## API and UI contracts

`GET /api/data` is the dashboard's JSON API. Preserve these existing fields unless the user explicitly requests a breaking change:

- `now`, `next`, `tonight`, `not_watchable`, and `boise_state`: server-computed for today with all services enabled.
- `games`: non-finished games today, plus finished Boise State games so Boise State can remain pinned.
- `scores`: all today's ESPN events, including completed games.
- `tomorrow_games`: games for the next Boise-local calendar date, with completed Boise State games retained.
- `services` and `favorite_teams`: browser-facing configuration/defaults.
- `fgc_tournaments` and `fgc_status`: optional start.gg tournament listings and source status.

The browser stores service toggles, favorites, and FGC filters in local storage; the server does not store those preferences. Preserve the distinction between TV-service watchability and organizer-listed FGC streams.

The API response is cached for 10 minutes. Bump `API_CACHE_VERSION` when changing the API response shape or cached data behavior so stale cached payloads do not mask the change.

## Local development and validation

Do not deploy unless the user explicitly requests it. For the local Docker dashboard, run commands from the project root:

```bash
docker compose up -d
docker compose logs --tail=100 sports-dashboard
docker compose restart sports-dashboard
docker compose down
```

After editing `worker.js`, Wrangler normally reloads the bind-mounted file. If the container is stopped, `docker compose up -d` starts it. Local URL: `http://localhost:8787/`; API: `http://localhost:8787/api/data`.

Focused checks using the Node runtime in the container:

```bash
docker compose exec -T sports-dashboard node --check worker.js
python3 -m json.tool my_services_map.json >/dev/null
```

For frontend edits, also extract the served inline script and parse it with the container's Node runtime:

```bash
curl -fsS http://127.0.0.1:8787/ \
  | python3 -c 'import re,sys; s=sys.stdin.read(); m=re.search(r"<script>(.*?)</script>",s,re.S); assert m; sys.stdout.write(m.group(1))' \
  | docker compose exec -T sports-dashboard node -e 'new Function(require("fs").readFileSync(0,"utf8")); console.log("Frontend syntax passed")'
```

Smoke-test the API without dumping credentials or large payloads:

```bash
python3 - <<'PY'
import json
from urllib.request import urlopen

with urlopen("http://127.0.0.1:8787/api/data", timeout=90) as response:
    data = json.load(response)
print({
    "date": data.get("date"),
    "tomorrow_date": data.get("tomorrow_date"),
    "games": len(data.get("games", [])),
    "tomorrow_games": len(data.get("tomorrow_games", [])),
    "scores": len(data.get("scores", [])),
    "fgc_status": data.get("fgc_status"),
    "fgc_tournaments": len(data.get("fgc_tournaments", [])),
})
PY
```

There is no configured automated test suite. Validate the changed behavior directly (API shape, Boise-local date boundaries, service matching, and browser interactions) rather than treating syntax checks as a behavior test.
