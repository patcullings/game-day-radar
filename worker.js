/**
 * "What Sports Can I Actually Watch Today?" — Cloudflare Worker
 *
 * Single-file backend + frontend. No DB, no build step.
 * Deploy instructions are in README.md.
 */

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

const TIMEZONE = 'America/Boise';
const FAVORITE_TEAMS = [
  'Arizona Cardinals',
  'Boise State Broncos',
  'AC Boise',
  'Athletic Club Boise',
  'Idaho Steelheads',
  'Boise Hawks',
];
const PRIME_VIDEO_LOCAL_TEAMS = ['Seattle Kraken'];

// Leagues to poll. `usFriendly:false` doesn't hide a league, it just sorts
// it after US leagues within a bucket (per "don't hide everything" rule).
const LEAGUES = [
  { sport: 'baseball',   league: 'mlb',              name: 'MLB',                usFriendly: true  },
  { sport: 'basketball', league: 'wnba',              name: 'WNBA',               usFriendly: true  },
  { sport: 'basketball', league: 'nba',               name: 'NBA',                usFriendly: true  },
  { sport: 'basketball', league: 'mens-college-basketball',   name: "Men's College Basketball",   usFriendly: true },
  { sport: 'basketball', league: 'womens-college-basketball', name: "Women's College Basketball", usFriendly: true },
  { sport: 'volleyball', league: 'mens-college-volleyball',   name: "Men's College Volleyball",   usFriendly: true },
  { sport: 'volleyball', league: 'womens-college-volleyball', name: "Women's College Volleyball", usFriendly: true },
  { sport: 'football',   league: 'nfl',               name: 'NFL',                usFriendly: true  },
  { sport: 'football',   league: 'college-football',  name: 'College Football',  usFriendly: true, extraParams: '&groups=80&limit=300' },
  { sport: 'hockey',     league: 'nhl',                name: 'NHL',               usFriendly: true  },
  { sport: 'racing',     league: 'f1',                 name: 'Formula 1',          usFriendly: false },
  { sport: 'soccer',     league: 'usa.1',              name: 'MLS',               usFriendly: true  },
  { sport: 'soccer',     league: 'usa.nwsl',           name: 'NWSL',              usFriendly: true  },
  { sport: 'soccer',     league: 'eng.1',              name: 'Premier League',    usFriendly: false },
  { sport: 'soccer',     league: 'esp.1',              name: 'La Liga',           usFriendly: false },
  { sport: 'soccer',     league: 'ger.1',              name: 'Bundesliga',        usFriendly: false },
  { sport: 'soccer',     league: 'fra.1',              name: 'Ligue 1',           usFriendly: false },
  { sport: 'soccer',     league: 'uefa.champions',     name: 'Champions League',  usFriendly: false },
];

const ANTENNA_NETWORKS = new Set(['ABC', 'CBS', 'NBC', 'FOX', 'CW', 'ION']);
const ANTENNA_CHANNELS = {
  ABC: { station: 'KIVI 6', network: 'ABC' },
  CBS: { station: 'KBOI 2', network: 'CBS' },
  NBC: { station: 'KTVB 7', network: 'NBC' },
  FOX: { station: 'KNIN 9', network: 'Fox' },
  CW: { station: 'Boise', network: 'CW' },
  ION: { station: 'Boise', network: 'ION' },
};

const SERVICES = [
  {
    id: 'antenna',
    name: 'Antenna',
    service: 'Antenna',
    match: (low, upper) => ANTENNA_NETWORKS.has(upper) &&
      !low.includes('+') && !low.includes('paramount') && !low.includes('peacock'),
    label: (raw) => {
      const channel = ANTENNA_CHANNELS[raw.toUpperCase()];
      const localWarning = raw.toUpperCase() === 'CBS' ? '; local game unconfirmed' : '';
      return `Antenna (${channel.network} ${channel.station}${localWarning})`;
    },
    link: null,
    defaultEnabled: true,
  },
  {
    id: 'paramount-plus',
    name: 'Paramount+ Essential',
    service: 'Paramount+',
    match: (low) => low.includes('paramount+'),
    exclude: (low) => low.includes('showtime'),
    label: () => 'Paramount+',
    link: 'https://www.paramountplus.com/live-tv/',
    defaultEnabled: true,
  },
  {
    id: 'peacock',
    name: 'Peacock Premium',
    service: 'Peacock',
    match: (low) => low.includes('peacock'),
    label: () => 'Peacock',
    link: 'https://www.peacocktv.com/',
    defaultEnabled: true,
  },
  {
    id: 'prime-video',
    name: 'Prime Video',
    service: 'Prime Video',
    match: (low, upper, context) => {
      if (!low.includes('prime video') && low !== 'prime' && !low.includes('amazon')) return false;
      if (!low.includes('local')) return true;
      return PRIME_VIDEO_LOCAL_TEAMS.some(team =>
        team.toLowerCase() === (context && context.homeTeam || '').toLowerCase()
      );
    },
    label: (raw) => /local/i.test(raw) ? 'Prime Video (Local)' : 'Prime Video',
    link: 'https://www.amazon.com/gp/video/storefront',
    defaultEnabled: true,
  },
  {
    id: 'mlb-tv',
    name: 'MLB.TV',
    service: 'MLB.TV',
    match: (low) => low.includes('mlb.tv'),
    label: () => 'MLB.TV',
    link: 'https://www.mlb.com/live-stream-games',
    defaultEnabled: true,
  },
  {
    id: 'youtube',
    name: 'YouTube (free streams)',
    service: 'YouTube',
    match: (low) => low.includes('youtube'),
    label: () => 'YouTube',
    link: 'https://www.youtube.com/',
    defaultEnabled: true,
  },
  {
    id: 'apple-tv',
    name: 'Apple TV',
    service: 'Apple TV',
    match: (low) => low === 'apple tv',
    label: () => 'Apple TV',
    link: 'https://tv.apple.com/',
    defaultEnabled: true,
  },
  {
    id: 'tubi',
    name: 'Tubi (free)',
    service: 'Tubi',
    match: (low) => low.includes('tubi'),
    label: () => 'Tubi',
    link: 'https://tubitv.com/',
    defaultEnabled: true,
  },
];

const CACHE_TTL_SECONDS = 600; // 10 minutes
const API_CACHE_VERSION = '14';

