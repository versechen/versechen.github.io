export type Note = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  /** 已发布到博客时记下文件名，方便再编辑或更新。 */
  publishedSlug?: string;
  publishedAt?: string;
};

export type Deletion = {
  id: string;
  at: string;
};

export type NoteStore = {
  notes: Note[];
  deleted: Deletion[];
};

export type NoteGroup = {
  label: string;
  notes: Note[];
};

export const STORAGE_KEY = 'codeverse.notes.v1';
export const ACTIVE_KEY = 'codeverse.notes.active';

const MAX_NOTES = 500;
const MAX_TITLE = 200;
const MAX_BODY = 100_000;
const MAX_TAGS = 12;
const MAX_TAG = 40;
const DAY = 24 * 60 * 60 * 1000;

export function createNote(now = new Date()): Note {
  return {
    id: `note-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: '',
    body: '',
    tags: [],
    pinned: false,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function asIso(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const time = Date.parse(value);
  return Number.isNaN(time) ? fallback : new Date(time).toISOString();
}

export function normalizeTag(value: string): string {
  return value.trim().replace(/^#+/, '').trim().slice(0, MAX_TAG);
}

export function normalizeNotes(input: unknown): Note[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const notes: Note[] = [];

  for (const item of input.slice(0, MAX_NOTES)) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const id = String(raw.id ?? '').slice(0, 80);
    if (!/^[\w-]+$/.test(id) || seen.has(id)) continue;
    seen.add(id);

    const now = new Date().toISOString();
    const tags = Array.isArray(raw.tags)
      ? [...new Set(raw.tags.map((tag) => normalizeTag(String(tag))).filter(Boolean))].slice(0, MAX_TAGS)
      : [];

    const publishedSlug = normalizeBlogSlug(String(raw.publishedSlug ?? ''));
    notes.push({
      id,
      title: String(raw.title ?? '').slice(0, MAX_TITLE),
      body: String(raw.body ?? '').slice(0, MAX_BODY),
      tags,
      pinned: raw.pinned === true,
      createdAt: asIso(raw.createdAt, now),
      updatedAt: asIso(raw.updatedAt, now),
      ...(publishedSlug ? { publishedSlug, publishedAt: asIso(raw.publishedAt, now) } : {}),
    });
  }

  return notes.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
}

export function mergeNotes(local: Note[], remote: Note[]): Note[] {
  const map = new Map<string, Note>();
  for (const note of [...local, ...remote]) {
    const current = map.get(note.id);
    if (!current || Date.parse(note.updatedAt) >= Date.parse(current.updatedAt)) {
      map.set(note.id, note);
    }
  }
  return normalizeNotes([...map.values()]);
}

/** 删除记录只保留最近的 MAX_NOTES 条，并按固定顺序输出，方便比较是否需要同步。 */
function normalizeDeleted(input: unknown): Deletion[] {
  if (!Array.isArray(input)) return [];
  const map = new Map<string, string>();
  for (const item of input.slice(0, MAX_NOTES * 4)) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const id = String(raw.id ?? '').slice(0, 80);
    if (!/^[\w-]+$/.test(id)) continue;
    const at = asIso(raw.at, '');
    if (!at) continue;
    const current = map.get(id);
    if (!current || Date.parse(at) >= Date.parse(current)) map.set(id, at);
  }
  return [...map.entries()]
    .map(([id, at]) => ({ id, at }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id))
    .slice(0, MAX_NOTES);
}

function applyDeletions(store: NoteStore): NoteStore {
  const deletedAt = new Map(store.deleted.map((item) => [item.id, item.at]));
  const notes = store.notes.filter((note) => {
    const at = deletedAt.get(note.id);
    return !at || Date.parse(note.updatedAt) > Date.parse(at);
  });
  const live = new Set(notes.map((note) => note.id));
  return {
    notes,
    deleted: store.deleted.filter((item) => !live.has(item.id)),
  };
}

export function parseStore(input: unknown): NoteStore {
  if (Array.isArray(input)) return { notes: normalizeNotes(input), deleted: [] };
  if (!input || typeof input !== 'object') return { notes: [], deleted: [] };
  const raw = input as Record<string, unknown>;
  return applyDeletions({
    notes: normalizeNotes(raw.notes),
    deleted: normalizeDeleted(raw.deleted),
  });
}

export function mergeStores(local: NoteStore, remote: NoteStore): NoteStore {
  return applyDeletions({
    notes: mergeNotes(local.notes, remote.notes),
    deleted: normalizeDeleted([...local.deleted, ...remote.deleted]),
  });
}

export function serializeStore(store: NoteStore): string {
  return JSON.stringify({ version: 1, ...parseStore(store) });
}

export function loadLocalStore(): NoteStore {
  try {
    return parseStore(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{"notes":[],"deleted":[]}'));
  } catch {
    return { notes: [], deleted: [] };
  }
}

export function saveLocalStore(store: NoteStore): void {
  localStorage.setItem(STORAGE_KEY, serializeStore(store));
}

export function parseTags(value: string): string[] {
  return [...new Set(value.split(/[,，\s]+/).map(normalizeTag).filter(Boolean))].slice(0, MAX_TAGS);
}

export function isBlankNote(note: Note): boolean {
  return !note.title.trim() && !note.body.trim() && note.tags.length === 0;
}

export function isPublishedNote(note: Note): boolean {
  return Boolean(note.publishedSlug);
}

export function markNotePublished(note: Note, slug: string, at = new Date()): Note {
  note.publishedSlug = normalizeBlogSlug(slug);
  note.publishedAt = at.toISOString();
  return note;
}

export function markNoteDraft(note: Note): Note {
  delete note.publishedSlug;
  delete note.publishedAt;
  return note;
}

/** 去掉 Markdown 标记，用于摘要、搜索和字数。 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/^\s*(?:```|~~~).*$/gm, '')
    .replace(/^\s*\$\$\s*$/gm, '')
    .replace(/^:::.*$/gm, '')
    .replace(/^\s*>?\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/gim, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\^[^\]]+\]:?/g, '')
    .replace(/^\s*(?:>\s?)+/gm, '')
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|?)+\s*$/gm, '')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/\*\*|__|~~|==|`/g, '')
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w])_(?!\s)([^_\n]+?)_(?!\w)/g, '$1$2')
    .replace(/\|/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function noteExcerpt(note: Note, length = 90): string {
  return plainText(note.body).replace(/\s+/g, ' ').slice(0, length);
}

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/g;
const WORD = /[A-Za-z0-9\u00c0-\u024f]+(?:['’.-][A-Za-z0-9\u00c0-\u024f]+)*/g;

/** 中文按字、西文按词计数，阅读速度约每分钟 400 字或 220 词。 */
export function countWords(markdown: string): { words: number; minutes: number } {
  const text = plainText(markdown);
  const cjk = text.match(CJK)?.length ?? 0;
  const latin = text.replace(CJK, ' ').match(WORD)?.length ?? 0;
  const words = cjk + latin;
  if (words === 0) return { words: 0, minutes: 0 };
  return { words, minutes: Math.max(1, Math.round(cjk / 400 + latin / 220)) };
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function clock(date: Date): string {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** 列表里用的短时间：刚刚、几分钟前、今天、昨天、日期。 */
export function formatNoteTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diff = now.getTime() - date.getTime();
  if (diff >= 0 && diff < 60_000) return '刚刚';
  if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days === 0) return `今天 ${clock(date)}`;
  if (days === 1) return `昨天 ${clock(date)}`;
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

export function formatFullTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 ${clock(date)}`;
}

