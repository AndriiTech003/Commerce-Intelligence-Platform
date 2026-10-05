import { loadConfig } from './config';
import { DEMO_PASSWORD, seed } from './seed-lib';

const config = loadConfig();
const reset = process.argv.includes('--reset');
const result = await seed(config, {
  reset,
  demoCampaign: !process.argv.includes('--no-campaign'),
  log: (message) => console.log(`seed: ${message}`),
});
console.log(`seed: done (${result.length} tenant(s) created). Logins use password ${DEMO_PASSWORD}.`);
process.exit(0);
