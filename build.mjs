import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const portalPath = join(__dirname, 'news-portal.html');

async function hasLocalPortal() {
  try {
    await access(portalPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!process.env.GAMMA_API_KEY) {
    if (await hasLocalPortal()) {
      console.log('Build skipped remote generation (missing GAMMA_API_KEY). Using existing news-portal.html.');
      return;
    }
    throw new Error('Missing GAMMA_API_KEY and no local news-portal.html found');
  }

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['daily-brief.mjs'], {
      cwd: __dirname,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`daily-brief.mjs exited with code ${code}`));
    });
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
