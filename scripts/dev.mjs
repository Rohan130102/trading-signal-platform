// One command for local development: database, API with an in-process worker, and the web app.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('.env')) {
  console.error('No .env yet. Run: node scripts/setup-env.mjs');
  process.exit(1);
}
process.loadEnvFile('.env');

const children = [];
const run = (name, command, args, options = {}) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env, ...options });
  const prefix = (chunk) =>
    chunk
      .toString()
      .trimEnd()
      .split('\n')
      .map((line) => `[${name}] ${line}`)
      .join('\n');
  child.stdout.on('data', (d) => console.log(prefix(d)));
  child.stderr.on('data', (d) => console.error(prefix(d)));
  children.push(child);
  return child;
};
const once = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env, ...options });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)),
    );
  });

run('db', 'node', ['scripts/dev-db.mjs']);
for (let i = 0; i < 60; i += 1) {
  try {
    await once(
      'node',
      [
        '-e',
        `require('net').connect(54329,'localhost').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))`,
      ],
      { stdio: 'ignore' },
    );
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
await once('npm', ['run', 'build', '-w', '@signaldesk/domain']);
await once('npm', ['run', 'build', '-w', '@signaldesk/api']);
await once('npm', ['run', 'db:migrate', '-w', '@signaldesk/api']);
await once('npm', ['run', 'db:seed', '-w', '@signaldesk/api']);
run('api', 'node', ['dist/main.js'], { cwd: 'apps/api' });
run('web', 'npm', ['run', 'dev', '-w', '@signaldesk/web']);

const stop = () => {
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1500);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
