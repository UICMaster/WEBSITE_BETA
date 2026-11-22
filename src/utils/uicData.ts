// src/utils/uicData.ts
import rawRosters from '../../data/data.json';
import rawTeams from '../../data/teams.json';
import rawPrimeStats from '../../data/prime_stats.json';

const rosters = (rawRosters || {}) as Record<string, any[]>;
const teams = (rawTeams || {}) as Record<string, any>;
const primeStats = (rawPrimeStats || {}) as Record<string, any>;

export const hasPrimeLeagueId = (key: string): boolean => {
  const id = teams[key]?.primeLeagueId;
  return Boolean(id !== undefined && id !== null && String(id).trim() !== '');
};

export const totalTeams = Object.keys(rosters).filter(hasPrimeLeagueId).length;

export const totalAthletes = Object.entries(rosters)
  .filter(([key]) => hasPrimeLeagueId(key))
  .reduce((acc: number, [_, r]: [string, any]) => {
    return acc + (Array.isArray(r) ? r.length : 0);
  }, 0);

export const primeTier = teams.prime?.tier || "Division 4";
export const primeTierShort = primeTier.toUpperCase().replace("DIVISION", "DIV").trim();

export const communityCount = "500+";
export const discordInviteUrl = "https://discord.gg/ultrainstinctcrew";

export interface NextMatchStarter {
  name: string;
  role: string;
}

export interface NextMatchInfo {
  mode: 'upcoming' | 'recent' | 'fallback';
  isPlayoff: boolean;
  stageLabel: string;
  headingLabel: string;
  result: string | null;
  resultOutcome: 'win' | 'loss' | 'draw' | null;
  resultBadgeLabel: 'SIEG' | 'NIEDERLAGE' | 'UNENTSCHIEDEN' | null;
  teamKey: string;
  team: string;
  teamLogo: string;
  teamTier: string;
  teamTierShort: string;
  teamLink: string | null;
  matchDay: number | null;
  matchLink: string | null;
  enemy: string;
  enemyTag: string;
  enemyLogo: string | null;
  enemyLink: string | null;
  beginISO: string | null;
  dateFormatted: string;
  timeFormatted: string;
  dateFull: string;
  confirmed: boolean;
  confirmedLabel: "Bestätigt" | "Unbestätigt";
  starters: NextMatchStarter[];
  isScheduled: boolean;
}

const now = new Date();
const liveCutoffMs = now.getTime() - 3 * 3600 * 1000;
const recentDrawCutoffMs = now.getTime() - 21 * 86400 * 1000;
const ROLE_ORDER: Record<string, number> = { TOP: 1, JGL: 2, MID: 3, BOT: 4, SUP: 5 };
const teamAssetMap = (import.meta as any).glob('/public/assets/teams/*.{webp,png,jpg,svg}');

const isPlayoffType = (typeVal: unknown): boolean =>
  /playoff|tiebreaker|relegation|promotion|final/i.test(String(typeVal || ''));

// Map every match URL / ID to its confirmation status for cross-referencing in Events.astro
export const matchLookupByUrl: Record<string, { confirmed: boolean; begin?: string; team?: string }> = {};

const allUpcomingMatches: (NextMatchInfo & { timestamp: number })[] = [];
const allCompletedMatches: (NextMatchInfo & { timestamp: number })[] = [];

