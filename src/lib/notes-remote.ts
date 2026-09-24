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
export const BLOG_ACTIONS_URL = `https://github.com/${BLOG_REPO}/actions`;

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

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
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
      scope === 'repo'
        ? '没有这个仓库的写入权限。请换一个勾选了 Contents 的令牌，陌生人的令牌无法发布'
        : 'GitHub 拒绝了这次同步，请确认令牌有 Gist 读写权限',
      'auth',
    );
  }
  return response;
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
    const repo = (await response.json()) as { permissions?: { push?: boolean } };
    return Boolean(repo.permissions?.push);
  } catch (error) {
    if (error instanceof NotesRemoteError && (error.code === 'auth' || error.code === 'network')) return false;
    throw error;
  }
}

/** 用 Contents API 提交文章，随后仓库里的 GitHub Actions 会自动构建上线。 */
export async function publishBlogPost(
  token: string,
  input: { slug: string; title: string; markdown: string; overwrite?: boolean },
): Promise<{ updated: boolean }> {
  const relative = `${BLOG_DIR}/${input.slug}.md`;
  const apiPath = `/repos/${BLOG_REPO}/contents/${relative.split('/').map(encodeURIComponent).join('/')}`;
  const existing = await github(token, `${apiPath}?ref=${BLOG_BRANCH}`, {}, 'repo');
  let sha = '';
  if (existing.ok) {
    const file = (await existing.json()) as { sha?: string };
    sha = typeof file.sha === 'string' ? file.sha : '';
    if (!input.overwrite) {
      throw new NotesRemoteError(`${relative} 已存在`, 'exists');
    }
  } else if (existing.status !== 404) {
    throw new NotesRemoteError('检查远端文章失败，请稍后重试');
  }

  const title = input.title.replace(/\s+/g, ' ').trim().slice(0, 60) || '无标题';
  const response = await github(
    token,
    apiPath,
    {
      method: 'PUT',
      body: JSON.stringify({
        message: sha ? `feat(blog): 更新《${title}》` : `feat(blog): 发布《${title}》`,
        content: utf8ToBase64(input.markdown),
        branch: BLOG_BRANCH,
        ...(sha ? { sha } : {}),
      }),
    },
    'repo',
  );
  if (!response.ok) {
    throw new NotesRemoteError(sha ? '更新远端文章失败，请稍后重试' : '发布到仓库失败，请稍后重试');
  }
  return { updated: Boolean(sha) };
}

/** 连接时顺带读取用户名，失败不影响同步。 */
export async function fetchLogin(token: string): Promise<string> {
  try {
    const response = await github(token, '/user');
    if (!response.ok) return '';
    const user = (await response.json()) as { login?: string };
    const login = typeof user.login === 'string' ? user.login : '';
    if (login) localStorage.setItem(LOGIN_KEY, login);
    return login;
  } catch (error) {
    if (error instanceof NotesRemoteError && error.code === 'auth') throw error;
    return '';
  }
}
