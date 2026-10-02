import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { renderNote } from './notes-render';
import { continueBlock, indentLines, toggleWrap, isInFence } from './notes-editor';

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
type Block = { start: number; end: number };

/** Source offsets, never HTML → Markdown serialization: whitespace and extensions stay intact. */
export function sourceBlocks(source: string): Block[] {
  const nodes = parser.parse(source).children;
  const blocks = nodes.map((node, i) => ({
    start: i === 0 ? 0 : node.position!.start.offset!,
    end: nodes[i + 1]?.position?.start.offset ?? source.length,
  }));
  return blocks.length ? blocks : [{ start: 0, end: source.length }];
}

export class LiveMarkdown {
  private active: HTMLTextAreaElement | null = null;
  private range: Block | null = null;
  private composing = false;
  private sending = false;
  private revision = '';
  private history: string[] = [];
  private historyAt = -1;
  private docId = '';
  private enabled = false;

  constructor(private source: HTMLTextAreaElement, private host: HTMLElement) {
    this.history = [source.value];
    this.historyAt = 0;
    this.revision = source.value;
    source.addEventListener('input', () => {
      if (!this.sending) {
        this.remember();
        // Toolbar helpers set their selection immediately after dispatching input.
        queueMicrotask(() => this.render(this.enabled ? source.selectionStart : undefined));
      }
    });
    source.addEventListener('keydown', (event) => {
      if (event.isComposing || this.composing) return;
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.undo(event.key.toLowerCase() === 'y' || event.shiftKey);
      }
    }, true);
    source.addEventListener('focus', () => {
      if (this.enabled) queueMicrotask(() => this.render(source.selectionStart));
    });
    host.addEventListener('keydown', (event) => {
      if (event.isComposing || this.composing || event.key === 'Process') return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        event.stopPropagation();
        this.undo(event.key.toLowerCase() === 'y' || event.shiftKey);
      }
    });
  }

  setDocument(id: string): void {
    if (this.docId !== id) {
      this.docId = id;
      this.history = [this.source.value];
      this.historyAt = 0;
    } else if (this.revision !== this.source.value) this.remember();
    this.render();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.host.hidden = !on;
    this.source.tabIndex = on ? -1 : 0;
    this.source.setAttribute('aria-hidden', String(on));
    if (on) this.render();
  }

  private remember(): void {
    if (this.history[this.historyAt] === this.source.value) return;
    this.history.splice(this.historyAt + 1);
    this.history.push(this.source.value);
    if (this.history.length > 200) this.history.shift();
    this.historyAt = this.history.length - 1;
  }

  private emit(): void {
    this.sending = true;
    this.source.dispatchEvent(new Event('input', { bubbles: true }));
    this.sending = false;
    this.revision = this.source.value;
  }

  private undo(redo: boolean): void {
    const next = this.historyAt + (redo ? 1 : -1);
    if (next < 0 || next >= this.history.length) return;
    this.historyAt = next;
    const caret = Math.min(this.source.selectionStart, this.history[next].length);
    this.source.value = this.history[next];
    this.emit();
    this.source.setSelectionRange(caret, caret);
    this.render(caret);
  }

  private sync(): void {
    if (!this.active || !this.range) return;
    const { start, end } = this.range;
    const area = this.active;
    this.source.value = this.source.value.slice(0, start) + area.value + this.source.value.slice(end);
    this.range.end = start + area.value.length;
    this.source.setSelectionRange(start + area.selectionStart, start + area.selectionEnd);
    if (!this.composing) this.remember();
    this.emit();
    area.style.height = '0';
    area.style.height = `${area.scrollHeight + 2}px`;
  }

  private edit(container: HTMLElement, range: Block, caret = range.start): void {
    const area = document.createElement('textarea');
    area.className = 'notes-live__input';
    area.setAttribute('aria-label', '编辑 Markdown 段落');
    area.spellcheck = this.source.spellcheck;
    area.value = this.source.value.slice(range.start, range.end);
    container.replaceChildren(area);
    container.removeAttribute('tabindex');
    container.removeAttribute('role');
    container.classList.add('is-editing');
    this.active = area;
    this.range = range;
    area.addEventListener('compositionstart', () => { this.composing = true; });
    area.addEventListener('compositionend', () => { this.composing = false; this.sync(); });
    area.addEventListener('input', () => {
      this.sync();
      if (this.composing) return;
      // Completing a block renders it immediately and continues in the next block.
      const position = area.selectionStart;
      if (position === area.selectionEnd && /\n\n$/.test(area.value.slice(0, position))) {
        const absolute = range.start + position;
        const blocks = sourceBlocks(this.source.value);
        if (!isInFence(this.source.value, absolute) && (blocks.some((block) => block.start === absolute) || absolute === this.source.value.length)) {
          this.render(absolute);
        }
      }
    });
    area.addEventListener('select', () => {
      this.source.setSelectionRange(range.start + area.selectionStart, range.start + area.selectionEnd);
    });
    area.addEventListener('keydown', (event) => {
      if (event.isComposing || this.composing || event.key === 'Process') return;
      const mod = event.ctrlKey || event.metaKey;
      if (event.key === 'Escape' || (mod && event.key === 'Enter')) {
        event.preventDefault();
        event.stopPropagation();
        this.render();
        this.host.querySelector<HTMLElement>('.notes-live__block')?.focus();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        indentLines(area, event.shiftKey);
      } else if (event.key === 'Enter' && !event.shiftKey && continueBlock(area)) {
        event.preventDefault();
      } else if (mod && ['b', 'i'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        toggleWrap(area, event.key.toLowerCase() === 'b' ? '**' : '*');
      }
    });
    area.addEventListener('blur', () => {
      // Preserve selection for existing toolbar commands; don't steal their focus.
      window.setTimeout(() => {
        if (this.active === area && document.activeElement !== area && !this.composing) this.render();
      }, 0);
    });
    area.focus({ preventScroll: true });
    area.setSelectionRange(Math.max(0, caret - range.start), Math.max(0, caret - range.start));
    area.style.height = `${area.scrollHeight + 2}px`;
  }

  private render(caret?: number): void {
    if (!this.enabled) return;
    this.active = null;
    this.range = null;
    this.revision = this.source.value;
    const source = this.source.value;
    const blocks = sourceBlocks(source);
    const definitions = parser.parse(source).children.filter((node) => node.type === 'definition')
      .map((node) => source.slice(node.position!.start.offset, node.position!.end.offset)).join('\n');
    this.host.replaceChildren();
    const help = document.createElement('p');
    help.className = 'notes-live__hint';
    help.textContent = '点段落原位编辑 · 空行或离开段落即排版 · Ctrl/⌘ + Enter 完成';
    this.host.append(help);
    if (caret === source.length && source.endsWith('\n\n')) blocks.push({ start: source.length, end: source.length });
    let selected = false;
    for (const range of blocks) {
      const section = document.createElement('section');
      section.className = 'notes-live__block';
      section.tabIndex = 0;
      section.setAttribute('role', 'group');
      section.setAttribute('aria-label', 'Markdown 段落，按 Enter 编辑');
      const raw = source.slice(range.start, range.end);
      section.innerHTML = raw.trim() ? renderNote(`${raw}\n\n${definitions}`) : '<p class="notes-live__placeholder">写下第一句话…</p>';
      // Checkbox editing is performed through Markdown to retain one mutation path.
      section.querySelectorAll<HTMLInputElement>('input').forEach((input) => { input.disabled = true; });
      this.host.append(section);
      section.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('textarea')) return;
        event.preventDefault();
        this.render(range.start);
      });
      section.addEventListener('keydown', (event) => {
        if (event.target !== section || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        this.render(range.start);
      });
      if (caret !== undefined && !selected && caret >= range.start && (caret < range.end || range.end === source.length && range.start === range.end || caret === range.end && range === blocks[blocks.length - 1])) {
        selected = true;
        this.edit(section, range, caret);
      }
    }
    const append = document.createElement('button');
    append.type = 'button';
    append.className = 'notes-live__append';
    append.textContent = '+ 继续书写';
    append.addEventListener('click', () => {
      if (this.source.value && !this.source.value.endsWith('\n\n')) this.source.value += this.source.value.endsWith('\n') ? '\n' : '\n\n';
      this.remember();
      this.emit();
      this.render(this.source.value.length);
    });
    this.host.append(append);
    void import('./notes-highlight').then(({ highlightCode }) => highlightCode(this.host));
  }
}