for (const [teamKey, teamObj] of Object.entries(primeStats)) {
  if (!teamObj || !hasPrimeLeagueId(teamKey)) continue;
  const rawMatches = Array.isArray(teamObj.matches) ? teamObj.matches : [];
  const hasMainStage = rawMatches.some(
    (m: any) => String(m.match_type || '').toLowerCase() !== 'group'
  );
  const matches = hasMainStage
    ? rawMatches.filter((m: any) => String(m.match_type || '').toLowerCase() !== 'group')
    : rawMatches;

  const teamDisplay = teamObj.teamDisplay || `UIC ${teamKey.toUpperCase()}`;
  const teamTier = teamObj.tier || teamObj.api_meta?.division || "Prime League";
  const teamTierShort = String(teamTier).toUpperCase().replace("DIVISION", "DIV").trim();
  const teamLink = teamObj.api_meta?.prime_league_link || null;
  const hasLocalTeamWebp = `/public/assets/teams/${teamKey}.webp` in teamAssetMap;
  const hasLocalTeamPng = `/public/assets/teams/${teamKey}.png` in teamAssetMap;
  const teamLogo: string =
    teamObj.logoUrl ||
    (hasLocalTeamWebp
      ? `/assets/teams/${teamKey}.webp`
      : hasLocalTeamPng
        ? `/assets/teams/${teamKey}.png`
        : teamObj.api_meta?.logo_url || '/assets/logo/logo.svg');

  const teamRoster = [...(rosters[teamKey] || [])].sort(
    (a, b) => (ROLE_ORDER[a.role] || 99) - (ROLE_ORDER[b.role] || 99)
  );
  const starters: NextMatchStarter[] = teamRoster.slice(0, 5).map((p) => ({
    name: p.name || "Spieler",
    role: p.role || "SUB"
  }));

  for (const m of matches) {
    if (m.prime_league_link) {
      matchLookupByUrl[m.prime_league_link] = {
        confirmed: m.confirmed === true,
        begin: m.begin,
        team: teamDisplay
      };
    }

    const isPlayoff = isPlayoffType(m.match_type);
    const stageLabel = isPlayoff
      ? (m.match_day ? `PLAYOFFS • RUNDE ${m.match_day}` : 'PLAYOFFS')
      : (m.match_day ? `SPIELTAG ${m.match_day}` : 'SPIELTAG');
    const mDate = m.begin ? new Date(m.begin) : null;
    const ts = mDate ? mDate.getTime() : NaN;
    const hasValidDate = !isNaN(ts);

    if (!m.result) {
      if (hasValidDate && ts >= liveCutoffMs) {
        const isConfirmed = m.confirmed === true;
        allUpcomingMatches.push({
          timestamp: ts,
          mode: 'upcoming',
          isPlayoff,
          stageLabel,
          headingLabel: isPlayoff ? 'NÄCHSTES PLAYOFF-SPIEL' : 'NÄCHSTES SPIEL',
          result: null,
          resultOutcome: null,
          resultBadgeLabel: null,
          teamKey,
          team: teamDisplay,
          teamLogo,
          teamTier,
          teamTierShort,
          teamLink,
          matchDay: m.match_day ?? null,
          matchLink: m.prime_league_link || null,
          enemy: m.enemy_team?.name || m.enemy_team?.team_tag || "Gegner",
          enemyTag: m.enemy_team?.team_tag || "OPP",
          enemyLogo: m.enemy_team?.logo_url || null,
          enemyLink: m.enemy_team?.prime_league_link || null,
          beginISO: mDate!.toISOString(),
          dateFormatted: mDate!.toLocaleDateString('de-DE', {
            timeZone: 'Europe/Berlin',
            weekday: 'short',
            day: '2-digit',
            month: 'short'
          }),
          timeFormatted: mDate!.toLocaleTimeString('de-DE', {
            timeZone: 'Europe/Berlin',
            hour: '2-digit',
            minute: '2-digit'
          }),
          dateFull: mDate!.toLocaleString('de-DE', {
            timeZone: 'Europe/Berlin',
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          }),
          confirmed: isConfirmed,
          confirmedLabel: isConfirmed ? "Bestätigt" : "Unbestätigt",
          starters,
          isScheduled: true
        });
      } else if (!m.begin) {
        const updatedMs = m.updated_at ? new Date(m.updated_at).getTime() : 0;
        if (isPlayoff || updatedMs >= recentDrawCutoffMs) {
          allUpcomingMatches.push({
            timestamp: Number.MAX_SAFE_INTEGER - (100 - (Number(m.match_day) || 0)),
            mode: 'upcoming',
            isPlayoff,
            stageLabel,
            headingLabel: isPlayoff ? 'NÄCHSTES PLAYOFF-SPIEL' : 'NÄCHSTES SPIEL',
            result: null,
            resultOutcome: null,
            resultBadgeLabel: null,
            teamKey,
            team: teamDisplay,
            teamLogo,
            teamTier,
            teamTierShort,
            teamLink,
            matchDay: m.match_day ?? null,
            matchLink: m.prime_league_link || null,
            enemy: m.enemy_team?.name || m.enemy_team?.team_tag || "Gegner",
            enemyTag: m.enemy_team?.team_tag || "OPP",
            enemyLogo: m.enemy_team?.logo_url || null,
            enemyLink: m.enemy_team?.prime_league_link || null,
            beginISO: null,
            dateFormatted: "TERMIN OFFEN",
            timeFormatted: "--:--",
            dateFull: "Termin in Abstimmung",
            confirmed: false,
            confirmedLabel: "Unbestätigt",
            starters,
            isScheduled: false
          });
        }
      }
      continue;
    }

    if (typeof m.result === 'string' && /^\d+:\d+$/.test(m.result.trim())) {
      const [us, them] = m.result.trim().split(':').map(Number);
      const resultOutcome: 'win' | 'loss' | 'draw' =
        us > them ? 'win' : us < them ? 'loss' : 'draw';
      const resultBadgeLabel: 'SIEG' | 'NIEDERLAGE' | 'UNENTSCHIEDEN' =
        us > them ? 'SIEG' : us < them ? 'NIEDERLAGE' : 'UNENTSCHIEDEN';
      const completedTs = hasValidDate
        ? ts
        : (m.updated_at ? new Date(m.updated_at).getTime() : 0);

      allCompletedMatches.push({
        timestamp: completedTs,
        mode: 'recent',
        isPlayoff,
        stageLabel,
        headingLabel: isPlayoff ? 'LETZTES PLAYOFF-SPIEL' : 'LETZTES SPIEL',
        result: `${us} : ${them}`,
        resultOutcome,
        resultBadgeLabel,
        teamKey,
        team: teamDisplay,
        teamLogo,
        teamTier,
        teamTierShort,
        teamLink,
        matchDay: m.match_day ?? null,
        matchLink: m.prime_league_link || null,
        enemy: m.enemy_team?.name || m.enemy_team?.team_tag || "Gegner",
        enemyTag: m.enemy_team?.team_tag || "OPP",
        enemyLogo: m.enemy_team?.logo_url || null,
        enemyLink: m.enemy_team?.prime_league_link || null,
        beginISO: hasValidDate ? mDate!.toISOString() : null,
        dateFormatted: hasValidDate
          ? mDate!.toLocaleDateString('de-DE', {
              timeZone: 'Europe/Berlin',
              weekday: 'short',
              day: '2-digit',
              month: 'short'
            })
          : "GESPIELT",
        timeFormatted: hasValidDate
          ? mDate!.toLocaleTimeString('de-DE', {
              timeZone: 'Europe/Berlin',
              hour: '2-digit',
              minute: '2-digit'
            })
          : "ENDSTAND",
        dateFull: hasValidDate
          ? mDate!.toLocaleString('de-DE', {
              timeZone: 'Europe/Berlin',
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            })
          : "Abgeschlossen",
        confirmed: true,
        confirmedLabel: "Bestätigt",
        starters,
        isScheduled: false
      });
    }
  }
}

