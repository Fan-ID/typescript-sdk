#!/usr/bin/env node
/**
 * Run from package root after `npm run build`:
 *
 *   node --env-file=examples/.env examples/list-paid-campaigns.mjs
 *
 * (Requires Node 20.6+ for --env-file.) Or export SOUNDLINK_* in the shell first.
 */
import {
  AuthenticationError,
  listPaidCampaigns,
  SoundlinkError,
} from "../dist/index.mjs";

async function main() {
  const { data, error } = await listPaidCampaigns({
    page: 1,
    pageSize: 10,
    sortBy: "createdAt",
    sortOrder: "desc",
  });

  if (error) {
    if (error instanceof AuthenticationError) {
      console.error("Auth failed:", error.message);
      process.exit(1);
    }
    if (error instanceof SoundlinkError) {
      console.error(
        `API error [${error.code}] (${error.status}):`,
        error.message,
      );
      process.exit(1);
    }
    throw error;
  }

  console.log(JSON.stringify(data, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
