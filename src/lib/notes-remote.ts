import { parseStore, readYamlBoolean, serializeStore, setYamlBoolean, type NoteStore } from './notes';
import { assignBlogCover, parseCoverRegistry } from './blog-covers.mjs';
import { parseAnnotations, type AnnotationStore } from './article-annotations';

export const TOKEN_KEY = 'codeverse.notes.githubToken';
export const GIST_KEY = 'codeverse.notes.gistId';
export const LOGIN_KEY = 'codeverse.notes.githubLogin';
const ANNOTATION_GIST_KEY = 'codeverse.annotations.gistId';
const ANNOTATION_DESCRIPTION = 'codeverse-article-annotations';

async function annotationGist(token: string): Promise<Gist | null> {
  const cached = read(ANNOTATION_GIST_KEY);
  if (/^[a-f0-9]+$/i.test(cached)) {
    const response = await github(token, `/gists/${cached}`);
    if (response.ok) {
      const gist = await response.json() as Gist & { owner?: { login?: string }; public?: boolean };
      if (gist.description === ANNOTATION_DESCRIPTION && isSiteOwner(gist.owner?.login ?? '')) {
        if (gist.public !== false) throw new NotesRemoteError('云端阅读笔记是公开 Gist，已停止同步，请先处理其可见性');
        return gist;
      }
    } else if (response.status !== 404) throw new NotesRemoteError('无法读取云端阅读笔记');
    localStorage.removeItem(ANNOTATION_GIST_KEY);
  }
  for (let page = 1; page <= 10; page++) {
    const response = await github(token, `/gists?per_page=100&page=${page}`);
    if (!response.ok) throw new NotesRemoteError('无法查找云端阅读笔记');
    const list = await response.json() as Gist[];
    const found = list.find(x => x.description === ANNOTATION_DESCRIPTION);
    if (found) {
      localStorage.setItem(ANNOTATION_GIST_KEY, found.id);
      const detail = await github(token, `/gists/${found.id}`);
      if (!detail.ok) throw new NotesRemoteError('无法读取云端阅读笔记');
      const gist = await detail.json() as Gist & { owner?: { login?: string }; public?: boolean };
      if (!isSiteOwner(gist.owner?.login ?? '')) throw new NotesRemoteError('云端阅读笔记不属于管理员账号');
      if (gist.public !== false) throw new NotesRemoteError('云端阅读笔记是公开 Gist，已停止同步，请先处理其可见性');
      return gist;
    }
    if (list.length < 100) return null;
  }
  throw new NotesRemoteError('Gist 数量过多，无法完成阅读笔记查找；请稍后重试');
}

export async function pullAnnotations(token: string): Promise<AnnotationStore> {
  const gist = await annotationGist(token);
  if (!gist) return { items: [], deleted: [] };
  const file = gist.files?.['annotations.json'];
  if (!file || file.truncated || typeof file.content !== 'string') throw new NotesRemoteError('云端阅读笔记文件缺失或过大，未覆盖本机数据');
  try { return parseAnnotations(JSON.parse(file.content ?? '{}')); }
  catch { throw new NotesRemoteError('云端阅读笔记格式错误，未覆盖本机数据'); }
}

export async function pushAnnotations(token: string, store: AnnotationStore): Promise<void> {
  const gist = await annotationGist(token);
  const response = await github(token, gist ? `/gists/${gist.id}` : '/gists', {
    method: gist ? 'PATCH' : 'POST',
    body: JSON.stringify({ description: ANNOTATION_DESCRIPTION, ...(!gist ? { public: false } : {}),
      files: { 'annotations.json': { content: JSON.stringify(store) } } }),
  });
  if (!response.ok) throw new NotesRemoteError('阅读笔记同步失败，本机内容仍然保留');
  const saved = await response.json() as Gist;
  localStorage.setItem(ANNOTATION_GIST_KEY, saved.id);
}

const API = 'https://api.github.com';
const DESCRIPTION = 'codeverse-notes';
const FILE = 'notes.json';
const KEEPALIVE_LIMIT = 60_000;

