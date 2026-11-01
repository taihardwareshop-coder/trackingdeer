#!/usr/bin/env node
/**
 * Push a content/news/*.json article into SMARTCY as an agent draft (review queue).
 *
 * Creates or updates a draft for target `m-specialist.com/news`; does not submit
 * unless --submit is passed (submit creates the review reminder for 主公).
 *
 * usage: node tools/news-draft.mjs --slug=<slug> [--submit] [--list]
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const SITE = path.resolve(arg('site', '.'));
const BASE = 'http://10.221.246.70:8090';
const TARGET = 'm-specialist.com/news';
const CATEGORIES = {
  hacksaw: 'Hacksaw Blades',
  'air-saw': 'Air Saw Blades',
  coping: 'Coping Saw Blades',
  'mini-hacksaw': 'Mini Hacksaw Blades',
  'mini-jigsaw': 'Mini Jigsaw Blades',
  'scroll-saw': 'Scroll Saw Blades',
  'handy-saw': 'Handy Saw',
  general: 'Company & Market',
};

const creds = JSON.parse(
  (await readFile(path.resolve(SITE, '..', '.dsh', 'secrets', 'smartcy.json'), 'utf8')).replace(/^\uFEFF/, ''),
);

async function login() {
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: creds.username, password: creds.password }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('login returned no session cookie');
  return cookie;
}

async function api(cookie, pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${pathname} -> ${res.status} ${String(text).slice(0, 300)}`);
  return body;
}

const STYLE = `<style>
.a{font-family:'Inter',-apple-system,'Segoe UI',system-ui,'Noto Sans TC',sans-serif;max-width:780px;margin:0 auto;padding:6px;color:#334155}
.a h1{font-size:32px;line-height:1.25;color:#0f172a;margin:0 0 8px;letter-spacing:-.02em}
.a .meta{color:#64748b;font-size:14px;margin-bottom:22px}
.a h2{font-size:23px;color:#0f172a;margin:32px 0 12px}
.a h3{font-size:19px;color:#0f172a;margin:24px 0 10px}
.a p,.a li{font-size:17px;line-height:1.75}
.a table{width:100%;border-collapse:collapse;margin:18px 0;font-size:15px}
.a th,.a td{border:1px solid #e2e8f0;padding:10px 12px;text-align:left}
.a th{background:#f8fafc}
.a img{max-width:100%;height:auto;border-radius:12px}
</style>`;

function bodyHtml(article) {
  return `${STYLE}
<article class="a">
<h1>${article.title}</h1>
<div class="meta">${article.date} · ${CATEGORIES[article.category] ?? article.category}</div>
<img src="https://www.m-specialist.com/${article.cover}" alt="${article.title}">
${article.body}
</article>`;
}

const cookie = await login();

if (process.argv.includes('--list')) {
  const list = await api(cookie, `/api/agent/drafts?target=${encodeURIComponent(TARGET)}`);
  console.log(JSON.stringify(list, null, 2));
  process.exit(0);
}

const slug = arg('slug');
if (!slug) throw new Error('need --slug=<file name without .json>');
const article = JSON.parse((await readFile(path.join(SITE, 'content', 'news', `${slug}.json`), 'utf8')));

const existing = await api(cookie, `/api/agent/drafts?target=${encodeURIComponent(TARGET)}`);
const mine = (existing.drafts ?? existing ?? []).find((d) => d.title === article.title);

const payload = {
  title: article.title,
  body: article.summary,
  body_html: bodyHtml(article),
  lang: article.lang ?? 'zh',
  target: TARGET,
  content_type: 'html',
};
let result;
if (mine && ['draft', 'rejected'].includes(mine.status)) {
  result = await api(cookie, `/api/agent/drafts/${mine.id}`, { method: 'PUT', body: JSON.stringify(payload) });
  console.log(`updated draft #${mine.id}`);
} else {
  result = await api(cookie, '/api/agent/drafts', { method: 'POST', body: JSON.stringify(payload) });
  console.log(`created draft #${result.id ?? result.draft?.id}`);
}

const id = result.id ?? result.draft?.id ?? mine?.id;
if (process.argv.includes('--submit')) {
  await api(cookie, `/api/agent/drafts/${id}/submit`, { method: 'POST', body: '{}' });
  console.log(`submitted #${id} for review`);
}
console.log(JSON.stringify({ id, preview: `${BASE}/api/agent/drafts/${id}/preview`, page: `${BASE}/pages/dsh-drafts.html` }, null, 2));
