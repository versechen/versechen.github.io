export type Note = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
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

    notes.push({
      id,
      title: String(raw.title ?? '').slice(0, MAX_TITLE),
      body: String(raw.body ?? '').slice(0, MAX_BODY),
      tags,
      pinned: raw.pinned === true,
      createdAt: asIso(raw.createdAt, now),
      updatedAt: asIso(raw.updatedAt, now),
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
  for (const note of sorted.filter((item) => !item.pinned)) {
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

/** 导入 .md / .txt：首行一级标题作为标题，其余作为正文。 */
export function noteFromMarkdown(source: string, fileName: string, now = new Date()): Note {
  const text = source.replace(/\r\n/g, '\n');
  const heading = text.match(/^\s*#\s+(.+)\n?/);
  const note = createNote(now);
  note.title = (heading?.[1] ?? fileName.replace(/\.(md|markdown|txt)$/i, '')).trim().slice(0, MAX_TITLE);
  note.body = (heading ? text.slice(heading[0].length) : text).replace(/^\n+/, '').slice(0, MAX_BODY);
  return note;
}

export const NOTE_LIMITS = { MAX_NOTES, MAX_TITLE, MAX_BODY, MAX_TAGS, MAX_TAG };
