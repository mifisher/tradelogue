import type { InferInsertModel } from 'drizzle-orm';
import { setups } from './schema';

type SetupInsert = InferInsertModel<typeof setups>;
type SetupSeed = Omit<SetupInsert, 'id'>;

/**
 * Starter setup data — ONE worked example, not a playbook to trade.
 *
 * Your setups are the most personal thing in this app: they are how you
 * actually make money, and no two traders' are alike. This single entry exists
 * to show the shape the app expects (and to give the AI features something to
 * reference on a fresh install). Replace it with your own.
 *
 * Edit this file and re-run `npm run seed:setups`, or add and edit setups
 * directly in the UI at /setups. Seeding upserts on `number`, so editing a
 * setup here and re-running updates it in place rather than duplicating.
 *
 * Every field except `number` and `name` is optional — start with a name and a
 * description and fill the rest in as the pattern earns its place.
 */
export const SETUPS_DATA: SetupSeed[] = [
  {
    number: 1,
    name: 'Example — Opening Range Breakout',
    alsoCalled: 'ORB, Opening Drive Continuation',
    description: `EXAMPLE SETUP — replace with your own. A liquid name opens with a clear directional bias, then builds a defined high/low range in the first 15–30 minutes. The trade is a break out of that range in the direction of the opening drive, taken only after the range has actually formed.`,
    whyItWorks: `The opening range concentrates overnight disagreement into a visible band. Once price leaves that band on volume, the traders positioned against the move are forced to cover, which supplies the fuel for continuation. The range itself gives an unambiguous invalidation level, which is what makes the trade manageable.`,
    entryCriteria: `1. Liquid underlying with tight option spreads
2. Let the first 15–30 minutes build a clear high and low
3. Volume contracts inside the range rather than expanding (consolidation, not distribution)
4. Entry on a candle close outside the range, in the direction of the opening drive
5. Skip it entirely if the range is unusually wide — the stop will be too expensive`,
    target: `Measured move equal to the height of the opening range, projected from the breakout level. Beyond that, trail rather than target.`,
    management: `- Move the stop to break-even once the trade covers roughly half the measured move
- Take a first partial at the measured-move target
- Trail any remainder on your chosen moving average and exit on a clean break`,
    stopPlacement: `Just back inside the opposite side of the opening range. If that stop is too wide to size correctly under your outlay cap, pass the trade rather than sizing down into a stop you will not honour.`,
    idealConditions: `- A tape with a clear directional bias from the open
- Normal-to-elevated volume
- No major scheduled catalyst in the first hour`,
    watchOuts: `- On a choppy or headline-driven tape this setup produces repeated false breaks — this is exactly the situation the chop-day trade cap exists for
- A range that forms on very low volume tends to break and immediately reverse
- Do not anticipate the break; wait for the candle to close outside the range`,
  },
];
