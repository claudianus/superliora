import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export async function downloadToFile(url, dest, options = {}) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed ${url}: HTTP ${res.status}`);
  }
  await mkdir(dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  if (options.expectedSha256) {
    const digest = await sha256File(dest);
    if (digest !== options.expectedSha256.toLowerCase()) {
      throw new Error(
        `Checksum mismatch for ${dest}: expected ${options.expectedSha256}, got ${digest}`,
      );
    }
  }
  return dest;
}

export async function fetchJson(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Fetch JSON failed ${url}: HTTP ${res.status}`);
  }
  return res.json();
}

export async function sha256File(path) {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}
