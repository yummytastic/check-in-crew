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

type TrackedAccount = { username: string; id?: string };

function trackedAccounts(series: Awaited<ReturnType<typeof config>>) {
  const accounts = new Map<string, TrackedAccount>();
  for (const item of series.series)
    for (const member of item.maintainers) {
      if (/^t2_[A-Za-z0-9]+$/.test(member.id))
        accounts.set(member.username.toLowerCase(), {
          id: member.id,
          username: member.username,
        });
    }
  for (const item of series.series) {
    const names = [
      ...(item.hostRoster ?? []),
      ...Object.values(item.hosts).flat(),
    ];
    for (const username of names) {
      const key = username.toLowerCase();
      if (!accounts.has(key)) accounts.set(key, { username });
    }
  }
  return accounts;
}

/**
 * Rechecks only identities that the app already stores. Missing users are
 * confirmed over time; API failures leave the state unchanged.
 */
export async function checkTrackedAccounts(now = new Date()): Promise<void> {
  const accounts = trackedAccounts(await config());
  const statuses = await redis.hGetAll(STATUS);
  for (const [key, account] of accounts) {
    let user;
    try {
      user = account.id
        ? await reddit.getUserById(account.id as `t2_${string}`)
        : await reddit.getUserByUsername(account.username);
    } catch {
      continue;
    }
    if (user) {
      if (statuses[key]) await redis.hDel(STATUS, [key]);
      continue;
    }

    const previous = statuses[key] ? (JSON.parse(statuses[key]!) as AccountStatus) : undefined;
    const firstMissingAt = previous?.firstMissingAt ?? now.toISOString();
    const checks = (previous?.checks ?? 0) + 1;
    const next: AccountStatus = { username: account.username, firstMissingAt, checks };
    if (
      checks >= REQUIRED_CHECKS &&
      now.getTime() - Date.parse(firstMissingAt) >= MIN_CONFIRMATION_AGE
    ) {
      try {
        await requestPersonalDataDeletion(automaticIdentity, account.username, 'DELETE');
        await redis.hDel(STATUS, [key]);
      } catch {
        // An active deletion job or transient failure is retried next tick.
      }
    } else {
      await redis.hSet(STATUS, { [key]: JSON.stringify(next) });
    }
  }
}
