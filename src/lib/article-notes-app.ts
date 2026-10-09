import { ANNOTATIONS_KEY, parseAnnotations, mergeAnnotations, locateQuote, questionTask, selectionMenuPosition,
  type Annotation, type AnnotationStore } from './article-annotations';
import { loadToken, fetchLogin, isSiteOwner, pullAnnotations, pushAnnotations, TOKEN_KEY, LOGIN_KEY } from './notes-remote';
import { createNote, loadLocalStore, saveLocalStore, ACTIVE_KEY } from './notes';

export function initArticleNotes(): void {
  const root = document.querySelector<HTMLElement>('[data-article-notes]');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = '1';
  const status = root.querySelector<HTMLElement>('[data-note-status]')!;
  const workspace = root.querySelector<HTMLElement>('[data-note-workspace]')!;
  const panel = root.querySelector<HTMLElement>('[data-note-panel]')!;
  const form = root.querySelector<HTMLFormElement>('[data-note-form]')!;
  const list = root.querySelector<HTMLElement>('[data-note-list]')!;
  const filter = root.querySelector<HTMLSelectElement>('[data-note-filter]')!;
  const selectionMenu = root.querySelector<HTMLElement>('[data-note-selection]')!;
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
  let anchor = { quote: '', prefix: '', suffix: '', section: '' };
  const message = (text: string) => { status.textContent = text; };
  const updatedTime = () => new Date(Math.max(Date.now(), ...store.items.map(x => Date.parse(x.updatedAt) + 1),
    ...store.deleted.map(x => Date.parse(x.at) + 1))).toISOString();
  const lock = () => {
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
    if (toggle) toggle.textContent = '收起';
    root.querySelector('[data-notes-toggle]')?.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    panel.hidden = true; root.dataset.open = 'false';
    const toggle = root.querySelector('[data-notes-toggle]');
    toggle?.setAttribute('aria-expanded', 'false'); if (toggle) toggle.textContent = '阅读笔记';
  };
  const setKind = (value: Annotation['kind']) => {
    kind.value = value; form.dataset.kind = value;
    root.querySelector('[data-note-editor-title]')!.textContent = `${editId ? '编辑' : '添加'}${{ highlight: '重点', question: '疑问', comment: '注释' }[value]}`;
    root.querySelectorAll<HTMLElement>('[data-editor-kind]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.editorKind === value)));
  };
  const reset = () => { editId = ''; freshSelection = false; selectedRange = null; selectionMenu.hidden = true; editor.hidden = true;
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
    if (!body) return;
    body.querySelectorAll('.annotation-marked').forEach(x => x.classList.remove('annotation-marked', 'annotation-highlight', 'annotation-question', 'annotation-comment'));
    const api = window as unknown as { Highlight?: new (...ranges: Range[]) => unknown; CSS?: { highlights?: Map<string, unknown> } };
    for (const type of ['highlight', 'question', 'comment']) {
      const ranges: Range[] = [];
      for (const item of store.items.filter(x => x.slug === slug && x.kind === type)) {
        const match = locate(item); if (!match) continue;
        if (match.range) ranges.push(match.range);
        if (!api.Highlight || !api.CSS?.highlights) match.el.classList.add('annotation-marked', `annotation-${type}`);
      }
      if (api.Highlight && api.CSS?.highlights) api.CSS.highlights.set(`article-${type}`, new api.Highlight(...ranges));
    }
  };
  const button = (text: string, action: () => void) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
    b.addEventListener('click', () => { try { action(); } catch (err) { message(err instanceof Error ? err.message : '操作失败，请检查本机存储'); } }); return b;
  };
  function render() {
    if (!authorized) return;
    list.replaceChildren();
    const items = visible();
    if (!items.length) { const p = document.createElement('p'); p.textContent = '这里还没有笔记'; list.append(p); }
    for (const item of items) {
      const card = document.createElement('article'); card.className = 'note-card'; card.id = item.id; card.dataset.kind = item.kind; card.dataset.resolved = String(item.resolved);
      const heading = document.createElement('strong'); heading.className = 'note-heading';
      const badge = document.createElement('span'); badge.className = 'note-kind-badge';
      badge.textContent = { highlight: '★ 重点', question: '? 疑问', comment: '✎ 注释' }[item.kind]; heading.append(badge);
      if (item.kind === 'question') { const state = document.createElement('span'); state.textContent = item.resolved ? '已解答' : '待解答'; heading.append(state); }
      if (!slug) { const title = document.createElement('span'); title.textContent = item.title; heading.append(title); }
      const excerpt = document.createElement('blockquote'); excerpt.textContent = item.quote || '整篇笔记';
      const content = document.createElement('p'); content.className = 'note-body'; content.textContent = item.body;
      const meta = document.createElement('p'); meta.className = 'note-meta'; meta.textContent = `${item.section || '整篇文章'} · ${new Date(item.updatedAt).toLocaleString('zh-CN')}`;
      card.append(heading, excerpt, content, meta);
      if (slug && item.quote && (!locate(item) || item.revision !== revision)) {
        const warn = document.createElement('p'); warn.className = 'note-source-missing';
        warn.textContent = locate(item) ? '文章版本已更新；已按摘录重新定位，请核对上下文' : '原文位置待重新定位，摘录仍保留'; card.append(warn);
      }
      const actions = document.createElement('div'); actions.className = 'note-actions';
      const tools = document.createElement('details'); tools.className = 'note-card-tools';
      const summary = document.createElement('summary'); summary.textContent = '定位、编辑与处理'; tools.append(summary);
      if (slug) actions.append(button('跳到原文', () => jump(item)));
      else { const link = document.createElement('a'); link.href = `/blog/${encodeURIComponent(item.slug)}/#${encodeURIComponent(item.id)}`; link.textContent = '打开文章'; actions.append(link); }
      actions.append(button('编辑', () => { editId = item.id; setKind(item.kind); quoteField.value = item.quote; editor.hidden = false;
        freshSelection = false; contentField.value = item.body; anchor = { quote: item.quote, prefix: item.prefix, suffix: item.suffix, section: item.section }; open(); form.scrollIntoView({ block: 'nearest' }); }));
      if (slug) actions.append(button('用新选区重新定位', () => {
        if (!anchor.quote || !freshSelection) return message('请先在正文选择新的原文位置');
        Object.assign(item, anchor, { revision, updatedAt: updatedTime() }); persist(); reset();
      }));
      if (item.kind === 'question') {
        const label = document.createElement('label'); label.textContent = '答案位置（站内路径或 https 链接）';
        const input = document.createElement('input'); input.type = 'text'; input.value = item.answer; input.placeholder = '/blog/文章/#章节'; label.append(input); tools.append(label);
        actions.append(button(item.resolved ? '重新标为待解答' : '标为已解答', () => {
          if (!item.resolved && !/^(https:\/\/|\/(?!\/))\S+$/.test(input.value.trim())) return message('请填写有效的答案位置后再标为已解答');
          item.resolved = !item.resolved; item.answer = input.value.trim(); item.updatedAt = updatedTime(); persist();
        }));
        if (item.resolved && /^(https:\/\/|\/(?!\/))\S+$/.test(item.answer)) {
          const link = document.createElement('a'); link.href = item.answer; link.textContent = '查看答案'; link.rel = 'noopener noreferrer'; actions.append(link);
        }
      }
      actions.append(button('删除', () => {
        if (!window.confirm('删除这条阅读笔记？同步后其他设备也会删除。')) return;
        store.deleted.push({ id: item.id, at: updatedTime() }); store.items = store.items.filter(x => x.id !== item.id); persist();
      })); tools.append(actions); card.append(tools); list.append(card);
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
    const range = selection.getRangeAt(0);
    if (!body.contains(range.startContainer) || !body.contains(range.endContainer)) { selectionMenu.hidden = true; return; }
    if (selectedRange && selectedRange.startContainer === range.startContainer && selectedRange.startOffset === range.startOffset
      && selectedRange.endContainer === range.endContainer && selectedRange.endOffset === range.endOffset) { positionMenu(); return; }
    const el = blocks().find(x => x.contains(range.startContainer) && x.contains(range.endContainer));
    if (!el) return message('请在一个段落、列表项或代码块内选择原文');
    const quote = range.toString(); if (!quote.trim() || quote.length > 4000) return message('选区请控制在 4000 字以内');
    const { text, nodes } = blockText(el); let index = 0;
    for (const n of nodes) {
      if (n === range.startContainer) { index += range.startOffset; break; }
      if (range.comparePoint(n, 0) >= 0) break;
      index += n.length;
    }
    if (text.slice(index, index + quote.length) !== quote) return message('这个选区包含特殊排版，请改选普通正文');
    const headings = body.querySelectorAll<HTMLElement>('h2,h3,h4'); let section = '';
    for (const h of headings) { if (h === el || h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) section = h.textContent ?? ''; }
    anchor = { quote, prefix: text.slice(Math.max(0, index - 40), index), suffix: text.slice(index + quote.length, index + quote.length + 40), section };
    freshSelection = true; selectedRange = range.cloneRange(); selectionMenu.hidden = false; quoteField.value = quote; positionMenu();
  };
  document.addEventListener('pointerup', e => { if (!(e.target instanceof Element && e.target.closest('[data-article-notes]'))) capture(); });
  selectionMenu.addEventListener('pointerdown', e => e.preventDefault());
  selectionMenu.querySelectorAll<HTMLButtonElement>('[data-annotation-kind]').forEach(b => b.addEventListener('click', () => {
    setKind(b.dataset.annotationKind as Annotation['kind']); selectionMenu.hidden = true; editor.hidden = false; open();
    form.scrollIntoView({ block: 'nearest' }); contentField.focus({ preventScroll: true });
  }));
  root.querySelectorAll<HTMLButtonElement>('[data-editor-kind]').forEach(b => b.addEventListener('click', () => setKind(b.dataset.editorKind as Annotation['kind'])));
  root.querySelector('[data-note-new]')!.addEventListener('click', () => { reset(); setKind('comment'); editor.hidden = false; open(); contentField.focus({ preventScroll: true }); });
  document.addEventListener('keyup', e => { if (e.key === 'Escape') { selectionMenu.hidden = true; close(); } else if (!(e.target instanceof Element && e.target.closest('[data-article-notes]'))) capture(); });
  window.addEventListener('scroll', positionMenu, { passive: true });
  window.addEventListener('resize', positionMenu);
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
      message('阅读笔记已就绪；可选择原文添加笔记'); render();
      const id = decodeURIComponent(location.hash.slice(1)); const item = store.items.find(x => x.id === id);
      if (item && slug) { open(); jump(item); }
    } catch (err) { message(err instanceof Error ? err.message : '阅读笔记初始化失败'); }
  })();
}