/** 置顶在前，其余按最后编辑时间分到今天、昨天、近 7 天、近 30 天和各月份。 */
export function groupNotes(notes: Note[], now = new Date()): NoteGroup[] {
  const groups = new Map<string, Note[]>();
  const push = (label: string, note: Note) => {
    const list = groups.get(label);
    if (list) list.push(note);
    else groups.set(label, [note]);
  };
  const today = startOfDay(now);
  const sorted = [...notes].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  for (const note of sorted.filter((item) => item.pinned)) push('置顶', note);
  for (const note of sorted.filter((item) => !item.pinned && isPublishedNote(item))) push('已发布', note);
  for (const note of sorted.filter((item) => !item.pinned && !isPublishedNote(item))) {
    const date = new Date(note.updatedAt);
    const days = Math.round((today - startOfDay(date)) / DAY);
    if (days <= 0) push('今天', note);
    else if (days === 1) push('昨天', note);
    else if (days < 7) push('近 7 天', note);
    else if (days < 30) push('近 30 天', note);
    else push(`${date.getFullYear()} 年 ${date.getMonth() + 1} 月`, note);
  }

  return [...groups.entries()].map(([label, list]) => ({ label, notes: list }));
}

export function collectTags(notes: Note[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'));
}

export function searchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

/** 多个关键词同时命中才算匹配；`#标签` 只匹配标签。 */
export function matchNote(note: Note, terms: string[], tag: string): boolean {
  if (tag && !note.tags.includes(tag)) return false;
  if (terms.length === 0) return true;
  const haystack = `${note.title}\n${note.body}`.toLowerCase();
  const tags = note.tags.map((item) => item.toLowerCase());
  return terms.every((term) =>
    term.startsWith('#') && term.length > 1
      ? tags.some((item) => item.includes(term.slice(1)))
      : haystack.includes(term) || tags.some((item) => item.includes(term)),
  );
}

export function noteToMarkdown(note: Note): string {
  const title = note.title.trim();
  const tags = note.tags.length ? `\n\n${note.tags.map((tag) => `#${tag}`).join(' ')}` : '';
  return `${title ? `# ${title}\n\n` : ''}${note.body.trim()}${tags}\n`;
}

const BLOG_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DESCRIPTION = 200;
const MAX_SLUG = 80;
const MAX_CATEGORY = 40;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type BlogPublishInput = {
  title: string;
  description: string;
  slug: string;
  tags: string[];
  category?: string;
  draft: boolean;
  body: string;
  pubDate?: Date;
};

export function normalizeBlogSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG);
}

