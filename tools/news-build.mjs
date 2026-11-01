#!/usr/bin/env node
/**
 * Build the news section from content/news/*.json into static HTML.
 *
 * Pages produced (under the site root):
 *   news/index.html            all articles, page 1
 *   news/all-2.html …          all articles, page 2+
 *   news/<category>.html       category page 1
 *   news/<category>-2.html …   category page 2+
 *   news/<slug>.html           article
 *   news/feed.xml              RSS 2.0
 *   index.html                 "最新消息" block between NEWS:HOME markers
 *   sitemap.xml                news URLs between NEWS:SITEMAP markers
 *
 * usage: node tools/news-build.mjs [--site=<dir>]
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const SITE = path.resolve(process.argv.find((a) => a.startsWith('--site='))?.slice(7) ?? '.');
const SITE_URL = 'https://www.m-specialist.com';
const PER_PAGE = 9;

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

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const iso = (d) => new Date(`${d}T00:00:00+08:00`).toISOString();

const index = await readFile(path.join(SITE, 'index.html'), 'utf8');
const head = index.slice(0, index.indexOf('</head>') + 7);
const bodyPrefix = index.slice(index.indexOf('<body'), index.indexOf('<!-- Header Navigation -->'));
const headerStart = index.indexOf('<!-- Header Navigation -->');
const header = index.slice(headerStart, index.indexOf('</header>') + '</header>'.length);
const footer = index.slice(index.indexOf('<footer'), index.indexOf('</footer>') + '</footer>'.length);
const scripts = [...index.matchAll(/<script[^>]+src="[^"]+"[^>]*><\/script>/g)].map((m) => m[0]).join('\n');

/** Prefix relative URLs once, so the same fragment works at any depth. */
function shift(fragment, depth) {
  if (!depth) return fragment;
  return fragment
    .replace(/(href|src)="(?![a-z]+:|\/\/|#|data:)([^"]*)"/gi, (_m, attr, url) => `${attr}="${depth}${url}"`)
    .replace(/href="#/g, `href="${depth}index.html#`);
}

function renderHead({ title, description, canonical, image, jsonld }) {
  let h = head;
  h = h.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  h = h.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(description)}">`);
  h = h.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`);
  h = h.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(description)}">`);
  h = h.replace(/<meta property="og:type" content="[^"]*">/, '<meta property="og:type" content="article">');
  h = h.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${canonical}">`);
  h = h.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${image}">`);
  h = h.replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${image}">`);
  h = h.replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${esc(title)}">`);
  h = h.replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${esc(description)}">`);
  h = h.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${canonical}">`);
  return h.replace('</head>', `  <link rel="stylesheet" href="assets/css/news.css">\n${jsonld ? `  <script type="application/ld+json">${JSON.stringify(jsonld)}</script>\n` : ''}</head>`);
}

function page({ headHtml, depth, main, extraClass = '' }) {
  return `${shift(headHtml, depth)}${shift(bodyPrefix, depth)}${shift(header, depth)}<main id="main" class="${extraClass}">${main}</main>${shift(footer, depth)}${shift(scripts, depth)}</body>\n</html>\n`;
}

function card(a, depth) {
  const href = `${depth}news/${a.slug}.html`;
  return `<a class="news-card" href="${href}">
  <img src="${depth}${a.cover}" alt="${esc(a.title)}" loading="lazy" width="640" height="360">
  <div class="news-card-body">
    <div class="news-meta"><span>${a.date}</span><span>${esc(CATEGORIES[a.category] ?? a.category)}</span></div>
    <h2>${esc(a.title)}</h2>
    <p>${esc(a.summary)}</p>
  </div>
</a>`;
}

function chips(active, depth) {
  const items = [['', '全部'], ...Object.entries(CATEGORIES)];
  return `<div class="news-chips">${items
    .map(([slug, label]) => {
      const href = slug === '' ? `${depth}news/index.html` : `${depth}news/${slug}.html`;
      const cur = slug === active ? ' aria-current="page"' : '';
      return `<a class="news-chip" href="${href}"${cur}>${esc(label)}</a>`;
    })
    .join('')}</div>`;
}

