import type { APIRoute } from 'astro';
import rawPrimeStats from '../../../data/prime_stats.json';
import rawTeams from '../../../data/teams.json';

const rawMap = (rawPrimeStats || {}) as Record<string, any>;
const teamsMap = (rawTeams || {}) as Record<string, any>;
const hasPrimeLeagueId = (key: string, teamObj?: any): boolean => {
  const id = teamsMap[key]?.primeLeagueId ?? teamObj?.primeLeagueId;
  return Boolean(id !== undefined && id !== null && String(id).trim() !== '');
};

const publicPrimeStats: Record<string, any> = {};

for (const [key, pTeam] of Object.entries(rawMap)) {
  if (!pTeam || !hasPrimeLeagueId(key, pTeam)) continue;
  publicPrimeStats[key] = {
    teamDisplay: pTeam.teamDisplay,
    tier: pTeam.tier,
    api_meta: pTeam.api_meta
      ? {
          logo_url: pTeam.api_meta.logo_url,
          name: pTeam.api_meta.name,
          team_tag: pTeam.api_meta.team_tag
        }
      : null,
    matches: (pTeam.matches || []).map((m: any) => ({
      id: m.id || m.match_id,
      match_day: m.match_day,
      begin: m.begin,
      confirmed: !!m.confirmed,
      result: m.result || null,
      enemy_team: m.enemy_team
        ? {
            name: m.enemy_team.name || m.enemy_team.team_tag || 'Gegner',
            team_tag: m.enemy_team.team_tag || 'OPP',
            logo_url: m.enemy_team.logo_url || '/assets/logo/logo.png'
          }
        : null
    }))
  };
}

export const GET: APIRoute = () => {
  return new Response(JSON.stringify(publicPrimeStats), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache'
    }
  });
};