const STARTGG_TOURNAMENT_QUERY = `
  query UpcomingFgcTournaments($afterDate: Timestamp!, $beforeDate: Timestamp!) {
    tournaments(query: {
      perPage: 50
      page: 1
      filter: { afterDate: $afterDate, beforeDate: $beforeDate }
    }) {
      nodes {
        name
        slug
        startAt
        endAt
        streams { streamName streamSource }
        events {
          name
          videogame { name }
        }
      }
    }
  }
`;

const FGC_GAME_TERMS = [
  'smash', 'street fighter', 'tekken', 'guilty gear', 'mortal kombat',
  'dragon ball fighterz', 'king of fighters', 'granblue', 'under night',
  'blazblue', 'marvel vs', 'fatal fury', 'brawlhalla', 'rivals of aether',
  'virtua fighter', 'soulcalibur', 'dead or alive',
];

async function fetchFgcTournaments(env) {
  if (!env.STARTGG_API_TOKEN) return { status: 'not_configured', tournaments: [] };

  const nowSeconds = Math.floor(Date.now() / 1000);
  const afterSeconds = nowSeconds - 24 * 60 * 60;
  const beforeSeconds = nowSeconds + 7 * 24 * 60 * 60;
  try {
    const response = await fetch('https://api.start.gg/gql/alpha', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.STARTGG_API_TOKEN}`,
      },
      body: JSON.stringify({
        query: STARTGG_TOURNAMENT_QUERY,
        variables: { afterDate: afterSeconds, beforeDate: beforeSeconds },
      }),
    });
    if (!response.ok) {
      console.error(`start.gg request failed with status ${response.status}.`);
      return { status: 'unavailable', tournaments: [] };
    }

    const result = await response.json();
    if (result.errors?.length) {
      console.error('start.gg returned GraphQL errors:', result.errors);
      return { status: 'unavailable', tournaments: [] };
    }

    const tournaments = (result.data?.tournaments?.nodes || [])
      .map((tournament) => {
        const events = (tournament.events || [])
          .filter(event => FGC_GAME_TERMS.some(term =>
            String(event.videogame?.name || '').toLowerCase().includes(term)))
          .map(event => ({
            name: event.name,
            game: event.videogame?.name || 'Fighting game',
          }));
        if (!events.length || !tournament.startAt) return null;
        return {
          name: tournament.name,
          url: `https://www.start.gg/${tournament.slug}`,
          startTimeISO: new Date(tournament.startAt * 1000).toISOString(),
          endTimeISO: tournament.endAt
            ? new Date(tournament.endAt * 1000).toISOString()
            : null,
          games: events,
          streams: (tournament.streams || [])
            .filter(stream => stream.streamName)
            .map(stream => ({
              name: stream.streamName,
              source: stream.streamSource || '',
            })),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.startTimeISO.localeCompare(b.startTimeISO));
    return { status: 'ok', tournaments };
  } catch (error) {
    console.error('Could not load FGC tournaments from start.gg.', error);
    return { status: 'unavailable', tournaments: [] };
  }
}

// ---------------------------------------------------------------------------
// BROADCAST -> SERVICE MATCHING (strict, per user's rules)
// ---------------------------------------------------------------------------

function matchServices(rawNames, context = {}) {
  const matched = [];
  const seen = new Set();

  for (const raw of rawNames) {
    if (!raw) continue;
    const s = String(raw).trim();
    const low = s.toLowerCase();
    const upper = s.toUpperCase();

    for (const service of SERVICES) {
      if (!service.match(low, upper, context)) continue;
      if (service.exclude && service.exclude(low)) break;

      if (!seen.has(service.id)) {
        matched.push({
          service: service.service,
          serviceId: service.id,
          label: service.label(s),
          link: service.link,
        });
        seen.add(service.id);
      }
      break;
    }
  }

  return matched;
}

function collectBroadcastNames(competition) {
  const names = [];
  if (Array.isArray(competition.broadcasts)) {
    for (const b of competition.broadcasts) {
      if (Array.isArray(b.names)) names.push(...b.names);
    }
  }
  if (Array.isArray(competition.geoBroadcasts)) {
    for (const gb of competition.geoBroadcasts) {
      if (gb.media && gb.media.shortName) names.push(gb.media.shortName);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// TIME HELPERS (America/Boise)
// ---------------------------------------------------------------------------

function boiseDateKey(dateInput) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(dateInput)); // "YYYY-MM-DD"
}

function boiseDateKeyToCompact(key) {
  return key.replaceAll('-', ''); // "YYYYMMDD"
}

function addDaysToKey(key, days) {
  const d = new Date(`${key}T12:00:00Z`); // noon UTC avoids DST edge issues
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function boiseTimeLabel(dateInput) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
  }).format(new Date(dateInput));
}

function zonedDateTimeToISO(dateKey, hour, minute, timeZone) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]));
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    guess += target - represented;
  }
  return new Date(guess).toISOString();
}

function scheduledNxtEvents(todayKey) {
  const [year, month, day] = todayKey.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (weekday !== 2) return [];

  const startTimeISO = zonedDateTimeToISO(todayKey, 20, 0, 'America/New_York');
  const endTimeISO = zonedDateTimeToISO(todayKey, 22, 0, 'America/New_York');
  const broadcastNames = ['CW'];
  return [{
    id: `wwe-nxt-${todayKey}`,
    league: 'wwe-nxt',
    leagueName: 'WWE NXT',
    usFriendly: true,
    state: new Date() >= new Date(endTimeISO) ? 'post'
      : new Date() >= new Date(startTimeISO) ? 'in' : 'pre',
    statusDetail: 'Scheduled on The CW',
    startTimeISO,
    endTimeISO,
    startTimeLabel: boiseTimeLabel(startTimeISO),
    eventName: 'WWE NXT',
    sessionName: 'Weekly broadcast',
    isScheduledEvent: true,
    awayTeam: '',
    awayTeamFull: '',
    awayScore: null,
    homeTeam: '',
    homeTeamFull: '',
    homeScore: null,
    watchable: matchServices(broadcastNames),
    rawBroadcasts: broadcastNames,
    isBoiseState: false,
  }];
}

// ---------------------------------------------------------------------------
// ESPN FETCH
// ---------------------------------------------------------------------------

