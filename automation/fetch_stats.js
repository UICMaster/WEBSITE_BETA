/**
 * automation/fetch_stats.js
 * Receiver Build: API fetching has been migrated to UIC_ANALYSES.
 * Validates incoming data.json and prunes any team removed from data/teams.json.
 */

import fs from 'node:fs';
import path from 'node:path';

const DATA_JSON_PATH = path.resolve(process.cwd(), 'data', 'data.json');
const TEAMS_JSON_PATH = path.resolve(process.cwd(), 'data', 'teams.json');

function validateSync() {
    console.log("🔄 Verifying incoming data.json synchronization...");

    if (!fs.existsSync(DATA_JSON_PATH)) {
        console.error("❌ CRITICAL ERROR: data.json was not found in the data/ folder!");
        console.error("👉 Ensure your upstream GitHub Action or sync process has correctly pushed data.json to this repository.");
        process.exit(1);
    }

    try {
        const rawContent = fs.readFileSync(DATA_JSON_PATH, 'utf-8');
        const parsedData = JSON.parse(rawContent);

        if (fs.existsSync(TEAMS_JSON_PATH)) {
            const teamsData = JSON.parse(fs.readFileSync(TEAMS_JSON_PATH, 'utf-8'));
            const activeTeamKeys = new Set(
                Object.entries(teamsData)
                    .filter(([, meta]) => Boolean(meta?.primeLeagueId && String(meta.primeLeagueId).trim() !== ''))
                    .map(([key]) => key)
            );

            const staleKeys = Object.keys(parsedData).filter((key) => !activeTeamKeys.has(key));
            if (staleKeys.length > 0) {
                for (const key of staleKeys) {
                    delete parsedData[key];
                }
                fs.writeFileSync(DATA_JSON_PATH, JSON.stringify(parsedData, null, 2));
                console.log(`🧹 Pruned teams removed from teams.json out of data.json: ${staleKeys.join(', ')}`);
            }
        }

        console.log("✅ data.json is present and verified as valid JSON.");
        console.log("\n📊 --- SYNCHRONIZED ROSTERS ---");

        for (const [teamKey, roster] of Object.entries(parsedData)) {
            if (Array.isArray(roster)) {
                console.log(`🔹 [${teamKey.toUpperCase()}] received with ${roster.length} profile tracks.`);
            }
        }

        console.log("\n🎉 Deployment assets validated successfully!");
    } catch (error) {
        console.error("❌ CRITICAL ERROR: data.json exists but contains corrupt or invalid data!");
        console.error(`👉 Details: ${error.message}`);
        process.exit(1);
    }
}

validateSync();
