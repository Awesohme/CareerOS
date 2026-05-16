// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  deepseek: 'deepseek-chat',
  gemini: 'gemini-2.0-flash',
  qwen: 'qwen-plus',
  kimi: 'moonshot-v1-8k',
  custom: '',
};

const STATUS_COLORS = {
  Interview: 'status-green',
  Offer: 'status-green',
  Applied: 'status-orange',
  Responded: 'status-orange',
  Evaluated: 'status-blue',
  Rejected: 'status-grey',
  Discarded: 'status-grey',
  SKIP: 'status-grey',
};

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  apps: [],
  filteredApps: [],
  summary: null,
  context: null,
  currentFile: 'cv',
  reports: [],
  setupStatus: null,
  evalResult: '',
};

// ── API ───────────────────────────────────────────────────────────────────────

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(payload.error || 'Request failed');
  }
  return response.json();
}

// ── Views ─────────────────────────────────────────────────────────────────────

function setView(view) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('active', s.id === `view-${view}`));
  closeSidebar();
}

// ── Mobile nav ────────────────────────────────────────────────────────────────

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-backdrop').classList.add('visible');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('visible');
}

// ── Onboarding ────────────────────────────────────────────────────────────────

let currentStep = 1;
const TOTAL_STEPS = 4;

function showStep(step) {
  currentStep = step;
  document.querySelectorAll('.step-content').forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.step) === step);
  });
  document.querySelectorAll('.step-bar .step').forEach((el) => {
    const n = Number(el.dataset.step);
    el.classList.toggle('active', n === step);
    el.classList.toggle('done', n < step);
  });
  const backBtn = document.getElementById('ob-back');
  const nextBtn = document.getElementById('ob-next');
  backBtn.classList.toggle('hidden', step === 1);
  if (step === TOTAL_STEPS) {
    nextBtn.classList.add('hidden');
  } else {
    nextBtn.classList.remove('hidden');
    nextBtn.textContent = step === TOTAL_STEPS - 1 ? 'Set up →' : 'Continue →';
  }
  document.getElementById('ob-error').textContent = '';
}

function validateStep(step) {
  if (step === 1) {
    const name = document.getElementById('ob-name').value.trim();
    const email = document.getElementById('ob-email').value.trim();
    const roles = document.getElementById('ob-roles').value.trim();
    if (!name) return 'Please enter your full name.';
    if (!email) return 'Please enter your email.';
    if (!roles) return 'Please enter at least one target role.';
  }
  if (step === 2) {
    const key = document.getElementById('ob-apikey').value.trim();
    const provider = document.getElementById('ob-provider').value;
    if (!key) return 'Please enter your API key.';
    if (provider === 'custom' && !document.getElementById('ob-baseurl').value.trim()) {
      return 'Please enter the base URL for your custom provider.';
    }
  }
  if (step === 3) {
    const cv = document.getElementById('ob-cv').value.trim();
    if (!cv) return 'Please paste your CV.';
  }
  return null;
}

async function submitOnboarding() {
  const body = {
    name: document.getElementById('ob-name').value.trim(),
    email: document.getElementById('ob-email').value.trim(),
    location: document.getElementById('ob-location').value.trim(),
    linkedin: document.getElementById('ob-linkedin').value.trim(),
    targetRoles: document.getElementById('ob-roles').value.trim(),
    provider: document.getElementById('ob-provider').value,
    apiKey: document.getElementById('ob-apikey').value.trim(),
    model: document.getElementById('ob-model').value.trim(),
    baseUrl: document.getElementById('ob-baseurl').value.trim(),
    cv: document.getElementById('ob-cv').value.trim(),
  };
  await api('/api/onboarding', { method: 'POST', body: JSON.stringify(body) });
  const name = body.name.split(' ')[0];
  document.getElementById('done-heading').textContent = `You're all set, ${name}!`;
  document.getElementById('done-body').textContent =
    `Paste any job URL or description in the Evaluate tab to get your first analysis.`;
}

function initOnboarding() {
  const provider = document.getElementById('ob-provider');
  const modelInput = document.getElementById('ob-model');
  const baseUrlField = document.getElementById('ob-baseurl-field');

  provider.addEventListener('change', () => {
    const val = provider.value;
    modelInput.placeholder = DEFAULT_MODELS[val] || '';
    if (!modelInput.value) modelInput.value = DEFAULT_MODELS[val] || '';
    baseUrlField.style.display = val === 'custom' ? '' : 'none';
  });
  // Set initial default
  modelInput.value = DEFAULT_MODELS[provider.value] || '';

  document.getElementById('ob-next').addEventListener('click', async () => {
    const err = validateStep(currentStep);
    if (err) {
      document.getElementById('ob-error').textContent = err;
      return;
    }
    if (currentStep === TOTAL_STEPS - 1) {
      const nextBtn = document.getElementById('ob-next');
      nextBtn.textContent = 'Saving…';
      nextBtn.disabled = true;
      try {
        await submitOnboarding();
        showStep(TOTAL_STEPS);
      } catch (e) {
        document.getElementById('ob-error').textContent = e.message;
        nextBtn.textContent = 'Set up →';
        nextBtn.disabled = false;
      }
      return;
    }
    showStep(currentStep + 1);
  });

  document.getElementById('ob-back').addEventListener('click', () => {
    if (currentStep > 1) showStep(currentStep - 1);
  });

  document.getElementById('ob-finish').addEventListener('click', () => {
    document.getElementById('onboarding').classList.add('hidden');
    document.getElementById('app').style.display = '';
    boot();
  });
}

