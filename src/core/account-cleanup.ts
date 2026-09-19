import { reddit, redis } from '@devvit/web/server';
import { config, type Identity } from './service.ts';
import { requestPersonalDataDeletion } from './privacy.ts';

const STATUS = 'crew:account-status:v1';
const REQUIRED_CHECKS = 3;
const MIN_CONFIRMATION_AGE = 24 * 60 * 60 * 1000;

type AccountStatus = {
  username: string;
  firstMissingAt: string;
  checks: number;
};

const automaticIdentity: Identity = {
  id: 'automatic-account-cleanup',
  username: 'check-in-crew',
  admin: true,
};

function trackedAccounts(series: Awaited<ReturnType<typeof config>>) {
  const accounts = new Map<string, string>();
  for (const item of series.series)
    for (const member of item.maintainers)
      if (/^t2_[A-Za-z0-9]+$/.test(member.id))
        accounts.set(member.id, member.username);
  return accounts;
}

/**
 * Rechecks only identities that the app already stores. Missing users are
 * confirmed over time; API failures leave the state unchanged.
 */
export async function checkTrackedAccounts(now = new Date()): Promise<void> {
  const accounts = trackedAccounts(await config());
  const statuses = await redis.hGetAll(STATUS);
  for (const [id, username] of accounts) {
    let user;
    try {
      user = await reddit.getUserById(id as `t2_${string}`);
    } catch {
      continue;
    }
    if (user) {
      if (statuses[id]) await redis.hDel(STATUS, [id]);
      continue;
    }

    const previous = statuses[id] ? (JSON.parse(statuses[id]!) as AccountStatus) : undefined;
    const firstMissingAt = previous?.firstMissingAt ?? now.toISOString();
    const checks = (previous?.checks ?? 0) + 1;
    const next: AccountStatus = { username, firstMissingAt, checks };
    if (
      checks >= REQUIRED_CHECKS &&
      now.getTime() - Date.parse(firstMissingAt) >= MIN_CONFIRMATION_AGE
    ) {
      try {
        await requestPersonalDataDeletion(automaticIdentity, username, 'DELETE');
        await redis.hDel(STATUS, [id]);
      } catch {
        // An active deletion job or transient failure is retried next tick.
      }
    } else {
      await redis.hSet(STATUS, { [id]: JSON.stringify(next) });
    }
  }
}
