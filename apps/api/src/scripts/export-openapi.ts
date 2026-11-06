import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CONTROLLERS } from '../app.module.js';
import { buildOpenApi } from '../common/openapi.js';

const out = resolve(process.argv[2] ?? '../../docs/openapi.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(buildOpenApi(CONTROLLERS, 'api/v1'), null, 2)}\n`);
console.log(`Wrote ${out}`);
process.exit(0);
