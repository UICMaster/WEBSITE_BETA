// src/utils/honoredData.ts
import rawHonored from '../../data/honored.json';
import rawTeams from '../../data/teams.json';
import rawPrimeStats from '../../data/prime_stats.json';

export interface HonoredBioSection {
  subtitle?: string;
  title: string;
  paragraphs: string[];
}

export interface HonoredSeasonEntry {
  season: string;
  team: string;
  division?: string;
  note?: string;
  teamLink?: string | null;
}

export interface HonoredMilestone {
  date: string;
  label: string;
  detail?: string;
}

export interface HonoredVoiceClip {
  title: string;
  src: string;
  context?: string;
}

export interface HonoredVideo {
  title: string;
  src: string;
  description?: string;
  poster?: string;
}

export interface HonoredImageEntry {
  src: string;
  title?: string;
  caption?: string;
  date?: string;
}

export interface HonoredPlayerDossier {
  playerId: string;
  slug: string;
  name: string;
  photoSrc: string;
  title: string;
  heroIntro?: string;
  inductedAtRaw: string;
  inductedAtFormatted: string;
  primeLeagueUserId: number | null;
  primeLeagueAccountName: string | null;
  primeLeagueUserUrl: string | null;
  phrases: string[];
  bioLead?: string;
  bioSections: HonoredBioSection[];
  impact: string[];
  milestones: HonoredMilestone[];
  seasons: HonoredSeasonEntry[];
  audioTrack: HonoredVoiceClip | null;
  voiceClips: HonoredVoiceClip[];
  videos: HonoredVideo[];
  images: HonoredImageEntry[];
}

const honoredConfigMap = (rawHonored || {}) as Record<string, any>;
const teamsMeta = (rawTeams || {}) as Record<string, any>;
const primeMeta = (rawPrimeStats || {}) as Record<string, any>;
const honoredAssetMap = (import.meta as any).glob('/public/assets/honored/**/*.{webp,png,jpg,jpeg}');

