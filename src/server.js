import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerRoutes } from './routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const participants = JSON.parse(readFileSync(join(__dirname, '..', 'participants.json'), 'utf-8'));

const app = Fastify({ logger: true });

// Pre-load static files
const indexHtml = readFileSync(join(publicDir, 'index.html'), 'utf-8');
const styleCss = readFileSync(join(publicDir, 'style.css'), 'utf-8');
const appJs = readFileSync(join(publicDir, 'app.js'), 'utf-8');

// Serve index.html for root and participant codes
const serveIndex = async (request, reply) => {
  reply.type('text/html').send(indexHtml);
};

app.get('/', serveIndex);
for (const p of participants) {
  app.get(`/${p.code}`, serveIndex);
}

// Serve static assets (no-cache to prevent CDN stale content)
app.get('/style.css', async (request, reply) => {
  reply.header('Cache-Control', 'no-cache').type('text/css').send(styleCss);
});
app.get('/app.js', async (request, reply) => {
  reply.header('Cache-Control', 'no-cache').type('application/javascript').send(appJs);
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
