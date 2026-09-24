import type { IconName } from './notes-icons';

type Area = HTMLTextAreaElement;

const CARET = '{|}';
const LIST_ITEM = /^([ \t]*)((?:>[ \t]?)*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/;
const QUOTE_ONLY = /^([ \t]*)((?:>[ \t]?)+)/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;

/** 用 execCommand 插入以保留浏览器的撤销记录，不支持时退回 setRangeText。 */
export function replaceRange(area: Area, start: number, end: number, text: string, select?: [number, number]): void {
  area.focus({ preventScroll: true });
  area.setSelectionRange(start, end);
  let done = false;
  if (text || start !== end) {
    try {
      done = text ? document.execCommand('insertText', false, text) : document.execCommand('delete');
    } catch {
      done = false;
    }
    if (!done) {
      area.setRangeText(text, start, end, 'end');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  const [from, to] = select ?? [text.length, text.length];
  area.setSelectionRange(start + from, start + to);
}

/** 替换并把 `{|}` 标记的位置当作光标，标记成对出现时选中两者之间的文字。 */
export function insertWithCaret(area: Area, start: number, end: number, template: string): void {
  const first = template.indexOf(CARET);
  if (first === -1) {
    replaceRange(area, start, end, template);
    return;
  }
  const withoutFirst = template.slice(0, first) + template.slice(first + CARET.length);
  const second = withoutFirst.indexOf(CARET);
  const text = second === -1 ? withoutFirst : withoutFirst.slice(0, second) + withoutFirst.slice(second + CARET.length);
  replaceRange(area, start, end, text, [first, second === -1 ? first : second]);
}

export function lineBounds(value: string, start: number, end = start): { start: number; end: number } {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const next = value.indexOf('\n', last);
  return { start: lineStart, end: next === -1 ? value.length : next };
}

/** 判断某位置所在行是否处于代码围栏内部（只看它之前的行）。 */
export function isInFence(value: string, position: number): boolean {
  const lineStart = value.lastIndexOf('\n', position - 1) + 1;
  let open = '';
  for (const line of value.slice(0, lineStart).split('\n')) {
    const fence = line.match(FENCE);
    if (!fence) continue;
    if (!open) open = fence[1];
    else if (fence[1][0] === open[0] && fence[1].length >= open.length && !line.slice(fence[0].length).trim()) open = '';
  }
  return Boolean(open);
}

function runLength(value: string, from: number, step: 1 | -1, char: string): number {
  let count = 0;
  let index = step === 1 ? from : from - 1;
  while (index >= 0 && index < value.length && value[index] === char) {
    count += 1;
    index += step;
  }
  return count;
}

/** 给选区加上或去掉成对标记；`*` 与 `**` 会区分斜体和粗体。 */
export function toggleWrap(area: Area, before: string, after = before, placeholder = ''): void {
  const { selectionStart: start, selectionEnd: end, value } = area;
  const selected = value.slice(start, end);
  const repeated = before === after && before.split('').every((char) => char === before[0]);

  let wrapped = value.slice(start - before.length, start) === before && value.slice(end, end + after.length) === after;
  if (wrapped && repeated) {
    const left = runLength(value, start, -1, before[0]);
    const right = runLength(value, end, 1, before[0]);
    wrapped = before.length === 1 ? left % 2 === 1 && right % 2 === 1 : left >= 2 && right >= 2 && left <= 3 && right <= 3;
  }
  if (wrapped) {
    replaceRange(area, start - before.length, end + after.length, selected, [0, selected.length]);
    return;
  }

  if (selected.length > before.length + after.length && selected.startsWith(before) && selected.endsWith(after)) {
    const inner = selected.slice(before.length, selected.length - after.length);
    replaceRange(area, start, end, inner, [0, inner.length]);
    return;
  }

  const trimmed = selected.replace(/\s+$/, '');
  const trailing = selected.slice(trimmed.length);
  const inner = trimmed || placeholder;
  replaceRange(area, start, end, `${before}${inner}${after}${trailing}`, [before.length, before.length + inner.length]);
}

/** 选中文字后输入符号时直接包裹，连按两次 `*` 得到 `**粗体**`。 */
export function surround(area: Area, before: string, after = before): void {
  const { selectionStart: start, selectionEnd: end, value } = area;
  const selected = value.slice(start, end);
  const trimmed = selected.replace(/\s+$/, '');
  const trailing = selected.slice(trimmed.length);
  replaceRange(area, start, end, `${before}${trimmed}${after}${trailing}`, [before.length, before.length + trimmed.length]);
}

export type LineKind = 'h1' | 'h2' | 'h3' | 'paragraph' | 'ul' | 'ol' | 'task' | 'quote';

function stripHeading(line: string): string {
  return line.replace(/^[ \t]{0,3}#{1,6}[ \t]+/, '');
}

function stripList(line: string): { indent: string; text: string } {
  const match = line.match(/^([ \t]*)(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/);
  const indent = match?.[1] ?? '';
  return { indent, text: line.slice(match?.[0].length ?? 0) };
}

function lineKind(line: string): LineKind | null {
  const heading = line.match(/^[ \t]{0,3}(#{1,6})[ \t]+/);
  if (heading) return heading[1].length <= 3 ? (`h${heading[1].length}` as LineKind) : null;
  if (/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+/.test(line)) return 'task';
  if (/^[ \t]*[-*+][ \t]+/.test(line)) return 'ul';
  if (/^[ \t]*\d{1,9}[.)][ \t]+/.test(line)) return 'ol';
  if (/^[ \t]*>/.test(line)) return 'quote';
  return null;
}

/** 把选中的每一行设为标题、列表、待办或引用；全部已是该格式时还原为正文。 */
export function setLineKind(area: Area, kind: LineKind): void {
  const { selectionStart, selectionEnd, value } = area;
  const bounds = lineBounds(value, selectionStart, selectionEnd);
  const lines = value.slice(bounds.start, bounds.end).split('\n');
  const content = lines.filter((line) => line.trim());
  const already = kind !== 'paragraph' && content.length > 0 && content.every((line) => lineKind(line) === kind);
  let counter = 0;

  const next = lines.map((line) => {
    if (!line.trim() && kind !== 'quote') return line;
    if (kind === 'quote') {
      return already ? line.replace(/^([ \t]*)>[ \t]?/, '$1') : `> ${line}`;
    }
    if (kind === 'h1' || kind === 'h2' || kind === 'h3' || kind === 'paragraph') {
      const text = stripHeading(line);
      if (already || kind === 'paragraph') return text;
      return `${'#'.repeat(Number(kind[1]))} ${stripList(text).text}`;
    }
    const { indent, text } = stripList(stripHeading(line));
    if (already) return `${indent}${text}`;
    counter += 1;
    const marker = kind === 'ol' ? `${counter}. ` : kind === 'task' ? '- [ ] ' : '- ';
    return `${indent}${marker}${text}`;
  });

  replaceLines(area, bounds, lines, next);
}

/** 替换整行后，单行内的光标或选区跟着前缀长度平移，跨行选区则选中全部结果。 */
function replaceLines(area: Area, bounds: { start: number; end: number }, lines: string[], next: string[]): void {
  const { selectionStart: start, selectionEnd: end, value } = area;
  const text = next.join('\n');
  if (value.slice(start, end).includes('\n')) {
    replaceRange(area, bounds.start, bounds.end, text, [0, text.length]);
    return;
  }
  const delta = next[0].length - lines[0].length;
  const shift = (position: number) => Math.max(0, Math.min(next[0].length, position - bounds.start + delta));
  replaceRange(area, bounds.start, bounds.end, text, [shift(start), shift(end)]);
}

/** 在光标处插入独立成段的块，前后自动补空行。 */
export function insertBlock(area: Area, template: string): void {
  const { selectionStart: start, selectionEnd: end, value } = area;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const prefix = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const body = template.includes(CARET) ? template : `${template}${CARET}`;
  insertWithCaret(area, start, end, `${prefix}${body}${suffix}`);
}

function selectedOr(area: Area, fallback: string): string {
  const selected = area.value.slice(area.selectionStart, area.selectionEnd);
  return selected.trim() ? selected : fallback;
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : prefix.trimEnd()))
    .join('\n');
}

/** 换行时延续列表、待办、编号和引用；空条目再按回车会结束列表。 */
export function continueBlock(area: Area): boolean {
  const { selectionStart: start, selectionEnd: end, value } = area;
  if (start !== end) return false;
  const bounds = lineBounds(value, start);
  const line = value.slice(bounds.start, bounds.end);
  const beforeCaret = value.slice(bounds.start, start);

  if (isInFence(value, bounds.start)) {
    const indent = beforeCaret.match(/^[ \t]*/)?.[0] ?? '';
    if (!indent) return false;
    replaceRange(area, start, start, `\n${indent}`);
    return true;
  }

  const item = line.match(LIST_ITEM);
  if (item && beforeCaret.length >= item[0].length) {
    const [marker, indent, quotes, bullet, number, delimiter, space, task] = item;
    if (!line.slice(marker.length).trim()) {
      if (indent.length > 0) indentLines(area, true);
      else replaceRange(area, bounds.start, bounds.end, quotes);
      return true;
    }
    const nextMarker = bullet ? bullet : `${Number(number) + 1}${delimiter}`;
    replaceRange(area, start, start, `\n${indent}${quotes}${nextMarker}${space}${task ? '[ ] ' : ''}`);
    return true;
  }

  const quote = line.match(QUOTE_ONLY);
  if (quote && beforeCaret.length >= quote[0].length) {
    if (!line.slice(quote[0].length).trim()) {
      replaceRange(area, bounds.start, bounds.end, '');
      return true;
    }
    replaceRange(area, start, start, `\n${quote[1]}${quote[2].endsWith(' ') ? quote[2] : `${quote[2]} `}`);
    return true;
  }

  return false;
}

function leadingWidth(line: string): number {
  return line.match(/^[ \t]*/)?.[0].replace(/\t/g, '    ').length ?? 0;
}

/** Tab 缩进到上一条列表的内容位置，Shift+Tab 退回上一层。 */
export function indentLines(area: Area, outdent: boolean): void {
  const { selectionStart: start, selectionEnd: end, value } = area;
  const bounds = lineBounds(value, start, end);
  const lines = value.slice(bounds.start, bounds.end).split('\n');
  const first = lines[0];
  const isList = LIST_ITEM.test(first);

  if (!outdent && start === end && !isList) {
    replaceRange(area, start, start, '  ');
    return;
  }

  const previous = value.slice(0, bounds.start).replace(/\n$/, '').split('\n').reverse();
  const currentIndent = leadingWidth(first);
  let target = outdent ? 0 : currentIndent + 2;
  for (const line of previous) {
    if (!line.trim()) continue;
    const item = line.match(LIST_ITEM);
    const indent = leadingWidth(line);
    if (outdent) {
      if (item && indent < currentIndent) {
        target = indent;
        break;
      }
      continue;
    }
    if (item && indent === currentIndent) {
      target = currentIndent + item[0].length - item[1].length - item[2].length - (item[7]?.length ?? 0);
    }
    break;
  }
  const delta = target - currentIndent;
  if (delta === 0) return;

  const next = lines.map((line) => {
    if (!line.trim()) return line;
    const width = leadingWidth(line);
    const indent = ' '.repeat(Math.max(0, width + delta));
    return indent + line.replace(/^[ \t]*/, '');
  });
  const text = next.join('\n');
  if (start === end) {
    const caret = Math.max(0, start - bounds.start + (next[0].length - first.length));
    replaceRange(area, bounds.start, bounds.end, text, [caret, caret]);
  } else {
    replaceRange(area, bounds.start, bounds.end, text, [0, text.length]);
  }
}

/** Mod+Enter：切换待办勾选；普通行变成待办。 */
export function toggleTaskLines(area: Area): void {
  const { selectionStart: start, selectionEnd: end, value } = area;
  const bounds = lineBounds(value, start, end);
  const lines = value.slice(bounds.start, bounds.end).split('\n');
  const next = lines.map((line) => {
    if (!line.trim()) return line;
    const task = line.match(/^([ \t]*(?:>[ \t]?)*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[([ xX])\]/);
    if (task) return `${task[1]}[${task[2] === ' ' ? 'x' : ' '}]${line.slice(task[0].length)}`;
    const list = line.match(/^([ \t]*(?:>[ \t]?)*(?:[-*+]|\d{1,9}[.)])[ \t]+)/);
    if (list) return `${list[1]}[ ] ${line.slice(list[0].length)}`;
    const { indent, text } = stripList(stripHeading(line));
    return `${indent}- [ ] ${text}`;
  });
  replaceLines(area, bounds, lines, next);
}

/** 预览里点待办时，根据渲染器记下的起点找到 `[ ]` 中间那个字符。 */
export function taskCharIndex(source: string, offset: number): number {
  const match = source.slice(offset, offset + 40).match(/^(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\]/);
  return match ? offset + match[0].length - 2 : -1;
}

/** 行首或空格后的 `/`（行首也可以是中文输入法的 `、`）触发插入菜单。 */
export function slashQuery(value: string, caret: number): { start: number; query: string } | null {
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const before = value.slice(lineStart, caret);
  const match = before.match(/(?:^|[ \t\u3000])\/([^\s/]{0,16})$/) ?? before.match(/^[ \t]*、([^\s、]{0,16})$/);
  if (!match || isInFence(value, lineStart)) return null;
  return { start: caret - match[1].length - 1, query: match[1] };
}

const MIRRORED = [
  'boxSizing', 'overflowX', 'overflowY', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch',
  'fontSize', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize',
] as const;

/** 用镜像节点量出光标在视口中的位置，给斜杠菜单定位。 */
export function caretRect(area: Area, position: number): { left: number; top: number; height: number } {
  const style = getComputedStyle(area);
  const mirror = document.createElement('div');
  for (const prop of MIRRORED) mirror.style[prop] = style[prop];
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.width = `${area.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`;
  mirror.textContent = area.value.slice(0, position);
  const marker = document.createElement('span');
  marker.textContent = area.value.slice(position) || '.';
  mirror.append(marker);
  document.body.append(mirror);
  const rect = area.getBoundingClientRect();
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6;
  const result = {
    left: rect.left + parseFloat(style.borderLeftWidth) + marker.offsetLeft - area.scrollLeft,
    top: rect.top + parseFloat(style.borderTopWidth) + marker.offsetTop - area.scrollTop,
    height: lineHeight,
  };
  mirror.remove();
  return result;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatDate(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatClock(date = new Date()): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function weekday(date: Date): string {
  return WEEKDAYS[date.getDay()];
}

function isoWeek(date: Date): number {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return Math.ceil(((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

export type CommandGroup = '标题与列表' | '块' | '提示' | '插入';

export type Command = {
  id: string;
  label: string;
  hint: string;
  icon: IconName;
  group: CommandGroup;
  keywords: string;
  run: (area: Area) => void;
};

function alert(kind: string, fallback: string) {
  return (area: Area) => insertBlock(area, `${prefixLines(`[!${kind}]`, '> ')}\n${prefixLines(`${CARET}${selectedOr(area, fallback)}${CARET}`, '> ')}`);
}

export const COMMANDS: Command[] = [
  { id: 'h1', label: '一级标题', hint: '# 标题', icon: 'heading', group: '标题与列表', keywords: 'h1 heading title biaoti bt 标题 大标题', run: (area) => setLineKind(area, 'h1') },
  { id: 'h2', label: '二级标题', hint: '## 标题', icon: 'heading', group: '标题与列表', keywords: 'h2 heading biaoti bt 标题 小标题', run: (area) => setLineKind(area, 'h2') },
  { id: 'h3', label: '三级标题', hint: '### 标题', icon: 'heading', group: '标题与列表', keywords: 'h3 heading biaoti bt 标题', run: (area) => setLineKind(area, 'h3') },
  { id: 'ul', label: '无序列表', hint: '- 条目', icon: 'list', group: '标题与列表', keywords: 'ul list bullet liebiao lb 列表', run: (area) => setLineKind(area, 'ul') },
  { id: 'ol', label: '有序列表', hint: '1. 条目', icon: 'listOrdered', group: '标题与列表', keywords: 'ol ordered number liebiao lb bianhao 编号 列表', run: (area) => setLineKind(area, 'ol') },
  { id: 'task', label: '待办事项', hint: '- [ ] 事项', icon: 'todo', group: '标题与列表', keywords: 'todo task check daiban db renwu 任务 清单', run: (area) => setLineKind(area, 'task') },
  { id: 'quote', label: '引用', hint: '> 引用', icon: 'quote', group: '标题与列表', keywords: 'quote blockquote yinyong yy', run: (area) => setLineKind(area, 'quote') },
  {
    id: 'code', label: '代码块', hint: '``` 代码 ```', icon: 'codeBlock', group: '块', keywords: 'code pre daima dm 代码',
    run: (area) => insertBlock(area, `\`\`\`${CARET}\n${selectedOr(area, '')}${CARET}\n\`\`\``),
  },
  {
    id: 'table', label: '表格', hint: '三列表格', icon: 'table', group: '块', keywords: 'table biaoge bg grid 表',
    run: (area) => insertBlock(area, `| ${CARET}列 1${CARET} | 列 2 | 列 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |`),
  },
  {
    id: 'math', label: '公式块', hint: '$$ 公式 $$', icon: 'math', group: '块', keywords: 'math latex katex gongshi gs 数学 公式',
    run: (area) => insertBlock(area, `$$\n${CARET}${selectedOr(area, 'E = mc^2')}${CARET}\n$$`),
  },
  {
    id: 'details', label: '折叠块', hint: ':::details 标题', icon: 'details', group: '块', keywords: 'details collapse fold zhedie zd 折叠 展开',
    run: (area) => insertBlock(area, `:::details ${CARET}点击展开${CARET}\n${selectedOr(area, '折叠起来的内容')}\n:::`),
  },
  { id: 'hr', label: '分割线', hint: '---', icon: 'divider', group: '块', keywords: 'hr divider line fengexian fgx 分隔', run: (area) => insertBlock(area, '---') },
  { id: 'note', label: '提示', hint: '> [!NOTE]', icon: 'note', group: '提示', keywords: 'note info tishi ts 提示 说明', run: alert('NOTE', '补充说明') },
  { id: 'tip', label: '技巧', hint: '> [!TIP]', icon: 'tip', group: '提示', keywords: 'tip jiqiao jq 技巧 建议', run: alert('TIP', '一个小技巧') },
  { id: 'important', label: '重要', hint: '> [!IMPORTANT]', icon: 'important', group: '提示', keywords: 'important zhongyao zy 重要', run: alert('IMPORTANT', '重要的事情') },
  { id: 'warning', label: '注意', hint: '> [!WARNING]', icon: 'warning', group: '提示', keywords: 'warning warn zhuyi zy 注意 警示', run: alert('WARNING', '需要注意') },
  { id: 'caution', label: '警告', hint: '> [!CAUTION]', icon: 'caution', group: '提示', keywords: 'caution danger jinggao jg 警告 危险', run: alert('CAUTION', '千万小心') },
  {
    id: 'link', label: '链接', hint: '[文字](网址)', icon: 'link', group: '插入', keywords: 'link url lianjie lj 链接 网址',
    run: (area) => {
      const selected = area.value.slice(area.selectionStart, area.selectionEnd);
      const template = /^https?:\/\/\S+$/.test(selected.trim())
        ? `[${CARET}链接文字${CARET}](${selected.trim()})`
        : `[${selected || '链接文字'}](${CARET}https://${CARET})`;
      insertWithCaret(area, area.selectionStart, area.selectionEnd, template);
    },
  },
  {
    id: 'image', label: '图片', hint: '![描述](网址)', icon: 'image', group: '插入', keywords: 'image img picture tupian tp 图片 照片',
    run: (area) => insertWithCaret(area, area.selectionStart, area.selectionEnd, `![${selectedOr(area, '图片描述')}](${CARET}https://${CARET})`),
  },
  {
    id: 'inline-math', label: '行内公式', hint: '$x^2$', icon: 'math', group: '插入', keywords: 'inline math gongshi gs 公式',
    run: (area) => toggleWrap(area, '$', '$', 'x^2'),
  },
  {
    id: 'footnote', label: '脚注', hint: '[^1]', icon: 'footnote', group: '插入', keywords: 'footnote jiaozhu jz 脚注 注释',
    run: (area) => {
      const numbers = [...area.value.matchAll(/\[\^(\d+)\]/g)].map((match) => Number(match[1]));
      const next = numbers.length ? Math.max(...numbers) + 1 : 1;
      const { selectionEnd: end, value } = area;
      const tail = value.slice(end).replace(/\s+$/, '');
      insertWithCaret(area, end, value.length, `[^${next}]${tail}\n\n[^${next}]: ${CARET}脚注内容${CARET}\n`);
    },
  },
  {
    id: 'date', label: '今天日期', hint: '年-月-日 周几', icon: 'calendar', group: '插入', keywords: 'date today riqi rq jintian 日期 今天',
    run: (area) => {
      const now = new Date();
      replaceRange(area, area.selectionStart, area.selectionEnd, `${formatDate(now)} ${weekday(now)}`);
    },
  },
  {
    id: 'time', label: '当前时间', hint: '时:分', icon: 'clock', group: '插入', keywords: 'time now shijian sj 时间 现在',
    run: (area) => replaceRange(area, area.selectionStart, area.selectionEnd, formatClock()),
  },
];

export function filterCommands(query: string): Command[] {
  const term = query.trim().toLowerCase();
  if (!term) return COMMANDS;
  return COMMANDS.filter((command) => command.label.includes(term) || command.keywords.includes(term) || command.id.startsWith(term));
}

export type Template = {
  id: string;
  label: string;
  hint: string;
  icon: IconName;
  tags: string[];
  title: (date: Date) => string;
  body: (date: Date) => string;
};

export const TEMPLATES: Template[] = [
  {
    id: 'diary', label: '日记', hint: '心情、经历与明日计划', icon: 'feather', tags: ['日记'],
    title: (date) => `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${weekday(date)}`,
    body: () => `## 今天的心情\n\n${CARET}\n\n## 发生了什么\n\n- \n\n## 值得记住的\n\n> \n\n## 明天想做\n\n- [ ] \n`,
  },
  {
    id: 'meeting', label: '会议纪要', hint: '议题、结论与待办', icon: 'users', tags: ['会议'],
    title: (date) => `会议纪要 ${formatDate(date)}`,
    body: (date) =>
      `**时间**：${formatDate(date)} ${formatClock(date)}\n**参与人**：${CARET}\n**主题**：\n\n## 议题\n\n1. \n\n## 讨论要点\n\n- \n\n## 结论\n\n> [!IMPORTANT]\n> \n\n## 待办\n\n- [ ] 负责人 · 事项 · 截止日期\n`,
  },
  {
    id: 'reading', label: '读书笔记', hint: '摘录、想法与延伸', icon: 'bookOpen', tags: ['读书'],
    title: () => '读书笔记',
    body: (date) =>
      `**书名**：《${CARET}》\n**作者**：\n**读于**：${formatDate(date)}\n\n## 一句话总结\n\n\n\n## 摘录\n\n> \n\n## 我的想法\n\n- \n\n:::details 延伸阅读\n- \n:::\n`,
  },
  {
    id: 'weekly', label: '周复盘', hint: '完成、问题与下周计划', icon: 'chart', tags: ['复盘'],
    title: (date) => `${date.getFullYear()} 年第 ${isoWeek(date)} 周复盘`,
    body: () => `## 本周完成\n\n- [x] ${CARET}\n\n## 遇到的问题\n\n- \n\n## 学到的东西\n\n> [!TIP]\n> \n\n## 下周计划\n\n- [ ] \n`,
  },
  {
    id: 'todo', label: '待办清单', hint: '按轻重缓急分组', icon: 'todo', tags: ['待办'],
    title: (date) => `待办 ${date.getMonth() + 1} 月 ${date.getDate()} 日`,
    body: () => `## 重要且紧急\n\n- [ ] ${CARET}\n\n## 重要不紧急\n\n- [ ] \n\n## 顺手就做\n\n- [ ] \n`,
  },
  {
    id: 'idea', label: '灵感', hint: '想法、来源与用法', icon: 'tip', tags: ['灵感'],
    title: () => '灵感',
    body: () => `💡 ${CARET}\n\n**来源**：\n\n**可以怎么用**：\n\n- \n`,
  },
];

export function templateText(template: Template, date = new Date()): { title: string; body: string } {
  return { title: template.title(date), body: template.body(date) };
}

export type GlyphGroup = { label: string; items: string[] };

export const EMOJI_GROUPS: GlyphGroup[] = [
  { label: '心情', items: ['😀', '😊', '🥰', '😂', '🤣', '😎', '🤔', '😴', '😭', '😤', '🥳', '😇', '🙃', '😅', '🤯', '🫠'] },
  { label: '手势', items: ['👍', '👎', '👏', '🙏', '💪', '👀', '🙌', '✌️', '👌', '🤝', '👋', '✍️'] },
  { label: '标记', items: ['✅', '❌', '⭐', '🔥', '💡', '📌', '⚠️', '❗', '❓', '🎯', '🎉', '✨', '❤️', '💯', '🚩', '🔖'] },
  { label: '生活', items: ['☕', '🍜', '🍰', '🏃', '🧘', '📚', '🎧', '🎬', '🌙', '☀️', '🌧️', '❄️', '🌸', '🌿', '🐱', '🐶'] },
  { label: '工作', items: ['💻', '📝', '📅', '⏰', '📈', '📊', '🐛', '🚀', '🔧', '📦', '🧪', '🗂️', '📎', '🔗', '💬', '📮'] },
];

export const SYMBOL_GROUPS: GlyphGroup[] = [
  { label: '标点', items: ['「」', '『』', '《》', '【】', '“”', '‘’', '……', '——', '·', '～'] },
  { label: '箭头', items: ['→', '←', '↑', '↓', '↔', '⇒', '⇐', '⇔', '↗', '↘'] },
  { label: '数学', items: ['±', '×', '÷', '≈', '≠', '≤', '≥', '∞', '√', '∑', 'π', '°', '‰', '∈'] },
  { label: '序号', items: ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'] },
  { label: '其他', items: ['℃', '¥', '€', '£', '©', '®', '™', '§', '★', '☆', '●', '○', '◆', '✓', '✗'] },
];

const PAIRED = new Set(['「」', '『』', '《》', '【】', '“”', '‘’']);

/** 成对的标点会包住选区，没有选区时把光标放在中间。 */
export function insertGlyph(area: Area, glyph: string): void {
  if (PAIRED.has(glyph)) {
    toggleWrap(area, glyph[0], glyph[1]);
    return;
  }
  replaceRange(area, area.selectionStart, area.selectionEnd, glyph);
}

export const WRAP_KEYS: Record<string, string> = {
  '*': '*',
  _: '_',
  '~': '~',
  '=': '=',
  '`': '`',
  '"': '"',
  '(': ')',
  '[': ']',
  $: '$',
};
