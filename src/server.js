import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerRoutes } from './routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const participants = JSON.parse(readFileSync(join(__dirname, '..', 'participants.json'), 'utf-8'));

const app = Fastify({ logger: true });

// Pre-load static files with cache-busting hashes
const styleCss = readFileSync(join(publicDir, 'style.css'), 'utf-8');
const appJs = readFileSync(join(publicDir, 'app.js'), 'utf-8');
const styleHash = createHash('md5').update(styleCss).digest('hex').slice(0, 8);
const appHash = createHash('md5').update(appJs).digest('hex').slice(0, 8);

const indexHtml = readFileSync(join(publicDir, 'index.html'), 'utf-8')
  .replace('/style.css', `/style.${styleHash}.css`)
  .replace('/app.js', `/app.${appHash}.js`);

// Serve index.html for root and participant codes
const serveIndex = async (request, reply) => {
  reply.type('text/html').send(indexHtml);
};

app.get('/', serveIndex);
for (const p of participants) {
  app.get(`/${p.code}`, serveIndex);
}

// Serve static assets with long cache (hash in URL busts cache)
app.get(`/style.${styleHash}.css`, async (request, reply) => {
  reply.header('Cache-Control', 'public, max-age=31536000, immutable').type('text/css').send(styleCss);
});
app.get(`/app.${appHash}.js`, async (request, reply) => {
  reply.header('Cache-Control', 'public, max-age=31536000, immutable').type('application/javascript').send(appJs);
});

// Register API routes
registerRoutes(app, participants);

const port = parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';

try {
  await app.listen({ port, host });
  console.log(`Server running on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