function pager(pageNo, totalPages, nameFor) {
  if (totalPages <= 1) return '';
  const parts = [];
  for (let i = 1; i <= totalPages; i += 1) {
    const url = `../news/${nameFor(i)}`;
    parts.push(i === pageNo ? `<span aria-current="page">${i}</span>` : `<a href="${url}">${i}</a>`);
  }
  return `<nav class="news-pager" aria-label="Pagination">${parts.join('')}</nav>`;
}

const files = (await readdir(path.join(SITE, 'content', 'news'), { withFileTypes: true })).filter((f) => f.isFile() && f.name.endsWith('.json'));
const articles = [];
for (const f of files) {
  const raw = await readFile(path.join(SITE, 'content', 'news', f.name), 'utf8');
  const data = JSON.parse(raw);
  articles.push(data);
}
articles.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));

await mkdir(path.join(SITE, 'news'), { recursive: true });

// --- article pages ---
for (const a of articles) {
  const canonical = `${SITE_URL}/news/${a.slug}.html`;
  const image = a.cover.startsWith('http') ? a.cover : `${SITE_URL}/${a.cover.replace(/^\.\//, '')}`;
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: a.title,
    description: a.summary,
    datePublished: iso(a.date),
    dateModified: iso(a.date),
    image: [image],
    articleSection: CATEGORIES[a.category] ?? a.category,
    author: { '@type': 'Organization', name: 'M-Specialist | Chang Yung Metal Work Co., Ltd.' },
    publisher: { '@type': 'Organization', name: 'M-Specialist', logo: { '@type': 'ImageObject', url: `${SITE_URL}/assets/img/site/logo.png` } },
    mainEntityOfPage: canonical,
    inLanguage: 'zh-Hant',
  };
  const headHtml = renderHead({ title: `${a.title} | M-Specialist`, description: a.summary, canonical, image, jsonld });
  const main = `<article class="news-article">
  <div class="news-meta"><a href="../index.html">首頁</a> / <a href="index.html">最新消息</a> / <span>${esc(CATEGORIES[a.category] ?? a.category)}</span></div>
  <h1>${esc(a.title)}</h1>
  <div class="news-meta"><time datetime="${a.date}">${a.date}</time></div>
  <img class="news-cover" src="../${a.cover}" alt="${esc(a.title)}" width="1200" height="675">
  ${a.body}
  <div class="news-cta">
    <p>需要這個規格的樣品或報價？我們在台灣生產，可做 OEM／自有品牌包裝。</p>
    <a href="../index.html#contact">取得報價</a>
  </div>
  <div class="news-related"><a href="index.html">← 回最新消息</a></div>
</article>`;
  await writeFile(path.join(SITE, 'news', `${a.slug}.html`), page({ headHtml, depth: '../', main }));
}

// --- list pages ---
async function writeList({ filter, slug, label, description }) {
  const list = filter ? articles.filter((a) => a.category === filter) : articles;
  const totalPages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const nameFor = (p) =>
    slug ? (p === 1 ? `${slug}.html` : `${slug}-${p}.html`) : p === 1 ? 'index.html' : `all-${p}.html`;
  for (let p = 1; p <= totalPages; p += 1) {
    const slice = list.slice((p - 1) * PER_PAGE, p * PER_PAGE);
    const file = nameFor(p);
    const canonical = `${SITE_URL}/news/${file === 'index.html' ? '' : file}`;
    const headHtml = renderHead({
      title: slug === '' ? '最新消息 | M-Specialist' : `${label} | 最新消息 | M-Specialist`,
      description,
      canonical,
      image: `${SITE_URL}/assets/img/og/og-index.jpg`,
      jsonld: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `${label} — M-Specialist News`,
        url: canonical,
        inLanguage: 'zh-Hant',
      },
    });
    const main = `<section class="news-hero"><div class="news-wrap"><h1>最新消息</h1><p>${esc(description)}</p></div></section>
<div class="news-wrap">${chips(slug, '../')}<div class="news-grid">${slice.map((a) => card(a, '../')).join('\n') || '<p class="news-empty">這個分類還沒有文章。</p>'}</div>${pager(p, totalPages, nameFor)}</div>`;
    await writeFile(path.join(SITE, 'news', file), page({ headHtml, depth: '../', main }));
  }
}

