import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerRoutes } from './routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const participants = JSON.parse(readFileSync(join(__dirname, '..', 'participants.json'), 'utf-8'));

const app = Fastify({ logger: true });

// Serve static files from public/
await app.register(fastifyStatic, {
  root: join(__dirname, '..', 'public'),
  prefix: '/',
});

// Register API and redirect routes
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
