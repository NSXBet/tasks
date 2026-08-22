# @tasks/postgres

PostgreSQL persistence adapter for Tasks application ports. Uses `pg`, parameterized SQL, transaction-bound unit of work, checksummed migration history, and transaction advisory migration lock.

## Setup

```ts
import { PostgresAdapter } from '@tasks/postgres';

const store = new PostgresAdapter({ connectionString: process.env.DATABASE_URL });
await store.migrate();
await store.withinTransaction(issues => issues.findById(id));
await store.close();
```

Inject shared infrastructure when needed:

```ts
new PostgresAdapter({ pool });   // caller owns Pool
new PostgresAdapter({ client }); // caller owns PoolClient
```

Instants use epoch milliseconds (`BIGINT`); JSON fields use `JSONB`. Migrations acquire PostgreSQL transaction-scoped advisory lock and validate migration order/checksum before DDL. Claim uses one conditional parameterized `UPDATE`, safe across competing connections.

## Tests

`bun run --filter @tasks/postgres test` has no database service dependency. Integration tests may be added gated by `DATABASE_URL`.
