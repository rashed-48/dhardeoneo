/**
 * Runs the production setup locally: build the SPA, then start the server in
 * production mode so one process serves the API, the covers and the UI —
 * exactly what the deployed container does.
 */
import { spawnSync } from 'node:child_process';

const run = (cmd, args, env) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('npm', ['--prefix', 'web', 'run', 'build']);
run('node', ['server/src/index.js'], { NODE_ENV: 'production' });
