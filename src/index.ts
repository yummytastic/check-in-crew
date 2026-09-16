import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api';
import { crew } from './routes/crew';
import { automation } from './routes/automation';
import { triggers } from './routes/triggers';

const app = new Hono();
const internal = new Hono();

internal.route('/', crew);
internal.route('/', automation);
internal.route('/triggers', triggers);

app.route('/api', api);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