async function fetchLeagueEvents(leagueCfg, dateCompactStrs) {
  const all = [];
  await Promise.all(dateCompactStrs.map(async (d) => {
    let url = `https://site.api.espn.com/apis/site/v2/sports/${leagueCfg.sport}/${leagueCfg.league}/scoreboard?dates=${d}`;
    if (leagueCfg.extraParams) url += leagueCfg.extraParams;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (dashboard-worker)' } });
      if (!res.ok) return;
      const json = await res.json();
      if (Array.isArray(json.events)) {
        for (const ev of json.events) all.push({ ev, leagueCfg });
      }
    } catch (e) {
      // Swallow per-league errors so one bad endpoint doesn't kill the dashboard.
    }
  }));
  return all;
}

// ---------------------------------------------------------------------------
// CORE BUILD
// ---------------------------------------------------------------------------

function normalizeEvent(ev, leagueCfg) {
  const comp = ev.competitions && ev.competitions[0];
  if (!comp) return null;

  const statusType = (comp.status && comp.status.type) || (ev.status && ev.status.type) || {};
  const state = statusType.state || 'pre'; // 'pre' | 'in' | 'post'

  const competitors = comp.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home') || competitors[0] || {};
  const away = competitors.find(c => c.homeAway === 'away') || competitors[1] || {};

  const teamName = (c) => (c.team && (c.team.shortDisplayName || c.team.displayName || c.team.name)) || 'TBD';
  const fullTeamName = (c) => (c.team && (c.team.displayName || c.team.name)) || 'TBD';
  const isBoiseState = (c) => {
    const n = (c.team && (c.team.displayName || c.team.name || '')) || '';
    return n.toLowerCase().includes('boise state');
  };

  const broadcastNames = collectBroadcastNames(comp);
  const watchable = matchServices(broadcastNames, { homeTeam: fullTeamName(home) });

  return {
    id: ev.id,
    league: leagueCfg.league,
    leagueName: leagueCfg.name,
    usFriendly: leagueCfg.usFriendly,
    state,
    statusDetail: statusType.shortDetail || statusType.detail || '',
    startTimeISO: ev.date,
    startTimeLabel: boiseTimeLabel(ev.date),
    awayTeam: teamName(away),
    awayTeamFull: fullTeamName(away),
    awayScore: away.score ?? null,
    homeTeam: teamName(home),
    homeTeamFull: fullTeamName(home),
    homeScore: home.score ?? null,
    watchable,
    rawBroadcasts: broadcastNames,
    isBoiseState: isBoiseState(home) || isBoiseState(away),
  };
}

function normalizeFormulaOneSessions(ev, leagueCfg) {
  const sessions = ev.competitions || [];
  return sessions.map((competition) => {
    const statusType = competition.status && competition.status.type || {};
    const sessionName = competition.type &&
      (competition.type.abbreviation || competition.type.name) || 'Session';
    const broadcastNames = collectBroadcastNames(competition);

    return {
      id: `${ev.id}-${competition.id}`,
      league: leagueCfg.league,
      leagueName: leagueCfg.name,
      eventName: ev.name,
      sessionName,
      isScheduledEvent: true,
      usFriendly: leagueCfg.usFriendly,
      state: statusType.state || 'pre',
      statusDetail: statusType.shortDetail || statusType.detail || '',
      startTimeISO: competition.date,
      startTimeLabel: boiseTimeLabel(competition.date),
      awayTeam: '',
      awayScore: null,
      homeTeam: '',
      homeScore: null,
      watchable: matchServices(broadcastNames),
      rawBroadcasts: broadcastNames,
      isBoiseState: false,
    };
  }).filter(session => session.startTimeISO);
}

async function buildDashboard(env) {
  const todayKey = boiseDateKey(new Date());
  const dateKeys = [addDaysToKey(todayKey, -1), todayKey, addDaysToKey(todayKey, 1)];
  const dateCompact = dateKeys.map(boiseDateKeyToCompact);

  const [leagueResults, fgcResult] = await Promise.all([
    Promise.all(LEAGUES.map(cfg => fetchLeagueEvents(cfg, dateCompact))),
    fetchFgcTournaments(env),
  ]);

  const seenIds = new Set();
  const games = [];
  const tomorrowGames = [];
  const tomorrowKey = addDaysToKey(todayKey, 1);
  for (const list of leagueResults) {
    for (const { ev, leagueCfg } of list) {
      const normalizedGames = leagueCfg.league === 'f1'
        ? normalizeFormulaOneSessions(ev, leagueCfg)
        : [normalizeEvent(ev, leagueCfg)];
      for (const g of normalizedGames) {
        if (!g) continue;
        const key = `${leagueCfg.league}-${g.id}`;
        if (seenIds.has(key)) continue;
        seenIds.add(key);
        const gameDate = boiseDateKey(g.startTimeISO);
        if (gameDate === todayKey) games.push(g);
        else if (gameDate === tomorrowKey) tomorrowGames.push(g);
      }
    }
  }

  games.push(...scheduledNxtEvents(todayKey));
  tomorrowGames.push(...scheduledNxtEvents(tomorrowKey));

  const now = new Date();
  const nowMs = now.getTime();
  const threeHoursMs = 3 * 60 * 60 * 1000;

  const boiseState = [];
  const liveNow = [];
  const nextUp = [];
  const tonight = [];
  const notWatchable = [];

  for (const g of games) {
    if (g.isBoiseState) {
      boiseState.push(g);
      continue; // pinned bucket only, per "always pin to top"
    }
    if (g.state === 'post') continue; // don't clutter with finished games

    const isWatchable = g.watchable.length > 0;
    const startMs = new Date(g.startTimeISO).getTime();

    if (!isWatchable) {
      notWatchable.push(g);
      continue;
    }

    if (g.state === 'in') {
      liveNow.push(g);
    } else if (g.state === 'pre' && startMs - nowMs <= threeHoursMs) {
      nextUp.push(g);
    } else {
      tonight.push(g);
    }
  }

  const byTime = (a, b) => new Date(a.startTimeISO) - new Date(b.startTimeISO);
  const byFriendlyThenTime = (a, b) => {
    if (a.usFriendly !== b.usFriendly) return a.usFriendly ? -1 : 1;
    return byTime(a, b);
  };

  boiseState.sort(byTime);
  liveNow.sort(byTime);
  nextUp.sort(byTime);
  tonight.sort(byTime);
  notWatchable.sort(byFriendlyThenTime);
  tomorrowGames.sort(byTime);

  return {
    generated_at: now.toISOString(),
    timezone: TIMEZONE,
    date: todayKey,
    tomorrow_date: tomorrowKey,
    services: SERVICES.map(({ id, name, link, defaultEnabled }) => ({
      id,
      name,
      link,
      defaultEnabled,
    })),
    favorite_teams: FAVORITE_TEAMS,
    boise_state: boiseState,
    now: liveNow,
    next: nextUp,
    tonight: tonight,
    not_watchable: notWatchable,
    games: games.filter(g => g.state !== 'post' || g.isBoiseState),
    scores: games,
    tomorrow_games: tomorrowGames.filter(g => g.state !== 'post' || g.isBoiseState),
    fgc_tournaments: fgcResult.tournaments,
    fgc_status: fgcResult.status,
  };
}

