import { Hono } from 'hono';
import { context, reddit, settings } from '@devvit/web/server';
import {
  flairDefaults,
  formatDefaults,
  renderFlair,
  type FlairConfig,
  type FlairValue,
} from '../tools/flair.ts';

const yes = (value: unknown) => value === true || value === 'true';
export async function flairEnabled() {
  const enabled = await settings.get('enableUserFlair');
  return enabled === undefined ? true : yes(enabled);
}
const setting = async (key: string) => yes(await settings.get(key));
export async function flairAvailable() {
  if (!(await flairEnabled())) return false;
  const subreddit = await reddit.getSubredditByName(context.subredditName);
  return Boolean(
    subreddit.userFlairsEnabled &&
    (subreddit.usersCanAssignUserFlairs ||
      (await setting('allowBotFlairAssignment')))
  );
}
async function flairConfig(): Promise<FlairConfig> {
  const fields = await Promise.all(
    flairDefaults.map(async ([label, type], i) => {
      const id = `flair${i + 1}`;
      const read = async (suffix: string, fallback: string) => {
        const value = await settings.get(id + suffix);
        return typeof value === 'string' ? value.trim() : fallback;
      };
      const rawType = await settings.get(id + 'Type');
      return {
        id,
        label: await read('Label', label),
        type: Array.isArray(rawType)
          ? String(rawType[0])
          : typeof rawType === 'string'
            ? rawType
            : type,
        help: await read('Help', ''),
        required: yes(await settings.get(id + 'Required')),
      };
    })
  );
  const formats = await Promise.all(
    formatDefaults.map(async ([name, format], i) => {
      const savedName = await settings.get(`flairFormat${i + 1}Name`);
      const savedFormat = await settings.get(`flairFormat${i + 1}Text`);
      return {
        id: String(i + 1),
        name: typeof savedName === 'string' ? savedName.trim() : name,
        format: typeof savedFormat === 'string' ? savedFormat.trim() : format,
      };
    })
  );
  return {
    fields: fields.filter(
      (f) => f.label && ['text', 'number', 'weight', 'height'].includes(f.type)
    ),
    formats: formats.filter((f) => f.name && f.format),
  };
}
async function ownFlair() {
  if (!(await flairEnabled()))
    throw Error('The flair tool is disabled in this community.');
  if (!context.userId) throw Error('Sign in to Reddit, then reopen Set flair.');
  const user = await reddit.getCurrentUser();
  if (!user || user.id !== context.userId)
    throw Error('Could not verify your account. Please retry.');
  if (
    (
      await reddit
        .getBannedUsers({
          subredditName: context.subredditName,
          username: user.username,
        })
        .all()
    ).length
  )
    throw Error('This account cannot update flair in this community.');
  const subreddit = await reddit.getSubredditByName(context.subredditName);
  if (!subreddit.userFlairsEnabled)
    throw Error('User flair is not enabled in this community.');
  const botAssignment = await setting('allowBotFlairAssignment');
  if (!subreddit.usersCanAssignUserFlairs && !botAssignment)
    throw Error(
      'Members cannot assign flair in this community. A moderator can enable Check-In Crew assignment in app settings if that is intended.'
    );
  const [current, templates, config, replaceExisting] = await Promise.all([
    user.getUserFlairBySubreddit(context.subredditName),
    reddit.getUserFlairTemplates(context.subredditName),
    flairConfig(),
    setting('allowReplacingExistingFlair'),
  ]);
  const templateId = await settings.get('userFlairTemplate');
  const template = templates.find(
    (t) =>
      (!templateId || t.id === templateId) &&
      !t.modOnly &&
      (subreddit.usersCanAssignUserFlairs ? t.allowUserEdits : botAssignment) &&
      t.allowableContent !== 'emoji'
  );
  if (!template)
    throw Error(
      'A moderator needs to select or create a suitable non-moderator text flair template in Reddit’s flair settings.'
    );
  const css = current?.flairCssClass ?? '';
  // The public SDK does not expose the template ID of current user flair. Do
  // not guess from text or CSS: preserve every existing flair by default.
  const hasExistingFlair = Boolean(current?.flairText || css);
  const protectedFlair =
    hasExistingFlair &&
    (!replaceExisting ||
      templates.some(
        (t) => t.modOnly && t.text && t.text === current?.flairText
      ));
  return {
    user,
    current: { text: current?.flairText ?? '', css },
    config,
    template,
    protectedFlair,
    reservedTexts: templates.filter((t) => t.modOnly).map((t) => t.text),
  };
}
export const flair = new Hono();
flair.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});
flair.onError((error, c) => c.json({ error: error.message }, 400));
flair.get('/', async (c) => {
  const info = await ownFlair();
  return c.json({
    ...info.config,
    current: info.current,
    community: context.subredditName,
    protectedFlair: info.protectedFlair,
  });
});
flair.post('/', async (c) => {
  const body = await c.req.json<{
    formatId: string;
    values: Record<string, FlairValue>;
    preview: string;
    confirm: boolean;
    previous: { text: string; css: string };
  }>();
  if (body.confirm !== true)
    throw Error('Preview your flair and confirm Apply.');
  const info = await ownFlair();
  if (info.protectedFlair)
    throw Error(
      'Your current flair is protected. Ask a moderator to help change it.'
    );
  if (
    body.previous?.text !== info.current.text ||
    body.previous?.css !== info.current.css
  )
    throw Error(
      'Your flair changed since you opened this form. Reopen Set flair to review it.'
    );
  if (
    !body.values ||
    typeof body.values !== 'object' ||
    Array.isArray(body.values)
  )
    throw Error('Invalid flair details.');
  const text = renderFlair(info.config, body.formatId, body.values);
  if (info.reservedTexts.includes(text))
    throw Error('That wording is reserved for a moderator-assigned flair.');
  if (text !== body.preview)
    throw Error('The format changed. Reopen Set flair and check your preview.');
  // Only the authenticated account and this installation can be targeted.
  await reddit.setUserFlair({
    subredditName: context.subredditName,
    username: info.user.username,
    flairTemplateId: info.template.id,
    text,
  });
  return c.json({ text });
});
