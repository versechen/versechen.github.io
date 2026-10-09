import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import { Window } from 'happy-dom';

const source = readFileSync(new URL('../src/lib/article-annotations.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { parseAnnotations, mergeAnnotations, locateQuote, questionTask, selectionMenuPosition } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const item = (overrides = {}) => ({ id: 'one', slug: 'ddp', title: 'DDP', revision: 'v1', kind: 'question', quote: '梯度', prefix: '', suffix: '', section: '同步', body: '哪里同步？', resolved: false, answer: '', updatedAt: '2026-10-09T01:00:00.000Z', ...overrides });
const store = (...items) => ({ items, deleted: [] });

test('a deleted question does not return from an offline device', () => {
  const deleted = { items: [], deleted: [{ id: 'one', at: '2026-10-09T02:00:00.000Z' }] };
  assert.equal(mergeAnnotations(deleted, store(item())).items.length, 0);
  assert.equal(mergeAnnotations(store(item()), deleted).items.length, 0);
  assert.equal(mergeAnnotations(deleted, store(item({ updatedAt: deleted.deleted[0].at }))).items.length, 0);
});
test('merge keeps the newer answer, handles offsets, and preserves other devices’ notes', () => {
  const answered = item({ resolved: true, answer: '/blog/ddp/#answer', updatedAt: '2026-10-09T10:01:00+08:00' });
  const merged = mergeAnnotations(store(item(), item({ id: 'two' })), store(answered));
  assert.equal(merged.items.length, 2);
  assert.equal(merged.items.find(x => x.id === 'one').resolved, true);
  assert.deepEqual(mergeAnnotations(store(answered), store(item())).items[0], answered);
});
test('quote anchors tolerate moved unique text but reject ambiguous repeated text', () => {
  assert.equal(locateQuote('前面增加：梯度同步', '梯度', '旧前缀', ''), 5);
  assert.equal(locateQuote('A 梯度 B 梯度 C', '梯度', '', ''), -1);
  assert.equal(locateQuote('A 梯度 B 梯度 C', '梯度', ' B ', ' C'), 7);
  assert.equal(locateQuote('内容已删除', '梯度', '', ''), -1);
});
test('task contains only pending questions with source and no literal newline escapes', () => {
  const task = questionTask([item(), item({ id: 'two', resolved: true }), item({ id: 'three', kind: 'comment' })]);
  assert.match(task, /文章：\/blog\/ddp\//);
  assert.match(task, /原文：梯度\n疑问：哪里同步？/);
  assert.match(task, /不直接发布/);
  assert.doesNotMatch(task, /疑问 2/);
});
test('invalid storage is rejected, rather than silently replaced during sync', () => {
  assert.throws(() => parseAnnotations(null));
  assert.throws(() => parseAnnotations({ items: 'corrupt' }));
  assert.equal(parseAnnotations(store(item({ resolved: 'true' }))).items[0].resolved, false);
});

const appSource = readFileSync(new URL('../src/lib/article-notes-app.ts', import.meta.url), 'utf8');
const appCode = ts.transpileModule(appSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const component = readFileSync(new URL('../src/components/ArticleNotes.astro', import.meta.url), 'utf8').match(/<section[\s\S]*?<\/section>/)[0];
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture({ login = 'versechen', article = true, initial = store(), remoteError = false } = {}) {
  const window = new Window({ url: 'https://example.test/' });
  window.document.body.innerHTML = (article ? '<div data-annotation-body><p>左边梯度，右边梯度。</p></div>' : '') + component;
  const root = window.document.querySelector('[data-article-notes]');
  root.dataset.slug = article ? 'ddp' : ''; root.dataset.title = 'DDP'; root.dataset.revision = 'v1';
  window.localStorage.setItem('codeverse.annotations.v1', JSON.stringify(initial));
  let token = 'test-only-token'; let pushed = null; const drafts = { notes: [], deleted: [] };
  const remote = { loadToken: () => token, fetchLogin: async () => login, isSiteOwner: x => x === 'versechen',
    pullAnnotations: async () => { if (remoteError) throw new Error('测试网络不可用'); return store(); },
    pushAnnotations: async (_, data) => { pushed = structuredClone(data); }, TOKEN_KEY: 'token', LOGIN_KEY: 'login' };
  const notes = { createNote: () => ({ id: 'draft-one' }), loadLocalStore: () => drafts, saveLocalStore: () => {}, ACTIVE_KEY: 'active' };
  const exports = {};
  vm.runInNewContext(appCode, { exports, require: path => path.includes('article-annotations') ? { parseAnnotations, mergeAnnotations, locateQuote, questionTask, selectionMenuPosition, ANNOTATIONS_KEY: 'codeverse.annotations.v1' } : path.endsWith('notes-remote') ? remote : notes,
    window, document: window.document, localStorage: window.localStorage, location: window.location, navigator: window.navigator,
    crypto: globalThis.crypto, CSS: { highlights: new Map() }, Node: window.Node, NodeFilter: window.NodeFilter, Element: window.Element, Error, console });
  window.confirm = () => true;
  exports.initArticleNotes(); await tick();
  return { window, root, drafts, pushed: () => pushed, logout: () => { token = ''; window.dispatchEvent(new window.Event('codeverse:owner-nav')); },
    stored: () => JSON.parse(window.localStorage.getItem('codeverse.annotations.v1')),
    click: label => { const b = [...root.querySelectorAll('button')].find(x => x.textContent === label); assert.ok(b, label); b.click(); } };
}

test('non-owner cannot see locally stored notes', async () => {
  const f = await fixture({ login: 'someone-else', initial: store(item()) });
  assert.equal(f.root.querySelector('[data-note-workspace]').hidden, true);
  assert.equal(f.root.querySelector('[data-note-list]').children.length, 0);
  await f.window.happyDOM.close();
});
test('selected repeated text keeps the correct context, survives reload, and supports resolving', async () => {
  const f = await fixture(); const { window, root } = f;
  const text = window.document.querySelector('[data-annotation-body] p').firstChild;
  const range = window.document.createRange(); range.setStart(text, 7); range.setEnd(text, 9);
  window.getSelection().addRange(range); window.document.dispatchEvent(new window.Event('pointerup'));
  assert.equal(root.querySelector('[name=quote]').value, '梯度');
  root.querySelector('[name=kind]').value = 'question'; root.querySelector('[name=body]').value = '在哪同步？';
  root.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  const saved = f.stored(); assert.equal(saved.items.length, 1); assert.equal(saved.items[0].prefix, '左边梯度，右边');
  await window.happyDOM.close();
  const again = await fixture({ initial: saved });
  assert.equal(again.root.querySelectorAll('.note-card').length, 1);
  assert.equal(again.root.querySelector('.note-source-missing'), null);
  again.click('标为已解答'); assert.equal(again.stored().items[0].resolved, false);
  again.root.querySelector('.note-card input').value = '/blog/ddp/#answer'; again.click('标为已解答');
  assert.equal(again.stored().items[0].resolved, true);
  again.logout(); assert.equal(again.root.querySelector('[data-note-workspace]').hidden, true);
  assert.equal(again.root.querySelector('[data-note-list]').children.length, 0);
  await again.window.happyDOM.close();
});
test('global queue generates an unpublished task draft and deletion persists', async () => {
  const f = await fixture({ article: false, initial: store(item()) });
  assert.equal(f.root.querySelector('[data-note-filter]').value, 'question');
  f.click('生成补充任务草稿'); assert.equal(f.drafts.notes.length, 1);
  assert.match(f.drafts.notes[0].body, /哪里同步？/); assert.equal(f.drafts.notes[0].publishedSlug, undefined);
  f.click('删除'); assert.equal(f.stored().items.length, 0); assert.equal(f.stored().deleted.length, 1);
  await f.window.happyDOM.close();
});
test('failed synchronization preserves local questions; successful synchronization sends them', async () => {
  const f = await fixture({ initial: store(item()), remoteError: true }); f.click('同步笔记'); await tick();
  assert.equal(f.stored().items.length, 1); assert.match(f.root.querySelector('[data-note-status]').textContent, /网络不可用/);
  assert.equal(f.pushed(), null); await f.window.happyDOM.close();
  const success = await fixture({ initial: store(item()) }); success.click('同步笔记'); await tick();
  assert.equal(success.pushed().items.length, 1); await success.window.happyDOM.close();
});

const remoteSource = readFileSync(new URL('../src/lib/notes-remote.ts', import.meta.url), 'utf8');
const remoteCode = ts.transpileModule(remoteSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function remoteFixture(existing = null) {
  const storage = new Map(); const requests = []; const exports = {};
  vm.runInNewContext(remoteCode, { exports, require: () => ({ parseAnnotations }), Error,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    fetch: async (url, init) => {
      requests.push({ url, ...init });
      const data = init.method ? { id: 'abcd' } : url.includes('?') ? existing ? [existing] : [] : existing;
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } });
  return { api: exports, requests };
}
test('annotation sync creates its own unlisted gist and does not overwrite draft notes', async () => {
  const f = remoteFixture(); await f.api.pushAnnotations('test-only-token', store(item()));
  const request = f.requests.find(x => x.method === 'POST'); assert.ok(request);
  const payload = JSON.parse(request.body); assert.equal(payload.public, false);
  assert.equal(payload.description, 'codeverse-article-annotations');
  assert.deepEqual(Object.keys(payload.files), ['annotations.json']);
});
test('cloud sync refuses public or truncated stores before writing', async () => {
  const gist = { id: 'abcd', owner: { login: 'versechen' }, description: 'codeverse-article-annotations', public: true };
  const exposed = remoteFixture(gist);
  await assert.rejects(exposed.api.pushAnnotations('test-only-token', store(item())), /公开 Gist/);
  assert.equal(exposed.requests.some(x => x.method), false);
  const truncated = remoteFixture({ ...gist, public: false, files: { 'annotations.json': { content: '{}', truncated: true } } });
  await assert.rejects(truncated.api.pullAnnotations('test-only-token'), /过大/);
  assert.equal(truncated.requests.some(x => x.method), false);
});

test('selection menu opens near the upper-right and stays inside a narrow viewport', () => {
  const viewport = { width: 1000, height: 800, top: 72 }, menu = { width: 260, height: 52 };
  assert.deepEqual(selectionMenuPosition({ right: 640, top: 200, bottom: 220 }, viewport, menu), { left: 380, top: 140, below: false });
  assert.deepEqual(selectionMenuPosition({ right: 100, top: 76, bottom: 96 }, viewport, menu), { left: 8, top: 104, below: true });
  const edge = selectionMenuPosition({ right: 500, top: 740, bottom: 760 }, { ...viewport, width: 320 }, menu);
  assert.equal(edge.left, 52); assert.ok(edge.top + menu.height <= viewport.height - 8);
});
test('selecting text shows three choices; choosing a type opens the side editor without losing the quote', async () => {
  const f = await fixture(); const { window, root } = f;
  const range = window.document.createRange(), text = window.document.querySelector('[data-annotation-body] p').firstChild;
  range.setStart(text, 2); range.setEnd(text, 4); window.getSelection().addRange(range);
  window.document.dispatchEvent(new window.Event('pointerup'));
  const popup = root.querySelector('[data-note-selection]'); assert.equal(popup.hidden, false);
  assert.equal(popup.querySelectorAll('[data-annotation-kind]').length, 3);
  assert.equal(root.querySelector('[data-note-editor]').hidden, true);
  popup.querySelector('[data-annotation-kind=question]').click();
  assert.equal(popup.hidden, true); assert.equal(root.dataset.open, 'true');
  assert.equal(root.querySelector('[data-note-editor]').hidden, false);
  assert.equal(root.querySelector('[name=quote]').value, '梯度'); assert.equal(root.querySelector('[name=kind]').value, 'question');
  window.document.dispatchEvent(new window.Event('pointerup')); assert.equal(popup.hidden, true);
  root.querySelector('[name=body]').value = '为什么同步？'; root.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(f.stored().items[0].kind, 'question'); assert.equal(root.querySelector('.note-card').dataset.kind, 'question');
  assert.match(root.querySelector('.note-kind-badge').textContent, /\? 疑问/);
  assert.equal(root.querySelector('[data-note-editor]').hidden, true);
  await window.happyDOM.close();
});
test('types have distinct badges; keyboard close does not discard saved notes', async () => {
  const f = await fixture({ initial: store(item(), item({ id: 'two', kind: 'highlight' }), item({ id: 'three', kind: 'comment' })) });
  assert.deepEqual([...f.root.querySelectorAll('.note-kind-badge')].map(x => x.textContent), ['? 疑问', '★ 重点', '✎ 注释']);
  f.window.document.dispatchEvent(new f.window.KeyboardEvent('keyup', { key: 'Escape' }));
  assert.equal(f.root.dataset.open, 'false'); assert.equal(f.stored().items.length, 3);
  await f.window.happyDOM.close();
});
