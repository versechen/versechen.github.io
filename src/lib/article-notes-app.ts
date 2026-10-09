import { ANNOTATIONS_KEY, parseAnnotations, mergeAnnotations, locateQuote, questionTask, selectionMenuPosition,
  type Annotation, type AnnotationStore } from './article-annotations';
import { loadToken, fetchLogin, isSiteOwner, pullAnnotations, pushAnnotations, TOKEN_KEY, LOGIN_KEY } from './notes-remote';
import { createNote, loadLocalStore, saveLocalStore, ACTIVE_KEY } from './notes';
import { icon } from './notes-icons';

export function initArticleNotes(): void {
  const root = document.querySelector<HTMLElement>('[data-article-notes]');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = '1';
  const status = root.querySelector<HTMLElement>('[data-note-status]')!;
  const workspace = root.querySelector<HTMLElement>('[data-note-workspace]')!;
  const panel = root.querySelector<HTMLElement>('[data-note-panel]')!;
  const form = root.querySelector<HTMLFormElement>('[data-note-form]')!;
  const list = root.querySelector<HTMLElement>('[data-note-list]')!;
  const count = root.querySelector<HTMLElement>('[data-note-count]')!;
  const filter = root.querySelector<HTMLSelectElement>('[data-note-filter]')!;
  const selectionMenu = root.querySelector<HTMLElement>('[data-note-selection]')!;
  const popover = root.querySelector<HTMLElement>('[data-note-popover]')!;
  const popoverContent = root.querySelector<HTMLElement>('[data-note-popover-content]')!;
  const editor = root.querySelector<HTMLElement>('[data-note-editor]')!;
  const connect = root.querySelector<HTMLElement>('[data-note-connect]')!;
  const body = document.querySelector<HTMLElement>('[data-annotation-body]');
  const slug = root.dataset.slug ?? '';
  const revision = root.dataset.revision ?? '';
  const kind = form.elements.namedItem('kind') as HTMLInputElement;
  root.dataset.layout = slug ? 'sidebar' : 'page';
  const quoteField = form.elements.namedItem('quote') as HTMLTextAreaElement;
  const contentField = form.elements.namedItem('body') as HTMLTextAreaElement;
  let store: AnnotationStore = { items: [], deleted: [] };
  let authorized = false, syncing = false, editId = '', freshSelection = false;
  let selectedRange: Range | null = null;
  let markedRanges: { item: Annotation; el: HTMLElement; range: Range }[] = [];
  let popoverAnchor: { range: Range; line: number } | null = null;
  let popoverPreviousFocus: HTMLElement | null = null;
  let anchor = { quote: '', prefix: '', suffix: '', section: '' };
  const message = (text: string) => { status.textContent = text; };
  const updatedTime = () => new Date(Math.max(Date.now(), ...store.items.map(x => Date.parse(x.updatedAt) + 1),
    ...store.deleted.map(x => Date.parse(x.at) + 1))).toISOString();
  const lock = () => {
    dismissPopover(); markedRanges = []; body?.classList.remove('annotation-hover');
    authorized = false; workspace.hidden = true; list.replaceChildren(); selectionMenu.hidden = true; connect.hidden = false;
    if (slug) root.hidden = true;
    document.querySelectorAll('.annotation-focus,.annotation-marked').forEach(x => x.classList.remove('annotation-focus', 'annotation-marked', 'annotation-highlight', 'annotation-question', 'annotation-comment'));
    for (const name of ['highlight', 'question', 'comment']) CSS.highlights?.delete(`article-${name}`);
    message('管理员连接后可做阅读笔记，请到记录页连接 GitHub');
  };
  const load = () => {
    try { return parseAnnotations(JSON.parse(localStorage.getItem(ANNOTATIONS_KEY) ?? '{}')); }
    catch { throw new Error('本机阅读笔记无法读取，请先导出或检查浏览器存储'); }
  };
  const persist = () => {
    store = mergeAnnotations(store, load());
    localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(store));
    message('已保存到本机；点击「同步笔记」保存到云端');
    render();
  };
  const open = () => {
    panel.hidden = false;
    root.dataset.open = 'true';
    const toggle = root.querySelector('[data-notes-toggle]');
    root.querySelector('[data-note-toggle-label]')!.textContent = '收起';
    toggle?.setAttribute('aria-label', '收起阅读笔记');
    root.querySelector('[data-notes-toggle]')?.setAttribute('aria-expanded', 'true');
    quoteField.style.height = 'auto';
    quoteField.style.height = `${Math.min(140, Math.max(50, quoteField.scrollHeight))}px`;
  };
  const revealEditor = () => {
    open();
    // Keep the page heading and pen choices below the fixed notebook toolbar,
    // even when the editor is taller than the available screen height.
    const toolbar = root.querySelector<HTMLElement>('.note-book-toolbar');
    panel.scrollTop = Math.max(0, panel.scrollTop + editor.getBoundingClientRect().top
      - panel.getBoundingClientRect().top - (toolbar?.offsetHeight ?? 0) - 12);
    if (root.getBoundingClientRect().top > window.innerHeight - 80) root.scrollIntoView({ block: 'start' });
  };
  const close = () => {
    panel.hidden = true; root.dataset.open = 'false';
    const toggle = root.querySelector('[data-notes-toggle]');
    toggle?.setAttribute('aria-expanded', 'false');
    toggle?.setAttribute('aria-label', '打开阅读笔记');
    root.querySelector('[data-note-toggle-label]')!.textContent = '阅读笔记';
    if (panel.contains(document.activeElement)) (toggle as HTMLButtonElement)?.focus();
  };
  const setKind = (value: Annotation['kind']) => {
    kind.value = value; form.dataset.kind = value;
    root.querySelector('[data-note-editor-title]')!.textContent = `${editId ? '编辑' : '添加'}${{ highlight: '重点', question: '疑问', comment: '注释' }[value]}`;
    root.querySelectorAll<HTMLElement>('[data-editor-kind]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.editorKind === value)));
  };
  const reset = () => { dismissPopover(); editId = ''; freshSelection = false; selectedRange = null; selectionMenu.hidden = true; editor.hidden = true;
    anchor = { quote: '', prefix: '', suffix: '', section: '' }; form.reset(); setKind('highlight'); window.getSelection()?.removeAllRanges(); };
  const blocks = () => body ? [...body.querySelectorAll<HTMLElement>('p,pre,li,h2,h3,h4,td,th')]
    .filter(x => !x.closest('.mermaid') && !x.querySelector('p,pre,li,h2,h3,h4,td,th')) : [];
  const blockText = (el: HTMLElement) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement?.closest('button,.copy-code-button,.katex-mathml')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const nodes: Text[] = []; while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    return { text: nodes.map(x => x.data).join(''), nodes };
  };
  const rangeAt = (el: HTMLElement, start: number, length: number) => {
    const { nodes } = blockText(el); let offset = 0;
    const range = document.createRange(); let started = false;
    for (const n of nodes) {
      if (!started && start < offset + n.length) { range.setStart(n, start - offset); started = true; }
      if (started && start + length <= offset + n.length) { range.setEnd(n, start + length - offset); return range; }
      offset += n.length;
    }
    return null;
  };
  const locate = (item: Annotation) => {
    const matches: { el: HTMLElement; index: number }[] = [];
    for (const el of blocks()) {
      const index = locateQuote(blockText(el).text, item.quote, item.prefix, item.suffix);
      if (index >= 0) matches.push({ el, index });
    }
    const contextual = matches.filter(({ el, index }) => {
      const text = blockText(el).text;
      return (!item.prefix || text.slice(Math.max(0, index - item.prefix.length), index) === item.prefix)
        && (!item.suffix || text.slice(index + item.quote.length, index + item.quote.length + item.suffix.length) === item.suffix);
    });
    const candidates = matches.length === 1 ? matches : contextual;
    if (candidates.length !== 1) return null;
    const { el, index } = candidates[0]; return { el, range: rangeAt(el, index, item.quote.length) };
  };
  const jump = (item: Annotation) => {
    const match = locate(item);
    if (!match) { message('原文已变化或存在多个匹配，摘录仍保留；可选中新位置后重新定位'); return; }
    match.el.closest('details')?.setAttribute('open', '');
    document.querySelectorAll('.annotation-focus').forEach(x => x.classList.remove('annotation-focus'));
    match.el.classList.add('annotation-focus'); match.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (match.range) { const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(match.range); }
  };
  const visible = () => store.items.filter(x => (!slug || x.slug === slug)
    && (filter.value === 'all' || (filter.value === 'resolved' ? x.kind === 'question' && x.resolved
      : filter.value === 'question' ? x.kind === 'question' && !x.resolved : x.kind === filter.value)));
  const paint = () => {
    dismissPopover(); markedRanges = [];
    if (!body) return;
    body.querySelectorAll('.annotation-marked').forEach(x => x.classList.remove('annotation-marked', 'annotation-highlight', 'annotation-question', 'annotation-comment'));
    const api = window as unknown as { Highlight?: new (...ranges: Range[]) => unknown; CSS?: { highlights?: Map<string, unknown> } };
    for (const type of ['highlight', 'question', 'comment']) {
      const ranges: Range[] = [];
      for (const item of store.items.filter(x => x.slug === slug && x.kind === type)) {
        const match = locate(item); if (!match) continue;
        if (match.range) { ranges.push(match.range); markedRanges.push({ item, el: match.el, range: match.range }); }
        if (!api.Highlight || !api.CSS?.highlights) match.el.classList.add('annotation-marked', `annotation-${type}`);
      }
      if (api.Highlight && api.CSS?.highlights) api.CSS.highlights.set(`article-${type}`, new api.Highlight(...ranges));
    }
  };
  const button = (text: string, action: () => void) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
    b.addEventListener('click', () => { try { action(); } catch (err) { message(err instanceof Error ? err.message : '操作失败，请检查本机存储'); } }); return b;
  };
  const editNote = (item: Annotation) => {
    dismissPopover(); selectionMenu.hidden = true;
    editId = item.id; setKind(item.kind); quoteField.value = item.quote; editor.hidden = false;
    freshSelection = false; contentField.value = item.body;
    anchor = { quote: item.quote, prefix: item.prefix, suffix: item.suffix, section: item.section };
    revealEditor(); contentField.focus({ preventScroll: true });
  };
  function dismissPopover(restoreFocus = false) {
    const hadFocus = popover.contains(document.activeElement);
    popover.hidden = true; popoverContent.replaceChildren(); popoverAnchor = null;
    if (restoreFocus && hadFocus && popoverPreviousFocus?.isConnected) popoverPreviousFocus.focus({ preventScroll: true });
    popoverPreviousFocus = null;
  }
  const positionPopover = () => {
    if (!popoverAnchor || popover.hidden) return;
    const rect = popoverAnchor.range.getClientRects()[popoverAnchor.line];
    const top = Math.max(8, (document.getElementById('site-header')?.getBoundingClientRect().bottom ?? 64) + 8);
    if (!rect || rect.bottom < top || rect.top > window.innerHeight - 8) { dismissPopover(); return; }
    popover.style.maxHeight = `${Math.max(0, window.innerHeight - top - 16)}px`;
    const position = selectionMenuPosition(rect, { width: window.innerWidth, height: window.innerHeight, top },
      { width: popover.offsetWidth || 340, height: popover.offsetHeight || 240 });
    popover.style.left = `${position.left}px`; popover.style.top = `${position.top}px`;
  };
  // CSS highlights don't create clickable DOM nodes. Test each rendered line,
  // rather than a whole paragraph or the empty space between wrapped lines.
  const hitNotes = (event: MouseEvent) => {
    if (!authorized || !(event.target instanceof Element)
      || event.target.closest('a,button,input,textarea,select,summary,[contenteditable]')) return [];
    const target = event.target;
    return markedRanges.filter(mark => mark.el.contains(target)).flatMap(mark => {
      const line = [...mark.range.getClientRects()].findIndex(rect => rect.width > 0 && rect.height > 0
        && event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom);
      return line < 0 ? [] : [{ ...mark, line }];
    });
  };
  body?.addEventListener('click', event => {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !window.getSelection()?.isCollapsed) return;
    const hits = hitNotes(event); if (!hits.length) return;
    dismissPopover(); selectionMenu.hidden = true;
    popoverPreviousFocus = document.activeElement as HTMLElement | null;
    popoverAnchor = { range: hits[0].range, line: hits[0].line };
    for (const { item } of hits) {
      const entry = document.createElement('article'); entry.className = 'note-popover-entry'; entry.dataset.kind = item.kind;
      const heading = document.createElement('strong'); heading.className = 'note-heading';
      const badge = document.createElement('span'); badge.className = 'note-kind-badge';
      badge.innerHTML = icon(({ highlight: 'highlight', question: 'question', comment: 'edit' } as const)[item.kind], 14);
      badge.append(document.createTextNode({ highlight: '重点', question: '疑问', comment: '注释' }[item.kind])); heading.append(badge);
      if (item.kind === 'question') { const state = document.createElement('span'); state.className = 'note-resolved'; state.textContent = item.resolved ? '已解答' : '待解答'; heading.append(state); }
      const quote = document.createElement('blockquote'); quote.textContent = item.quote;
      const content = document.createElement('p'); content.className = 'note-body'; content.textContent = item.body || '已标记为重点，尚未添加文字笔记。';
      entry.append(heading, quote, content, button('编辑这条笔记', () => editNote(item))); popoverContent.append(entry);
    }
    popover.hidden = false; positionPopover(); popover.focus({ preventScroll: true });
  });
  body?.addEventListener('pointermove', event => body.classList.toggle('annotation-hover', hitNotes(event).length > 0));
  body?.addEventListener('pointerleave', () => body.classList.remove('annotation-hover'));
  root.querySelector('[data-note-popover-close]')!.addEventListener('click', () => dismissPopover(true));
  document.addEventListener('pointerdown', event => { if (event.target instanceof Node && !popover.contains(event.target)) dismissPopover(); });
  document.addEventListener('click', event => { if (event.target instanceof Node && !popover.contains(event.target) && !body?.contains(event.target)) dismissPopover(); });
  function render() {
    if (!authorized) return;
    list.replaceChildren();
    const items = visible();
    count.textContent = `${items.length} 条`;
    if (!items.length) {
      const empty = document.createElement('div'); empty.className = 'note-empty'; empty.innerHTML = icon('bookOpen', 32);
      const title = document.createElement('h3'); title.textContent = filter.value === 'all' ? '记下第一条思考' : '这一页，还留着空白';
      const hint = document.createElement('p'); hint.textContent = slug ? '选一段触动你的文字，标记重点、提出疑问，或写下自己的理解。' : '阅读文章时留下的疑问和思考，会收集在这里。';
      empty.append(title, hint); list.append(empty);
    }
    for (const item of items) {
      const card = document.createElement('article'); card.className = 'note-card'; card.id = item.id; card.dataset.kind = item.kind; card.dataset.resolved = String(item.resolved);
      const heading = document.createElement('strong'); heading.className = 'note-heading';
      const badge = document.createElement('span'); badge.className = 'note-kind-badge';
      badge.innerHTML = icon(({ highlight: 'highlight', question: 'question', comment: 'edit' } as const)[item.kind], 14);
      badge.append(document.createTextNode({ highlight: '重点', question: '疑问', comment: '注释' }[item.kind])); heading.append(badge);
      if (item.kind === 'question') { const state = document.createElement('span'); state.className = 'note-resolved'; state.textContent = item.resolved ? '已解答' : '待解答'; heading.append(state); }
      if (!slug) { const title = document.createElement('span'); title.className = 'note-article-title'; title.textContent = item.title; heading.append(title); }
      const excerpt = document.createElement('blockquote'); excerpt.textContent = item.quote || '整篇笔记';
      const content = document.createElement('p'); content.className = 'note-body'; content.textContent = item.body;
      const meta = document.createElement('p'); meta.className = 'note-meta';
      meta.textContent = `${item.section || '整篇文章'} · ${new Date(item.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`;
      meta.title = new Date(item.updatedAt).toLocaleString('zh-CN');
      card.append(heading); if (item.quote) card.append(excerpt); if (item.body) card.append(content); card.append(meta);
      if (slug && item.quote && (!locate(item) || item.revision !== revision)) {
        const warn = document.createElement('p'); warn.className = 'note-source-missing';
        warn.textContent = locate(item) ? '文章版本已更新；已按摘录重新定位，请核对上下文' : '原文位置待重新定位，摘录仍保留'; card.append(warn);
      }
      const actions = document.createElement('div'); actions.className = 'note-actions';
      const secondary = document.createElement('div'); secondary.className = 'note-actions';
      const footer = document.createElement('div'); footer.className = 'note-card-footer';
      const tools = document.createElement('details'); tools.className = 'note-card-tools';
      const summary = document.createElement('summary'); summary.textContent = '更多 ···'; tools.append(summary);
      if (slug) actions.append(button('跳到原文', () => jump(item)));
      else { const link = document.createElement('a'); link.href = `/blog/${encodeURIComponent(item.slug)}/#${encodeURIComponent(item.id)}`; link.textContent = '打开文章'; actions.append(link); }
      actions.append(button('编辑', () => editNote(item)));
      if (slug) secondary.append(button('用新选区重新定位', () => {
        if (!anchor.quote || !freshSelection) return message('请先在正文选择新的原文位置');
        Object.assign(item, anchor, { revision, updatedAt: updatedTime() }); persist(); reset();
      }));
      if (item.kind === 'question') {
        const label = document.createElement('label'); label.textContent = '答案位置（站内路径或 https 链接）';
        const input = document.createElement('input'); input.type = 'text'; input.value = item.answer; input.placeholder = '/blog/文章/#章节'; label.append(input); tools.append(label);
        secondary.append(button(item.resolved ? '重新标为待解答' : '标为已解答', () => {
          if (!item.resolved && !/^(https:\/\/|\/(?!\/))\S+$/.test(input.value.trim())) return message('请填写有效的答案位置后再标为已解答');
          item.resolved = !item.resolved; item.answer = input.value.trim(); item.updatedAt = updatedTime(); persist();
        }));
        if (item.resolved && /^(https:\/\/|\/(?!\/))\S+$/.test(item.answer)) {
          const link = document.createElement('a'); link.href = item.answer; link.textContent = '查看答案'; link.rel = 'noopener noreferrer'; secondary.append(link);
        }
      }
      const remove = button('删除', () => {
        if (!window.confirm('删除这条阅读笔记？同步后其他设备也会删除。')) return;
        store.deleted.push({ id: item.id, at: updatedTime() }); store.items = store.items.filter(x => x.id !== item.id); persist();
      }); remove.dataset.noteDelete = ''; secondary.append(remove);
      tools.append(secondary); footer.append(actions, tools); card.append(footer); list.append(card);
    }
    paint();
  }
  const positionMenu = () => {
    if (!selectedRange || selectionMenu.hidden) return;
    const rect = selectedRange.getBoundingClientRect();
    const header = document.getElementById('site-header')?.getBoundingClientRect().bottom ?? 64;
    if (rect.height > 0 && (rect.bottom < header + 8 || rect.top > window.innerHeight)) { selectionMenu.hidden = true; return; }
    const position = selectionMenuPosition(rect, { width: window.innerWidth, height: window.innerHeight, top: Math.max(8, header + 8) },
      { width: selectionMenu.offsetWidth || 260, height: selectionMenu.offsetHeight || 52 });
    selectionMenu.style.left = `${position.left}px`; selectionMenu.style.top = `${position.top}px`; selectionMenu.dataset.below = String(position.below);
    selectionMenu.style.setProperty('--note-arrow-left', `${Math.max(12, Math.min((selectionMenu.offsetWidth || 260) - 20, rect.right - position.left - 10))}px`);
  };
  const capture = () => {
    if (!authorized || !body) return;
    const selection = window.getSelection(); if (!selection || selection.isCollapsed || !selection.rangeCount) { selectionMenu.hidden = true; selectedRange = null; return; }
    let range = selection.getRangeAt(0);
    if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) { selectionMenu.hidden = true; return; }
    dismissPopover();
    // A paragraph selection can end at the next block's first character. Trim
    // that boundary only when the selection contains exactly the whole block.
    const startBlock = blocks().find(x => x.contains(range.startContainer));
    if (startBlock && !startBlock.contains(range.endContainer)) {
      const text = blockText(startBlock).text;
      if (text.trim() === range.toString().trim()) range = rangeAt(startBlock, 0, text.length) ?? range;
    }
    if (selectedRange && selectedRange.startContainer === range.startContainer && selectedRange.startOffset === range.startOffset
      && selectedRange.endContainer === range.endContainer && selectedRange.endOffset === range.endOffset) { positionMenu(); return; }
    const el = blocks().find(x => x.contains(range.startContainer) && x.contains(range.endContainer));
    const reject = (reason: string) => { selectionMenu.hidden = true; selectedRange = null; freshSelection = false; message(reason); };
    if (!el) return reject('请在一个段落、列表项或代码块内选择原文');
    const quote = range.toString(); if (!quote.trim() || quote.length > 4000) return reject('选区请控制在 4000 字以内');
    const { text, nodes } = blockText(el); let index = 0;
    for (const n of nodes) {
      if (n === range.startContainer) { index += range.startOffset; break; }
      if (range.comparePoint(n, 0) >= 0) break;
      index += n.length;
    }
    if (text.slice(index, index + quote.length) !== quote) return reject('这个选区包含特殊排版，请改选普通正文');
    const headings = body.querySelectorAll<HTMLElement>('h2,h3,h4'); let section = '';
    for (const h of headings) { if (h === el || h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) section = h.textContent ?? ''; }
    anchor = { quote, prefix: text.slice(Math.max(0, index - 40), index), suffix: text.slice(index + quote.length, index + quote.length + 40), section };
    freshSelection = true; selectedRange = range.cloneRange(); selectionMenu.hidden = false; quoteField.value = quote; positionMenu();
  };
  document.addEventListener('pointerup', e => { if (!(e.target instanceof Element && e.target.closest('[data-article-notes]'))) capture(); });
  selectionMenu.addEventListener('pointerdown', e => e.preventDefault());
  selectionMenu.querySelectorAll<HTMLButtonElement>('[data-annotation-kind]').forEach(b => b.addEventListener('click', () => {
    editId = ''; contentField.value = '';
    setKind(b.dataset.annotationKind as Annotation['kind']); selectionMenu.hidden = true; editor.hidden = false; revealEditor();
    contentField.focus({ preventScroll: true });
  }));
  root.querySelectorAll<HTMLButtonElement>('[data-editor-kind]').forEach(b => b.addEventListener('click', () => setKind(b.dataset.editorKind as Annotation['kind'])));
  root.querySelector('[data-note-new]')!.addEventListener('click', () => { reset(); setKind('comment'); editor.hidden = false; revealEditor(); contentField.focus({ preventScroll: true }); });
  document.addEventListener('keyup', e => { if (e.key === 'Escape') { if (!popover.hidden) dismissPopover(true); else { selectionMenu.hidden = true; close(); } } else if (!(e.target instanceof Element && e.target.closest('[data-article-notes]'))) capture(); });
  window.addEventListener('scroll', () => { positionMenu(); positionPopover(); }, { passive: true, capture: true });
  window.addEventListener('resize', () => { positionMenu(); positionPopover(); });
  document.addEventListener('selectionchange', () => { if (document.activeElement?.closest('[data-article-notes]')) return; window.setTimeout(capture, 150); });
  root.querySelector('[data-notes-toggle]')!.addEventListener('click', () => { if (panel.hidden) open(); else close(); });
  filter.addEventListener('change', render);
  root.querySelector('[data-note-cancel]')!.addEventListener('click', reset);
  form.addEventListener('submit', e => {
    e.preventDefault(); if (!authorized) return;
    if (kind.value !== 'highlight' && !contentField.value.trim()) return message('请填写疑问或注释内容');
    if (kind.value === 'highlight' && !anchor.quote) return message('重点需要选中一段原文');
    const existing = store.items.find(x => x.id === editId);
    if (!slug && !existing) return message('请进入对应文章添加笔记');
    const item: Annotation = { id: existing?.id ?? crypto.randomUUID(), slug: existing?.slug ?? slug,
      title: existing?.title ?? root.dataset.title ?? '', revision: freshSelection ? revision : existing?.revision ?? revision,
      ...anchor, kind: kind.value as Annotation['kind'], body: contentField.value.trim(),
      resolved: existing?.resolved ?? false, answer: existing?.answer ?? '', updatedAt: updatedTime() };
    store.items = store.items.filter(x => x.id !== item.id); store.items.push(item);
    try { persist(); reset(); } catch (err) { message(err instanceof Error ? err.message : '保存失败'); }
  });
  const sync = async () => {
    if (!authorized || syncing) return;
    syncing = true; message('正在同步阅读笔记…');
    try {
      const token = loadToken(); if (!isSiteOwner(await fetchLogin(token))) { lock(); throw new Error('管理员身份验证失败，请重新连接'); }
      const remote = await pullAnnotations(token); store = mergeAnnotations(mergeAnnotations(store, load()), remote);
      localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(store)); render();
      const sent = JSON.stringify(store); await pushAnnotations(token, store);
      message(JSON.stringify(load()) === sent ? '阅读笔记已同步' : '同步期间有新的修改，请再同步一次');
    } catch (err) { message(err instanceof Error ? err.message : '同步失败，本机笔记仍保留'); }
    finally { syncing = false; }
  };
  root.querySelector('[data-note-sync]')!.addEventListener('click', () => void sync());
  const pending = () => store.items.filter(x => (!slug || x.slug === slug) && x.kind === 'question' && !x.resolved);
  root.querySelector('[data-note-task]')!.addEventListener('click', async () => {
    if (!pending().length) return message('没有待解答疑问');
    try { await navigator.clipboard.writeText(questionTask(pending())); message('补充任务已复制，可交给助手生成解答'); }
    catch { message('复制失败，可使用「生成补充任务草稿」查看完整内容'); }
  });
  root.querySelector('[data-note-draft]')!.addEventListener('click', () => {
    if (!pending().length) return message('没有待解答疑问');
    try {
      const notes = loadLocalStore(); const note = createNote(); note.title = `${root.dataset.title || '阅读疑问'}：补充任务`;
      note.body = questionTask(pending()); note.tags = ['阅读疑问', '补充任务']; notes.notes.unshift(note);
      saveLocalStore(notes); localStorage.setItem(ACTIVE_KEY, note.id); location.href = '/notes';
    } catch (err) { message(err instanceof Error ? err.message : '草稿创建失败'); }
  });
  window.addEventListener('codeverse:owner-nav', () => { if (!loadToken()) lock(); });
  window.addEventListener('storage', e => {
    if (e.key === TOKEN_KEY || e.key === LOGIN_KEY || e.key === null) { lock(); return; }
    if (e.key === ANNOTATIONS_KEY && authorized) {
      try { store = mergeAnnotations(store, load()); render(); } catch (err) { message(String(err)); }
    }
  });
  void (async () => {
    try {
      const token = loadToken(); if (!token) return;
      if (!isSiteOwner(await fetchLogin(token))) return message('仅管理员可以使用阅读笔记，请到记录页重新连接');
      authorized = true; store = load(); root.hidden = false; workspace.hidden = false; connect.hidden = true;
      if (!slug) { open(); filter.value = 'question'; } else if (window.matchMedia('(min-width: 1280px)').matches) open();
      message('本机笔记已就绪'); render();
      const id = decodeURIComponent(location.hash.slice(1)); const item = store.items.find(x => x.id === id);
      if (item && slug) { open(); jump(item); }
    } catch (err) { message(err instanceof Error ? err.message : '阅读笔记初始化失败'); }
  })();
}
