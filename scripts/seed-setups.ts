import 'dotenv/config';
import { db } from '../src/db';
import { setups } from '../src/db/schema';
import { SETUPS_DATA } from '../src/db/seed-setups';

async function main() {
  console.log(`Seeding ${SETUPS_DATA.length} setups...`);

  for (const setup of SETUPS_DATA) {
    await db
      .insert(setups)
      .values(setup)
      .onConflictDoUpdate({
        target: setups.number,
        set: {
          name: setup.name,
          alsoCalled: setup.alsoCalled,
          description: setup.description,
          whyItWorks: setup.whyItWorks,
          entryCriteria: setup.entryCriteria,
          target: setup.target,
          management: setup.management,
          stopPlacement: setup.stopPlacement,
          idealConditions: setup.idealConditions,
          watchOuts: setup.watchOuts,
        },
      });
    console.log(`  Upserted setup ${setup.number}: ${setup.name}`);
  }

  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
