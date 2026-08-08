#!/usr/bin/env node
/**
 * 从 GitHub 拉取项目 README 与 docs/，写入 Astro Content Layer。
 *
 * 清单：src/data/github-projects.json
 * 输出：src/content/projects/ 、 src/content/project-docs/
 *
 * 认证（任选）：GITHUB_TOKEN / GH_TOKEN 环境变量，或已登录的 `gh auth token`
 */

import { execSync } from 'node:child_process';
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MANIFEST = join(ROOT, 'src/data/github-projects.json');
const OUT_PROJECTS = join(ROOT, 'src/content/projects');
const OUT_DOCS = join(ROOT, 'src/content/project-docs');
const CURRENT_REPO = 'versechen/versechen.github.io';

const API = 'https://api.github.com';
const args = new Set(process.argv.slice(2));
const slugFilter = [...args].find((a) => a.startsWith('--slug='))?.slice('--slug='.length);

function resolveToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    return execSync('gh auth token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const TOKEN = resolveToken();

async function gh(path, { raw = false } = {}) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const headers = {
    Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
    'User-Agent': 'codeverse-sync-github-projects',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  const res = await fetch(url, { headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${res.status} ${url}\n${body.slice(0, 400)}`);
  }
  if (raw) return await res.text();
  return await res.json();
}

/** 本站仓库优先读本地文件，避免「先推送才能同步自己」的鸡生蛋问题 */
function readLocalIfCurrent(repo, filePath) {
  if (repo !== CURRENT_REPO) return null;
  const abs = join(ROOT, filePath);
  if (!existsSync(abs) || !statSync(abs).isFile()) return null;
  return readFileSync(abs, 'utf8');
}

async function fetchFile(repo, filePath) {
  const local = readLocalIfCurrent(repo, filePath);
  if (local != null) return local;
  return gh(`/repos/${repo}/contents/${encodeURI(filePath)}`, { raw: true });
}

async function fetchReadme(repo) {
  const localCandidates = ['README.md', 'readme.md', 'Readme.md'];
  if (repo === CURRENT_REPO) {
    for (const name of localCandidates) {
      const abs = join(ROOT, name);
      if (existsSync(abs)) return readFileSync(abs, 'utf8');
    }
  }
  const text = await gh(`/repos/${repo}/readme`, { raw: true });
  return text;
}

/** 脱敏：避免把误进仓库的 token 写进静态站 */
function redactSecrets(text) {
  return text
    .replace(/\b(sk|sk-ant|sk-proj)-[A-Za-z0-9_\-]{16,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_GITHUB_PAT]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, '[REDACTED_SLACK_TOKEN]')
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*["'][^"']{8,}["']/gi, '$1: "[REDACTED]"');
}

function isAbsoluteOrSpecialUrl(url) {
  return /^(?:[a-z]+:|\/\/|\/|#|data:)/i.test(url);
}

/**
 * 把 Markdown / HTML 里的相对资源路径改成 GitHub raw URL，
 * 避免 Astro 在构建时去解析仓库内不存在的本地图片。
 */
function rewriteAssetUrls(md, repo, filePath, branch) {
  const dir = posix.dirname(filePath);
  const rawBase = `https://raw.githubusercontent.com/${repo}/${branch}`;

  const toRaw = (url) => {
    const cleaned = url.trim().replace(/^<|>$/g, '').split(' ')[0];
    if (!cleaned || isAbsoluteOrSpecialUrl(cleaned)) return null;
    const abs = posix.normalize(posix.join(dir === '.' ? '' : dir, cleaned)).replace(/^\//, '');
    return `${rawBase}/${abs}`;
  };

  let out = md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (full, alt, src) => {
    const raw = toRaw(src);
    return raw ? `![${alt}](${raw})` : full;
  });

  out = out.replace(/\bsrc=["']([^"']+)["']/g, (full, src) => {
    const raw = toRaw(src);
    return raw ? `src="${raw}"` : full;
  });

  return out;
}

function yamlEscape(value) {
  if (value == null) return '""';
  const s = String(value);
  if (/^[\w./:@+-]+$/u.test(s)) return s;
  return JSON.stringify(s);
}

function toFrontmatter(fields) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => yamlEscape(v)).join(', ')}]`);
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${yamlEscape(value)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

function stripExistingFrontmatter(md) {
  if (!md.startsWith('---')) return md;
  const end = md.indexOf('\n---', 3);
  if (end === -1) return md;
  return md.slice(end + 4).replace(/^\s*\n/, '');
}

function titleFromMarkdown(md, fallback) {
  const m = md.match(/^#\s+(.+)$/m);
  return (m?.[1] ?? fallback).replace(/\s+/g, ' ').trim();
}

function descriptionFromMarkdown(md) {
  const body = stripExistingFrontmatter(md)
    .replace(/^#.+$/m, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[[^\]]*]\([^)]*\)/g, '')
    .replace(/[>*_`#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return body.slice(0, 140);
}