// Sort strictly chronologically across all UIC teams (earliest upcoming match first)
allUpcomingMatches.sort((a, b) => a.timestamp - b.timestamp);
allCompletedMatches.sort((a, b) => b.timestamp - a.timestamp);

const fallbackStarters: NextMatchStarter[] = (rosters.prime || []).slice(0, 5).map((p) => ({
  name: p.name || "Spieler",
  role: p.role || "SUB"
}));

export const nextMatch: NextMatchInfo =
  allUpcomingMatches[0] ||
  allCompletedMatches[0] || {
    mode: 'fallback',
    isPlayoff: false,
    stageLabel: 'SPIELTAG',
    headingLabel: 'NÄCHSTES SPIEL',
    result: null,
    resultOutcome: null,
    resultBadgeLabel: null,
    teamKey: "prime",
    team: "UIC Prime",
    teamLogo: "/assets/teams/prime.webp",
    teamTier: primeTier,
    teamTierShort: primeTierShort,
    teamLink: primeStats.prime?.api_meta?.prime_league_link || null,
    matchDay: null,
    matchLink: null,
    enemy: "Gegner offen",
    enemyTag: "OPP",
    enemyLogo: null,
    enemyLink: null,
    beginISO: null,
    dateFormatted: "DEMNÄCHST",
    timeFormatted: "--:--",
    dateFull: "Prime League Spieltag",
    confirmed: false,
    confirmedLabel: "Unbestätigt",
    starters: fallbackStarters,
    isScheduled: false
  };
