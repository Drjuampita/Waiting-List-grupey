// Servidor mínimo para desarrollo y pruebas E2E: sirve public/ con los headers de vercel.json
// (cleanUrls y 404.html incluidos) y monta los handlers reales de api/. No sustituye a Vercel
// en producción; reproduce lo necesario para probar la landing completa.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const vercel = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8')) as {
  headers: { headers: { key: string; value: string }[] }[];
};
const GLOBAL_HEADERS = vercel.headers.flatMap((h) => h.headers);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

type Handler = (request: Request) => Promise<Response>;
const api: Record<string, Record<string, Handler>> = {
  '/api/pre-register': await import('../api/pre-register'),
  '/api/health': await import('../api/health'),
};

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function serveApi(route: Record<string, Handler>, req: IncomingMessage, res: ServerResponse, url: URL) {
  const handler = route[req.method ?? 'GET'];
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  headers.set('x-real-ip', req.socket.remoteAddress ?? '127.0.0.1');
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const request = new Request(url, { method: req.method, headers, body: hasBody ? new Uint8Array(await readBody(req)) : undefined });
  const response = handler ? await handler(request) : new Response(null, { status: 405 });
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function resolveStatic(pathname: string): Promise<string | null> {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const candidates = clean === '/' ? ['index.html'] : [clean, `${clean}.html`];
  for (const c of candidates) {
    const file = join(PUBLIC, c);
    if (!file.startsWith(PUBLIC)) return null;
    try {
      if ((await stat(file)).isFile()) return file;
    } catch {
      /* siguiente candidato */
    }
  }
  return null;
}

export function startServer(port: number) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      for (const h of GLOBAL_HEADERS) res.setHeader(h.key, h.value);
      // HSTS y upgrade-insecure-requests no aplican en http://localhost.
      res.removeHeader('Strict-Transport-Security');
      res.setHeader('Content-Security-Policy', String(res.getHeader('Content-Security-Policy')).replace('; upgrade-insecure-requests', ''));

      const route = api[url.pathname];
      if (route) return await serveApi(route, req, res, url);

      // cleanUrls: /gracias.html → /gracias
      if (url.pathname.endsWith('.html')) {
        res.writeHead(308, { Location: url.pathname.replace(/(index)?\.html$/, '') || '/' });
        return res.end();
      }
      const file = await resolveStatic(url.pathname);
      const status = file ? 200 : 404;
      const body = await readFile(file ?? join(PUBLIC, '404.html'));
      res.writeHead(status, { 'Content-Type': TYPES[extname(file ?? '.html')] ?? 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.statusCode = 500;
      res.end('internal error');
    }
  });
  return new Promise<typeof server>((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 3000);
  await startServer(port);
  console.log(`Grupey landing en http://localhost:${port}`);
}