await writeList({ filter: null, slug: '', label: '最新消息', description: '產品選型、加工實務與採購資訊。由 M-Specialist 工程團隊整理。' });
for (const [slug, label] of Object.entries(CATEGORIES)) {
  await writeList({ filter: slug, slug, label, description: `${label} 的選型、應用與採購筆記。` });
}

// --- RSS ---
const rssItems = articles
  .slice(0, 20)
  .map(
    (a) => `    <item>
      <title>${esc(a.title)}</title>
      <link>${SITE_URL}/news/${a.slug}.html</link>
      <guid isPermaLink="true">${SITE_URL}/news/${a.slug}.html</guid>
      <pubDate>${new Date(`${a.date}T09:00:00+08:00`).toUTCString()}</pubDate>
      <category>${esc(CATEGORIES[a.category] ?? a.category)}</category>
      <description>${esc(a.summary)}</description>
    </item>`,
  )
  .join('\n');
await writeFile(
  path.join(SITE, 'news', 'feed.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
    <title>M-Specialist — 最新消息</title>
    <link>${SITE_URL}/news/index.html</link>
    <description>產品選型、加工實務與採購資訊。</description>
    <language>zh-Hant</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${rssItems}
</channel></rss>
`,
);

// --- homepage block ---
const top3 = articles.slice(0, 3);
const homeBlock = `<!-- NEWS:HOME:START -->
<section class="home-news" id="news">
  <div class="news-wrap">
    <div class="home-news-head">
      <h2>最新消息</h2>
      <a href="news/index.html">全部文章 →</a>
    </div>
    <div class="news-grid">${top3.map((a) => card(a, '')).join('\n')}</div>
  </div>
</section>
<!-- NEWS:HOME:END -->`;

let home = await readFile(path.join(SITE, 'index.html'), 'utf8');
if (home.includes('<!-- NEWS:HOME:START -->')) {
  home = home.replace(/<!-- NEWS:HOME:START -->[\s\S]*?<!-- NEWS:HOME:END -->/, homeBlock);
} else {
  const anchor = home.indexOf('<footer');
  home = `${home.slice(0, anchor)}${homeBlock}\n${home.slice(anchor)}`;
}
// nav link
home = home.replace(
  /(<a href="#why-us")/,
  '<a href="news/index.html" class="hover:text-emerald-400 transition">NEWS</a>\n                $1',
);
await writeFile(path.join(SITE, 'index.html'), home);

// --- sitemap ---
let sitemap = await readFile(path.join(SITE, 'sitemap.xml'), 'utf8');
sitemap = sitemap.replace(/<!-- NEWS:SITEMAP:START -->[\s\S]*?<!-- NEWS:SITEMAP:END -->\n?/, '');
const urls = ['index.html', ...Object.keys(CATEGORIES).map((c) => `${c}.html`), ...articles.map((a) => `${a.slug}.html`)];
const entries = urls
  .map((u) => {
    const loc = u === 'index.html' ? `${SITE_URL}/news/` : `${SITE_URL}/news/${u}`;
    const last = u === 'index.html' ? (articles[0]?.date ?? new Date().toISOString().slice(0, 10)) : (articles.find((a) => `${a.slug}.html` === u)?.date ?? '');
    return `  <url><loc>${loc}</loc>${last ? `<lastmod>${last}</lastmod>` : ''}<changefreq>weekly</changefreq><priority>0.6</priority></url>`;
  })
  .join('\n');
sitemap = sitemap.replace('</urlset>', `<!-- NEWS:SITEMAP:START -->\n${entries}\n<!-- NEWS:SITEMAP:END -->\n</urlset>`);
await writeFile(path.join(SITE, 'sitemap.xml'), sitemap);

console.log(JSON.stringify({ articles: articles.length, categories: Object.keys(CATEGORIES).length, perPage: PER_PAGE, pages: ['news/index.html', ...articles.map((a) => `news/${a.slug}.html`)] }, null, 2));
