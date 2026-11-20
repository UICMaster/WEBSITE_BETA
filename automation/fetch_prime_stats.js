import fs from 'node:fs';
import path from 'node:path';

// --- PATHS & HEADERS ---
const INPUT_PATH = path.resolve(process.cwd(), 'data', 'teams.json');
const OUTPUT_PATH = path.resolve(process.cwd(), 'data', 'prime_stats.json');
const HEADERS = {
    'User-Agent': 'UIC-Data-Warehouse/1.0',
    'Accept': 'application/json'
};

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 750;

// --- HELPERS ---
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Resilient JSON fetch with timeout and exponential backoff on transient failures
async function fetchJsonWithRetry(url, { retries = MAX_RETRIES, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, {
                headers: HEADERS,
                signal: AbortSignal.timeout(timeoutMs)
            });

            if (response.ok) {
                return await response.json();
            }

            const isRetryable = response.status === 429 || response.status >= 500;
            lastError = new Error(`HTTP ${response.status} ${response.statusText || ''}`.trim());

            if (!isRetryable || attempt === retries) {
                throw lastError;
            }

            const retryAfterSec = Number(response.headers.get('retry-after'));
            const delayMs =
                Number.isFinite(retryAfterSec) && retryAfterSec > 0
                    ? Math.min(retryAfterSec * 1000, 10_000)
                    : RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);

            console.warn(`⏳ Retry ${attempt}/${retries - 1} for ${url} after ${lastError.message} (${delayMs}ms)...`);
            await sleep(delayMs);
        } catch (err) {
            lastError = err;
            if (attempt === retries) {
                throw lastError;
            }
            const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
            console.warn(`⏳ Retry ${attempt}/${retries - 1} for ${url} after error "${err.message}" (${delayMs}ms)...`);
            await sleep(delayMs);
        }
    }
    throw lastError;
}

// Helper to safely match Riot IDs between API and Local JSON
function isSamePlayer(apiSummonerName, localPlayer) {
    if (!apiSummonerName || !localPlayer || !localPlayer.gameName) return false;

    const apiClean = apiSummonerName.toLowerCase().trim();
    const localNameClean = localPlayer.gameName.toLowerCase().trim();

    const hasTag = !!localPlayer.tagLine;
    const localCombined = hasTag
        ? `${localPlayer.gameName}#${localPlayer.tagLine}`.toLowerCase().trim()
        : localNameClean;

    // 1. Exact match with full Riot ID (e.g. "uic speedy#euw" === "uic speedy#euw")
    if (apiClean === localCombined) return true;

    // 2. Exact match with just gameName (e.g. "uic speedy" === "uic speedy")
    if (apiClean === localNameClean) return true;

    // 3. API has tag, but we only check the prefix (e.g. "uic speedy#euw" matches "uic speedy")
    if (apiClean.split('#')[0].trim() === localNameClean) return true;

    return false;
}

function mergeRosterWithFallback(localRoster, prevRoster) {
    const prevList = Array.isArray(prevRoster) ? prevRoster : [];
    return (localRoster || []).map((localPlayer) => {
        const prevMatch = prevList.find(
            (p) =>
                (localPlayer.playerId && p.playerId === localPlayer.playerId) ||
                isSamePlayer(p.gameName, localPlayer)
        );
        return {
            ...localPlayer,
            api_id: prevMatch?.api_id ?? null,
            isCaptain: prevMatch?.isCaptain ?? localPlayer.isCaptain,
            api_name: prevMatch?.api_name ?? null,
            in_api_roster: prevMatch?.in_api_roster ?? false
        };
    });
}

