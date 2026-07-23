import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const source = resolve(root, '..');
const client = resolve(root, 'dist/client');
const server = resolve(root, 'dist/server');

await rm(resolve(root, 'dist'), { recursive: true, force: true });
await mkdir(client, { recursive: true });
await mkdir(server, { recursive: true });

for (const entry of ['index.html', 'css', 'js', 'img']) {
  await cp(resolve(source, entry), resolve(client, entry), { recursive: true });
}

await writeFile(resolve(server, 'index.js'), `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let response = await env.ASSETS.fetch(request);
    if (response.status === 404 && !url.pathname.split('/').pop().includes('.')) {
      response = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
    }
    return response;
  }
};\n`);

console.log('Admin preparado para Sites.');

