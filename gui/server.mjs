#!/usr/bin/env node

import http from 'http';
import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import { extname, join, normalize, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { evaluate, loadAiConfig, DEFAULT_MODELS } from './ai.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const publicDir = join(__dirname, 'public');
const port = Number(process.env.PORT || 4312);
const host = '0.0.0.0';
const authPassword = process.env.AUTH_PASSWORD || '';

const STATUS_OPTIONS = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP'];

const fileMap = {
  cv: join(root, 'cv.md'),
  profile: join(root, 'config', 'profile.yml'),
  portals: join(root, 'portals.yml'),
  pipeline: join(root, 'data', 'pipeline.md'),
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

// ── Auth ─────────────────────────────────────────────────────────────────────

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

function parseApplications(content) {
  const lines = content.split('\n');
  const apps = [];
  for (const line of lines) {
    if (!line.trim().startsWith('|')) continue;
    if (line.includes('|---')) continue;
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length < 10) continue;
    const number = Number(parts[1]);
    if (!Number.isFinite(number)) continue;
    const scoreRaw = parts[5];
    const scoreMatch = scoreRaw.match(/(\d+\.?\d*)\/5/);
    apps.push({
      number,
      date: parts[2],
      company: parts[3],
      role: parts[4],
      scoreRaw,
      score: scoreMatch ? Number(scoreMatch[1]) : null,
      status: parts[6],
      hasPdf: parts[7].includes('✅'),
      reportMarkdown: parts[8],
      notes: parts[9] || '',
      reportPath: extractReportPath(parts[8]),
    });
  }
  return apps;
}

function extractReportPath(markdownLink) {
  const match = markdownLink.match(/\]\(([^)]+)\)/);
  return match ? match[1] : '';
}

function computeSummary(apps) {
  const byStatus = {};
  let totalScore = 0;
  let scored = 0;
  let topScore = 0;
  let pdfCount = 0;
  for (const app of apps) {
    byStatus[app.status] = (byStatus[app.status] || 0) + 1;
    if (typeof app.score === 'number') {
      totalScore += app.score;
      scored += 1;
      if (app.score > topScore) topScore = app.score;
    }
    if (app.hasPdf) pdfCount += 1;
  }
  return {
    total: apps.length,
    avgScore: scored ? Number((totalScore / scored).toFixed(2)) : null,
    topScore: topScore || null,
    pdfCount,
    byStatus,
  };
}

async function readApplicationsFile() {
  const dataPath = join(root, 'data', 'applications.md');
  const topLevelPath = join(root, 'applications.md');
  const filePath = existsSync(dataPath) ? dataPath : topLevelPath;
  const content = await readFile(filePath, 'utf8');
  return { filePath, content, apps: parseApplications(content) };
}

function updateApplicationStatus(content, rowNumber, newStatus) {
  const lines = content.split('\n');
  const updated = lines.map((line) => {
    if (!line.trim().startsWith('|')) return line;
    const parts = line.split('|');
    if (parts.length < 10) return line;
    const num = Number(parts[1].trim());
    if (num !== rowNumber) return line;
    parts[6] = ` ${newStatus} `;
    return parts.join('|');
  });
  return updated.join('\n');
}

async function loadReports() {
  const dir = join(root, 'reports');
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  const reports = [];
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const filePath = join(dir, name);
    const content = await readFile(filePath, 'utf8');
    const info = await stat(filePath);
    reports.push({
      name,
      updatedAt: info.mtime.toISOString(),
      company: guessCompany(name),
      title: firstMeaningfulLine(content),
      excerpt: content.split('\n').slice(0, 8).join('\n'),
    });
  }
  reports.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return reports;
}

function guessCompany(fileName) {
  const bits = fileName.replace(/\.md$/, '').split('-');
  if (bits.length < 3) return fileName;
  return bits.slice(1, -3).join(' ') || fileName;
}

function firstMeaningfulLine(content) {
  return content.split('\n').find((line) => line.trim() && !line.startsWith('**')) || 'Career report';
}

