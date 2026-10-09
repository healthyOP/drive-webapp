import fs from 'node:fs/promises';
import { createLock } from '../utils/lock.js';
import { ApiError } from '../utils/errors.js';

export function createBudget(file, limits = { reads: 10000, writes: 5000, deletes: 5000 }) {
  const lock = createLock();
  const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return async function reserve(cost) {
    return lock('budget', async () => {
      let usage;
      try { usage = JSON.parse(await fs.readFile(file, 'utf8')); }
      catch (err) { if (err.code !== 'ENOENT') throw err; }
      if (!usage || usage.day !== day()) usage = { day: day(), reads: 0, writes: 0, deletes: 0 };
      for (const key of ['reads', 'writes', 'deletes']) {
        if (!Number.isFinite(usage[key])) throw new Error('Invalid budget ledger.');
        usage[key] += cost[key] || 0;
        if (usage[key] > limits[key]) throw new ApiError(503, 'DAILY_BUDGET', 'The daily database safety budget is exhausted. Try again after midnight Pacific time.');
      }
      await fs.writeFile(file + '.tmp', JSON.stringify(usage), { mode: 0o600 });
      await fs.rename(file + '.tmp', file);
    });
  };
}