async function buildGoldenJSON() {
    console.log("🚀 Starting Golden Prime League Sync...");
    const localTeamsData = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
    const goldenDatabase = {};

    // Load previous prime_stats.json for per-team error fallback & enemy logo caching
    let existingData = {};
    const enemyLogoCache = new Map();
    const prevMatchMetaCache = new Map();

    if (fs.existsSync(OUTPUT_PATH)) {
        try {
            existingData = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')) || {};
            for (const teamObj of Object.values(existingData)) {
                for (const match of (teamObj?.matches || [])) {
                    const eId = match?.enemy_team?.id;
                    const eLogo = match?.enemy_team?.logo_url;
                    if (eId && eLogo) {
                        enemyLogoCache.set(eId, eLogo);
                    }
                    if (match?.id != null) {
                        prevMatchMetaCache.set(match.id, {
                            confirmed: Boolean(match.confirmed),
                            enemyLogoUrl: eLogo || null
                        });
                    }
                }
            }
        } catch {
            existingData = {};
        }
    }

    // Track active teams strictly from data/teams.json (removed teams are automatically purged)
    const activeEntries = Object.entries(localTeamsData).filter(([teamKey, info]) => {
        const teamId = info?.primeLeagueId;
        if (!teamId || String(teamId).trim() === "") {
            console.log(`⚠️ Skipping ${teamKey} (No Prime League ID).`);
            return false;
        }
        return true;
    });

    const activeKeys = new Set(activeEntries.map(([k]) => k));
    const removedKeys = Object.keys(existingData).filter((k) => !activeKeys.has(k));
    if (removedKeys.length > 0) {
        console.log(`🧹 Removing teams no longer present in teams.json: ${removedKeys.join(', ')}`);
    }

    let succeededCount = 0;
    let failedCount = 0;

    for (const [teamKey, localTeamInfo] of activeEntries) {
        const teamId = String(localTeamInfo.primeLeagueId).trim();
        const prevTeam = existingData[teamKey];
        const hasValidPrevForSameId =
            prevTeam &&
            String(prevTeam.primeLeagueId || '').trim() === teamId &&
            prevTeam.api_meta !== null;

        console.log(`📡 Fetching data for: ${localTeamInfo.teamDisplay || teamKey} (ID: ${teamId})...`);

        // Base structure inheriting local teams.json metadata
        goldenDatabase[teamKey] = {
            ...localTeamInfo,
            api_meta: null,
            roster: [...(localTeamInfo.roster || [])],
            matches: []
        };

        try {
            const apiData = await fetchJsonWithRetry(`https://primebot.me/api/v1/teams/${teamId}/`);

            // 1. INHERIT LATEST API META DATA
            goldenDatabase[teamKey].api_meta = {
                id: apiData.id,
                name: apiData.name,
                team_tag: apiData.team_tag,
                division: apiData.division,
                logo_url: apiData.logo_url,
                prime_league_link: apiData.prime_league_link,
                updated_at: apiData.updated_at
            };

            // 2. MERGE ROSTERS (Local Data + API Data)
            const apiPlayers = apiData.players || [];

            goldenDatabase[teamKey].roster = goldenDatabase[teamKey].roster.map((localPlayer) => {
                const apiMatch = apiPlayers.find((p) => isSamePlayer(p.summoner_name, localPlayer));
                return {
                    ...localPlayer,
                    api_id: apiMatch ? apiMatch.id : null,
                    isCaptain: apiMatch ? apiMatch.is_leader : localPlayer.isCaptain,
                    api_name: apiMatch ? apiMatch.name : null,
                    in_api_roster: !!apiMatch
                };
            });

            apiPlayers.forEach((apiPlayer) => {
                const existsLocally = goldenDatabase[teamKey].roster.find((localPlayer) =>
                    isSamePlayer(apiPlayer.summoner_name, localPlayer)
                );
                if (!existsLocally) {
                    goldenDatabase[teamKey].roster.push({
                        playerId: "UNKNOWN_LOCAL",
                        gameName: apiPlayer.summoner_name,
                        role: "UNKNOWN",
                        rosterStatus: "api_only",
                        isCaptain: apiPlayer.is_leader,
                        api_id: apiPlayer.id,
                        in_api_roster: true,
                        missing_in_local: true
                    });
                }
            });

            // 3. INHERIT AND FORMAT ALL LATEST MATCHES
            if (Array.isArray(apiData.matches)) {
                const enrichedMatches = [];

                for (const m of apiData.matches) {
                    const prevMeta = prevMatchMetaCache.get(m.id);
                    let isConfirmed = prevMeta?.confirmed ?? false;
                    const enemyId = m.enemy_team?.id ?? null;
                    let enemyLogoUrl =
                        m.enemy_team?.logo_url ||
                        (enemyId ? enemyLogoCache.get(enemyId) : null) ||
                        prevMeta?.enemyLogoUrl ||
                        null;

                    if (m.result) {
                        isConfirmed = true;
                        if (enemyId && !enemyLogoCache.has(enemyId)) {
                            try {
                                const matchDetail = await fetchJsonWithRetry(
                                    `https://primebot.me/api/v1/matches/${m.id}/`,
                                    { retries: 2, timeoutMs: 10_000 }
                                );
                                enemyLogoUrl = matchDetail.enemy_team?.logo_url || enemyLogoUrl || null;
                                if (enemyLogoUrl) {
                                    enemyLogoCache.set(enemyId, enemyLogoUrl);
                                }
                                await sleep(150);
                            } catch (err) {
                                console.warn(`⚠️ Could not fetch enemy logo for match ${m.id}: ${err.message}`);
                            }
                        }
                    } else {
                        try {
                            const matchDetail = await fetchJsonWithRetry(
                                `https://primebot.me/api/v1/matches/${m.id}/`,
                                { retries: 2, timeoutMs: 10_000 }
                            );
                            isConfirmed = matchDetail.match_begin_confirmed === true;
                            enemyLogoUrl = matchDetail.enemy_team?.logo_url || enemyLogoUrl || null;
                            if (enemyId && enemyLogoUrl) {
                                enemyLogoCache.set(enemyId, enemyLogoUrl);
                            }
                            await sleep(200);
                        } catch (err) {
                            console.warn(`⚠️ Could not fetch confirmation status for match ${m.id}: ${err.message}`);
                        }
                    }

                    enrichedMatches.push({
                        id: m.id,
                        match_id: m.match_id,
                        match_type: m.match_type,
                        match_day: m.match_day,
                        begin: m.begin,
                        confirmed: isConfirmed,
                        result: m.result || null,
                        prime_league_link: m.prime_league_link,
                        updated_at: m.updated_at,
                        enemy_team: m.enemy_team
                            ? {
                                  id: m.enemy_team.id,
                                  name: m.enemy_team.name,
                                  team_tag: m.enemy_team.team_tag,
                                  prime_league_link: m.enemy_team.prime_league_link,
                                  logo_url: enemyLogoUrl
                              }
                            : null,
                        team_lineup: m.team_lineup || []
                    });
                }

                goldenDatabase[teamKey].matches = enrichedMatches;
            }

            succeededCount++;
            console.log(`✅ ${teamKey}: synced (${goldenDatabase[teamKey].matches.length} matches)`);
        } catch (e) {
            failedCount++;
            console.error(`❌ Error fetching data for ${teamKey}:`, e.message);

            // Fail-safe: retain previous valid API data for this team instead of wiping it
            if (hasValidPrevForSameId) {
                goldenDatabase[teamKey] = {
                    ...localTeamInfo,
                    api_meta: prevTeam.api_meta,
                    roster: mergeRosterWithFallback(localTeamInfo.roster, prevTeam.roster),
                    matches: Array.isArray(prevTeam.matches) ? prevTeam.matches : []
                };
                console.warn(
                    `🛡️ Preserved previous cached Prime League data for ${teamKey} (${goldenDatabase[teamKey].matches.length} matches).`
                );
            }
        }

        // Respect API rate limits between team calls
        await sleep(250);
    }

    const totalAttempted = activeEntries.length;

    // Global Outage Guard: if PrimeBot API is completely unreachable or >50% of calls failed,
    // do not overwrite an intact prime_stats.json unless teams were removed from teams.json.
    if (totalAttempted > 0 && failedCount > totalAttempted / 2) {
        if (removedKeys.length > 0 && Object.keys(existingData).length > 0) {
            // Still prune removed teams while preserving all remaining cached teams
            fs.writeFileSync(OUTPUT_PATH, JSON.stringify(goldenDatabase, null, 2));
            console.error(
                `⛔ PrimeBot API outage detected (${failedCount}/${totalAttempted} failed). Pruned removed teams while preserving remaining cached data.`
            );
            process.exit(1);
        }
        console.error(
            `⛔ Aborting write: PrimeBot API outage detected (${failedCount}/${totalAttempted} teams failed). Existing prime_stats.json left untouched.`
        );
        process.exit(1);
    }

    // Write the Golden JSON (strictly containing only active teams from teams.json)
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(goldenDatabase, null, 2));
    console.log(
        `✅ Golden Data successfully built (${succeededCount}/${totalAttempted} fresh, ${failedCount} preserved from cache): ${OUTPUT_PATH}`
    );
}

buildGoldenJSON().catch((err) => {
    console.error("💥 Fatal Error:", err);
    process.exit(1);
});