/** 标题里有英文就用它做文件名，否则用日期加记录编号，避免中文路径。 */
export function suggestBlogSlug(title: string, noteId: string, now = new Date()): string {
  const fromTitle = normalizeBlogSlug(title);
  if (fromTitle.length >= 2) return fromTitle;
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const tail = noteId.replace(/^note-/, '').replace(/[^a-z0-9]+/gi, '').slice(-6).toLowerCase();
  return tail ? `${stamp}-${tail}` : stamp;
}

export function formatBlogPubDate(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getDate()} ${date.getFullYear()}`;
}

function yamlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function validateBlogPublish(input: Partial<BlogPublishInput>): string | null {
  const title = input.title?.trim() ?? '';
  const description = input.description?.trim() ?? '';
  const slug = normalizeBlogSlug(input.slug ?? '');
  const category = input.category?.trim() ?? '';
  const tags = (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean);
  const body = input.body?.trim() ?? '';
  if (!title) return '请填写标题';
  if (title.length > MAX_TITLE) return `标题不能超过 ${MAX_TITLE} 字`;
  if (!description) return '请填写简介，发布后会显示在博客列表里';
  if (description.length > MAX_DESCRIPTION) return `简介不能超过 ${MAX_DESCRIPTION} 字`;
  if (!slug || !BLOG_SLUG.test(slug)) return '文件名只能用小写字母、数字和连字符，例如 weekend-plan';
  if (category.length > MAX_CATEGORY) return `分类不能超过 ${MAX_CATEGORY} 字`;
  if (tags.length > MAX_TAGS) return `每篇最多 ${MAX_TAGS} 个标签`;
  if (tags.some((tag) => tag.length > MAX_TAG)) return `单个标签不能超过 ${MAX_TAG} 字`;
  if (!body) return '正文是空的，写一点再发布';
  if ((input.body ?? '').length > MAX_BODY) return `正文不能超过 ${MAX_BODY} 字`;
  return null;
}

/** 生成带 frontmatter 的博客文章，标题走字段，不再重复写进正文。 */
export function noteToBlogMarkdown(input: BlogPublishInput): string {
  const title = input.title.trim();
  const description = input.description.trim().replace(/\s+/g, ' ');
  const tags = [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))];
  const category = input.category?.trim() ?? '';
  const date = input.pubDate ?? new Date();
  const lines = [
    '---',
    `title: ${yamlQuote(title)}`,
    `description: ${yamlQuote(description)}`,
    `pubDate: ${yamlQuote(formatBlogPubDate(date))}`,
    `tags: [${tags.map((tag) => yamlQuote(tag)).join(', ')}]`,
  ];
  if (category) lines.push(`category: ${yamlQuote(category)}`);
  if (input.draft) lines.push('draft: true');
  lines.push('---', '', input.body.replace(/\r\n/g, '\n').trim(), '');
  return lines.join('\n');
}

function yamlScalar(block: string, key: string): string {
  const line = block.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  if (!line) return '';
  let value = line[1].trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    value = value.slice(1, -1).replace(/''/g, "'");
  }
  return value.trim();
}

/** 从博客文章还原成记录，去掉 frontmatter，保留正文。 */
export function noteFromBlogMarkdown(source: string, slug: string, now = new Date()): Note {
  const text = source.replace(/\r\n/g, '\n');
  const matter = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const note = createNote(now);
  const front = matter?.[1] ?? '';
  note.title = (yamlScalar(front, 'title') || slug).slice(0, MAX_TITLE);
  note.body = (matter?.[2] ?? text).replace(/^\n+/, '').slice(0, MAX_BODY);
  note.tags = parseTags(yamlScalar(front, 'tags').replace(/^\[|\]$/g, ''));
  markNotePublished(note, slug, now);
  return note;
}

/** 导入 .md / .txt：首行一级标题作为标题，其余作为正文。 */
export function noteFromMarkdown(source: string, fileName: string, now = new Date()): Note {
  const text = source.replace(/\r\n/g, '\n');
  const heading = text.match(/^\s*#\s+(.+)\n?/);
  const note = createNote(now);
  note.title = (heading?.[1] ?? fileName.replace(/\.(md|markdown|txt)$/i, '')).trim().slice(0, MAX_TITLE);
  note.body = (heading ? text.slice(heading[0].length) : text).replace(/^\n+/, '').slice(0, MAX_BODY);
  return note;
}

export const NOTE_LIMITS = { MAX_NOTES, MAX_TITLE, MAX_BODY, MAX_TAGS, MAX_TAG, MAX_DESCRIPTION, MAX_SLUG, MAX_CATEGORY };
