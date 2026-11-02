import assert from 'node:assert/strict';
import test from 'node:test';
import {
  flairPostForRemovalReason,
  parseTeenGuidance,
  reasonTextMatchesTitle,
  type ModActionEvent,
  type RemovalReasonFlairDeps,
  type RemovalReasonLogEntry,
  type TeenGuidanceConfig,
} from './teen-guidance.ts';

const enabled: TeenGuidanceConfig = {
  removalReasonId: 'reason-teen',
  flairTemplateId: 'flair-teen',
  messageOverride: '',
  autoApprove: true,
  flairOnModeratorRemoval: true,
};

const event = (overrides: Partial<ModActionEvent> = {}): ModActionEvent => ({
  id: 'ModAction_1',
  action: 'addremovalreason',
  subreddit: { name: 'loseit_test' },
  moderator: { name: 'Yummytastic' },
  targetPost: { id: 't3_post' },
  ...overrides,
});

function harness(
  options: {
    config?: Partial<TeenGuidanceConfig>;
    reasons?: { id: string; title?: string }[];
    flairs?: { id: string }[];
    entry?: RemovalReasonLogEntry | undefined;
    post?: { subredditName: string; flairTemplateId?: string };
    app?: string;
  } = {}
) {
  const calls = {
    setFlair: [] as string[],
    logs: [] as { outcome: string; details: Record<string, unknown> }[],
    reddit: 0,
  };
  const post = options.post ?? {
    subredditName: 'loseit_test',
    flairTemplateId: 'flair-other',
  };
  const deps: RemovalReasonFlairDeps = {
    subredditName: 'loseit_test',
    readConfig: async () => ({ ...enabled, ...options.config }),
    appUsername: async () => {
      calls.reddit++;
      return options.app ?? 'check-in-crew';
    },
    removalReasons: async () => {
      calls.reddit++;
      return (
        options.reasons ?? [
          { id: 'reason-other', title: 'Rule 1: Be kind' },
          { id: 'reason-teen', title: 'Teenage Weightloss Guidance' },
        ]
      );
    },
    flairTemplates: async () => {
      calls.reddit++;
      return options.flairs ?? [{ id: 'flair-teen' }, { id: 'flair-other' }];
    },
    findLogEntry: async () => {
      calls.reddit++;
      return 'entry' in options
        ? options.entry
        : {
            id: 'ModAction_1',
            moderatorName: 'Yummytastic',
            details: '2: Teenage Weightloss Guidance',
            target: { id: 't3_post' },
          };
    },
    getPost: async () => {
      calls.reddit++;
      return { ...post };
    },
    setPostFlair: async (postId, templateId) => {
      calls.setFlair.push(`${postId}:${templateId}`);
      post.flairTemplateId = templateId;
    },
    log: (outcome, details) => calls.logs.push({ outcome, details }),
  };
  return { deps, calls };
}

void test('teen guidance config keeps automation off unless explicitly enabled', () => {
  assert.equal(parseTeenGuidance(undefined).flairOnModeratorRemoval, false);
  const existing = JSON.stringify({
    removalReasonId: 'r',
    flairTemplateId: 'f',
    messageOverride: '',
    autoApprove: true,
  });
  assert.equal(parseTeenGuidance(existing).flairOnModeratorRemoval, false);
  assert.equal(parseTeenGuidance(existing).autoApprove, true);
  assert.equal(
    parseTeenGuidance(JSON.stringify({ flairOnModeratorRemoval: 'yes' }))
      .flairOnModeratorRemoval,
    false
  );
  assert.equal(
    parseTeenGuidance(JSON.stringify({ flairOnModeratorRemoval: true }))
      .flairOnModeratorRemoval,
    true
  );
  assert.equal(parseTeenGuidance('{not json').flairOnModeratorRemoval, false);
});