// ── Metrics / Overview ────────────────────────────────────────────────────────

function renderMetrics() {
  const summary = state.summary || { total: 0, avgScore: null, topScore: null, pdfCount: 0, byStatus: {} };

  document.getElementById('metrics').innerHTML = [
    ['Tracked roles', summary.total],
    ['Average score', summary.avgScore != null ? `${summary.avgScore}/5` : 'N/A'],
    ['Top score', summary.topScore != null ? `${summary.topScore}/5` : 'N/A'],
    ['PDFs ready', summary.pdfCount],
  ].map(([label, value]) => `
    <article class="metric-card">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
    </article>
  `).join('');

  const breakdown = Object.entries(summary.byStatus || {});
  document.getElementById('status-breakdown').innerHTML = breakdown.length
    ? breakdown.map(([status, count]) =>
        `<span class="status-pill ${STATUS_COLORS[status] || 'status-grey'}">${status} · ${count}</span>`
      ).join('')
    : '<span class="muted">No application rows yet.</span>';

  document.getElementById('context-files').innerHTML = Object.entries(state.context?.files || {})
    .map(([label, path]) => `<span class="chip">${label}: <strong>${path}</strong></span>`)
    .join('');
}

// ── Score badge ───────────────────────────────────────────────────────────────

function scoreBadge(scoreRaw, score) {
  if (score == null) return scoreRaw || 'N/A';
  const cls = score >= 4 ? 'score-high' : score >= 3 ? 'score-mid' : 'score-low';
  return `<span class="score-badge ${cls}">${scoreRaw}</span>`;
}

// ── Applications ──────────────────────────────────────────────────────────────

