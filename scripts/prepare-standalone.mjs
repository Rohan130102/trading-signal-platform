// Next.js standalone output leaves static assets for the host to serve. Copying them in makes the
// build directory self-contained, for the container image and for local production runs.
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const web = resolve(import.meta.dirname, '../apps/web');
const target = resolve(web, '.next/standalone/apps/web');
if (!existsSync(target)) {
  console.error('Standalone output not found. Run next build first.');
  process.exit(1);
}
cpSync(resolve(web, '.next/static'), resolve(target, '.next/static'), { recursive: true });
cpSync(resolve(web, 'public'), resolve(target, 'public'), { recursive: true });