// ---------------------------------------------------------------------------
// HTTP HANDLERS
// ---------------------------------------------------------------------------

async function handleApi(request, env, ctx) {
  const cache = caches.default;
  const cacheUrl = new URL(request.url);
  cacheUrl.searchParams.set('cache-version', API_CACHE_VERSION);
  cacheUrl.searchParams.set('startgg', env.STARTGG_API_TOKEN ? 'enabled' : 'disabled');
  const cacheKey = new Request(cacheUrl, request);
  let response = await cache.match(cacheKey);
  if (response) return response;

  const data = await buildDashboard(env);
  response = new Response(JSON.stringify(data), {
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
      'Access-Control-Allow-Origin': '*',
    },
  });
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/data') {
      return handleApi(request, env, ctx);
    }
    return new Response(HTML, { headers: { 'content-type': 'text/html; charset=UTF-8' } });
  },
};

// ---------------------------------------------------------------------------
// FRONTEND (single static HTML file, ultra-minimal, TV-friendly)
// ---------------------------------------------------------------------------

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>What Can I Watch Today?</title>
<style>
  :root {
    --bg: #0b0d12;
    --card: #151922;
    --card-border: #262c3a;
    --text: #e9edf5;
    --muted: #8b93a7;
    --accent: #4fd1c5;
    --boise-blue: #0033a0;
    --boise-orange: #d64309;
    --live: #ff4b4b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    padding: 24px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 24px;
  }
  h1 { font-size: clamp(22px, 3vw, 34px); margin: 0; }
  .subtitle { color: var(--muted); font-size: 14px; }
  .service-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin: 14px 0 4px;
  }
  .service-settings {
    margin: 0 0 18px;
    padding: 10px 14px;
  }
  .service-settings summary {
    min-height: 28px;
    display: flex;
    align-items: center;
    cursor: pointer;
    color: #fff;
    font-weight: 700;
  }
  .service-settings summary:focus-visible {
    outline: 4px solid #fff;
    outline-offset: 3px;
    border-radius: 4px;
  }
  .service-summary-state {
    margin-left: 8px;
    color: var(--muted);
    font-size: 13px;
    font-weight: 500;
  }
  .service-toggle {
    min-height: 56px;
    min-width: 170px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 14px;
    padding: 10px 14px;
    border: 2px solid #737d91;
    border-radius: 10px;
    background: #252c3a;
    color: #fff;
    font: inherit;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
  }
  .service-toggle[aria-pressed="true"] {
    border-color: #70e3d8;
    background: #123d3a;
  }
  .service-toggle[aria-pressed="false"] {
    border-color: #aab1bf;
    background: #303541;
    color: #f0f1f4;
  }
  .service-toggle:focus-visible {
    outline: 4px solid #fff;
    outline-offset: 3px;
  }
  .view-controls {
    display: flex;
    gap: 10px;
    margin: 0 0 18px;
  }
  .view-button {
    min-height: 48px;
    padding: 10px 18px;
    border: 2px solid #737d91;
    border-radius: 10px;
    background: #252c3a;
    color: #fff;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .view-button[aria-pressed="true"] {
    border-color: #70e3d8;
    background: #123d3a;
  }
  .view-button:focus-visible {
    outline: 4px solid #fff;
    outline-offset: 3px;
  }
  .fgc-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 0 0 16px;
  }
  .fgc-filter {
    min-height: 44px;
    padding: 8px 14px;
    border: 2px solid #737d91;
    border-radius: 9px;
    background: #252c3a;
    color: #fff;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .fgc-filter[aria-pressed="true"] {
    border-color: #70e3d8;
    background: #123d3a;
  }
  .fgc-filter:focus-visible {
    outline: 4px solid #fff;
    outline-offset: 3px;
  }
  .fgc-day-today h2 { color: #ffd166; }
  .fgc-day-tomorrow h2 { color: #8ec5ff; }
  .toggle-state {
    min-width: 52px;
    padding: 4px 7px;
    border-radius: 6px;
    background: #fff;
    color: #10201f;
    text-align: center;
    font-size: 13px;
  }
  .service-toggle[aria-pressed="false"] .toggle-state {
    background: #e2e4e9;
    color: #16181d;
  }
  section { margin-bottom: 32px; }
  h2 {
    font-size: clamp(16px, 2vw, 20px);
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--muted);
    border-bottom: 1px solid var(--card-border);
    padding-bottom: 8px;
    margin-bottom: 14px;
  }
  h2.live { color: var(--live); }
  h2.boise { color: var(--boise-orange); }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 14px;
  }
  .card {
    background: var(--card);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    padding: 16px 18px;
    position: relative;
  }
  .card.boise-card {
    border-color: var(--boise-orange);
    background: linear-gradient(135deg, #151922 60%, #1a1420 100%);
  }
  .league-tag {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--accent);
    font-weight: 600;
  }
  .matchup {
    font-size: clamp(17px, 2.2vw, 20px);
    font-weight: 600;
    margin: 6px 0 4px;
  }
  .favorite-toggle {
    border: 0;
    padding: 0 2px;
    background: transparent;
    color: #ffd166;
    font: inherit;
    font-size: 0.9em;
    line-height: 1;
    cursor: pointer;
    vertical-align: 0.05em;
  }
  .favorite-toggle[aria-pressed="false"] { color: #9aa3b5; }
  .favorite-toggle:focus-visible {
    outline: 3px solid #fff;
    outline-offset: 2px;
    border-radius: 3px;
  }
  .score { color: var(--muted); font-weight: 400; }
  .meta { font-size: 13px; color: var(--muted); margin-bottom: 10px; }
  .live-badge {
    display: inline-block;
    background: var(--live);
    color: white;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 20px;
    margin-left: 8px;
    vertical-align: middle;
  }
  .watch-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .watch-pill {
    background: rgba(79, 209, 197, 0.12);
    border: 1px solid var(--accent);
    color: var(--accent);
    font-size: 12.5px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 20px;
    text-decoration: none;
  }
  .watch-pill:hover { background: rgba(79, 209, 197, 0.25); }
  .empty { color: var(--muted); font-style: italic; padding: 8px 0 0; }
  .availability-note {
    color: #fff;
    font-size: 14px;
    font-weight: 700;
    padding-top: 6px;
  }
  .availability-detail {
    display: block;
    color: #d0d5df;
    font-size: 13px;
    font-weight: 500;
    margin-top: 4px;
  }
  details {
    background: var(--card);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    padding: 12px 18px;
  }
  .fgc-upcoming { margin-bottom: 32px; }
  details summary {
    cursor: pointer;
    color: var(--muted);
    font-weight: 600;
  }
  details .grid { margin-top: 14px; }
  .not-watch-card { opacity: 0.75; }
  .not-watch-card .matchup { font-size: 15px; }
  footer {
    margin-top: 40px;
    color: var(--muted);
    font-size: 13px;
    text-align: center;
  }
  .loading { color: var(--muted); padding: 40px 0; text-align: center; }
</style>
</head>
<body>
<header>
  <h1>📺 What Can I Watch Today?</h1>
  <div class="subtitle">Choose which services are available to you today.</div>
</header>

<nav class="view-controls" aria-label="Dashboard view">
  <button type="button" class="view-button" data-view="watch" aria-pressed="true">What Can I Watch?</button>
  <button type="button" class="view-button" data-view="tomorrow" aria-pressed="false">Tomorrow's Feed</button>
  <button type="button" class="view-button" data-view="scores" aria-pressed="false">Today's Scores</button>
</nav>

<details class="service-settings">
  <summary>Available services <span id="service-summary-state" class="service-summary-state"></span></summary>
  <div id="service-toggles" class="service-controls" aria-label="Available services"></div>
</details>
<div id="app"><div class="loading">Loading today's games…</div></div>

<footer id="footer"></footer>

<script>
const REFRESH_MS = 10 * 60 * 1000;
const REEVALUATE_MS = 60 * 1000;
const STORAGE_KEY = 'sports-dashboard-enabled-services';
const FAVORITES_STORAGE_KEY = 'sports-dashboard-favorite-teams';
const FGC_FILTERS_STORAGE_KEY = 'sports-dashboard-fgc-filters';
let lastData = null;
let enabledServices = {};
let serviceStateInitialized = false;
let activeView = 'watch';
let favoriteTeams = new Set();
let favoriteStateInitialized = false;
let fgcFilters = { game: 'all', streamsOnly: false };
let fgcFiltersInitialized = false;

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function watchPills(watchable) {
  if (!watchable || watchable.length === 0) return '<span class="empty">Not on anything you have</span>';
  return '<div class="watch-list">' + watchable.map(w => {
    const tag = w.link ? 'a' : 'span';
    const href = w.link ? ' href="' + esc(w.link) + '" target="_blank" rel="noopener"' : '';
    return '<' + tag + ' class="watch-pill"' + href + '>' + esc(w.label) + '</' + tag + '>';
  }).join('') + '</div>';
}

function teamLabel(name, fullName) {
  const favoriteName = fullName || name;
  const isFavorite = favoriteTeams.has(favoriteName.toLowerCase()) ||
    favoriteTeams.has(name.toLowerCase());
  return esc(name) + ' <button type="button" class="favorite-toggle" data-team="' +
    esc(favoriteName) + '" aria-pressed="' + String(isFavorite) + '" aria-label="' +
    (isFavorite ? 'Remove ' + esc(favoriteName) + ' from favorites' : 'Add ' + esc(favoriteName) + ' to favorites') +
    '" title="' + (isFavorite ? 'Remove from favorites' : 'Add to favorites') + '">' +
    (isFavorite ? '★' : '☆') + '</button>';
}

function broadcastDetails(game) {
  const broadcasts = [...new Set((game.rawBroadcasts || [])
    .map(name => String(name).trim())
    .filter(Boolean))];
  return '<span class="availability-detail">Broadcasts listed: ' +
    esc(broadcasts.length ? broadcasts.join(', ') : 'No broadcast information listed by ESPN') +
    '</span>';
}

function gameCard(g, opts) {
  opts = opts || {};
  const scoreLine = !g.isScheduledEvent && (g.state === 'in' || g.state === 'post')
    ? '<span class="score"> ' + (g.awayScore ?? '-') + ' – ' + (g.homeScore ?? '-') + '</span>'
    : '';
  const liveBadge = g.state === 'in' || g.scheduledStartPassed
    ? '<span class="live-badge">LIVE</span>'
    : '';
  const cardClass = 'card' + (opts.boise ? ' boise-card' : '') + (opts.dim ? ' not-watch-card' : '');
  const availability = opts.scores
    ? ''
    : opts.availabilityMessage
    ? '<div class="availability-note">' + esc(opts.availabilityMessage) +
      (opts.unavailableReason ? '<span class="availability-detail">' + esc(opts.unavailableReason) + '</span>' : '') +
      broadcastDetails(g) +
      '</div>'
    : opts.dim
      ? '<div class="availability-note">' +
        esc(opts.unavailableReason || 'Not on anything you have') +
        broadcastDetails(g) +
        '</div>'
      : watchPills(g.watchable);
  return '<div class="' + cardClass + '">' +
    '<div class="league-tag">' + esc(g.leagueName) + '</div>' +
    '<div class="matchup">' +
      (g.isScheduledEvent
        ? esc(g.eventName) + ' · ' + esc(g.sessionName)
        : teamLabel(g.awayTeam, g.awayTeamFull) + ' @ ' + teamLabel(g.homeTeam, g.homeTeamFull)) +
      scoreLine + liveBadge + '</div>' +
    '<div class="meta">' + esc(g.startTimeLabel) + (g.statusDetail ? ' &middot; ' + esc(g.statusDetail) : '') + '</div>' +
    availability +
  '</div>';
}

function section(title, games, opts) {
  if (!games || games.length === 0) return '';
  const getOptions = typeof opts === 'function' ? opts : () => opts || {};
  const headerClass = typeof opts === 'function' ? '' : opts && opts.headerClass;
  const cls = headerClass ? ' class="' + headerClass + '"' : '';
  return '<section><h2' + cls + '>' + esc(title) + '</h2><div class="grid">' +
    games.map(g => gameCard(g, getOptions(g))).join('') +
  '</div></section>';
}

function tournamentStreamLink(stream) {
  const name = String(stream.name || '').trim();
  const source = String(stream.source || '').toUpperCase();
  if (/^https:\\/\\/(www\\.)?(twitch\\.tv|youtube\\.com|youtu\\.be)\\//i.test(name)) return name;
  if (source === 'TWITCH' && /^[A-Za-z0-9_]{4,25}$/.test(name)) {
    return 'https://www.twitch.tv/' + encodeURIComponent(name);
  }
  if (source === 'YOUTUBE' && name) {
    return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(name);
  }
  return '';
}

function boiseDayKey(dateInput) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Boise', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(dateInput));
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal')
    .map(part => [part.type, part.value]));
  return values.year + '-' + values.month + '-' + values.day;
}