export const BLOG_REPO = 'versechen/versechen.github.io';
export const BLOG_BRANCH = 'main';
export const BLOG_DIR = 'src/content/blog';
const COVER_REGISTRY = 'src/config/blog-covers.json';
export const OWNER_LOGIN = BLOG_REPO.split('/')[0] ?? 'versechen';
export const BLOG_ACTIONS_URL = `https://github.com/${BLOG_REPO}/actions`;
export const TOKEN_CREATE_URL =
  'https://github.com/settings/tokens/new?scopes=gist,public_repo&description=codeverse-notes';
export const TOKEN_SCOPES_HINT = '请重新生成令牌并勾选 gist 和 public_repo，再到「连接 GitHub」里粘贴；细粒度令牌请打开本仓库的 Contents 读写';

const CLASSIC_WRITE_SCOPES = new Set(['repo', 'public_repo']);

export type RemoteErrorCode = 'network' | 'auth' | 'rate' | 'exists' | 'other';

export class NotesRemoteError extends Error {
  readonly code: RemoteErrorCode;

  constructor(message: string, code: RemoteErrorCode = 'other') {
    super(message);
    this.name = 'NotesRemoteError';
    this.code = code;
  }
}

function read(key: string): string {
  try {
    return localStorage.getItem(key)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function loadToken(): string {
  return read(TOKEN_KEY);
}

export function loadLogin(): string {
  return read(LOGIN_KEY);
}

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

export function saveLogin(login: string): void {
  const value = login.trim();
  if (value) localStorage.setItem(LOGIN_KEY, value);
  else localStorage.removeItem(LOGIN_KEY);
}

export function isSiteOwner(login: string): boolean {
  return login.trim().toLowerCase() === OWNER_LOGIN.toLowerCase();
}

export function clearRemoteSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(GIST_KEY);
  localStorage.removeItem(LOGIN_KEY);
}

type GistFile = { content?: string; truncated?: boolean; raw_url?: string };
type Gist = {
  id: string;
  description?: string | null;
  files?: Record<string, GistFile>;
};

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function github(token: string, path: string, init: RequestInit = {}, scope: 'gist' | 'repo' = 'gist'): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new NotesRemoteError(
      scope === 'repo' ? '网络不可用，发布没有完成' : '网络不可用，草稿先保存在这台设备上',
      'network',
    );
  }

  if (response.status === 401) {
    throw new NotesRemoteError('令牌无效或已过期，请重新填写', 'auth');
  }
  if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
    throw new NotesRemoteError('请求太频繁，GitHub 暂时限流，请过几分钟再试', 'rate');
  }
  if (response.status === 403) {
    throw new NotesRemoteError(
      scope === 'repo' ? `没有这个仓库的写入权限。${TOKEN_SCOPES_HINT}` : 'GitHub 拒绝了这次同步，请确认令牌有 Gist 读写权限',
      'auth',
    );
  }
  return response;
}

/** 经典令牌的权限看 scope；细粒度令牌没有这个头，返回 null。 */
function classicWriteScope(response: Response): boolean | null {
  const header = response.headers.get('x-oauth-scopes');
  if (header === null) return null;
  const scopes = header.split(',').map((item) => item.trim()).filter(Boolean);
  if (scopes.length === 0) return null;
  return scopes.some((scope) => CLASSIC_WRITE_SCOPES.has(scope));
}

async function readGithubMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: string };
    return typeof payload.message === 'string' ? payload.message.replace(/\s+/g, ' ').trim() : '';
  } catch {
    return '';
  }
}