/**
 * 解析 GitBook SUMMARY.md
 * 返回 { path, title, section, order }[]
 */
function parseSummary(summaryText, docsRoot) {
  const hasHashSections = /^##\s+/m.test(summaryText);
  const lines = summaryText.split(/\r?\n/);
  let section = '文档';
  let lastTopTitle = '文档';
  let order = 0;
  const items = [];

  for (const raw of lines) {
    if (!raw.trim()) continue;

    const sectionMatch = raw.trim().match(/^##\s+(.+)/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }

    const itemMatch = raw.match(/^(\s*)\*\s+\[([^\]]+)\]\(([^)]+)\)/);
    if (!itemMatch) continue;

    const indent = itemMatch[1].replace(/\t/g, '  ').length;
    const title = itemMatch[2].trim();
    let href = itemMatch[3].trim().replace(/^\.\//, '');
    if (href.startsWith('#') || href.includes('://')) continue;
    href = href.split('#')[0];
    if (!href.endsWith('.md') && !href.endsWith('.MD')) continue;

    // 无 ## 时：顶层归「目录」，缩进子项归到最近的顶层标题
    let itemSection = section;
    if (!hasHashSections) {
      if (indent <= 1) {
        lastTopTitle = title;
        itemSection = '目录';
      } else {
        itemSection = lastTopTitle;
      }
    }

    let absPath = href;
    if (docsRoot && docsRoot !== '.') {
      if (!href.startsWith(`${docsRoot}/`) && href !== docsRoot) {
        absPath = posix.join(docsRoot, href);
      }
    }
    absPath = posix.normalize(absPath).replace(/^\//, '');

    items.push({ path: absPath, title, section: itemSection, order: order++ });
  }
  return items;
}

function shouldExclude(path, exclude = []) {
  const parts = path.split('/');
  return exclude.some((ex) => parts.includes(ex) || path.includes(`/${ex}/`) || path.startsWith(`${ex}/`));
}

async function getDefaultBranch(repo) {
  if (repo === CURRENT_REPO) {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || 'main';
    } catch {
      return 'main';
    }
  }
  const repoInfo = await gh(`/repos/${repo}`);
  if (!repoInfo) throw new Error(`仓库不存在：${repo}`);
  return repoInfo.default_branch || 'main';
}

async function listMarkdownViaTree(repo, docsPath, exclude, maxFiles, branch) {
  const tree = await gh(`/repos/${repo}/git/trees/${branch}?recursive=1`);
  if (!tree?.tree) return [];

  const prefix = docsPath === '.' ? '' : `${docsPath.replace(/\/$/, '')}/`;
  const files = tree.tree
    .filter((t) => t.type === 'blob')
    .map((t) => t.path)
    .filter((p) => p.endsWith('.md') || p.endsWith('.MD'))
    .filter((p) => (prefix ? p.startsWith(prefix) : true))
    .filter((p) => !shouldExclude(p, exclude))
    .filter((p) => !/(^|\/)(SUMMARY|summary)\.md$/i.test(p))
    .sort((a, b) => a.localeCompare(b));

  return files.slice(0, maxFiles).map((path, order) => ({
    path,
    title: null,
    section: inferSection(path, docsPath),
    order,
  }));
}

function listMarkdownLocal(docsPath, exclude, maxFiles) {
  const root = docsPath === '.' ? ROOT : join(ROOT, docsPath);
  if (!existsSync(root)) return [];
  const files = [];

  function walk(dir) {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = relative(ROOT, abs).split('\\').join('/');
      if (shouldExclude(rel, exclude)) continue;
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (/\.md$/i.test(name) && !/^SUMMARY\.md$/i.test(name)) {
        files.push(rel);
      }
    }
  }
  walk(root);
  return files.sort((a, b) => a.localeCompare(b)).slice(0, maxFiles).map((path, order) => ({
    path,
    title: null,
    section: inferSection(path, docsPath),
    order,
  }));
}

function inferSection(path, docsPath) {
  const prefix = docsPath === '.' ? '' : `${docsPath.replace(/\/$/, '')}/`;
  const rel = prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
  const dir = posix.dirname(rel);
  if (!dir || dir === '.') return '文档';
  return dir.split('/')[0];
}

/** 把仓库内路径映射为 content id 用的相对路径（去掉 docs 前缀与 .md） */
function toDocIdPath(repoPath, docsPath) {
  const prefix = docsPath === '.' ? '' : `${docsPath.replace(/\/$/, '')}/`;
  let rel = prefix && repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : repoPath;
  rel = rel.replace(/\.md$/i, '');
  if (rel === 'README' || rel === 'readme' || rel === 'Readme') rel = 'index';
  return rel || 'index';
}