function addDayKey(dayKey, amount) {
  const date = new Date(dayKey + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function initializeFgcFilters() {
  if (fgcFiltersInitialized) return;
  try {
    const saved = JSON.parse(localStorage.getItem(FGC_FILTERS_STORAGE_KEY) || 'null');
    if (saved && ['all', 'smash', 'other'].includes(saved.game) &&
        typeof saved.streamsOnly === 'boolean') {
      fgcFilters = saved;
    }
  } catch (error) {
    console.warn('Could not read saved FGC filters; using defaults.', error);
  }
  fgcFiltersInitialized = true;
}

function saveFgcFilters() {
  try {
    localStorage.setItem(FGC_FILTERS_STORAGE_KEY, JSON.stringify(fgcFilters));
  } catch (error) {
    console.warn('Could not save FGC filters; current filters still work for this page.', error);
  }
}

function tournamentMatchesFilters(tournament) {
  const isSmash = tournament.games.some(game => game.game.toLowerCase().includes('smash'));
  if (fgcFilters.game === 'smash' && !isSmash) return false;
  if (fgcFilters.game === 'other' && isSmash) return false;
  if (fgcFilters.streamsOnly && !(tournament.streams || []).length) return false;
  return true;
}

function fgcFilterControls() {
  return '<nav class="fgc-filters" aria-label="FGC tournament filters">' +
    '<button type="button" class="fgc-filter" data-fgc-game="all" aria-pressed="' +
    String(fgcFilters.game === 'all') + '">All games</button>' +
    '<button type="button" class="fgc-filter" data-fgc-game="smash" aria-pressed="' +
    String(fgcFilters.game === 'smash') + '">Smash</button>' +
    '<button type="button" class="fgc-filter" data-fgc-game="other" aria-pressed="' +
    String(fgcFilters.game === 'other') + '">Other FGC</button>' +
    '<button type="button" class="fgc-filter" data-fgc-streams-only="true" aria-pressed="' +
    String(fgcFilters.streamsOnly) + '">Streams only: ' +
    (fgcFilters.streamsOnly ? 'ON' : 'OFF') + '</button></nav>';
}

function tournamentCard(tournament, nowMs) {
  const startMs = new Date(tournament.startTimeISO).getTime();
  const endMs = tournament.endTimeISO ? new Date(tournament.endTimeISO).getTime() : NaN;
  const scheduledActive = startMs <= nowMs && Number.isFinite(endMs) && nowMs <= endMs;
  const start = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Boise', weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(tournament.startTimeISO));
  const gameNames = tournament.games
    .map(game => esc(game.game) + ': ' + esc(game.name))
    .join(' · ');
  const streamItems = (tournament.streams || []).map(stream => {
    const link = tournamentStreamLink(stream);
    const label = esc(stream.source ? stream.source + ': ' + stream.name : stream.name);
    return link
      ? '<a class="watch-pill" href="' + esc(link) + '" target="_blank" rel="noopener">' + label + '</a>'
      : '<span class="watch-pill">' + label + '</span>';
  }).join('');
  const streamDetails = streamItems
    ? '<div class="availability-detail">Organizer-listed streams (independent of service toggles):</div>' +
      '<div class="watch-list">' + streamItems + '</div>'
    : '<div class="availability-detail">No stream listed on start.gg</div>';
  return '<article class="card">' +
    '<div class="league-tag">' + (scheduledActive ? 'FGC Tournament · Scheduled active window' : 'FGC Tournament') + '</div>' +
    '<div class="matchup"><a href="' + esc(tournament.url) +
    '" target="_blank" rel="noopener">' + esc(tournament.name) + '</a></div>' +
    '<div class="meta">' + esc(start) + (scheduledActive ? ' · Start.gg schedule indicates it may be in progress' : '') + '</div>' +
    '<div class="availability-detail">' + gameNames + '</div>' + streamDetails + '</article>';
}

function renderTournamentSections(includeUpcoming, selectedDay) {
  if (!lastData) return '';
  if (lastData.fgc_status === 'unavailable') {
    return '<div class="loading">FGC tournament data could not be refreshed. The rest of the dashboard is available; it will retry on the next data refresh.</div>';
  }
  if (lastData.fgc_status !== 'ok') return '';
  const availableTournaments = lastData.fgc_tournaments || [];
  if (!availableTournaments.length) {
    return fgcFilterControls() +
      '<div class="loading">No listed FGC tournaments found for the next 7 days.</div>';
  }
  const tournaments = availableTournaments.filter(tournamentMatchesFilters);
  if (!tournaments.length) {
    return fgcFilterControls() +
      '<div class="loading">No tournaments match these FGC filters for the selected dates.</div>';
  }
  const nowMs = Date.now();
  const todayKey = boiseDayKey(nowMs);
  const tomorrowKey = addDayKey(todayKey, 1);
  const byDate = (a, b) => a.startTimeISO.localeCompare(b.startTimeISO);
  selectedDay = selectedDay || todayKey;
  const selectedDayLabel = selectedDay === tomorrowKey ? 'Tomorrow' : 'Today';
  const today = tournaments.filter(t => boiseDayKey(t.startTimeISO) === selectedDay).sort(byDate);
  const laterKey = addDayKey(selectedDay, 1);
  const tomorrow = tournaments.filter(t => boiseDayKey(t.startTimeISO) === laterKey).sort(byDate);
  const later = tournaments.filter(t => boiseDayKey(t.startTimeISO) > laterKey).sort(byDate);
  let html = '';
  html += fgcFilterControls();
  if (today.length) {
    html += '<section class="fgc-day-today"><h2>' + selectedDayLabel + ' · FGC Tournaments (' +
      today.length + ')</h2><div class="grid">' +
      today.map(tournament => tournamentCard(tournament, nowMs)).join('') + '</div></section>';
  }
  if (tomorrow.length) {
    html += '<section class="fgc-day-tomorrow"><h2>' + (selectedDay === todayKey ? 'Tomorrow' : 'Following day') + ' · FGC Tournaments (' +
      tomorrow.length + ')</h2><div class="grid">' +
      tomorrow.map(tournament => tournamentCard(tournament, nowMs)).join('') + '</div></section>';
  }
  if (includeUpcoming && later.length) {
    html += '<details class="fgc-upcoming"><summary>Later this week · FGC Tournaments (' +
      later.length + ')</summary><div class="grid">' +
      later.map(tournament => tournamentCard(tournament, nowMs)).join('') + '</div></details>';
  }
  return html;
}

function initializeServiceState(services) {
  if (!serviceStateInitialized) {
    let saved = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          saved = parsed;
        } else {
          console.warn('Saved service preferences were invalid; using defaults.');
        }
      }
    } catch (error) {
      console.warn('Could not read saved service preferences; using defaults.', error);
    }

    for (const service of services) {
      enabledServices[service.id] = typeof saved[service.id] === 'boolean'
        ? saved[service.id]
        : service.defaultEnabled;
    }
    serviceStateInitialized = true;
    return;
  }

  const ids = new Set(services.map(service => service.id));
  for (const id of Object.keys(enabledServices)) {
    if (!ids.has(id)) delete enabledServices[id];
  }
  for (const service of services) {
    if (typeof enabledServices[service.id] !== 'boolean') {
      enabledServices[service.id] = service.defaultEnabled;
    }
  }
}

