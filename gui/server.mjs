#!/usr/bin/env node

import http from 'http';
import { readFile } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import { extname, join, normalize, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { evaluate, getAiConfig, DEFAULT_MODELS } from './ai.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const publicDir = join(__dirname, 'public');
const port = Number(process.env.PORT || 7860);
const host = '0.0.0.0';
const authPassword = process.env.AUTH_PASSWORD || '';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

// ── Auth ──────────────────────────────────────────────────────────────────────

function checkAuth(req, res) {
  if (!authPassword) return true;
  const header = req.headers['authorization'] || '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const password = decoded.includes(':') ? decoded.split(':').slice(1).join(':') : decoded;
    if (password === authPassword) return true;
  }
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Career-Ops"',
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify({ error: 'Unauthorized' }));
  return false;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function buildSystemPrompt() {
  const tryRead = async (path) => {
    try { return await readFile(path, 'utf8'); } catch { return ''; }
  };
  const [shared, oferta] = await Promise.all([
    tryRead(join(root, 'modes', '_shared.md')),
    tryRead(join(root, 'modes', 'oferta.md')),
  ]);
  // CV is passed in the request body from localStorage
  return [
    shared && `# Shared Context\n${shared}`,
    oferta && `# Evaluation Mode\n${oferta}`,
  ].filter(Boolean).join('\n\n---\n\n');
}

// ── Static files ──────────────────────────────────────────────────────────────

function sendStaticFile(req, res) {
  let requested = req.url === '/' ? '/index.html' : req.url;
  requested = requested.split('?')[0];
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}

// ── Router ────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return json(res, 400, { error: 'Missing URL' });
    if (!checkAuth(req, res)) return;

    // AI config (provider + model from env vars, key never exposed)
    if (req.method === 'GET' && req.url === '/api/ai-config') {
      const { provider, model } = getAiConfig();
      return json(res, 200, {
        provider: provider || null,
        model: model || (provider ? DEFAULT_MODELS[provider] : null),
        configured: !!(provider && process.env.AI_API_KEY),
        defaultModels: DEFAULT_MODELS,
      });
    }

    // Evaluate a job description
    if (req.method === 'POST' && req.url === '/api/evaluate') {
      const body = await readBody(req);
      const jdText = (body.jdText || '').trim();
      if (!jdText) return json(res, 400, { error: 'No job description provided' });

      const { provider } = getAiConfig();
      if (!provider || !process.env.AI_API_KEY) {
        return json(res, 503, { error: 'AI provider not configured on this server. Set AI_PROVIDER and AI_API_KEY environment variables.' });
      }

      // Build system prompt from mode files + CV passed from client localStorage
      const basePrompt = await buildSystemPrompt();
      const cv = (body.cv || '').trim();
      const systemPrompt = cv
        ? `${basePrompt}\n\n---\n\n# Candidate CV\n${cv}`
        : basePrompt;

      const result = await evaluate(systemPrompt, jdText);
      return json(res, 200, { result });
    }

    return sendStaticFile(req, res);
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  const { provider, model } = getAiConfig();
  console.log(`Career-Ops running at http://localhost:${port}`);
  if (provider) console.log(`AI: ${provider} / ${model || DEFAULT_MODELS[provider] || 'default'}`);
  else console.log('AI: not configured — set AI_PROVIDER and AI_API_KEY');
  if (authPassword) console.log('Auth: password protection enabled');
});
