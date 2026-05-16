// ── Storage keys ──────────────────────────────────────────────────────────────

const LS = {
  profile: 'co:profile',
  cv: 'co:cv',
  applications: 'co:applications',
  reports: 'co:reports',
};

function lsGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function lsSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ── Status / score helpers ────────────────────────────────────────────────────

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

function scoreBadge(score) {
  if (score == null) return 'N/A';
  const display = `${score}/5`;
  const cls = score >= 4 ? 'score-high' : score >= 3 ? 'score-mid' : 'score-low';
  return `<span class="score-badge ${cls}">${display}</span>`;
}

// ── App state ─────────────────────────────────────────────────────────────────

const state = {
  aiConfig: null,
  evalResult: '',
  currentEditorKey: 'cv',
};

// ── API helper (only for server calls) ───────────────────────────────────────

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(payload.error || 'Request failed');
  }
  return res.json();
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
const TOTAL_STEPS = 3;

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
    if (!document.getElementById('ob-name').value.trim()) return 'Please enter your full name.';
    if (!document.getElementById('ob-email').value.trim()) return 'Please enter your email.';
    if (!document.getElementById('ob-roles').value.trim()) return 'Please enter at least one target role.';
  }
  if (step === 2) {
    if (!document.getElementById('ob-cv').value.trim()) return 'Please paste your CV.';
  }
  return null;
}

function submitOnboarding() {
  const profile = {
    name: document.getElementById('ob-name').value.trim(),
    email: document.getElementById('ob-email').value.trim(),
    location: document.getElementById('ob-location').value.trim(),
    linkedin: document.getElementById('ob-linkedin').value.trim(),
    targetRoles: document.getElementById('ob-roles').value.trim(),
  };
  lsSet(LS.profile, profile);
  lsSet(LS.cv, document.getElementById('ob-cv').value.trim());
  if (!lsGet(LS.applications)) lsSet(LS.applications, []);
  if (!lsGet(LS.reports)) lsSet(LS.reports, []);

  const first = profile.name.split(' ')[0];
  document.getElementById('done-heading').textContent = `You're all set, ${first}!`;
}