void test('log reason text matches the title with or without a position prefix', () => {
  const title = 'Teenage Weightloss Guidance';
  assert.ok(reasonTextMatchesTitle('2: Teenage Weightloss Guidance', title));
  assert.ok(reasonTextMatchesTitle('7: Teenage Weightloss Guidance', title));
  assert.ok(reasonTextMatchesTitle('Teenage Weightloss Guidance', title));
  assert.ok(
    reasonTextMatchesTitle(' 12 :  teenage  weightloss guidance ', title)
  );
  assert.ok(!reasonTextMatchesTitle('2: Teenage Weightloss', title));
  assert.ok(
    !reasonTextMatchesTitle('2: Teenage Weightloss Guidance extra', title)
  );
  assert.ok(!reasonTextMatchesTitle(undefined, title));
  assert.ok(!reasonTextMatchesTitle('2: ', ''));
});

void test('another moderator applying the reason to a post sets the flair', async () => {
  const { deps, calls } = harness();
  assert.equal(await flairPostForRemovalReason(event(), deps), 'flaired');
  assert.deepEqual(calls.setFlair, ['t3_post:flair-teen']);
  // Diagnosis uses IDs and the logged reason title only.
  const logged = JSON.stringify(calls.logs);
  assert.match(logged, /t3_post/);
  assert.doesNotMatch(logged, /Yummytastic/);
});

void test('the reason title can come from the log description instead', async () => {
  const { deps, calls } = harness({
    entry: {
      id: 'ModAction_1',
      description: 'Teenage Weightloss Guidance',
      target: { id: 't3_post' },
    },
  });
  assert.equal(await flairPostForRemovalReason(event(), deps), 'flaired');
  assert.equal(calls.setFlair.length, 1);
});

void test('a post carrying another flair has it replaced', async () => {
  const { deps, calls } = harness({
    post: { subredditName: 'loseit_test', flairTemplateId: 'flair-other' },
  });
  assert.equal(await flairPostForRemovalReason(event(), deps), 'flaired');
  assert.deepEqual(calls.setFlair, ['t3_post:flair-teen']);
});

void test('a post with no flair receives it', async () => {
  const { deps, calls } = harness({ post: { subredditName: 'loseit_test' } });
  assert.equal(await flairPostForRemovalReason(event(), deps), 'flaired');
  assert.equal(calls.setFlair.length, 1);
});

void test('a post already carrying the selected flair is left alone', async () => {
  const { deps, calls } = harness({
    post: { subredditName: 'loseit_test', flairTemplateId: 'flair-teen' },
  });
  assert.equal(
    await flairPostForRemovalReason(event(), deps),
    'already-flaired'
  );
  assert.equal(calls.setFlair.length, 0);
});

void test('duplicate deliveries flair once', async () => {
  const { deps, calls } = harness();
  assert.equal(await flairPostForRemovalReason(event(), deps), 'flaired');
  assert.equal(
    await flairPostForRemovalReason(event(), deps),
    'already-flaired'
  );
  assert.deepEqual(calls.setFlair, ['t3_post:flair-teen']);
});

void test('a removal reason on a comment never flairs the containing post', async () => {
  const { deps, calls } = harness();
  assert.equal(
    await flairPostForRemovalReason(
      event({ targetComment: { id: 't1_comment' } }),
      deps
    ),
    'comment-target'
  );
  assert.equal(calls.setFlair.length, 0);
});

void test('a log entry for a different item is not trusted', async () => {
  const { deps, calls } = harness({
    entry: {
      id: 'ModAction_1',
      details: '2: Teenage Weightloss Guidance',
      target: { id: 't1_comment' },
    },
  });
  assert.equal(
    await flairPostForRemovalReason(event(), deps),
    'log-target-mismatch'
  );
  assert.equal(calls.setFlair.length, 0);
});