function saveServiceState(services) {
  const saved = {};
  for (const service of services) saved[service.id] = enabledServices[service.id];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch (error) {
    console.warn('Could not save service preferences; current toggles still work for this page.', error);
  }
}

function updateServiceToggleStates() {
  const services = lastData?.services || [];
  const enabledCount = services.filter(service => enabledServices[service.id]).length;
  document.getElementById('service-summary-state').textContent =
    enabledCount + ' of ' + services.length + ' on';
  document.querySelectorAll('.service-toggle').forEach(button => {
    const enabled = enabledServices[button.dataset.serviceId];
    button.setAttribute('aria-pressed', String(enabled));
    button.querySelector('.toggle-state').textContent = enabled ? 'ON' : 'OFF';
  });
}

function renderServiceControls(services) {
  const controls = document.getElementById('service-toggles');
  controls.innerHTML = services.map(service => {
    const enabled = enabledServices[service.id];
    return '<button type="button" class="service-toggle" data-service-id="' + esc(service.id) +
      '" aria-pressed="' + String(enabled) + '">' +
      '<span>' + esc(service.name) + '</span>' +
      '<span class="toggle-state">' + (enabled ? 'ON' : 'OFF') + '</span>' +
      '</button>';
  }).join('');

  controls.querySelectorAll('.service-toggle').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.dataset.serviceId;
      if (!Object.prototype.hasOwnProperty.call(enabledServices, id)) return;
      enabledServices[id] = !enabledServices[id];
      updateServiceToggleStates();
      saveServiceState(lastData.services);
      renderActiveView();
    });
  });
  updateServiceToggleStates();
}

