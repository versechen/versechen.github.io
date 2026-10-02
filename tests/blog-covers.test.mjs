import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { assignBlogCover, readCoverFilename, unusedCovers } from '../src/lib/blog-covers.mjs';

const article = '---\ntitle: Example\n---\n\n## Body\n\n```yaml\nheroImage: ignored.svg\n```\n';
const initial = () => ({ version: 1, presets: ['a.svg', 'b.svg', 'c.svg'], assigned: {} });

test('draws without replacement, preserves the article body, and keeps covers across updates', () => {
  let registry = initial();
  const selected = [];
  for (const slug of ['first', 'second', 'third']) {
    const result = assignBlogCover(article, slug, registry, () => 0.75);
    registry = result.registry;
    selected.push(result.cover);
    assert.equal(result.markdown.split('\n---\n')[1], article.split('\n---\n')[1]);
    const updated = assignBlogCover(article, slug, registry, () => { throw new Error('must not draw again'); });
    assert.equal(updated.cover, result.cover);
  }
  assert.equal(new Set(selected).size, 3);
  assert.throws(() => assignBlogCover(article, 'fourth', registry), /全部使用/);
  assert.equal(unusedCovers(registry).length, 0);
});

test('historical/deleted assignments and explicit choices cannot be reused', () => {
  const registry = initial();
  registry.assigned.deleted = 'a.svg';
  const source = article.replace('title: Example', "title: Example\nheroImage: '../../assets/images/a.svg'");
  assert.throws(() => assignBlogCover(source, 'new', registry), /已使用/);
  assert.deepEqual(unusedCovers(registry), ['b.svg', 'c.svg']);
  assert.equal(assignBlogCover(article, 'new', registry, () => 0).cover, 'b.svg');
  assert.deepEqual(registry.assigned, { deleted: 'a.svg' });
});

test('supports nested articles and quoted frontmatter, ignores body examples', () => {
  assert.equal(readCoverFilename(article), '');
  const chosen = assignBlogCover(article, 'series/lesson', initial(), () => 0);
  assert.match(chosen.markdown, /heroImage: '\.\.\/\.\.\/\.\.\/assets\/images\/a.svg'/);
  assert.equal(readCoverFilename(chosen.markdown.replace("'../../../assets/images/a.svg'", '"../../../assets/images/a.svg" # comment')), 'a.svg');
  assert.throws(() => readCoverFilename(chosen.markdown.replace('title: Example', "title: Example\nheroImage: '../../assets/images/b.svg'")), /重复/);
});

