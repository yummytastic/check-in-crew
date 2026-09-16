import { Hono } from 'hono';
import { config, publish } from '../core/service.ts';
import { dueSlots } from '../core/model.ts';
import { processSeriesDeletions } from '../core/deletion.ts';
import { processPersonalDataDeletion } from '../core/privacy.ts';
export const automation = new Hono();
automation.post('/scheduler/tick', async (c) => {
  const now = new Date();
  const cfg = await config();
  let failures = 0;
  for (const series of cfg.series) {
    for (const slot of dueSlots(series, now)) {
      try {
        await publish(series.id, slot, 'scheduler', true);
      } catch (error) {
        failures++;
        console.error(
          'Scheduled publication failed',
          series.id,
          slot.date,
          slot.kind,
          error
        );
      }
    }
  }
  try {
    await processSeriesDeletions(now);
  } catch (error) {
    failures++;
    console.error('Series deletion needs attention', error);
  }
  try {
    await processPersonalDataDeletion();
  } catch (error) {
    failures++;
    console.error('Personal-data deletion needs attention', error);
  }
  return c.json({ status: failures ? 'partial' : 'ok' });
});