function renderApplications() {
  const tbody = document.getElementById('applications-body');
  const empty = document.getElementById('apps-empty');
  if (state.filteredApps.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  tbody.innerHTML = state.filteredApps.map((app) => `
    <tr>
      <td>${app.number}</td>
      <td><strong>${app.company}</strong></td>
      <td>${app.role}</td>
      <td>${scoreBadge(app.scoreRaw, app.score)}</td>
      <td>
        <select data-number="${app.number}" class="status-select ${STATUS_COLORS[app.status] || 'status-grey'}">
          ${['Evaluated','Applied','Responded','Interview','Offer','Rejected','Discarded','SKIP']
            .map((s) => `<option value="${s}" ${s === app.status ? 'selected' : ''}>${s}</option>`)
            .join('')}
        </select>
      </td>
      <td>${app.date}</td>
      <td>${app.hasPdf ? '<span class="pdf-yes">✅</span>' : '<span class="muted">—</span>'}</td>
      <td class="notes-cell">${app.notes || ''}</td>
    </tr>
  `).join('');

  document.querySelectorAll('.status-select').forEach((select) => {
    select.addEventListener('change', async (e) => {
      const number = e.target.dataset.number;
      await api(`/api/applications/${number}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: e.target.value }),
      });
      e.target.className = `status-select ${STATUS_COLORS[e.target.value] || 'status-grey'}`;
      await loadSummary();
    });
  });
}

function filterApplications() {
  const q = document.getElementById('app-search').value.trim().toLowerCase();
  state.filteredApps = q
    ? state.apps.filter((a) => `${a.company} ${a.role} ${a.status} ${a.notes}`.toLowerCase().includes(q))
    : [...state.apps];
  renderApplications();
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadSummary() {
  const [summaryPayload, contextPayload] = await Promise.all([
    api('/api/summary'),
    api('/api/context'),
  ]);
  state.apps = summaryPayload.apps;
  state.filteredApps = [...summaryPayload.apps];
  state.summary = summaryPayload.summary;
  state.context = contextPayload;
  renderMetrics();
  renderApplications();
}

async function loadFile(key) {
  state.currentFile = key;
  document.querySelectorAll('.mini-btn').forEach((b) => b.classList.toggle('active', b.dataset.file === key));
  const payload = await api(`/api/files/${key}`);
  document.getElementById('file-editor').value = payload.content;
}

async function saveCurrentFile() {
  const content = document.getElementById('file-editor').value;
  await api(`/api/files/${state.currentFile}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
  document.getElementById('save-feedback').textContent = `Saved at ${new Date().toLocaleTimeString()}`;
}

async function loadReports() {
  const payload = await api('/api/reports');
  state.reports = payload.reports;
  const list = document.getElementById('reports-list');
  if (!payload.reports.length) {
    list.innerHTML = `
      <div class="empty-state">
        <p class="empty-icon">📄</p>
        <p class="empty-title">No reports yet</p>
        <p class="muted">Evaluate a role to generate your first report.</p>
      </div>`;
    return;
  }
  list.innerHTML = payload.reports.map((r) => `
    <button class="report-item" data-report="${r.name}">
      <strong>${r.company}</strong>
      <div>${r.title}</div>
      <div class="meta">${new Date(r.updatedAt).toLocaleString()}</div>
    </button>
  `).join('');
  document.querySelectorAll('.report-item').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.report-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const payload = await api(`/api/report/${encodeURIComponent(btn.dataset.report)}`);
      document.getElementById('report-preview').innerHTML = marked.parse(payload.content);
    });
  });
}

async function runChecks() {
  const container = document.getElementById('checks-results');
  container.innerHTML = '<p class="muted" style="padding:16px">Running checks…</p>';
  const payload = await api('/api/checks/run', { method: 'POST' });
  container.innerHTML = payload.results.map((r) => `
    <article class="check-card ${r.ok ? 'ok' : 'fail'}">
      <h4>${r.script} ${r.ok ? '✓' : '✗'}</h4>
      <pre class="check-output">${r.output || 'No output'}</pre>
    </article>
  `).join('');
}

// ── Evaluate ──────────────────────────────────────────────────────────────────

async function runEvaluation() {
  const jdText = document.getElementById('eval-input').value.trim();
  if (!jdText) return;

  const btn = document.getElementById('eval-btn');
  const statusEl = document.getElementById('eval-status');
  const resultPanel = document.getElementById('eval-result-panel');

  btn.disabled = true;
  btn.textContent = 'Evaluating…';
  statusEl.textContent = 'This usually takes 30–60 seconds.';
  resultPanel.classList.add('hidden');

  try {
    const payload = await api('/api/evaluate', {
      method: 'POST',
      body: JSON.stringify({ jdText }),
    });
    state.evalResult = payload.result;
    document.getElementById('eval-result').innerHTML = marked.parse(payload.result);
    resultPanel.classList.remove('hidden');
    statusEl.textContent = 'Done.';
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Evaluate this role';
  }
}

async function saveEvalReport() {
  if (!state.evalResult) return;
  const btn = document.getElementById('save-report-btn');
  btn.textContent = 'Saving…';
  btn.disabled = true;
  try {
    const payload = await api('/api/reports/save', {
      method: 'POST',
      body: JSON.stringify({ content: state.evalResult }),
    });
    btn.textContent = `Saved as ${payload.fileName}`;
    await loadReports();
  } catch (e) {
    btn.textContent = 'Save failed';
  } finally {
    btn.disabled = false;
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function applySetupStatus() {
  const status = await api('/api/setup-status');
  state.setupStatus = status;

  if (status.name) {
    const first = status.name.split(' ')[0];
    document.getElementById('sidebar-title').textContent = `${first}'s Job Search OS`;
    document.getElementById('hero-heading').textContent = `${first}'s search, under control.`;
    document.title = `${first} · Career-Ops`;
  }

  if (status.provider && status.model) {
    const badge = `${status.provider} · ${status.model}`;
    document.getElementById('ai-badge').textContent = badge;
    document.getElementById('eval-ai-label').textContent = badge;
  }
}

function boot() {
  // Nav
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.addEventListener('click', () => setView(b.dataset.view));
  });

  // Mobile hamburger
  document.getElementById('hamburger').addEventListener('click', openSidebar);
  document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebar);

  // Editor tabs
  document.querySelectorAll('.mini-btn').forEach((b) => {
    b.addEventListener('click', () => loadFile(b.dataset.file));
  });

  document.getElementById('app-search').addEventListener('input', filterApplications);
  document.getElementById('save-file').addEventListener('click', saveCurrentFile);
  document.getElementById('run-checks').addEventListener('click', runChecks);
  document.getElementById('eval-btn').addEventListener('click', runEvaluation);
  document.getElementById('save-report-btn').addEventListener('click', saveEvalReport);
  document.getElementById('refresh-all').addEventListener('click', async () => {
    await Promise.all([loadSummary(), loadReports(), loadFile(state.currentFile), applySetupStatus()]);
  });

  Promise.all([applySetupStatus(), loadSummary(), loadReports(), loadFile('cv')]).catch((err) => {
    document.getElementById('app').innerHTML =
      `<main style="padding:24px"><h1>Career-Ops failed to load</h1><p>${err.message}</p></main>`;
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

(async () => {
  try {
    const status = await api('/api/setup-status');
    if (!status.complete) {
      document.getElementById('onboarding').classList.remove('hidden');
      initOnboarding();
      showStep(1);
    } else {
      document.getElementById('app').style.display = '';
      boot();
    }
  } catch (err) {
    document.body.innerHTML =
      `<main style="padding:24px;font-family:sans-serif"><h1>Career-Ops GUI failed to load</h1><p>${err.message}</p></main>`;
  }
})();