function initOnboarding() {
  document.getElementById('ob-next').addEventListener('click', () => {
    const err = validateStep(currentStep);
    if (err) { document.getElementById('ob-error').textContent = err; return; }
    if (currentStep === TOTAL_STEPS - 1) {
      submitOnboarding();
      showStep(TOTAL_STEPS);
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

// ── Overview ──────────────────────────────────────────────────────────────────

function computeSummary(apps) {
  const byStatus = {};
  let total = 0, scored = 0, totalScore = 0, topScore = 0, pdfCount = 0;
  for (const app of apps) {
    byStatus[app.status] = (byStatus[app.status] || 0) + 1;
    total++;
    if (app.score != null) { totalScore += app.score; scored++; if (app.score > topScore) topScore = app.score; }
    if (app.hasPdf) pdfCount++;
  }
  return { total, avgScore: scored ? Number((totalScore / scored).toFixed(2)) : null, topScore: topScore || null, pdfCount, byStatus };
}

function renderOverview() {
  const apps = lsGet(LS.applications, []);
  const profile = lsGet(LS.profile, {});
  const summary = computeSummary(apps);

  document.getElementById('metrics').innerHTML = [
    ['Tracked roles', summary.total],
    ['Average score', summary.avgScore != null ? `${summary.avgScore}/5` : 'N/A'],
    ['Top score', summary.topScore != null ? `${summary.topScore}/5` : 'N/A'],
    ['PDFs ready', summary.pdfCount],
  ].map(([label, value]) => `
    <article class="metric-card">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
    </article>`).join('');

  const breakdown = Object.entries(summary.byStatus);
  document.getElementById('status-breakdown').innerHTML = breakdown.length
    ? breakdown.map(([s, c]) => `<span class="status-pill ${STATUS_COLORS[s] || 'status-grey'}">${s} · ${c}</span>`).join('')
    : '<span class="muted">No applications yet.</span>';

  document.getElementById('context-info').innerHTML = [
    profile.name ? `<span class="chip">Name: <strong>${profile.name}</strong></span>` : '',
    profile.targetRoles ? `<span class="chip">Roles: <strong>${profile.targetRoles}</strong></span>` : '',
    state.aiConfig?.provider ? `<span class="chip">AI: <strong>${state.aiConfig.provider}${state.aiConfig.model ? ' / ' + state.aiConfig.model : ''}</strong></span>` : '',
  ].filter(Boolean).join('');
}

// ── Applications ──────────────────────────────────────────────────────────────

function renderApplications(filter = '') {
  const all = lsGet(LS.applications, []);
  const apps = filter
    ? all.filter((a) => `${a.company} ${a.role} ${a.status} ${a.notes || ''}`.toLowerCase().includes(filter))
    : all;

  const tbody = document.getElementById('applications-body');
  const empty = document.getElementById('apps-empty');
  if (!apps.length) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  tbody.innerHTML = apps.map((app) => `
    <tr data-id="${app.id}">
      <td>${app.number}</td>
      <td><strong>${app.company}</strong></td>
      <td>${app.role}</td>
      <td>${scoreBadge(app.score)}</td>
      <td>
        <select class="status-select ${STATUS_COLORS[app.status] || 'status-grey'}" data-id="${app.id}">
          ${['Evaluated','Applied','Responded','Interview','Offer','Rejected','Discarded','SKIP']
            .map((s) => `<option value="${s}" ${s === app.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
      <td>${app.date}</td>
      <td>${app.hasPdf ? '<span class="pdf-yes">✅</span>' : '<span class="muted">—</span>'}</td>
      <td class="notes-cell">${app.notes || ''}</td>
    </tr>`).join('');

  document.querySelectorAll('.status-select').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const all = lsGet(LS.applications, []);
      const idx = all.findIndex((a) => a.id === e.target.dataset.id);
      if (idx !== -1) { all[idx].status = e.target.value; lsSet(LS.applications, all); }
      e.target.className = `status-select ${STATUS_COLORS[e.target.value] || 'status-grey'}`;
      renderOverview();
    });
  });
}

// ── CV / Editor ───────────────────────────────────────────────────────────────

function loadEditor(key) {
  state.currentEditorKey = key;
  document.querySelectorAll('.mini-btn').forEach((b) => b.classList.toggle('active', b.dataset.file === key));
  const content = key === 'cv' ? (lsGet(LS.cv) || '') : JSON.stringify(lsGet(LS.profile, {}), null, 2);
  document.getElementById('file-editor').value = content;
}

function saveEditor() {
  const content = document.getElementById('file-editor').value;
  if (state.currentEditorKey === 'cv') {
    lsSet(LS.cv, content);
  } else if (state.currentEditorKey === 'profile') {
    try { lsSet(LS.profile, JSON.parse(content)); } catch { /* invalid JSON, ignore */ }
  }
  document.getElementById('save-feedback').textContent = `Saved at ${new Date().toLocaleTimeString()}`;
}

// ── Reports ───────────────────────────────────────────────────────────────────

function renderReports() {
  const reports = lsGet(LS.reports, []);
  const list = document.getElementById('reports-list');
  if (!reports.length) {
    list.innerHTML = `<div class="empty-state"><p class="empty-icon">📄</p><p class="empty-title">No reports yet</p><p class="muted">Evaluate a role to generate your first report.</p></div>`;
    return;
  }
  list.innerHTML = [...reports].reverse().map((r) => `
    <button class="report-item" data-id="${r.id}">
      <strong>${r.company || 'Report'}</strong>
      <div>${r.title || ''}</div>
      <div class="meta">${r.date}</div>
    </button>`).join('');

  document.querySelectorAll('.report-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.report-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const all = lsGet(LS.reports, []);
      const report = all.find((r) => r.id === btn.dataset.id);
      if (report) document.getElementById('report-preview').innerHTML = marked.parse(report.content);
    });
  });
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
    const cv = lsGet(LS.cv) || '';
    const payload = await api('/api/evaluate', {
      method: 'POST',
      body: JSON.stringify({ jdText, cv }),
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

function saveEvalReport() {
  if (!state.evalResult) return;
  const reports = lsGet(LS.reports, []);
  const id = `r-${Date.now()}`;
  const date = new Date().toLocaleDateString();
  const firstLine = state.evalResult.split('\n').find((l) => l.trim()) || 'Report';
  reports.push({ id, date, company: 'Evaluation', title: firstLine.slice(0, 60), content: state.evalResult });
  lsSet(LS.reports, reports);
  renderReports();
  const btn = document.getElementById('save-report-btn');
  btn.textContent = 'Saved ✓';
  setTimeout(() => { btn.textContent = 'Save to reports'; }, 2000);
}

// ── Export / Import ───────────────────────────────────────────────────────────

function exportData() {
  const data = {
    profile: lsGet(LS.profile),
    cv: lsGet(LS.cv),
    applications: lsGet(LS.applications, []),
    reports: lsGet(LS.reports, []),
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `career-ops-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.profile) lsSet(LS.profile, data.profile);
      if (data.cv) lsSet(LS.cv, data.cv);
      if (data.applications) lsSet(LS.applications, data.applications);
      if (data.reports) lsSet(LS.reports, data.reports);
      window.location.reload();
    } catch {
      alert('Invalid backup file.');
    }
  };
  reader.readAsText(file);
}

// ── Apply profile to UI ───────────────────────────────────────────────────────

function applyProfile() {
  const profile = lsGet(LS.profile, {});
  if (profile.name) {
    const first = profile.name.split(' ')[0];
    document.getElementById('sidebar-title').textContent = `${first}'s Job Search OS`;
    document.getElementById('hero-heading').textContent = `${first}'s search, under control.`;
    document.title = `${first} · Career-Ops`;
  }
}

function applyAiConfig() {
  if (!state.aiConfig?.configured) {
    document.getElementById('ai-badge').textContent = 'AI not configured';
    document.getElementById('eval-ai-label').textContent = 'AI not configured on server';
    document.getElementById('eval-btn').disabled = true;
    document.getElementById('eval-btn').title = 'Set AI_PROVIDER and AI_API_KEY on the server';
  } else {
    const label = `${state.aiConfig.provider}${state.aiConfig.model ? ' / ' + state.aiConfig.model : ''}`;
    document.getElementById('ai-badge').textContent = label;
    document.getElementById('eval-ai-label').textContent = label;
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

function boot() {
  applyProfile();

  api('/api/ai-config').then((cfg) => {
    state.aiConfig = cfg;
    applyAiConfig();
    renderOverview();
  }).catch(() => {});

  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  document.getElementById('hamburger').addEventListener('click', openSidebar);
  document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebar);

  document.querySelectorAll('.mini-btn').forEach((b) => b.addEventListener('click', () => loadEditor(b.dataset.file)));
  document.getElementById('save-file').addEventListener('click', saveEditor);
  document.getElementById('app-search').addEventListener('input', (e) => renderApplications(e.target.value.trim().toLowerCase()));

  document.getElementById('eval-btn').addEventListener('click', runEvaluation);
  document.getElementById('save-report-btn').addEventListener('click', saveEvalReport);

  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('import-input').addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
  });
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-input').click();
  });

  document.getElementById('refresh-all').addEventListener('click', () => {
    renderOverview();
    renderApplications();
    renderReports();
    loadEditor(state.currentEditorKey);
  });

  renderOverview();
  renderApplications();
  renderReports();
  loadEditor('cv');
}

// ── Entry point ───────────────────────────────────────────────────────────────

(function init() {
  const profile = lsGet(LS.profile);
  if (!profile || !profile.name) {
    document.getElementById('onboarding').classList.remove('hidden');
    initOnboarding();
    showStep(1);
  } else {
    document.getElementById('app').style.display = '';
    boot();
  }
})();