function throwRepoWriteError(status: number, githubMessage: string, fallback: string): never {
  const text = githubMessage.toLowerCase();
  if (/reference update failed|not a fast forward|not fast.?forward/.test(text)) {
    throw new NotesRemoteError('仓库刚有新提交，封面尚未占用，请重新发布', 'other');
  }
  if (status === 404 || /not found|resource not accessible/.test(text)) {
    throw new NotesRemoteError(`没有这个仓库的写入权限。${TOKEN_SCOPES_HINT}`, 'auth');
  }
  if (status === 409) {
    throw new NotesRemoteError('仓库有冲突，请稍后重试；如果这篇文章刚被改过，先覆盖再发布', 'other');
  }
  if (status === 422) {
    if (text.includes('sha')) {
      throw new NotesRemoteError('远端文章已变化，请再点一次覆盖并发布', 'exists');
    }
    if (/protect|not authorized to push|required status|ruleset/.test(text)) {
      throw new NotesRemoteError('main 分支受保护，无法直接提交。请到仓库设置里允许推送到 main', 'other');
    }
    if (text.includes('email')) {
      throw new NotesRemoteError('GitHub 要求先验证邮箱才能提交，请到 GitHub 设置里完成验证', 'other');
    }
  }
  throw new NotesRemoteError(`${fallback}。${TOKEN_SCOPES_HINT}`, 'auth');
}

function writeGistId(id: string): void {
  localStorage.setItem(GIST_KEY, id);
}

async function searchGistId(token: string): Promise<string | null> {
  const listed = await github(token, '/gists?per_page=100');
  if (!listed.ok) throw new NotesRemoteError('查找远端草稿失败，请稍后重试');
  const gists = (await listed.json()) as Gist[];
  const found = gists.find((gist) => gist.description === DESCRIPTION && gist.files?.[FILE]);
  if (found) writeGistId(found.id);
  return found?.id ?? null;
}

