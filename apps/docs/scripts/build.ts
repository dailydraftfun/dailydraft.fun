import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');

const files = [
  'index.html',
  'llms.txt',
  'openapi.yaml',
  'guides/quickstart.md',
  'guides/solana-transactions.md',
  'guides/webhooks.md',
];

await rm(output, { force: true, recursive: true });

for (const file of files) {
  const destination = join(output, file);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(root, file), destination);
}
