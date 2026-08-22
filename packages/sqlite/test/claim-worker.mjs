import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SqliteAdapter } from '../dist/index.js';

const options = JSON.parse(Bun.argv[2] ?? '{}');
const adapter = new SqliteAdapter({ filename: options.filename, now: () => new Date(options.now) });

async function waitForRelease() {
  const release = join(options.directory, 'release');
  for (;;) {
    try {
      await access(release);
      return;
    } catch {
      await Bun.sleep(5);
    }
  }
}

try {
  await writeFile(join(options.directory, `ready-${options.assignee}`), 'ready');
  await waitForRelease();
  const result = await adapter.withinTransaction(uow => uow.claimReady(options.id, options.assignee, new Date(options.expectedUpdatedAt)));
  console.log(JSON.stringify({ result }));
} catch (cause) {
  console.log(JSON.stringify({ error: cause instanceof Error ? cause.stack ?? cause.message : String(cause) }));
} finally {
  adapter.close();
}