async function fetchGist(token: string, gistId: string): Promise<Gist | null> {
  const response = await github(token, `/gists/${gistId}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new NotesRemoteError('读取远端草稿失败，请稍后重试');
  return (await response.json()) as Gist;
}

async function storeFromGist(gist: Gist): Promise<NoteStore> {
  const file = gist.files?.[FILE];
  if (!file) return { notes: [], deleted: [] };
  let content = file.content ?? '';
  if (file.truncated) {
    if (!file.raw_url) throw new NotesRemoteError('远端草稿过大，无法完整读取');
    try {
      const raw = await fetch(file.raw_url);
      if (!raw.ok) throw new Error(String(raw.status));
      content = await raw.text();
    } catch {
      throw new NotesRemoteError('远端草稿过大，完整内容读取失败');
    }
  }
  try {
    return parseStore(JSON.parse(content || '{"notes":[],"deleted":[]}'));
  } catch {
    throw new NotesRemoteError('远端草稿格式无法识别');
  }
}

/** 已知 Gist 时只发一个请求；Gist 被删或首次连接时再按描述查找。 */
export async function pullRemoteStore(token: string): Promise<NoteStore> {
  const stored = read(GIST_KEY);
  if (/^[a-f0-9]+$/i.test(stored)) {
    const gist = await fetchGist(token, stored);
    if (gist) return storeFromGist(gist);
    localStorage.removeItem(GIST_KEY);
  }
  const found = await searchGistId(token);
  if (!found) return { notes: [], deleted: [] };
  const gist = await fetchGist(token, found);
  return gist ? storeFromGist(gist) : { notes: [], deleted: [] };
}

export async function pushRemoteStore(token: string, store: NoteStore, options: { keepalive?: boolean } = {}): Promise<void> {
  const body = JSON.stringify({
    description: DESCRIPTION,
    public: false,
    files: { [FILE]: { content: serializeStore(store) } },
  });
  const keepalive = Boolean(options.keepalive) && body.length < KEEPALIVE_LIMIT;

  let gistId: string | null = read(GIST_KEY);
  if (/^[a-f0-9]+$/i.test(gistId)) {
    const response = await github(token, `/gists/${gistId}`, { method: 'PATCH', body, keepalive });
    if (response.ok) return;
    if (response.status !== 404) throw new NotesRemoteError('保存远端草稿失败，请稍后重试');
    localStorage.removeItem(GIST_KEY);
  }

  gistId = await searchGistId(token);
  const response = gistId
    ? await github(token, `/gists/${gistId}`, { method: 'PATCH', body })
    : await github(token, '/gists', { method: 'POST', body });
  if (!response.ok) throw new NotesRemoteError('保存远端草稿失败，请稍后重试');
  const gist = (await response.json()) as Gist;
  if (!gist.id) throw new NotesRemoteError('保存远端草稿失败，请稍后重试');
  writeGistId(gist.id);
}

/** 有没有往本站仓库推文章的权限；访客令牌一般没有。 */
export async function fetchRepoWriteAccess(token: string): Promise<boolean> {
  try {
    const response = await github(token, `/repos/${BLOG_REPO}`, {}, 'repo');
    if (!response.ok) return false;
    // 仓库主人用仅 gist 的经典令牌时，permissions.push 仍可能是 true，必须再看 scope。
    if (classicWriteScope(response) === false) return false;
    const repo = (await response.json()) as { permissions?: { push?: boolean } };
    return Boolean(repo.permissions?.push);
  } catch (error) {
    if (error instanceof NotesRemoteError && (error.code === 'auth' || error.code === 'network')) return false;
    throw error;
  }
}

/** 用 Git 提交写入或删除仓库文件：创建 blob / tree / commit，不是上传文件。 */
async function commitBlogTree(
  token: string,
  message: string,
  entries: Array<{ path: string; content?: string; remove?: boolean }>,
  snapshotParent?: string,
): Promise<void> {
  const probe = await github(token, `/repos/${BLOG_REPO}`, {}, 'repo');
  if (classicWriteScope(probe) === false) {
    throw new NotesRemoteError(`当前令牌只有草稿同步权限，改不了博客。${TOKEN_SCOPES_HINT}`, 'auth');
  }

  let parent = snapshotParent;
  if (!parent) {
    const refRes = await github(token, `/repos/${BLOG_REPO}/git/ref/heads/${BLOG_BRANCH}`, {}, 'repo');
    if (!refRes.ok) {
      throwRepoWriteError(refRes.status, await readGithubMessage(refRes), '读取仓库分支失败，请稍后重试');
    }
    parent = (await readJson<{ object?: { sha?: string } }>(refRes)).object?.sha;
  }
  if (!parent) throw new NotesRemoteError('读取仓库分支失败，请稍后重试');

  const commitRes = await github(token, `/repos/${BLOG_REPO}/git/commits/${parent}`, {}, 'repo');
  if (!commitRes.ok) {
    throwRepoWriteError(commitRes.status, await readGithubMessage(commitRes), '读取最新提交失败，请稍后重试');
  }
  const baseTree = (await readJson<{ tree?: { sha?: string } }>(commitRes)).tree?.sha;
  if (!baseTree) throw new NotesRemoteError('读取最新提交失败，请稍后重试');

  const tree: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string | null; content?: string }> = [];
  for (const entry of entries) {
    if (entry.remove) {
      tree.push({ path: entry.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const blobRes = await github(
      token,
      `/repos/${BLOG_REPO}/git/blobs`,
      { method: 'POST', body: JSON.stringify({ content: entry.content ?? '', encoding: 'utf-8' }) },
      'repo',
    );
    if (!blobRes.ok) {
      throwRepoWriteError(blobRes.status, await readGithubMessage(blobRes), '创建提交失败，请稍后重试');
    }
    const blobSha = (await readJson<{ sha?: string }>(blobRes)).sha;
    if (!blobSha) throw new NotesRemoteError('创建提交失败，请稍后重试');
    tree.push({ path: entry.path, mode: '100644', type: 'blob', sha: blobSha });
  }

  const treeRes = await github(
    token,
    `/repos/${BLOG_REPO}/git/trees`,
    { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree }) },
    'repo',
  );
  if (!treeRes.ok) {
    throwRepoWriteError(treeRes.status, await readGithubMessage(treeRes), '创建提交失败，请稍后重试');
  }
  const treeSha = (await readJson<{ sha?: string }>(treeRes)).sha;
  if (!treeSha) throw new NotesRemoteError('创建提交失败，请稍后重试');

  const commitNew = await github(
    token,
    `/repos/${BLOG_REPO}/git/commits`,
    { method: 'POST', body: JSON.stringify({ message, tree: treeSha, parents: [parent] }) },
    'repo',
  );
  if (!commitNew.ok) {
    throwRepoWriteError(commitNew.status, await readGithubMessage(commitNew), '创建提交失败，请稍后重试');
  }
  const commitSha = (await readJson<{ sha?: string }>(commitNew)).sha;
  if (!commitSha) throw new NotesRemoteError('创建提交失败，请稍后重试');

  const tip = await github(
    token,
    `/repos/${BLOG_REPO}/git/refs/heads/${BLOG_BRANCH}`,
    { method: 'PATCH', body: JSON.stringify({ sha: commitSha, force: false }) },
    'repo',
  );
  if (!tip.ok) {
    throwRepoWriteError(tip.status, await readGithubMessage(tip), '更新远端失败，请稍后重试');
  }
}

/** 用 Git 提交写入文章：创建 blob / tree / commit，不是上传文件。随后 Actions 构建上线。 */
export async function publishBlogPost(
  token: string,
  input: { slug: string; title: string; markdown: string; overwrite?: boolean },
): Promise<{ updated: boolean; archived: boolean }> {
  // 文章和封面清单都从同一个提交读取；并发发布只能有一方快进成功。
  const refRes = await github(token, `/repos/${BLOG_REPO}/git/ref/heads/${BLOG_BRANCH}`, {}, 'repo');
  if (!refRes.ok) throwRepoWriteError(refRes.status, await readGithubMessage(refRes), '读取仓库分支失败');
  const parent = (await readJson<{ object?: { sha?: string } }>(refRes)).object?.sha;
  if (!parent) throw new NotesRemoteError('读取仓库分支失败，请稍后重试');
  const relative = `${BLOG_DIR}/${input.slug}.md`;
  const encoded = relative.split('/').map(encodeURIComponent).join('/');
  const existing = await github(token, `/repos/${BLOG_REPO}/contents/${encoded}?ref=${parent}`, {}, 'repo');
  if (classicWriteScope(existing) === false) {
    throw new NotesRemoteError(`当前令牌只有草稿同步权限，发不了博客。${TOKEN_SCOPES_HINT}`, 'auth');
  }
  const updated = existing.ok;
  if (updated && !input.overwrite) {
    throw new NotesRemoteError(`${relative} 已存在`, 'exists');
  }
  if (!existing.ok && existing.status !== 404) {
    throwRepoWriteError(existing.status, await readGithubMessage(existing), '检查远端文章失败，请稍后重试');
  }
  // 归档状态以仓库为准：文章页上归档过的文章，从记录页更新时不能被悄悄放回列表。
  const remote = updated ? decodeContentsFile(await readJson<{ content?: string; encoding?: string }>(existing)) : null;
  const archived = remote ? readYamlBoolean(remote, 'archived') : false;

  const coversRes = await github(token, `/repos/${BLOG_REPO}/contents/${COVER_REGISTRY}?ref=${parent}`, {}, 'repo');
  if (!coversRes.ok) throwRepoWriteError(coversRes.status, await readGithubMessage(coversRes), '读取封面清单失败');
  const coversText = decodeContentsFile(await readJson<{ content?: string; encoding?: string }>(coversRes));
  if (!coversText) throw new NotesRemoteError('封面清单为空，请检查仓库配置');
  let assigned;
  try {
    assigned = assignBlogCover(input.markdown, input.slug, parseCoverRegistry(JSON.parse(coversText)));
  } catch (error) {
    throw new NotesRemoteError(error instanceof Error ? error.message : '分配封面失败');
  }

  const title = input.title.replace(/\s+/g, ' ').trim().slice(0, 60) || '无标题';
  await commitBlogTree(
    token,
    updated ? `feat(blog): 更新《${title}》` : `feat(blog): 发布《${title}》`,
    [
      { path: relative, content: setYamlBoolean(assigned.markdown, 'archived', archived) },
      { path: COVER_REGISTRY, content: `${JSON.stringify(assigned.registry, null, 2)}\n` },
    ],
    parent,
  );
  return { updated, archived };
}

export async function archiveBlogPost(
  token: string,
  slug: string,
  archived: boolean,
): Promise<void> {
  const file = await fetchPublishedBlogFile(token, slug);
  if (!file) throw new NotesRemoteError('仓库里没找到这篇文章');
  const markdown = setYamlBoolean(file.markdown, 'archived', archived);
  const title = file.markdown.match(/^title:\s*(.*)$/m)?.[1]?.replace(/^['"]|['"]$/g, '').trim() || slug;
  await commitBlogTree(
    token,
    archived ? `chore(blog): 归档《${title.slice(0, 60)}》` : `chore(blog): 取消归档《${title.slice(0, 60)}》`,
    [{ path: file.path, content: markdown }],
  );
}

export async function deleteBlogPost(token: string, slug: string): Promise<void> {
  const file = await fetchPublishedBlogFile(token, slug);
  if (!file) throw new NotesRemoteError('仓库里没找到这篇文章');
  const title = file.markdown.match(/^title:\s*(.*)$/m)?.[1]?.replace(/^['"]|['"]$/g, '').trim() || slug;
  await commitBlogTree(token, `chore(blog): 删除《${title.slice(0, 60)}》`, [{ path: file.path, remove: true }]);
}

function base64ToUtf8(content: string): string {
  const binary = atob(content.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeContentsFile(payload: { content?: string; encoding?: string }): string | null {
  if (typeof payload.content !== 'string') return null;
  return payload.encoding === 'base64' ? base64ToUtf8(payload.content) : payload.content;
}

/** 按文件名取回一篇已发布文章，编辑按钮会走这里。 */
export async function fetchPublishedBlogFile(
  token: string,
  slug: string,
): Promise<{ slug: string; markdown: string; path: string } | null> {
  const safe = slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '').slice(0, 80);
  if (!safe) return null;
  for (const ext of ['.md', '.mdx'] as const) {
    const path = `${BLOG_DIR}/${safe}${ext}`;
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const response = await github(token, `/repos/${BLOG_REPO}/contents/${encoded}?ref=${BLOG_BRANCH}`, {}, 'repo');
    if (response.status === 404) continue;
    if (!response.ok) {
      throwRepoWriteError(response.status, await readGithubMessage(response), '读取这篇文章失败，请稍后重试');
    }
    const markdown = decodeContentsFile(await readJson<{ content?: string; encoding?: string }>(response));
    if (!markdown) continue;
    return { slug: safe, markdown, path };
  }
  return null;
}

/** 读取仓库里已发布的博客 Markdown，方便取回再编辑。 */
export async function fetchPublishedBlogFiles(token: string): Promise<{ slug: string; markdown: string }[]> {
  const dir = BLOG_DIR.split('/').map(encodeURIComponent).join('/');
  const listed = await github(token, `/repos/${BLOG_REPO}/contents/${dir}?ref=${BLOG_BRANCH}`, {}, 'repo');
  if (!listed.ok) {
    throwRepoWriteError(listed.status, await readGithubMessage(listed), '读取已发布文章失败，请稍后重试');
  }
  const items = await readJson<Array<{ name?: string; path?: string; type?: string }>>(listed);
  const files = items.filter(
    (item): item is { name: string; path?: string; type: string } =>
      item.type === 'file' && typeof item.name === 'string' && item.name.endsWith('.md'),
  );
  const posts: { slug: string; markdown: string }[] = [];
  for (const file of files) {
    const path = (file.path ?? `${BLOG_DIR}/${file.name}`).split('/').map(encodeURIComponent).join('/');
    const response = await github(token, `/repos/${BLOG_REPO}/contents/${path}?ref=${BLOG_BRANCH}`, {}, 'repo');
    if (!response.ok) continue;
    const markdown = decodeContentsFile(await readJson<{ content?: string; encoding?: string }>(response));
    if (!markdown) continue;
    posts.push({
      slug: file.name.replace(/\.md$/, ''),
      markdown,
    });
  }
  return posts;
}

/** 连接时顺带读取用户名，失败不影响同步。 */
export async function fetchLogin(token: string): Promise<string> {
  try {
    const response = await github(token, '/user');
    if (!response.ok) return '';
    const user = (await response.json()) as { login?: string };
    const login = typeof user.login === 'string' ? user.login : '';
    return login;
  } catch (error) {
    if (error instanceof NotesRemoteError && error.code === 'auth') throw error;
    return '';
  }
}
