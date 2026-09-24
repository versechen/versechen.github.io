import rehypeExternalLinks from 'rehype-external-links';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import { remarkAlert } from 'remark-github-blockquote-alert';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

type TreeNode = {
  type: string;
  value?: string;
  tagName?: string;
  checked?: boolean | null;
  position?: { start: { offset?: number } };
  children?: TreeNode[];
  properties?: Record<string, unknown>;
  data?: object;
};

const ALERT_TITLES: Record<string, string> = {
  NOTE: '提示',
  TIP: '技巧',
  IMPORTANT: '重要',
  WARNING: '注意',
  CAUTION: '警告',
};

const DETAILS_OPEN = /^:::[ \t]*details\b[ \t]*(.*)$/;
const DETAILS_CLOSE = /^:::[ \t]*$/;
const MARK = /==(?=\S)([^=\n]*?\S)==/g;
const SOFT_BREAK = /[ \t]*\r?\n/;

const markdown = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkAlert);

const toHast = unified()
  .use(remarkRehype, { footnoteLabel: '脚注', footnoteBackLabel: '返回正文' })
  .use(rehypeKatex, { strict: 'ignore' })
  .use(rehypeExternalLinks, { target: '_blank', rel: ['noopener', 'noreferrer'] });

const toHtml = unified().use(rehypeStringify);

function text(value: string): TreeNode {
  return { type: 'text', value };
}

function splitMarks(value: string): TreeNode[] {
  const parts: TreeNode[] = [];
  let last = 0;
  for (const match of value.matchAll(MARK)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text(value.slice(last, start)));
    parts.push({ type: 'noteMark', data: { hName: 'mark' }, children: [text(match[1])] });
    last = start + match[0].length;
  }
  if (parts.length === 0) return [];
  if (last < value.length) parts.push(text(value.slice(last)));
  return parts;
}

function highlightMarks(node: TreeNode): void {
  const children = node.children;
  if (!children) return;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.type === 'text' && child.value?.includes('==')) {
      const parts = splitMarks(child.value);
      if (parts.length > 0) {
        children.splice(index, 1, ...parts);
        index += parts.length - 1;
      }
      continue;
    }
    highlightMarks(child);
  }
}

/** 记录里回车就是换行，不必像文章那样在行尾加两个空格。 */
function softBreaks(node: TreeNode): void {
  const children = node.children;
  if (!children) return;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.type === 'text' && child.value?.includes('\n')) {
      const parts = child.value
        .split(SOFT_BREAK)
        .flatMap((part, order) => (order === 0 ? [text(part)] : [{ type: 'break' }, text(part)]))
        .filter((part) => part.type !== 'text' || part.value);
      children.splice(index, 1, ...parts);
      index += parts.length - 1;
      continue;
    }
    softBreaks(child);
  }
}

function translateAlertTitles(node: TreeNode): void {
  for (const child of node.children ?? []) {
    const props = (child.data as { hProperties?: { className?: unknown } } | undefined)?.hProperties;
    if (child.type === 'paragraph' && props?.className === 'markdown-alert-title') {
      for (const part of child.children ?? []) {
        if (part.type === 'text' && part.value) {
          part.value = ALERT_TITLES[part.value.trim().toUpperCase()] ?? part.value;
        }
      }
      continue;
    }
    translateAlertTitles(child);
  }
}

/** 记下待办在原文里的起点，预览中勾选时据此改回原文。 */
function markTaskOffsets(node: TreeNode): void {
  for (const child of node.children ?? []) {
    const offset = child.position?.start.offset;
    if (child.type === 'listItem' && typeof child.checked === 'boolean' && offset !== undefined) {
      child.data = { ...child.data, hProperties: { dataTaskOffset: String(offset) } };
    }
    markTaskOffsets(child);
  }
}

function detailsNode(title: string): TreeNode {
  return {
    type: 'noteDetails',
    data: { hName: 'details', hProperties: { className: ['note-details'] } },
    children: [{ type: 'noteSummary', data: { hName: 'summary' }, children: [text(title || '展开')] }],
  };
}