function ensureEmptyDir(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.gitkeep'), '');
}

async function syncProject(project) {
  const {
    slug,
    repo,
    name,
    description,
    icon = '📦',
    tags = [],
    status = 'active',
    link,
    order = 99,
    github,
    docs,
  } = project;

  console.log(`\n→ ${slug} (${repo})`);
  const branch = await getDefaultBranch(repo);

  let readme = await fetchReadme(repo);
  if (!readme) throw new Error(`无法获取 README：${repo}`);
  readme = rewriteAssetUrls(
    redactSecrets(stripExistingFrontmatter(readme)),
    repo,
    'README.md',
    branch
  );

  // ---- docs ----
  let hasDocs = false;

  if (docs) {
    const docsPath = docs.path ?? 'docs';
    const exclude = docs.exclude ?? ['.gitbook', '.i18n', 'assets', 'images', 'node_modules'];
    const maxFiles = docs.maxFiles ?? 50;
    const optional = Boolean(docs.optional);
    let docEntries = [];

    try {
      if (docs.summary) {
        const summaryText = await fetchFile(repo, docs.summary);
        if (summaryText) {
          docEntries = parseSummary(summaryText, docsPath === '.' ? '' : docsPath)
            .filter((d) => !shouldExclude(d.path, exclude))
            .slice(0, maxFiles);
        }
      }

      if (docEntries.length === 0) {
        docEntries =
          repo === CURRENT_REPO
            ? listMarkdownLocal(docsPath, exclude, maxFiles)
            : await listMarkdownViaTree(repo, docsPath, exclude, maxFiles, branch);
      }

      const written = [];
      for (const entry of docEntries) {
        let body = await fetchFile(repo, entry.path);
        if (body == null) {
          console.warn(`  skip missing ${entry.path}`);
          continue;
        }
        body = rewriteAssetUrls(
          redactSecrets(stripExistingFrontmatter(body)),
          repo,
          entry.path,
          branch
        );
        const idPath = toDocIdPath(entry.path, docsPath);
        const outFile = join(OUT_DOCS, slug, `${idPath}.md`);
        mkdirSync(dirname(outFile), { recursive: true });

        const title = entry.title || titleFromMarkdown(body, idPath);
        const fm = toFrontmatter({
          title,
          description: descriptionFromMarkdown(body) || undefined,
          order: entry.order,
          section: entry.section || '文档',
        });
        writeFileSync(outFile, fm + body.trimEnd() + '\n');
        written.push(idPath);
      }

      hasDocs = written.length > 0;
      console.log(`  docs: ${written.length} 篇`);
    } catch (err) {
      if (optional) {
        console.warn(`  docs 可选，已跳过：${err.message}`);
        hasDocs = false;
      } else {
        throw err;
      }
    }
  } else {
    console.log('  docs: （未配置）');
  }

  // ---- project README entry ----
  const projectFm = toFrontmatter({
    name,
    description,
    icon,
    tags,
    status,
    github: github || `https://github.com/${repo}`,
    link,
    order,
    hasDocs,
  });
  writeFileSync(join(OUT_PROJECTS, `${slug}.md`), projectFm + readme.trimEnd() + '\n');
  console.log('  README: ok');
}

async function main() {
  if (!TOKEN) {
    console.warn('⚠ 未检测到 GITHUB_TOKEN / gh auth，将以未认证方式请求（限额较低）。');
  } else {
    console.log('✓ 使用 GitHub 认证拉取');
  }

  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const projects = slugFilter
    ? manifest.filter((p) => p.slug === slugFilter)
    : manifest;

  if (projects.length === 0) {
    throw new Error(slugFilter ? `清单中没有 slug=${slugFilter}` : '清单为空');
  }

  if (!slugFilter) {
    ensureEmptyDir(OUT_PROJECTS);
    ensureEmptyDir(OUT_DOCS);
  } else {
    mkdirSync(OUT_PROJECTS, { recursive: true });
    mkdirSync(OUT_DOCS, { recursive: true });
    for (const p of projects) {
      rmSync(join(OUT_PROJECTS, `${p.slug}.md`), { force: true });
      rmSync(join(OUT_DOCS, p.slug), { recursive: true, force: true });
    }
  }

  for (const project of projects) {
    await syncProject(project);
  }

  console.log(`\n完成：${projects.length} 个项目 → ${relative(ROOT, OUT_PROJECTS)} / ${relative(ROOT, OUT_DOCS)}`);
}

main().catch((err) => {
  console.error('\n同步失败：', err.message || err);
  process.exit(1);
});