void test('a different removal reason does nothing', async () => {
  const { deps, calls } = harness({
    entry: {
      id: 'ModAction_1',
      details: '1: Rule 1: Be kind',
      target: { id: 't3_post' },
    },
  });
  assert.equal(
    await flairPostForRemovalReason(event(), deps),
    'different-reason'
  );
  assert.equal(calls.setFlair.length, 0);
});

void test('duplicate reason titles are ambiguous and skipped', async () => {
  const { deps, calls } = harness({
    reasons: [
      { id: 'reason-teen', title: 'Teenage Weightloss Guidance' },
      { id: 'reason-copy', title: 'teenage weightloss  guidance' },
    ],
  });
  assert.equal(
    await flairPostForRemovalReason(event(), deps),
    'duplicate-reason-title'
  );
  assert.equal(calls.setFlair.length, 0);
});

void test("the app's own removal-reason action is ignored", async () => {
  const byEvent = harness();
  assert.equal(
    await flairPostForRemovalReason(
      event({ moderator: { name: 'Check-In-Crew' } }),
      byEvent.deps
    ),
    'app-action'
  );
  const byLog = harness({
    entry: {
      id: 'ModAction_1',
      moderatorName: 'check-in-crew',
      details: '2: Teenage Weightloss Guidance',
      target: { id: 't3_post' },
    },
  });
  assert.equal(
    await flairPostForRemovalReason(
      event({ moderator: undefined }),
      byLog.deps
    ),
    'app-action'
  );
  assert.equal(byEvent.calls.setFlair.length + byLog.calls.setFlair.length, 0);
});

void test('unrelated moderator actions and a disabled setting make no Reddit calls', async () => {
  const unrelated = harness();
  assert.equal(
    await flairPostForRemovalReason(
      event({ action: 'removelink' }),
      unrelated.deps
    ),
    'ignored'
  );
  const disabled = harness({ config: { flairOnModeratorRemoval: false } });
  assert.equal(
    await flairPostForRemovalReason(event(), disabled.deps),
    'disabled'
  );
  for (const { calls } of [unrelated, disabled]) {
    assert.equal(calls.reddit, 0);
    assert.equal(calls.setFlair.length, 0);
    assert.equal(calls.logs.length, 0);
  }
});

void test('missing or foreign event fields are skipped', async () => {
  for (const [input, outcome] of [
    [event({ targetPost: undefined }), 'missing-post'],
    [event({ targetPost: { id: '' } }), 'missing-post'],
    [event({ targetPost: { id: 't1_comment' } }), 'missing-post'],
    [event({ subreddit: { name: 'loseit' } }), 'other-subreddit'],
  ] as const) {
    const { deps, calls } = harness();
    assert.equal(await flairPostForRemovalReason(input, deps), outcome);
    assert.equal(calls.setFlair.length, 0);
  }
});

void test('missing or stale configuration is skipped', async () => {
  const cases: [Parameters<typeof harness>[0], string][] = [
    [{ config: { removalReasonId: '' } }, 'not-configured'],
    [{ config: { flairTemplateId: '' } }, 'not-configured'],
    [{ reasons: [{ id: 'reason-other', title: 'Rule 1' }] }, 'reason-missing'],
    [{ flairs: [{ id: 'flair-other' }] }, 'flair-missing'],
  ];
  for (const [options, outcome] of cases) {
    const { deps, calls } = harness(options);
    assert.equal(await flairPostForRemovalReason(event(), deps), outcome);
    assert.equal(calls.setFlair.length, 0);
  }
});

void test('a missing log entry or a post from elsewhere is skipped', async () => {
  const noEntry = harness({ entry: undefined });
  assert.equal(
    await flairPostForRemovalReason(event(), noEntry.deps),
    'log-entry-not-found'
  );
  const elsewhere = harness({ post: { subredditName: 'loseit' } });
  assert.equal(
    await flairPostForRemovalReason(event(), elsewhere.deps),
    'post-other-subreddit'
  );
  assert.equal(
    noEntry.calls.setFlair.length + elsewhere.calls.setFlair.length,
    0
  );
});