function disabledServiceReason(game) {
  const disabled = game.watchable.filter(option => !enabledServices[option.serviceId]);
  if (disabled.length === 0) return '';
  const names = disabled.map(option => {
    const service = lastData.services.find(item => item.id === option.serviceId);
    return service ? service.name : option.service;
  });
  return 'On ' + names.join(', ') + ' (toggled off)';
}

function renderBuckets(games, dayTitle) {
  if (!lastData) return;

  const boiseState = [];
  const liveNow = [];
  const nextUp = [];
  const tonight = [];
  const notWatchable = [];
  const nowMs = Date.now();
  const threeHoursMs = 3 * 60 * 60 * 1000;

  for (const game of games) {
    const watchable = game.watchable.filter(option => enabledServices[option.serviceId]);
    const visibleGame = {
      ...game,
      watchable,
      unavailableReason: disabledServiceReason(game),
    };

    if (game.isBoiseState) {
      boiseState.push(visibleGame);
      continue;
    }
    if (game.state === 'post') continue;

    if (watchable.length === 0) {
      notWatchable.push({ ...visibleGame, unavailableReason: disabledServiceReason(game) });
      continue;
    }

    const startMs = new Date(game.startTimeISO).getTime();
    const scheduledStartPassed = game.state === 'pre' && startMs <= nowMs;
    if (game.state === 'in' || scheduledStartPassed) {
      liveNow.push({ ...visibleGame, scheduledStartPassed });
    } else if (game.state === 'pre' && startMs - nowMs <= threeHoursMs) {
      nextUp.push(visibleGame);
    } else {
      tonight.push(visibleGame);
    }
  }

  const byTime = (a, b) => new Date(a.startTimeISO) - new Date(b.startTimeISO);
  const byFriendlyThenTime = (a, b) => {
    if (a.usFriendly !== b.usFriendly) return a.usFriendly ? -1 : 1;
    return byTime(a, b);
  };
  boiseState.sort(byTime);
  liveNow.sort(byTime);
  nextUp.sort(byTime);
  tonight.sort(byTime);
  notWatchable.sort(byFriendlyThenTime);

  let html = '';
  if (dayTitle === 'Tomorrow') {
    html += renderTournamentSections(true, lastData.tomorrow_date);
  } else {
    html += renderTournamentSections(true, lastData.date);
  }
  html += section('🔶 Boise State ' + dayTitle, boiseState, game => ({
    boise: true,
    availabilityMessage: game.watchable.length ? '' : 'Not available with your current services',
    unavailableReason: game.unavailableReason,
  }));
  html += section(dayTitle === 'Tomorrow' ? '🔴 Live Now · Tomorrow' : '🔴 Live Now', liveNow, { headerClass: 'live' });
  html += section('⏭️ Next Up (within 3 hours)', nextUp);
  html += section(dayTitle === 'Tomorrow' ? '🌙 Later Tomorrow' : '🌙 Tonight / Later Today', tonight);

  if (notWatchable.length > 0) {
    html += '<details><summary>Happening but NOT watchable for you (' + notWatchable.length + ')</summary>' +
      '<div class="grid">' + notWatchable.map(g => gameCard(g, {
        dim: true,
        unavailableReason: g.unavailableReason || 'Not on anything you have',
      })).join('') + '</div>' +
    '</details>';
  }

  if (!boiseState.length && !liveNow.length && !nextUp.length && !tonight.length && !notWatchable.length) {
    html += '<div class="loading">No games found for ' + esc(dayTitle.toLowerCase()) + '. Check back later.</div>';
  }

  document.getElementById('app').innerHTML = html;
  updateFooter();
}