function runNodeScript(scriptName) {
  return new Promise((resolvePromise) => {
    execFile('node', [scriptName], { cwd: root }, (error, stdout, stderr) => {
      resolvePromise({
        script: scriptName,
        ok: !error,
        output: [stdout, stderr].filter(Boolean).join('\n').trim(),
      });
    });
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

// ── Setup status ──────────────────────────────────────────────────────────────

async function getSetupStatus() {
  let profileContent = '';
  let cvContent = '';
  try { profileContent = await readFile(join(root, 'config', 'profile.yml'), 'utf8'); } catch { /* missing */ }
  try { cvContent = await readFile(join(root, 'cv.md'), 'utf8'); } catch { /* missing */ }

  const nameMatch = profileContent.match(/full_name:\s*["']?([^"'\n]+)["']?/);
  const name = nameMatch ? nameMatch[1].trim() : '';
  const isPlaceholder = !name || name.toLowerCase().includes('your name') || name.toLowerCase() === 'olamide irojah' && !cvContent.trim();

  const aiConfig = await loadAiConfig().catch(() => ({ provider: '', model: '' }));
  const hasCv = cvContent.trim().length > 50;
  const hasProfile = name.length > 0 && !name.toLowerCase().includes('your name');
  const hasAi = !!aiConfig.provider && !!aiConfig.apiKey;

  return {
    complete: hasCv && hasProfile && hasAi,
    hasCv,
    hasProfile,
    hasAi,
    name: hasProfile ? name : null,
    provider: aiConfig.provider || null,
    model: aiConfig.model || null,
  };
}

// ── Onboarding save ────────────────────────────────────────────────────────────

async function saveOnboarding(body) {
  const { name, email, location, linkedin, targetRoles, cv, provider, apiKey, model, baseUrl } = body;

  // Build profile.yml
  const roles = (targetRoles || '').split(',').map((r) => r.trim()).filter(Boolean);
  const rolesYml = roles.map((r) => `    - "${r}"`).join('\n');
  const profileYml = `candidate:
  full_name: "${name || ''}"
  email: "${email || ''}"
  location: "${location || ''}"
  linkedin: "${linkedin || ''}"

target_roles:
  primary:
${rolesYml || '    - ""'}

ai_provider: "${provider || ''}"
ai_api_key: "${apiKey || ''}"
ai_model: "${model || ''}"
${baseUrl ? `ai_base_url: "${baseUrl}"\n` : ''}`;

  await mkdir(join(root, 'config'), { recursive: true });
  await writeFile(join(root, 'config', 'profile.yml'), profileYml, 'utf8');

  // Write cv.md
  if (cv && cv.trim()) {
    await writeFile(join(root, 'cv.md'), cv.trim(), 'utf8');
  }

  // Ensure data dir + applications.md
  await mkdir(join(root, 'data'), { recursive: true });
  const appsPath = join(root, 'data', 'applications.md');
  if (!existsSync(appsPath)) {
    await writeFile(appsPath, '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n', 'utf8');
  }

  // Ensure reports dir
  await mkdir(join(root, 'reports'), { recursive: true });
}

// ── Save report ────────────────────────────────────────────────────────────────

async function saveReport(content) {
  await mkdir(join(root, 'reports'), { recursive: true });
  const existing = existsSync(join(root, 'reports'))
    ? (await readdir(join(root, 'reports'))).filter((f) => f.endsWith('.md'))
    : [];
  const maxNum = existing.reduce((max, name) => {
    const n = parseInt(name.split('-')[0], 10);
    return isNaN(n) ? max : Math.max(max, n);
  }, 0);
  const num = String(maxNum + 1).padStart(3, '0');
  const date = new Date().toISOString().slice(0, 10);
  const slug = `report-${date}`;
  const fileName = `${num}-${slug}.md`;
  await writeFile(join(root, 'reports', fileName), content, 'utf8');
  return fileName;
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

    // Setup status
    if (req.method === 'GET' && req.url === '/api/setup-status') {
      return json(res, 200, await getSetupStatus());
    }

    // Onboarding
    if (req.method === 'POST' && req.url === '/api/onboarding') {
      const body = await readBody(req);
      await saveOnboarding(body);
      return json(res, 200, { ok: true });
    }

    // AI config (no key exposed)
    if (req.method === 'GET' && req.url === '/api/ai-config') {
      const { provider, model } = await loadAiConfig();
      return json(res, 200, { provider, model, defaultModels: DEFAULT_MODELS });
    }

    // Evaluate JD
    if (req.method === 'POST' && req.url === '/api/evaluate') {
      const body = await readBody(req);
      const jdText = body.jdText || body.jdUrl || '';
      if (!jdText.trim()) return json(res, 400, { error: 'No job description provided' });
      const result = await evaluate(jdText);
      return json(res, 200, { result });
    }

    // Save report
    if (req.method === 'POST' && req.url === '/api/reports/save') {
      const body = await readBody(req);
      const fileName = await saveReport(body.content || '');
      return json(res, 200, { ok: true, fileName });
    }

    // Summary
    if (req.method === 'GET' && req.url === '/api/summary') {
      const { apps } = await readApplicationsFile();
      return json(res, 200, { summary: computeSummary(apps), apps });
    }

    // Applications list
    if (req.method === 'GET' && req.url === '/api/applications') {
      const { apps } = await readApplicationsFile();
      return json(res, 200, { apps, statuses: STATUS_OPTIONS });
    }

    // Update application status
    if (req.method === 'PATCH' && req.url.startsWith('/api/applications/')) {
      const number = Number(req.url.split('/').pop());
      const body = await readBody(req);
      if (!STATUS_OPTIONS.includes(body.status)) return json(res, 400, { error: 'Invalid status' });
      const { filePath, content } = await readApplicationsFile();
      const updated = updateApplicationStatus(content, number, body.status);
      await writeFile(filePath, updated, 'utf8');
      return json(res, 200, { ok: true });
    }

    // File read
    if (req.method === 'GET' && req.url.startsWith('/api/files/')) {
      const key = req.url.split('/').pop();
      if (!key || !fileMap[key]) return json(res, 404, { error: 'Unknown file' });
      const content = await readFile(fileMap[key], 'utf8').catch(() => '');
      return json(res, 200, { key, content });
    }

    // File write
    if (req.method === 'PUT' && req.url.startsWith('/api/files/')) {
      const key = req.url.split('/').pop();
      if (!key || !fileMap[key]) return json(res, 404, { error: 'Unknown file' });
      const body = await readBody(req);
      await writeFile(fileMap[key], body.content ?? '', 'utf8');
      return json(res, 200, { ok: true });
    }

    // Reports list
    if (req.method === 'GET' && req.url === '/api/reports') {
      const reports = await loadReports();
      return json(res, 200, { reports });
    }

    // Report content
    if (req.method === 'GET' && req.url.startsWith('/api/report/')) {
      const name = decodeURIComponent(req.url.replace('/api/report/', ''));
      const filePath = join(root, 'reports', name);
      if (!filePath.startsWith(join(root, 'reports')) || !existsSync(filePath)) {
        return json(res, 404, { error: 'Report not found' });
      }
      const content = await readFile(filePath, 'utf8');
      return json(res, 200, { name, content });
    }

    // Run checks
    if (req.method === 'POST' && req.url === '/api/checks/run') {
      const results = await Promise.all([
        runNodeScript('cv-sync-check.mjs'),
        runNodeScript('verify-pipeline.mjs'),
      ]);
      return json(res, 200, { results });
    }

    // Context
    if (req.method === 'GET' && req.url === '/api/context') {
      return json(res, 200, {
        root,
        files: Object.fromEntries(Object.entries(fileMap).map(([k, v]) => [k, v.replace(`${root}/`, '')])),
      });
    }

    return sendStaticFile(req, res);
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Career-Ops GUI running at http://localhost:${port}`);
  if (authPassword) console.log('Password protection: enabled');
});