/** `:::details 标题` 到 `:::` 之间的块包成可折叠区域；开合行与正文挨着写也能识别。 */
function wrapDetails(node: TreeNode): void {
  const children = node.children;
  if (!children || node.type === 'paragraph' || node.type === 'heading') return;

  const output: TreeNode[] = [];
  const stack: TreeNode[] = [];
  const append = (child: TreeNode) => {
    const target = stack[stack.length - 1];
    if (target) target.children?.push(child);
    else output.push(child);
  };
  const close = () => {
    const done = stack.pop();
    if (done) append(done);
  };

  for (const child of children) {
    if (child.type !== 'paragraph' || !child.children?.length) {
      wrapDetails(child);
      append(child);
      continue;
    }

    const first = child.children[0];
    if (first.type === 'text' && first.value) {
      const [line, ...rest] = first.value.split('\n');
      const open = line.match(DETAILS_OPEN);
      if (open) {
        stack.push(detailsNode(open[1].trim()));
        if (rest.length === 0 && child.children.length === 1) continue;
        first.value = rest.join('\n');
        if (!first.value) child.children.shift();
        if (!child.children.length) continue;
      } else if (DETAILS_CLOSE.test(first.value) && child.children.length === 1) {
        close();
        continue;
      }
    }

    const last = child.children[child.children.length - 1];
    if (stack.length > 0 && last?.type === 'text' && last.value) {
      const lines = last.value.split('\n');
      if (lines.length > 1 && DETAILS_CLOSE.test(lines[lines.length - 1])) {
        last.value = lines.slice(0, -1).join('\n');
        append(child);
        close();
        continue;
      }
    }

    append(child);
  }

  while (stack.length > 0) close();
  node.children = output;
}

function isSafeUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const value = url.replace(/[\u0000-\u0020\u007f]/g, '');
  const scheme = value.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!scheme) return true;
  return ['http', 'https', 'mailto', 'tel'].includes(scheme[1].toLowerCase());
}

function className(node: TreeNode): string[] {
  const value = node.properties?.className;
  return Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(/\s+/) : [];
}

function decorateHast(tree: TreeNode): void {
  const walk = (node: TreeNode, taskOffset: unknown) => {
    for (const child of node.children ?? []) {
      let offset = taskOffset;
      if (child.type === 'element' && child.properties) {
        const props = child.properties;
        if (child.tagName === 'li' && 'dataTaskOffset' in props) {
          offset = props.dataTaskOffset;
          delete props.dataTaskOffset;
        }
        if (child.tagName === 'a' && 'href' in props && !isSafeUrl(props.href)) delete props.href;
        if (child.tagName === 'img') {
          if (!isSafeUrl(props.src)) delete props.src;
          props.loading = 'lazy';
          props.decoding = 'async';
        }
        if (child.tagName === 'input' && props.type === 'checkbox' && offset !== undefined) {
          delete props.disabled;
          props.dataTask = offset;
          props.ariaLabel = props.checked ? '标记为未完成' : '标记为已完成';
          offset = undefined;
        }
        if (child.tagName === 'pre') {
          const code = child.children?.find((item) => item.tagName === 'code');
          const lang = code ? className(code).find((name) => name.startsWith('language-')) : undefined;
          if (lang) props.dataLang = lang.slice('language-'.length);
        }
      }
      walk(child, offset);
    }
  };
  walk(tree, undefined);
}

/** 与博客文章同一套 remark / rehype 插件，原文中的 HTML 不会被输出。 */
export function renderNote(source: string): string {
  try {
    const mdast = markdown.runSync(markdown.parse(source));
    const tree = mdast as unknown as TreeNode;
    translateAlertTitles(tree);
    markTaskOffsets(tree);
    highlightMarks(tree);
    wrapDetails(tree);
    softBreaks(tree);
    const hast = toHast.runSync(mdast);
    decorateHast(hast as unknown as TreeNode);
    return toHtml.stringify(hast);
  } catch {
    return '<p class="note-render-error">这段内容暂时无法预览，请检查公式或表格的写法。</p>';
  }
}
