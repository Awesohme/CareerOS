import { evaluate } from './ai.mjs';

const FETCH_TIMEOUT_MS = 10_000;
const AI_CONCURRENCY = 3;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms)),
  ]);
}

function dedup(jobs) {
  const seen = new Set();
  return jobs.filter((j) => {
    const key = `${j.company}||${j.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applyTitleFilters(jobs, filters = {}) {
  const positive = (filters.positive || []).map((k) => k.toLowerCase());
  const negative = (filters.negative || []).map((k) => k.toLowerCase());
  if (!positive.length && !negative.length) return jobs;
  return jobs.filter((job) => {
    const title = (job.title || '').toLowerCase();
    const hasPositive = !positive.length || positive.some((k) => title.includes(k));
    const hasNegative = negative.some((k) => title.includes(k));
    return hasPositive && !hasNegative;
  });
}

export async function scanGreenhouse(companies, filters) {
  const greenhouse = companies.filter((c) => c.enabled !== false && c.api);
  const results = await Promise.allSettled(
    greenhouse.map(async (company) => {
      const res = await withTimeout(fetch(company.api, { headers: { 'User-Agent': 'career-ops/1.0' } }), FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const jobs = (data.jobs || []).map((j) => ({
        company: company.name,
        title: j.title,
        url: j.absolute_url || j.url,
        location: (j.location?.name || j.offices?.[0]?.name || 'Remote'),
      }));
      return { company: company.name, jobs: dedup(applyTitleFilters(jobs, filters)) };
    })
  );

  const jobs = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      jobs.push(...r.value.jobs);
    } else {
      errors.push({ company: greenhouse[i].name, reason: r.reason?.message || 'Failed' });
    }
  });
  return { jobs, errors };
}

export async function scanWithAI(companies, filters) {
  const aiCompanies = companies.filter((c) => c.enabled !== false && !c.api && c.careers_url);

  const jobs = [];
  const errors = [];

  for (let i = 0; i < aiCompanies.length; i += AI_CONCURRENCY) {
    const batch = aiCompanies.slice(i, i + AI_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (company) => {
        const res = await withTimeout(
          fetch(company.careers_url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; career-ops/1.0)',
              Accept: 'text/html,application/xhtml+xml',
            },
          }),
          FETCH_TIMEOUT_MS
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        const trimmed = html.slice(0, 15_000);

        const systemPrompt = `You are a job listing extractor. Extract all job listings from the HTML below.
Return ONLY a valid JSON array with this exact shape (no markdown, no explanation):
[{"title": "Job Title", "url": "https://...", "location": "City or Remote"}]
If you find no listings, return [].`;

        const raw = await evaluate(systemPrompt, `HTML from ${company.careers_url}:\n${trimmed}`);
        const match = raw.match(/\[[\s\S]*\]/);
        if (!match) return { company: company.name, jobs: [] };
        const parsed = JSON.parse(match[0]);
        const companyJobs = parsed.map((j) => ({ ...j, company: company.name }));
        return { company: company.name, jobs: applyTitleFilters(companyJobs, filters) };
      })
    );

    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        jobs.push(...r.value.jobs);
      } else {
        errors.push({ company: batch[idx].name, reason: r.reason?.message || 'Failed' });
      }
    });
  }

  return { jobs, errors };
}
