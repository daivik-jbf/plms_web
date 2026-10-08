import '../config/load-env';
import { parseEnv } from '../config/env';
import { runMigrations } from '../db/migrate';

runMigrations(parseEnv(process.env).DATABASE_URL)
  .then(() => console.log('Migrations applied.'))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