function renderScores() {
  if (!lastData) return;
  initializeFgcFilters();
  const grouped = new Map();
  for (const game of lastData.scores || []) {
    if (!grouped.has(game.leagueName)) grouped.set(game.leagueName, []);
    grouped.get(game.leagueName).push(game);
  }
  const groups = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [, games] of groups) {
    games.sort((a, b) => new Date(a.startTimeISO) - new Date(b.startTimeISO));
  }
  const tournamentSection = lastData.fgc_status === 'not_configured'
    ? '<div class="loading">To enable FGC tournaments, add your start.gg API token to the local <code>.dev.vars</code> file. See README.md.</div>'
    : lastData.fgc_status === 'unavailable'
      ? '<div class="loading">FGC tournament data could not be refreshed. ESPN data remains available; it will retry on the next data refresh.</div>'
      : renderTournamentSections(true);
  const html = tournamentSection + groups.map(([sport, games]) =>
    section(sport + ' (' + games.length + ')', games, { scores: true })
  ).join('') || '<div class="loading">No games or events found for today.</div>';
  document.getElementById('app').innerHTML = html;
  updateFooter();
}

function renderActiveView() {
  document.querySelectorAll('.view-button').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.view === activeView));
  });
  if (activeView === 'scores') renderScores();
  else if (activeView === 'tomorrow') renderBuckets(lastData.tomorrow_games || [], 'Tomorrow');
  else renderBuckets(lastData.games || [], 'Today');
}

function initializeFavoriteTeams(defaults) {
  if (favoriteStateInitialized) return;
  favoriteTeams = new Set(defaults.map(team => team.toLowerCase()));
  try {
    const saved = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (saved !== null) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.every(team => typeof team === 'string')) {
        favoriteTeams = new Set(parsed.map(team => team.toLowerCase()));
      } else {
        console.warn('Saved favorite teams were invalid; using defaults.');
      }
    }
  } catch (error) {
    console.warn('Could not read saved favorite teams; using defaults.', error);
  }
  favoriteStateInitialized = true;
}

function saveFavoriteTeams() {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...favoriteTeams]));
  } catch (error) {
    console.warn('Could not save favorite teams; current highlights still work for this page.', error);
  }
}

function render(data) {
  lastData = data;
  initializeFgcFilters();
  initializeFavoriteTeams(data.favorite_teams || []);
  initializeServiceState(data.services);
  renderServiceControls(data.services);
  renderActiveView();
}

document.querySelectorAll('.view-button').forEach(button => {
  button.addEventListener('click', () => {
    activeView = button.dataset.view;
    renderActiveView();
  });
});

document.getElementById('app').addEventListener('click', event => {
  const fgcGameFilter = event.target.closest('.fgc-filter[data-fgc-game]');
  const fgcStreamFilter = event.target.closest('.fgc-filter[data-fgc-streams-only]');
  if (fgcGameFilter) {
    fgcFilters.game = fgcGameFilter.dataset.fgcGame;
    saveFgcFilters();
    renderActiveView();
    return;
  }
  if (fgcStreamFilter) {
    fgcFilters.streamsOnly = !fgcFilters.streamsOnly;
    saveFgcFilters();
    renderActiveView();
    return;
  }
  const button = event.target.closest('.favorite-toggle');
  if (!button) return;
  const team = button.dataset.team;
  if (!team) return;
  const key = team.toLowerCase();
  if (favoriteTeams.has(key)) favoriteTeams.delete(key);
  else favoriteTeams.add(key);
  saveFavoriteTeams();
  renderActiveView();
});

function updateFooter() {
  if (!lastData) return;
  const mins = Math.max(0, Math.round((Date.now() - new Date(lastData.generated_at).getTime()) / 60000));
  document.getElementById('footer').textContent =
    'Last updated ' + mins + ' min' + (mins === 1 ? '' : 's') +
    ' ago  ·  Data via ESPN' + (lastData.fgc_status === 'ok' ? ' and start.gg' : '');
}

async function load() {
  try {
    const res = await fetch('/api/data');
    if (!res.ok) throw new Error('API request failed with status ' + res.status);
    const data = await res.json();
    render(data);
  } catch (error) {
    console.error('Could not load games from /api/data.', error);
    document.getElementById('app').innerHTML = '<div class="loading">Couldn\\'t load games right now.</div>';
  }
}

load();
setInterval(load, REFRESH_MS);
setInterval(() => {
  if (activeView === 'scores') renderScores();
  else if (activeView === 'tomorrow') renderBuckets(lastData?.tomorrow_games || [], 'Tomorrow');
  else renderBuckets(lastData?.games || [], 'Today');
}, REEVALUATE_MS);
setInterval(updateFooter, 30000);
</script>
</body>
</html>`;