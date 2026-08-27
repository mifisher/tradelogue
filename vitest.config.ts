import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    // Pin the tunables so the suite is hermetic: src/lib/config.ts reads these
    // at module load, and without pinning, a developer's own .env would change
    // what the rules and timezone tests assert. These mirror the shipped
    // defaults — if you change a default in config.ts, change it here too.
    env: {
      NEXT_PUBLIC_TRADING_TIMEZONE: 'America/New_York',
      RULE_OUTLAY_CAP: '1000',
      RULE_REENTRY_PAUSE_MIN: '10',
      RULE_CIRCUIT_BREAKER: '-500',
      RULE_CHOP_TRADE_CAP: '3',
      RULE_SESSION_OPEN_HOUR: '10',
    },
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