test('exhaustion does not partly write articles or the registry', () => {
  const root = mkdtempSync(join(tmpdir(), 'blog-covers-'));
  try {
    for (const dir of ['scripts', 'src/lib', 'src/config', 'src/assets/images', 'src/content/blog']) mkdirSync(join(root, dir), { recursive: true });
    cpSync(new URL('../scripts/assign-blog-covers.mjs', import.meta.url), join(root, 'scripts/assign-blog-covers.mjs'));
    cpSync(new URL('../src/lib/blog-covers.mjs', import.meta.url), join(root, 'src/lib/blog-covers.mjs'));
    const registry = JSON.stringify({ version: 1, presets: ['a.svg'], assigned: {} });
    writeFileSync(join(root, 'src/config/blog-covers.json'), registry);
    writeFileSync(join(root, 'src/assets/images/a.svg'), '<svg/>');
    for (const slug of ['one', 'two']) writeFileSync(join(root, `src/content/blog/${slug}.md`), article);
    const result = spawnSync(process.execPath, [join(root, 'scripts/assign-blog-covers.mjs')], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /全部使用/);
    assert.equal(readFileSync(join(root, 'src/config/blog-covers.json'), 'utf8'), registry);
    for (const slug of ['one', 'two']) assert.equal(readFileSync(join(root, `src/content/blog/${slug}.md`), 'utf8'), article);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Import the actual publisher with its TypeScript-only syntax removed.
const esm = source => ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const notesUrl = moduleUrl(esm(readFileSync(new URL('../src/lib/notes.ts', import.meta.url), 'utf8')));
const publisherSource = esm(readFileSync(new URL('../src/lib/notes-remote.ts', import.meta.url), 'utf8'))
  .replace("'./notes'", JSON.stringify(notesUrl))
  .replace("'./blog-covers.mjs'", JSON.stringify(new URL('../src/lib/blog-covers.mjs', import.meta.url).href));
const { publishBlogPost } = await import(moduleUrl(publisherSource));

function gitFixture(registry) {
  const files = { 'src/config/blog-covers.json': JSON.stringify(registry) };
  const trees = new Map([['t0', files]]), commits = new Map([['h0', { tree: 't0' }]]), blobs = new Map();
  let head = 'h0', id = 0, writes = 0;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const fetch = async (url, options = {}) => {
    const parsed = new URL(url), path = parsed.pathname.replace('/repos/versechen/versechen.github.io', '');
    const data = options.body ? JSON.parse(options.body) : {};
    if (!path) return json({ permissions: { push: true } });
    if (path === '/git/ref/heads/main') return json({ object: { sha: head } });
    if (path.startsWith('/contents/')) {
      assert.ok(parsed.searchParams.get('ref'), 'reads must specify a commit');
      const ref = parsed.searchParams.get('ref');
      const file = trees.get(commits.get(ref).tree)[decodeURIComponent(path.slice('/contents/'.length))];
      return file === undefined ? json({ message: 'Not Found' }, 404) : json({ content: file, encoding: 'utf-8' });
    }
    if (path === '/git/blobs') { const sha = `b${++id}`; blobs.set(sha, data.content); return json({ sha }); }
    if (path === '/git/trees') {
      const sha = `t${++id}`, tree = { ...trees.get(data.base_tree) };
      for (const entry of data.tree) tree[entry.path] = blobs.get(entry.sha);
      trees.set(sha, tree); return json({ sha });
    }
    if (path === '/git/commits') {
      const sha = `h${++id}`; commits.set(sha, { tree: data.tree, parent: data.parents[0] }); return json({ sha });
    }
    if (path.startsWith('/git/commits/')) return json({ tree: { sha: commits.get(path.split('/').at(-1)).tree } });
    if (path === '/git/refs/heads/main') {
      assert.equal(data.force, false);
      if (commits.get(data.sha).parent !== head) return json({ message: 'Reference update failed' }, 422);
      head = data.sha; writes++; return json({ object: { sha: head } });
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  return { fetch, snapshot: () => trees.get(commits.get(head).tree), writes: () => writes };
}

test('publisher writes article and cover ledger atomically, and updates keep the selected cover', async t => {
  const fixture = gitFixture(initial()); t.mock.method(globalThis, 'fetch', fixture.fetch);
  await publishBlogPost('test-only', { slug: 'one', title: 'one', markdown: article });
  const first = fixture.snapshot();
  const cover = readCoverFilename(first['src/content/blog/one.md']);
  assert.equal(JSON.parse(first['src/config/blog-covers.json']).assigned.one, cover);
  await publishBlogPost('test-only', { slug: 'one', title: 'edited', markdown: article, overwrite: true });
  assert.equal(readCoverFilename(fixture.snapshot()['src/content/blog/one.md']), cover);
  assert.equal(fixture.writes(), 2);
});

test('concurrent publishing cannot overwrite a cover reservation; retry draws a different cover', async t => {
  const fixture = gitFixture(initial()); t.mock.method(globalThis, 'fetch', fixture.fetch);
  const results = await Promise.allSettled(['one', 'two'].map(slug => publishBlogPost('test-only', { slug, title: slug, markdown: article })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.match(rejected.reason.message, /重新发布/);
  assert.equal(fixture.writes(), 1);
  const missing = ['one', 'two'].find(slug => !fixture.snapshot()[`src/content/blog/${slug}.md`]);
  await publishBlogPost('test-only', { slug: missing, title: missing, markdown: article });
  const registry = JSON.parse(fixture.snapshot()['src/config/blog-covers.json']);
  assert.notEqual(registry.assigned.one, registry.assigned.two);
});

test('an exhausted publisher makes no commit and leaves the reservation ledger unchanged', async t => {
  const registry = initial(); registry.assigned = { deleted: 'a.svg', archived: 'b.svg', old: 'c.svg' };
  const fixture = gitFixture(registry); t.mock.method(globalThis, 'fetch', fixture.fetch);
  await assert.rejects(publishBlogPost('test-only', { slug: 'new', title: 'new', markdown: article }), /全部使用/);
  assert.equal(fixture.writes(), 0);
  assert.deepEqual(JSON.parse(fixture.snapshot()['src/config/blog-covers.json']), registry);
});
