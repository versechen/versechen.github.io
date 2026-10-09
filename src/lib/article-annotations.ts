export type Annotation = {
  id: string; slug: string; title: string; revision: string;
  kind: 'highlight' | 'question' | 'comment';
  quote: string; prefix: string; suffix: string; section: string;
  body: string; resolved: boolean; answer: string; updatedAt: string;
};
export type AnnotationStore = { items: Annotation[]; deleted: { id: string; at: string }[] };
export const ANNOTATIONS_KEY = 'codeverse.annotations.v1';

/** Fixed-position menu beside the selection, clamped clear of the header and screen edges. */
export function selectionMenuPosition(rect: { right: number; top: number; bottom: number },
  viewport: { width: number; height: number; top: number }, menu: { width: number; height: number }) {
  const left = Math.max(8, Math.min(rect.right - menu.width, viewport.width - menu.width - 8));
  const below = rect.top - menu.height - 8 < viewport.top;
  const top = Math.max(viewport.top, Math.min(below ? rect.bottom + 8 : rect.top - menu.height - 8,
    viewport.height - menu.height - 8));
  return { left, top, below };
}

export function parseAnnotations(input: unknown): AnnotationStore {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid annotations');
  const raw = input as Partial<AnnotationStore> | null;
  if ((raw?.items !== undefined && !Array.isArray(raw.items))
    || (raw?.deleted !== undefined && !Array.isArray(raw.deleted))) throw new Error('Invalid annotations');
  const items: Annotation[] = [];
  for (const x of Array.isArray(raw?.items) ? raw.items : []) {
    if (!x || typeof x.id !== 'string' || typeof x.slug !== 'string'
      || !['highlight', 'question', 'comment'].includes(x.kind)
      || !Number.isFinite(Date.parse(x.updatedAt))) throw new Error('Invalid annotation entry');
    const item = { ...x };
    for (const key of ['id', 'slug', 'title', 'revision', 'quote', 'prefix', 'suffix', 'section', 'body', 'answer'] as const) {
      item[key] = String(x[key] ?? '').slice(0, key === 'body' ? 10000 : 4000);
    }
    item.resolved = x.resolved === true;
    items.push(item);
  }
  const deleted = (Array.isArray(raw?.deleted) ? raw.deleted : [])
    .filter(x => typeof x?.id === 'string' && Number.isFinite(Date.parse(x.at)));
  if (deleted.length !== (raw?.deleted?.length ?? 0)) throw new Error('Invalid deletion entry');
  return { items, deleted };
}

export function mergeAnnotations(a: AnnotationStore, b: AnnotationStore): AnnotationStore {
  const items = new Map<string, Annotation>();
  const deleted = new Map<string, { id: string; at: string }>();
  for (const x of [...a.items, ...b.items]) {
    const old = items.get(x.id);
    if (!old || Date.parse(x.updatedAt) > Date.parse(old.updatedAt)) items.set(x.id, x);
  }
  for (const x of [...a.deleted, ...b.deleted]) {
    const old = deleted.get(x.id);
    if (!old || Date.parse(x.at) > Date.parse(old.at)) deleted.set(x.id, x);
  }
  return {
    items: [...items.values()].filter(x => !deleted.has(x.id) || Date.parse(x.updatedAt) > Date.parse(deleted.get(x.id)!.at))
      .sort((x, y) => Date.parse(y.updatedAt) - Date.parse(x.updatedAt)),
    deleted: [...deleted.values()],
  };
}

/** Context disambiguates repeated text; uncertain matches stay detached. */
export function locateQuote(text: string, quote: string, prefix: string, suffix: string): number {
  if (!quote) return -1;
  const matches: number[] = [];
  let start = 0;
  while (start <= text.length) {
    const i = text.indexOf(quote, start);
    if (i < 0) break;
    matches.push(i); start = i + 1;
  }
  if (matches.length === 1) return matches[0];
  const contextual = matches.filter(i => (!prefix || text.slice(Math.max(0, i - prefix.length), i) === prefix)
    && (!suffix || text.slice(i + quote.length, i + quote.length + suffix.length) === suffix));
  return contextual.length === 1 ? contextual[0] : -1;
}

export function questionTask(items: Annotation[]): string {
  const questions = items.filter(x => x.kind === 'question' && !x.resolved);
  return ['请根据以下阅读疑问补充原博客，逐题给出明确答案、关键推理和必要的验证步骤。',
    '保留原文准确内容与章节结构；先提供补充稿和修改说明，不直接发布。涉及 API 请核对官方资料。',
    ...questions.map((x, i) => `\n## 疑问 ${i + 1}：${x.title}\n文章：/blog/${x.slug}/\n章节：${x.section || '未指定'}\n文章版本：${x.revision}\n原文：${x.quote}\n疑问：${x.body}\n`)].join('\n');
}
