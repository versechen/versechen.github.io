import { parseStore, serializeStore, type NoteStore } from './notes';

export const TOKEN_KEY = 'codeverse.notes.githubToken';
export const GIST_KEY = 'codeverse.notes.gistId';
export const LOGIN_KEY = 'codeverse.notes.githubLogin';

const API = 'https://api.github.com';
const DESCRIPTION = 'codeverse-notes';
const FILE = 'notes.json';
const KEEPALIVE_LIMIT = 60_000;

export const BLOG_REPO = 'versechen/versechen.github.io';
export const BLOG_BRANCH = 'main';
export const BLOG_DIR = 'src/content/blog';
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

/** 用 Git 提交写入文章：创建 blob / tree / commit，不是上传文件。随后 Actions 构建上线。 */
export async function publishBlogPost(
  token: string,
  input: { slug: string; title: string; markdown: string; overwrite?: boolean },
): Promise<{ updated: boolean }> {
  const relative = `${BLOG_DIR}/${input.slug}.md`;
  const encoded = relative.split('/').map(encodeURIComponent).join('/');
  const existing = await github(token, `/repos/${BLOG_REPO}/contents/${encoded}?ref=${BLOG_BRANCH}`, {}, 'repo');
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

  const refRes = await github(token, `/repos/${BLOG_REPO}/git/ref/heads/${BLOG_BRANCH}`, {}, 'repo');
  if (!refRes.ok) {
    throwRepoWriteError(refRes.status, await readGithubMessage(refRes), '读取仓库分支失败，请稍后重试');
  }
  const parent = (await readJson<{ object?: { sha?: string } }>(refRes)).object?.sha;
  if (!parent) throw new NotesRemoteError('读取仓库分支失败，请稍后重试');

  const commitRes = await github(token, `/repos/${BLOG_REPO}/git/commits/${parent}`, {}, 'repo');
  if (!commitRes.ok) {
    throwRepoWriteError(commitRes.status, await readGithubMessage(commitRes), '读取最新提交失败，请稍后重试');
  }
  const baseTree = (await readJson<{ tree?: { sha?: string } }>(commitRes)).tree?.sha;
  if (!baseTree) throw new NotesRemoteError('读取最新提交失败，请稍后重试');

  const blobRes = await github(
    token,
    `/repos/${BLOG_REPO}/git/blobs`,
    { method: 'POST', body: JSON.stringify({ content: input.markdown, encoding: 'utf-8' }) },
    'repo',
  );
  if (!blobRes.ok) {
    throwRepoWriteError(blobRes.status, await readGithubMessage(blobRes), '创建提交失败，请稍后重试');
  }
  const blobSha = (await readJson<{ sha?: string }>(blobRes)).sha;
  if (!blobSha) throw new NotesRemoteError('创建提交失败，请稍后重试');

  const treeRes = await github(
    token,
    `/repos/${BLOG_REPO}/git/trees`,
    {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTree,
        tree: [{ path: relative, mode: '100644', type: 'blob', sha: blobSha }],
      }),
    },
    'repo',
  );
  if (!treeRes.ok) {
    throwRepoWriteError(treeRes.status, await readGithubMessage(treeRes), '创建提交失败，请稍后重试');
  }
  const treeSha = (await readJson<{ sha?: string }>(treeRes)).sha;
  if (!treeSha) throw new NotesRemoteError('创建提交失败，请稍后重试');

  const title = input.title.replace(/\s+/g, ' ').trim().slice(0, 60) || '无标题';
  const commitNew = await github(
    token,
    `/repos/${BLOG_REPO}/git/commits`,
    {
      method: 'POST',
      body: JSON.stringify({
        message: updated ? `feat(blog): 更新《${title}》` : `feat(blog): 发布《${title}》`,
        tree: treeSha,
        parents: [parent],
      }),
    },
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
    { method: 'PATCH', body: JSON.stringify({ sha: commitSha }) },
    'repo',
  );
  if (!tip.ok) {
    throwRepoWriteError(tip.status, await readGithubMessage(tip), updated ? '更新远端文章失败，请稍后重试' : '发布到仓库失败，请稍后重试');
  }
  return { updated };
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