export function slugifyPlayerName(name: string, fallbackId: string): string {
  const cleaned = name
    .replace(/^uic\s+/i, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallbackId.toLowerCase();
}

function formatInductedDate(raw: string): string {
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString('de-DE', {
      timeZone: 'Europe/Berlin',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }
  return raw;
}

// Discover all honored playerIds from both teams.json (honored === true) and data/honored.json
const honoredIdSet = new Set<string>(Object.keys(honoredConfigMap));

for (const team of Object.values(teamsMeta)) {
  if (team && Array.isArray(team.roster)) {
    for (const p of team.roster) {
      if (p?.honored === true && p?.playerId) {
        honoredIdSet.add(String(p.playerId));
      }
    }
  }
}

export const honoredPlayers: HonoredPlayerDossier[] = Array.from(honoredIdSet).map((playerId) => {
  const cfg = honoredConfigMap[playerId] || {};

  // Find player in teams.json for basic name fallback
  let foundRosterMeta: any = null;
  for (const tVal of Object.values(teamsMeta)) {
    const match = (tVal?.roster || []).find((mp: any) => String(mp.playerId) === playerId);
    if (match) {
      foundRosterMeta = match;
      break;
    }
  }

  // Resolve Prime League user metadata (manual config or fallback from roster match)
  let primeLeagueUserId: number | null = cfg.primeLeagueUserId ? Number(cfg.primeLeagueUserId) : null;
  let primeLeagueAccountName: string | null = cfg.primeLeagueAccountName || null;

  if (!primeLeagueUserId) {
    for (const teamData of Object.values(primeMeta)) {
      if (!teamData) continue;
      const rosterMatch = (teamData.roster || []).find(
        (rp: any) =>
          String(rp.playerId) === playerId ||
          (foundRosterMeta?.gameName &&
            rp.gameName &&
            rp.gameName.toLowerCase() === foundRosterMeta.gameName.toLowerCase())
      );
      if (rosterMatch?.api_id) {
        primeLeagueUserId = Number(rosterMatch.api_id);
        primeLeagueAccountName = rosterMatch.api_name || null;
        break;
      }
    }
  }

  const name = cfg.name || foundRosterMeta?.gameName || `Spieler #${playerId}`;
  const slug = cfg.slug || slugifyPlayerName(name, playerId);

  const honoredExtensions = ['webp', 'png', 'jpg', 'jpeg'] as const;
  let detectedHonoredAsset: string | null = null;
  for (const ext of honoredExtensions) {
    const candidates = [
      `/public/assets/honored/${playerId}/${playerId}.${ext}`,
      `/public/assets/honored/${playerId}/portrait.${ext}`,
      `/public/assets/honored/${slug}/${slug}.${ext}`,
      `/public/assets/honored/${slug}/portrait.${ext}`,
      `/public/assets/honored/${playerId}.${ext}`,
      `/public/assets/honored/${slug}.${ext}`
    ];
    const found = candidates.find((c) => c in honoredAssetMap);
    if (found) {
      detectedHonoredAsset = found.replace(/^\/public/, '');
      break;
    }
  }

  const photoSrc =
    cfg.photoSrc ||
    detectedHonoredAsset ||
    '/assets/honored/honored_placeholder.webp';

  const inductedAtRaw = cfg.inductedAt || '2026-10-28';
  const inductedAtFormatted = formatInductedDate(inductedAtRaw);

  let bioSections: HonoredBioSection[] = [];
  if (Array.isArray(cfg.bioSections) && cfg.bioSections.length > 0) {
    bioSections = cfg.bioSections.map((sec: any) => ({
      subtitle: sec.subtitle || undefined,
      title: sec.title || 'Abschnitt',
      paragraphs: Array.isArray(sec.paragraphs) ? sec.paragraphs : []
    }));
  } else if (Array.isArray(cfg.bio) && cfg.bio.length > 0) {
    bioSections = [
      {
        subtitle: 'HINTERGRUND',
        title: 'Biografie',
        paragraphs: cfg.bio
      }
    ];
  } else {
    bioSections = [
      {
        subtitle: '[Platzhalter: Untertitel]',
        title: '[Platzhalter: Überschrift]',
        paragraphs: ['[Platzhalter: Biografie-Text für dieses Mitglied in data/honored.json hinterlegen.]']
      }
    ];
  }

  const phrases: string[] = Array.isArray(cfg.phrases)
    ? cfg.phrases
    : cfg.quote
      ? [cfg.quote]
      : ['[Platzhalter: Sprüche oder Zitate in data/honored.json hinterlegen.]'];

  const impact: string[] = Array.isArray(cfg.impact)
    ? cfg.impact
    : Array.isArray(cfg.contributions)
      ? cfg.contributions
      : ['[Platzhalter: Einfluss auf die Organisation in data/honored.json hinterlegen.]'];

  const manualSeasons: HonoredSeasonEntry[] = Array.isArray(cfg.seasons)
    ? cfg.seasons.map((s: any) => ({
        season: s.season || '[Platzhalter: Split]',
        team: s.team || 'UIC',
        division: s.division || undefined,
        note: s.note || s.achievement || undefined,
        teamLink: s.teamLink || null
      }))
    : [];

  const images: HonoredImageEntry[] = Array.isArray(cfg.images) ? cfg.images : [];

  const voiceClips: HonoredVoiceClip[] = Array.isArray(cfg.voiceClips)
    ? cfg.voiceClips
    : cfg.audioTrack && cfg.audioTrack.src
      ? [cfg.audioTrack]
      : [];

  const audioTrack: HonoredVoiceClip | null =
    cfg.audioTrack && cfg.audioTrack.src
      ? cfg.audioTrack
      : voiceClips[0] || null;

  return {
    playerId,
    slug,
    name,
    photoSrc,
    title: cfg.title || '[Platzhalter: Funktion / Rolle in der Organisation]',
    heroIntro: cfg.heroIntro || undefined,
    inductedAtRaw,
    inductedAtFormatted,
    primeLeagueUserId,
    primeLeagueAccountName,
    primeLeagueUserUrl: primeLeagueUserId
      ? `https://www.primeleague.gg/de/users/${primeLeagueUserId}`
      : null,
    phrases,
    bioLead: cfg.bioLead || undefined,
    bioSections,
    impact,
    milestones: Array.isArray(cfg.milestones) ? cfg.milestones : [],
    seasons: manualSeasons,
    audioTrack,
    voiceClips,
    videos: Array.isArray(cfg.videos) ? cfg.videos : [],
    images
  };
});

export function getHonoredHref(playerId: string, playerName: string): string {
  const existing = honoredPlayers.find((hp) => hp.playerId === String(playerId));
  if (existing) {
    return `/ruhmeshalle/${existing.slug}`;
  }
  return `/ruhmeshalle/${slugifyPlayerName(playerName, String(playerId))}`;
}
