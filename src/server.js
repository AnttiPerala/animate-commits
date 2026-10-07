import http from 'node:http';
import net from 'node:net';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { contained } from './config.js';

export async function assertPortFree(port, host = '127.0.0.1') {
  await new Promise((res, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Port ${port} is already in use. Stop the existing server or change port in your configuration.`)));
    server.listen(port, host, () => server.close(res));
  });
}

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm' };

export async function staticServer(root, port) {
  const canonicalRoot = await realpath(root);
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let file = resolve(root, '.' + pathname);
      if (!contained(root, file)) { res.writeHead(403).end(); return; }
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      if (!contained(canonicalRoot, await realpath(file))) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404).end('Not found'); }
  });
  await new Promise((res, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', res); });
  return { close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
