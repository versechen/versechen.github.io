import {
  ACTIVE_KEY,
  STORAGE_KEY,
  collectTags,
  countWords,
  createNote,
  formatFullTime,
  formatNoteTime,
  groupNotes,
  isBlankNote,
  loadLocalStore,
  matchNote,
  mergeStores,
  noteExcerpt,
  noteFromMarkdown,
  noteToBlogMarkdown,
  noteToMarkdown,
  NOTE_LIMITS,
  normalizeBlogSlug,
  parseStore,
  parseTags,
  plainText,
  suggestBlogSlug,
  validateBlogPublish,
  saveLocalStore,
  searchTerms,
  serializeStore,
  type Deletion,
  type Note,
  type NoteStore,
} from './notes';
import {
  BLOG_ACTIONS_URL,
  BLOG_REPO,
  TOKEN_CREATE_URL,
  TOKEN_SCOPES_HINT,
  clearRemoteSession,
  fetchLogin,
  fetchRepoWriteAccess,
  loadLogin,
  loadToken,
  NotesRemoteError,
  publishBlogPost,
  pullRemoteStore,
  pushRemoteStore,
  saveToken,
} from './notes-remote';
import {
  COMMANDS,
  TEMPLATES,
  WRAP_KEYS,
  caretRect,
  continueBlock,
  filterCommands,
  formatDate,
  indentLines,
  insertGlyph,
  insertWithCaret,
  replaceRange,
  setLineKind,
  slashQuery,
  surround,
  taskCharIndex,
  templateText,
  toggleTaskLines,
  toggleWrap,
  type Command,
  type LineKind,
  type Template,
} from './notes-editor';
import { icon, type IconName } from './notes-icons';

type Mode = 'edit' | 'split' | 'preview';
type SyncState = 'local' | 'dev' | 'pending' | 'syncing' | 'synced' | 'error' | 'offline';

type Prefs = {
  font: 'sans' | 'serif' | 'mono';
  size: number;
  leading: 'compact' | 'comfort' | 'loose';
  measure: 'narrow' | 'normal' | 'wide';
  spellcheck: boolean;
  scrollSync: boolean;
  slash: boolean;
  mode: Mode;
};

const PREFS_KEY = 'codeverse.notes.prefs';
const DEFAULT_PREFS: Prefs = {
  font: 'sans',
  size: 16,
  leading: 'comfort',
  measure: 'normal',
  spellcheck: false,
  scrollSync: true,
  slash: true,
  mode: 'split',
};
const REMOTE_IDLE = 2500;
/** GitHub 对写操作有频率限制，两次推送至少间隔这么久。 */
const REMOTE_GAP = 12_000;
const PULL_GAP = 20_000;
const CARET = '{|}';
const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

const SYNC_VIEW: Record<SyncState, { icon: IconName; label: string }> = {
  local: { icon: 'laptop', label: '仅本机' },
  dev: { icon: 'laptop', label: '开发同步' },
  pending: { icon: 'cloud', label: '待同步' },
  syncing: { icon: 'refresh', label: '同步中' },
  synced: { icon: 'cloudCheck', label: '已同步' },
  error: { icon: 'cloudOff', label: '同步失败' },
  offline: { icon: 'cloudOff', label: '离线' },
};

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`记录页面缺少元素 #${id}`);
  return node as T;
}

function queryUi(root: HTMLElement) {
  return {
    root,
    main: root.querySelector<HTMLElement>('.notes-main')!,
    sidebar: el('notes-sidebar'),
    total: el('notes-total'),
    query: el<HTMLInputElement>('notes-query'),
    filter: el('notes-filter'),
    list: el('notes-list'),
    empty: el('notes-empty'),
    doc: el('notes-doc'),
    title: el<HTMLInputElement>('notes-title'),
    tagList: el('notes-tag-list'),
    tagInput: el<HTMLInputElement>('notes-tag-input'),
    tagOptions: el('notes-tag-options'),
    body: el<HTMLTextAreaElement>('notes-body'),
    starter: el('notes-starter'),
    editPane: el('notes-edit-pane'),
    previewPane: el('notes-preview-pane'),
    previewTitle: el('notes-preview-title'),
    preview: el('notes-preview'),
    words: el('notes-words'),
    reading: el('notes-reading'),
    selection: el('notes-selection'),
    saved: el('notes-saved'),
    sync: el<HTMLButtonElement>('notes-sync'),
    syncLabel: el('notes-sync-label'),
    pinLabel: el('notes-pin-label'),
    slashMenu: el('notes-slash-menu'),
    slashList: el('notes-slash-list'),
    importInput: el<HTMLInputElement>('notes-import-input'),
    syncDialog: el<HTMLDialogElement>('notes-sync-dialog'),
    syncForm: el<HTMLFormElement>('notes-sync-form'),
    token: el<HTMLInputElement>('notes-token'),
    syncError: el('notes-sync-error'),
    syncErrorConnected: el('notes-sync-error-connected'),
    syncStateText: el('notes-sync-state'),
    syncWho: el('notes-sync-who'),
    syncTime: el('notes-sync-time'),
    syncConnect: el<HTMLButtonElement>('notes-sync-connect'),
    publishDialog: el<HTMLDialogElement>('notes-publish-dialog'),
    publishForm: el<HTMLFormElement>('notes-publish-form'),
    publishTitle: el<HTMLInputElement>('notes-publish-title-input'),
    publishDescription: el<HTMLTextAreaElement>('notes-publish-description'),
    publishSlug: el<HTMLInputElement>('notes-publish-slug'),
    publishFile: el('notes-publish-file'),
    publishTags: el<HTMLInputElement>('notes-publish-tags'),
    publishCategory: el<HTMLInputElement>('notes-publish-category'),
    publishDraft: el<HTMLInputElement>('notes-publish-draft'),
    publishError: el('notes-publish-error'),
    publishNote: el('notes-publish-note'),
    publishTokenHelp: el<HTMLParagraphElement>('notes-publish-token-help'),
    publishSubmit: el<HTMLButtonElement>('notes-publish-submit'),
    publishConnect: el<HTMLButtonElement>('notes-publish-connect'),
    prefsDialog: el<HTMLDialogElement>('notes-prefs-dialog'),
    prefsForm: el<HTMLFormElement>('notes-prefs-form'),
    sizeOutput: el('notes-size-output'),
    helpDialog: el<HTMLDialogElement>('notes-help-dialog'),
    toast: el('notes-toast'),
    toastText: el('notes-toast-text'),
    toastAction: el<HTMLButtonElement>('notes-toast-action'),
    tip: el('notes-tip'),
    dropzone: el('notes-dropzone'),
    print: el('notes-print'),
  };
}

let ui: ReturnType<typeof queryUi>;

const state = {
  notes: [] as Note[],
  deleted: [] as Deletion[],
  activeId: '',
  query: '',
  tag: '',
  prefs: { ...DEFAULT_PREFS },
  token: '',
  login: '',
  canPublish: false,
  devSync: false,
  sync: 'local' as SyncState,
  syncError: '',
  syncBlocked: false,
  lastSyncAt: 0,
  lastPullAt: 0,
  tabEscapes: false,
  slash: null as null | { start: number; query: string; items: Command[]; index: number },
};

const narrow = window.matchMedia('(max-width: 899px)');
const plainCache = new Map<string, { key: string; text: string }>();

let renderFn: ((source: string) => string) | null = null;
let renderLoading: Promise<void> | null = null;
let highlightFn: ((root: ParentNode) => void) | null = null;
let highlightLoading: Promise<void> | null = null;
let previewStale = true;
let previewTimer = 0;
let listTimer = 0;
let statsTimer = 0;
let localTimer = 0;
let remoteTimer = 0;
let devTimer = 0;
let toastTimer = 0;
let lastPushAt = 0;
let syncing: Promise<void> | null = null;
let syncAgain = false;
let toastHandler: (() => void) | null = null;

/* ---------- 通用 ---------- */

function formatKeys(keys: string): string {
  const parts = keys.split('+');
  if (IS_MAC) {
    const map: Record<string, string> = { Mod: '⌘', Alt: '⌥', Shift: '⇧', Enter: '↩', Tab: '⇥', Esc: 'Esc' };
    return parts.map((part) => map[part] ?? part).join('');
  }
  const map: Record<string, string> = { Mod: 'Ctrl' };
  return parts.map((part) => map[part] ?? part).join('+');
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function isVisible(node: HTMLElement): boolean {
  return node.getClientRects().length > 0;
}

function activeNote(): Note | undefined {
  return state.notes.find((note) => note.id === state.activeId);
}

function currentStore(): NoteStore {
  return { notes: state.notes, deleted: state.deleted };
}

function touch(note: Note): void {
  note.updatedAt = new Date().toISOString();
}

function notePlain(note: Note): string {
  const cached = plainCache.get(note.id);
  if (cached && cached.key === note.updatedAt) return cached.text;
  const text = plainText(note.body).replace(/\s+/g, ' ');
  plainCache.set(note.id, { key: note.updatedAt, text });
  return text;
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 80) || '无标题';
}

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stripCaret(text: string): { text: string; caret: number } {
  const caret = text.indexOf(CARET);
  return caret === -1 ? { text, caret: text.length } : { text: text.replaceAll(CARET, ''), caret };
}

/* ---------- 提示 ---------- */

function showToast(message: string, action?: { label: string; run: () => void }, duration = 3800): void {
  ui.toastText.textContent = message;
  ui.toastAction.hidden = !action;
  toastHandler = action?.run ?? null;
  if (action) ui.toastAction.textContent = action.label;
  ui.toast.hidden = false;
  requestAnimationFrame(() => ui.toast.classList.add('is-visible'));
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, duration);
}

function hideToast(): void {
  ui.toast.classList.remove('is-visible');
  toastHandler = null;
  window.setTimeout(() => {
    if (!ui.toast.classList.contains('is-visible')) ui.toast.hidden = true;
  }, 220);
}

function setupTips(): void {
  let timer = 0;
  let current: HTMLElement | null = null;

  const hide = () => {
    window.clearTimeout(timer);
    current = null;
    ui.tip.hidden = true;
  };
  const show = (target: HTMLElement) => {
    if (!isVisible(target) || target.matches('[aria-expanded="true"]')) return;
    const label = target.dataset.tip ?? '';
    const keys = target.dataset.keys;
    ui.tip.replaceChildren(label);
    if (keys) {
      const kbd = document.createElement('kbd');
      kbd.textContent = formatKeys(keys);
      ui.tip.append(kbd);
    }
    ui.tip.hidden = false;
    const rect = target.getBoundingClientRect();
    const width = ui.tip.offsetWidth;
    const height = ui.tip.offsetHeight;
    const below = rect.bottom + 8 + height < window.innerHeight;
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
    ui.tip.style.left = `${left}px`;
    ui.tip.style.top = `${below ? rect.bottom + 8 : rect.top - height - 8}px`;
  };

  ui.root.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const target = (event.target as Element).closest<HTMLElement>('[data-tip]');
    if (!target || target === current) return;
    hide();
    current = target;
    timer = window.setTimeout(() => show(target), 420);
  });
  ui.root.addEventListener('pointerout', (event) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-tip]');
    if (target && !target.contains(event.relatedTarget as Node | null)) hide();
  });
  ui.root.addEventListener('focusin', (event) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-tip]');
    if (target?.matches(':focus-visible')) {
      current = target;
      show(target);
    }
  });
  ui.root.addEventListener('focusout', hide);
  ui.root.addEventListener('pointerdown', hide);
  window.addEventListener('scroll', hide, true);
}

/* ---------- 偏好 ---------- */

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    const pick = <K extends keyof Prefs>(key: K, allowed: readonly Prefs[K][]): Prefs[K] =>
      allowed.includes(raw[key] as Prefs[K]) ? (raw[key] as Prefs[K]) : DEFAULT_PREFS[key];
    return {
      font: pick('font', ['sans', 'serif', 'mono']),
      size: typeof raw.size === 'number' && raw.size >= 14 && raw.size <= 22 ? Math.round(raw.size) : DEFAULT_PREFS.size,
      leading: pick('leading', ['compact', 'comfort', 'loose']),
      measure: pick('measure', ['narrow', 'normal', 'wide']),
      spellcheck: typeof raw.spellcheck === 'boolean' ? raw.spellcheck : DEFAULT_PREFS.spellcheck,
      scrollSync: typeof raw.scrollSync === 'boolean' ? raw.scrollSync : DEFAULT_PREFS.scrollSync,
      slash: typeof raw.slash === 'boolean' ? raw.slash : DEFAULT_PREFS.slash,
      mode: pick('mode', ['edit', 'split', 'preview']),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs));
  } catch {
    // 偏好保存失败不影响书写
  }
}

function applyPrefs(): void {
  const { prefs } = state;
  ui.root.dataset.font = prefs.font;
  ui.root.dataset.leading = prefs.leading;
  ui.root.dataset.measure = prefs.measure;
  ui.root.style.setProperty('--notes-size', `${prefs.size}px`);
  ui.body.spellcheck = prefs.spellcheck;
  ui.sizeOutput.textContent = String(prefs.size);
  autoGrow();
}

function fillPrefsForm(): void {
  const form = ui.prefsForm;
  for (const name of ['font', 'leading', 'measure'] as const) {
    const input = form.querySelector<HTMLInputElement>(`input[name="${name}"][value="${state.prefs[name]}"]`);
    if (input) input.checked = true;
  }
  form.querySelector<HTMLInputElement>('input[name="size"]')!.value = String(state.prefs.size);
  for (const name of ['spellcheck', 'scrollSync', 'slash'] as const) {
    form.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.checked = state.prefs[name];
  }
  ui.sizeOutput.textContent = String(state.prefs.size);
}

function readPrefsForm(): void {
  const data = new FormData(ui.prefsForm);
  const next = { ...state.prefs };
  next.font = (data.get('font') as Prefs['font']) ?? next.font;
  next.leading = (data.get('leading') as Prefs['leading']) ?? next.leading;
  next.measure = (data.get('measure') as Prefs['measure']) ?? next.measure;
  next.size = Number(data.get('size')) || next.size;
  next.spellcheck = data.has('spellcheck');
  next.scrollSync = data.has('scrollSync');
  next.slash = data.has('slash');
  state.prefs = next;
  savePrefs();
  applyPrefs();
}

/* ---------- 视图 ---------- */

function effectiveMode(): Mode {
  return state.prefs.mode === 'split' && narrow.matches ? 'edit' : state.prefs.mode;
}

function applyMode(): void {
  const mode = effectiveMode();
  ui.root.dataset.mode = mode;
  for (const button of ui.root.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === mode));
  }
  renderStarter();
  if (mode !== 'edit' && previewStale) schedulePreview(0);
  if (mode !== 'preview') requestAnimationFrame(autoGrow);
}

function setMode(mode: Mode): void {
  state.prefs.mode = mode;
  savePrefs();
  applyMode();
  if (mode === 'preview') ui.previewPane.focus({ preventScroll: true });
  else if (activeNote()) ui.body.focus({ preventScroll: true });
}

function setFocusMode(on: boolean): void {
  ui.root.classList.toggle('is-focus', on);
  document.documentElement.classList.toggle('notes-focus-mode', on);
  ui.root.querySelector('[data-action="focus"]')?.setAttribute('aria-pressed', String(on));
  if (on) showToast('已进入专注模式，按 Esc 退出', undefined, 2400);
  requestAnimationFrame(autoGrow);
}

function openDrawer(): void {
  ui.root.classList.add('is-drawer');
  if (narrow.matches) ui.main.inert = true;
  const active = ui.list.querySelector<HTMLElement>('[aria-current="true"]');
  (active ?? ui.query).focus({ preventScroll: true });
  active?.scrollIntoView({ block: 'nearest' });
}

function closeDrawer(): void {
  if (!ui.root.classList.contains('is-drawer')) return;
  ui.root.classList.remove('is-drawer');
  ui.main.inert = false;
}

function autoGrow(): void {
  if (CSS.supports('field-sizing', 'content')) return;
  const pane = ui.editPane;
  const top = pane.scrollTop;
  ui.body.style.height = 'auto';
  ui.body.style.height = `${ui.body.scrollHeight}px`;
  pane.scrollTop = top;
}

/* ---------- 保存与同步 ---------- */

function renderSaved(): void {
  const note = activeNote();
  if (localTimer) {
    ui.saved.textContent = '保存中…';
    ui.saved.dataset.state = 'saving';
    return;
  }
  ui.saved.dataset.state = 'saved';
  ui.saved.textContent = note ? `已保存 · ${formatNoteTime(note.updatedAt)}` : '已保存';
  ui.saved.title = note ? `创建于 ${formatFullTime(note.createdAt)}，最后编辑于 ${formatFullTime(note.updatedAt)}` : '';
}

function flushLocal(): void {
  window.clearTimeout(localTimer);
  localTimer = 0;
  try {
    saveLocalStore(currentStore());
  } catch {
    showToast('浏览器存储空间不足，最近的修改可能没有保存，请先导出备份', undefined, 8000);
  }
  renderSaved();
}

function scheduleLocal(): void {
  window.clearTimeout(localTimer);
  localTimer = window.setTimeout(flushLocal, 300);
  renderSaved();
}

function persist(): void {
  scheduleLocal();
  scheduleRemote();
}

function setSync(next: SyncState): void {
  state.sync = next;
  const view = SYNC_VIEW[next];
  ui.sync.dataset.state = next;
  ui.sync.querySelector('.notes-sync__icon')!.innerHTML = icon(view.icon, 16);
  ui.syncLabel.textContent = view.label;
  let tip = '';
  if (next === 'local') tip = '记录只保存在这台浏览器，点击开启多设备同步';
  else if (next === 'dev') tip = '开发模式：同时写入项目里的 data/local-notes.json';
  else if (next === 'pending') tip = '停笔几秒后会自动同步';
  else if (next === 'syncing') tip = '正在与 GitHub 同步';
  else if (next === 'synced') tip = `已同步到 GitHub${state.lastSyncAt ? ` · ${formatNoteTime(new Date(state.lastSyncAt).toISOString())}` : ''}`;
  else tip = state.syncError || '同步失败';
  ui.sync.dataset.tip = tip;
  ui.sync.setAttribute('aria-label', `同步状态：${view.label}。${tip}`);
  if (ui.syncDialog.open) renderSyncDialog();
}

function scheduleRemote(delay = REMOTE_IDLE): void {
  if (!state.token) {
    if (state.devSync) {
      window.clearTimeout(devTimer);
      devTimer = window.setTimeout(() => void pushDev(), 500);
    }
    return;
  }
  if (state.syncBlocked) return;
  window.clearTimeout(remoteTimer);
  const wait = Math.max(delay, REMOTE_GAP - (Date.now() - lastPushAt));
  remoteTimer = window.setTimeout(() => {
    remoteTimer = 0;
    void syncRemote();
  }, wait);
  if (state.sync !== 'syncing' && state.sync !== 'offline') setSync('pending');
}

function handleSyncError(error: unknown): void {
  const remote = error instanceof NotesRemoteError ? error : null;
  state.syncError = remote?.message ?? '同步失败，请稍后重试';
  if (remote?.code === 'auth') state.syncBlocked = true;
  setSync(remote?.code === 'network' ? 'offline' : 'error');
}

/** 先拉取远端并合并，只有合并结果与远端不同才推送。 */
async function syncRemote(): Promise<void> {
  if (!state.token) return;
  if (syncing) {
    syncAgain = true;
    return syncing;
  }
  window.clearTimeout(remoteTimer);
  remoteTimer = 0;
  const token = state.token;
  setSync('syncing');

  syncing = (async () => {
    try {
      const remote = await pullRemoteStore(token);
      if (token !== state.token) return;
      state.lastPullAt = Date.now();
      const before = serializeStore(currentStore());
      const merged = mergeStores(currentStore(), remote);
      const mergedJson = serializeStore(merged);
      if (mergedJson !== before) applyStore(merged);
      if (mergedJson !== serializeStore(remote)) {
        await pushRemoteStore(token, merged);
        lastPushAt = Date.now();
      }
      state.lastSyncAt = Date.now();
      state.syncError = '';
      state.syncBlocked = false;
      setSync('synced');
    } catch (error) {
      handleSyncError(error);
    } finally {
      syncing = null;
      if (syncAgain) {
        syncAgain = false;
        scheduleRemote();
      }
    }
  })();
  return syncing;
}

function flushRemoteOnHide(): void {
  if (state.token && remoteTimer && !state.syncBlocked) {
    window.clearTimeout(remoteTimer);
    remoteTimer = 0;
    lastPushAt = Date.now();
    void pushRemoteStore(state.token, currentStore(), { keepalive: true }).catch(() => undefined);
  }
  if (state.devSync && devTimer) {
    window.clearTimeout(devTimer);
    devTimer = 0;
    void pushDev(true);
  }
}

async function loadDev(): Promise<NoteStore | null> {
  if (!import.meta.env.DEV) return null;
  try {
    const response = await fetch('/api/notes');
    if (!response.ok) return null;
    return parseStore(await response.json());
  } catch {
    return null;
  }
}

async function pushDev(keepalive = false): Promise<void> {
  devTimer = 0;
  try {
    const response = await fetch('/api/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: serializeStore(currentStore()),
      keepalive,
    });
    if (!response.ok) throw new Error(String(response.status));
    if (!state.token) setSync('dev');
  } catch {
    state.syncError = '写入 data/local-notes.json 失败';
    if (!state.token) setSync('error');
  }
}

/** 合并后的数据写回界面；正在编辑的记录被其他设备改动时尽量保留光标。 */
function applyStore(store: NoteStore): void {
  const before = activeNote();
  state.notes = store.notes;
  state.deleted = store.deleted;
  const after = activeNote();

  if (before && !after) {
    state.activeId = state.notes[0]?.id ?? '';
    showToast('当前记录已在其他设备上删除');
    fillEditor();
  } else if (after && (after.body !== ui.body.value || after.title !== ui.title.value || after.tags.join() !== before?.tags.join())) {
    fillEditor({ keepSelection: true });
  } else if (!before && !state.activeId && state.notes.length) {
    state.activeId = state.notes[0].id;
    fillEditor();
  }
  renderList();
  flushLocal();
}

/* ---------- 同步对话框 ---------- */

function renderSyncDialog(): void {
  const connected = Boolean(state.token);
  for (const section of ui.syncDialog.querySelectorAll<HTMLElement>('[data-when]')) {
    section.hidden = section.dataset.when !== (connected ? 'connected' : 'disconnected');
  }
  const errorNode = connected ? ui.syncErrorConnected : ui.syncError;
  errorNode.hidden = !(state.sync === 'error' || state.sync === 'offline') || !state.syncError;
  errorNode.textContent = state.syncError;
  if (!connected) return;
  const view = SYNC_VIEW[state.sync];
  ui.syncStateText.innerHTML = `${icon(view.icon, 16)}<span>${view.label}</span>`;
  ui.syncStateText.dataset.state = state.sync;
  ui.syncWho.textContent = state.login ? `已连接 GitHub 账号 @${state.login}` : '已连接 GitHub';
  ui.syncTime.textContent = state.lastSyncAt ? `上次同步：${formatFullTime(new Date(state.lastSyncAt).toISOString())}` : '还没有完成过同步';
}

function openSyncDialog(): void {
  renderSyncDialog();
  ui.syncDialog.showModal();
  if (!state.token) ui.token.focus();
}

async function connectRemote(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const token = ui.token.value.trim();
  if (!token) {
    ui.syncError.hidden = false;
    ui.syncError.textContent = '请先粘贴 GitHub 令牌';
    ui.token.focus();
    return;
  }
  ui.syncConnect.disabled = true;
  ui.syncConnect.textContent = '连接中…';
  ui.syncError.hidden = true;
  try {
    const login = await fetchLogin(token);
    saveToken(token);
    state.token = token;
    state.login = login;
    state.canPublish = await fetchRepoWriteAccess(token);
    state.syncBlocked = false;
    await syncRemote();
    if (state.sync === 'error' && state.syncBlocked) {
      clearRemoteSession();
      state.token = '';
      renderSyncDialog();
      return;
    }
    ui.token.value = '';
    if (state.sync === 'synced') {
      ui.syncDialog.close();
      showToast(`已连接${login ? ` @${login}` : ' GitHub'}，之后会自动同步`);
    } else {
      renderSyncDialog();
    }
  } catch (error) {
    ui.syncError.hidden = false;
    ui.syncError.textContent = error instanceof NotesRemoteError ? error.message : '连接失败，请稍后重试';
  } finally {
    ui.syncConnect.disabled = false;
    ui.syncConnect.textContent = '连接并同步';
  }
}

function disconnectRemote(): void {
  clearRemoteSession();
  window.clearTimeout(remoteTimer);
  remoteTimer = 0;
  state.token = '';
  state.login = '';
  state.canPublish = false;
  state.syncError = '';
  state.syncBlocked = false;
  setSync(state.devSync ? 'dev' : 'local');
  renderSyncDialog();
  showToast('已断开同步，草稿仍保存在这台设备上');
}

/* ---------- 列表 ---------- */

function highlight(text: string, terms: string[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const lower = text.toLowerCase();
  let index = 0;
  while (terms.length && index < text.length) {
    let best = -1;
    let length = 0;
    for (const term of terms) {
      const at = lower.indexOf(term, index);
      if (at !== -1 && (best === -1 || at < best)) {
        best = at;
        length = term.length;
      }
    }
    if (best === -1) break;
    if (best > index) fragment.append(text.slice(index, best));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(best, best + length);
    fragment.append(mark);
    index = best + length;
  }
  if (index < text.length) fragment.append(text.slice(index));
  return fragment;
}

function excerptFor(note: Note, terms: string[]): string {
  const plain = notePlain(note);
  if (terms.length) {
    const lower = plain.toLowerCase();
    const hits = terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0);
    const at = hits.length ? Math.min(...hits) : -1;
    if (at > 36) return `…${plain.slice(at - 18, at + 80)}`;
  }
  return plain.slice(0, 96);
}

function renderFilter(): void {
  const tags = collectTags(state.notes);
  if (state.tag && !tags.some((item) => item.tag === state.tag)) state.tag = '';
  ui.filter.hidden = tags.length === 0;
  const chips = [{ tag: '', count: state.notes.length }, ...tags].map(({ tag, count }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'notes-filter__chip';
    button.dataset.filterTag = tag;
    button.setAttribute('aria-pressed', String(state.tag === tag));
    button.append(tag ? `#${tag}` : '全部');
    const badge = document.createElement('span');
    badge.textContent = String(count);
    button.append(badge);
    return button;
  });
  ui.filter.replaceChildren(...chips);
  ui.tagOptions.replaceChildren(
    ...tags.map(({ tag }) => {
      const option = document.createElement('option');
      option.value = tag;
      return option;
    }),
  );
}

function renderList(): void {
  window.clearTimeout(listTimer);
  listTimer = 0;
  const focusedId = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.notes-item')?.dataset.id;
  const allTerms = searchTerms(state.query);
  const terms = allTerms.filter((term) => !term.startsWith('#'));
  const notes = state.notes.filter((note) => matchNote(note, allTerms, state.tag));
  const fragment = document.createDocumentFragment();

  if (notes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'notes-list__empty';
    if (state.notes.length === 0) {
      empty.textContent = '还没有记录，点击「新建」开始';
    } else {
      empty.append(state.query ? `没有找到与「${state.query}」相关的记录` : '这个标签下没有记录');
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'notes-link-btn';
      clear.dataset.action = 'clear-filter';
      clear.textContent = '清除筛选';
      empty.append(clear);
    }
    fragment.append(empty);
  }

  for (const group of groupNotes(notes)) {
    const section = document.createElement('section');
    section.className = 'notes-group';
    const heading = document.createElement('h2');
    heading.className = 'notes-group__label';
    heading.textContent = group.label;
    const list = document.createElement('ul');
    list.className = 'notes-group__list';

    for (const note of group.notes) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'notes-item';
      button.dataset.id = note.id;
      if (note.id === state.activeId) button.setAttribute('aria-current', 'true');

      const title = document.createElement('span');
      title.className = 'notes-item__title';
      if (note.pinned) title.insertAdjacentHTML('afterbegin', icon('pin', 13));
      const titleText = document.createElement('span');
      titleText.append(highlight(note.title.trim() || '无标题', terms));
      if (!note.title.trim()) titleText.className = 'is-placeholder';
      title.append(titleText);

      const excerpt = document.createElement('span');
      excerpt.className = 'notes-item__excerpt';
      const text = excerptFor(note, terms);
      excerpt.append(text ? highlight(text, terms) : '还没有正文');
      if (!text) excerpt.classList.add('is-placeholder');

      const meta = document.createElement('span');
      meta.className = 'notes-item__meta';
      const time = document.createElement('time');
      time.dateTime = note.updatedAt;
      time.textContent = formatNoteTime(note.updatedAt);
      meta.append(time);
      for (const tag of note.tags.slice(0, 2)) {
        const chip = document.createElement('span');
        chip.className = 'notes-item__tag';
        chip.textContent = `#${tag}`;
        meta.append(chip);
      }
      if (note.tags.length > 2) {
        const more = document.createElement('span');
        more.className = 'notes-item__tag';
        more.textContent = `+${note.tags.length - 2}`;
        meta.append(more);
      }

      button.append(title, excerpt, meta);
      item.append(button);
      list.append(item);
    }
    section.append(heading, list);
    fragment.append(section);
  }

  ui.list.replaceChildren(fragment);
  if (focusedId) ui.list.querySelector<HTMLElement>(`[data-id="${focusedId}"]`)?.focus({ preventScroll: true });
  const filtered = Boolean(state.query || state.tag);
  ui.total.textContent = filtered ? `找到 ${notes.length} / ${state.notes.length} 篇` : `共 ${state.notes.length} 篇`;
  renderFilter();
}

function scheduleList(): void {
  if (listTimer) return;
  listTimer = window.setTimeout(renderList, 350);
}

function revealActiveItem(): void {
  ui.list.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
}

/* ---------- 编辑器 ---------- */

function setToolbarEnabled(enabled: boolean): void {
  for (const button of ui.root.querySelectorAll<HTMLButtonElement>('.notes-toolbar [data-cmd], .notes-toolbar [popovertarget], .notes-toolbar [data-view], .notes-toolbar [data-action="focus"]')) {
    button.disabled = !enabled;
  }
}

function renderTags(): void {
  const note = activeNote();
  const items = (note?.tags ?? []).map((tag) => {
    const item = document.createElement('li');
    item.className = 'notes-tag';
    item.append(`#${tag}`);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.removeTag = tag;
    remove.setAttribute('aria-label', `移除标签 ${tag}`);
    remove.innerHTML = icon('close', 12);
    item.append(remove);
    return item;
  });
  ui.tagList.replaceChildren(...items);
  ui.tagInput.placeholder = note?.tags.length ? '' : '添加标签';
}

function addTags(raw: string): void {
  const note = activeNote();
  if (!note) return;
  const tags = parseTags(raw).filter((tag) => !note.tags.includes(tag));
  if (!tags.length) return;
  if (note.tags.length >= NOTE_LIMITS.MAX_TAGS) {
    showToast(`每篇最多 ${NOTE_LIMITS.MAX_TAGS} 个标签`);
    return;
  }
  note.tags = [...note.tags, ...tags].slice(0, NOTE_LIMITS.MAX_TAGS);
  touch(note);
  renderTags();
  renderList();
  persist();
}

function removeTag(tag: string): void {
  const note = activeNote();
  if (!note) return;
  note.tags = note.tags.filter((item) => item !== tag);
  touch(note);
  renderTags();
  renderList();
  persist();
  ui.tagInput.focus();
}

function commitTagInput(): void {
  const value = ui.tagInput.value;
  ui.tagInput.value = '';
  addTags(value);
}

function renderStats(): void {
  window.clearTimeout(statsTimer);
  statsTimer = 0;
  const { words, minutes } = countWords(ui.body.value);
  ui.words.textContent = `${words.toLocaleString('zh-CN')} 字`;
  ui.reading.textContent = minutes ? `约 ${minutes} 分钟读完` : '';
  renderSelection();
}

function scheduleStats(): void {
  if (statsTimer) return;
  statsTimer = window.setTimeout(renderStats, 160);
}

function renderSelection(): void {
  const { selectionStart, selectionEnd, value } = ui.body;
  const focused = document.activeElement === ui.body;
  const selected = focused && selectionEnd > selectionStart ? countWords(value.slice(selectionStart, selectionEnd)).words : 0;
  ui.selection.textContent = selected ? `已选 ${selected} 字` : '';
}

function renderStarter(): void {
  const note = activeNote();
  ui.starter.hidden = !note || note.body.length > 0 || effectiveMode() === 'preview';
}

function fillEditor(options: { keepSelection?: boolean } = {}): void {
  const note = activeNote();
  const hasNote = Boolean(note);
  ui.empty.hidden = hasNote;
  ui.doc.hidden = !hasNote;
  ui.root.toggleAttribute('data-empty', !hasNote);
  setToolbarEnabled(hasNote);
  closeSlash();
  if (!note) {
    ui.words.textContent = '';
    ui.reading.textContent = '';
    ui.saved.textContent = '';
    return;
  }

  const { selectionStart, selectionEnd } = ui.body;
  ui.title.value = note.title;
  if (ui.body.value !== note.body) ui.body.value = note.body;
  if (options.keepSelection) {
    const max = note.body.length;
    ui.body.setSelectionRange(Math.min(selectionStart, max), Math.min(selectionEnd, max));
  } else {
    ui.body.setSelectionRange(0, 0);
    ui.editPane.scrollTop = 0;
    ui.previewPane.scrollTop = 0;
  }
  ui.pinLabel.textContent = note.pinned ? '取消置顶' : '置顶这篇';
  renderTags();
  renderStats();
  renderStarter();
  renderSaved();
  previewStale = true;
  schedulePreview(0);
  requestAnimationFrame(autoGrow);
}

function rememberActive(): void {
  try {
    localStorage.setItem(ACTIVE_KEY, state.activeId);
  } catch {
    // 记不住上次打开的记录也没关系
  }
}

/** 离开一篇空白记录时顺手删掉，避免列表里堆满「无标题」。 */
function pruneBlank(exceptId: string): void {
  const note = activeNote();
  if (!note || note.id === exceptId || !isBlankNote(note)) return;
  state.notes = state.notes.filter((item) => item.id !== note.id);
  state.deleted = [...state.deleted, { id: note.id, at: new Date().toISOString() }];
  persist();
}

function selectNote(id: string): void {
  if (id !== state.activeId) {
    pruneBlank(id);
    state.activeId = id;
    rememberActive();
    fillEditor();
    renderList();
    revealActiveItem();
  }
  closeDrawer();
}

function newNote(template?: Template): void {
  pruneBlank('');
  const note = createNote();
  let caret = 0;
  if (template) {
    const text = templateText(template);
    const body = stripCaret(text.body);
    note.title = text.title;
    note.body = body.text;
    note.tags = [...template.tags];
    caret = body.caret;
  }
  state.notes = [note, ...state.notes];
  state.activeId = note.id;
  if (state.query || (state.tag && !note.tags.includes(state.tag))) {
    state.query = '';
    state.tag = '';
    ui.query.value = '';
  }
  rememberActive();
  fillEditor();
  renderList();
  revealActiveItem();
  closeDrawer();
  persist();
  if (template) {
    if (effectiveMode() === 'preview') setMode(narrow.matches ? 'edit' : 'split');
    ui.body.focus();
    ui.body.setSelectionRange(caret, caret);
  } else {
    ui.title.focus();
  }
}

function applyTemplate(template: Template): void {
  const note = activeNote();
  if (!note) return newNote(template);
  const text = templateText(template);
  if (!note.title.trim()) {
    note.title = text.title;
    ui.title.value = text.title;
  }
  const tags = template.tags.filter((tag) => !note.tags.includes(tag));
  if (tags.length) note.tags = [...note.tags, ...tags].slice(0, NOTE_LIMITS.MAX_TAGS);
  renderTags();
  insertWithCaret(ui.body, ui.body.selectionStart, ui.body.selectionEnd, text.body);
}

function onBodyInput(): void {
  const note = activeNote();
  if (!note) return;
  note.body = ui.body.value;
  touch(note);
  autoGrow();
  scheduleStats();
  renderStarter();
  schedulePreview();
  scheduleList();
  persist();
  updateSlash();
}

function deleteActive(): void {
  const note = activeNote();
  if (!note) return;
  const order = state.notes.filter((item) => matchNote(item, searchTerms(state.query), state.tag));
  const index = order.findIndex((item) => item.id === note.id);
  state.notes = state.notes.filter((item) => item.id !== note.id);
  state.deleted = [...state.deleted, { id: note.id, at: new Date().toISOString() }];
  const rest = order.filter((item) => item.id !== note.id);
  state.activeId = (rest[Math.min(index, rest.length - 1)] ?? state.notes[0])?.id ?? '';
  rememberActive();
  fillEditor();
  renderList();
  persist();
  if (!isBlankNote(note)) {
    showToast(`已删除「${note.title.trim() || '无标题'}」`, { label: '撤销', run: () => restoreNote(note) }, 7000);
  }
}

function restoreNote(note: Note): void {
  touch(note);
  state.deleted = state.deleted.filter((item) => item.id !== note.id);
  state.notes = [note, ...state.notes.filter((item) => item.id !== note.id)];
  state.activeId = note.id;
  rememberActive();
  fillEditor();
  renderList();
  revealActiveItem();
  persist();
  showToast('已恢复');
}

function togglePin(): void {
  const note = activeNote();
  if (!note) return;
  note.pinned = !note.pinned;
  touch(note);
  ui.pinLabel.textContent = note.pinned ? '取消置顶' : '置顶这篇';
  renderList();
  revealActiveItem();
  persist();
  showToast(note.pinned ? '已置顶' : '已取消置顶');
}

/* ---------- 预览 ---------- */

function loadRenderer(): Promise<void> {
  renderLoading ??= import('./notes-render')
    .then((module) => {
      renderFn = module.renderNote;
    })
    .catch(() => {
      renderLoading = null;
      showToast('预览组件加载失败，请检查网络后刷新页面');
    });
  return renderLoading;
}

function schedulePreview(delay?: number): void {
  previewStale = true;
  if (effectiveMode() === 'edit') return;
  window.clearTimeout(previewTimer);
  const wait = delay ?? Math.min(480, 120 + Math.floor(ui.body.value.length / 300));
  previewTimer = window.setTimeout(() => void renderPreview(), wait);
}

async function renderPreview(): Promise<void> {
  if (!renderFn) await loadRenderer();
  const note = activeNote();
  if (!note || !renderFn) return;
  ui.previewTitle.textContent = note.title.trim() || '无标题';
  ui.previewTitle.classList.toggle('is-placeholder', !note.title.trim());
  if (note.body.trim()) {
    ui.preview.innerHTML = renderFn(note.body);
    enhancePreview();
  } else {
    ui.preview.innerHTML = '<p class="notes-preview__placeholder">正文还是空的。左边写下的内容会在这里排版好。</p>';
  }
  previewStale = false;
  syncPreviewScroll();
}

function loadHighlighter(): Promise<void> {
  highlightLoading ??= import('./notes-highlight')
    .then((module) => {
      highlightFn = module.highlightCode;
    })
    .catch(() => {
      highlightLoading = null;
    });
  return highlightLoading;
}

function highlightBlocks(root: ParentNode): void {
  if (!root.querySelector('pre[data-lang]')) return;
  if (highlightFn) highlightFn(root);
  else void loadHighlighter().then(() => highlightFn?.(root));
}

function enhancePreview(): void {
  highlightBlocks(ui.preview);
  for (const pre of ui.preview.querySelectorAll<HTMLPreElement>('pre')) {
    const wrap = document.createElement('div');
    wrap.className = 'notes-code';
    const bar = document.createElement('div');
    bar.className = 'notes-code__bar';
    const lang = document.createElement('span');
    lang.textContent = pre.dataset.lang || '代码';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'notes-code__copy';
    copy.dataset.copy = '';
    copy.innerHTML = `${icon('copy', 14)}<span>复制</span>`;
    bar.append(lang, copy);
    pre.replaceWith(wrap);
    wrap.append(bar, pre);
  }
}

function toggleTaskFromPreview(input: HTMLInputElement): void {
  const note = activeNote();
  if (!note) return;
  const index = taskCharIndex(note.body, Number(input.dataset.task));
  if (index < 0) {
    input.checked = !input.checked;
    showToast('没能定位这条待办，请在编辑区修改');
    return;
  }
  const mark = note.body[index] === ' ' ? 'x' : ' ';
  ui.body.setRangeText(mark, index, index + 1, 'preserve');
  note.body = ui.body.value;
  touch(note);
  input.setAttribute('aria-label', mark === 'x' ? '标记为未完成' : '标记为已完成');
  renderStats();
  scheduleList();
  persist();
}

function syncPreviewScroll(): void {
  if (effectiveMode() !== 'split' || !state.prefs.scrollSync) return;
  const source = ui.editPane;
  const range = source.scrollHeight - source.clientHeight;
  const ratio = range > 0 ? source.scrollTop / range : 0;
  const target = ui.previewPane;
  target.scrollTop = ratio * (target.scrollHeight - target.clientHeight);
}

/* ---------- 斜杠菜单 ---------- */

function slashOpen(): boolean {
  return ui.slashMenu.matches(':popover-open');
}

function closeSlash(): void {
  state.slash = null;
  ui.body.removeAttribute('aria-activedescendant');
  if (slashOpen()) ui.slashMenu.hidePopover();
}

function renderSlash(): void {
  const slash = state.slash;
  if (!slash) return;
  let lastGroup = '';
  const items: HTMLElement[] = [];
  slash.items.forEach((command, index) => {
    if (command.group !== lastGroup) {
      lastGroup = command.group;
      const heading = document.createElement('li');
      heading.className = 'notes-slash__group';
      heading.setAttribute('role', 'presentation');
      heading.textContent = command.group;
      items.push(heading);
    }
    const option = document.createElement('li');
    option.id = `notes-slash-${command.id}`;
    option.className = 'notes-slash__item';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(index === slash.index));
    option.dataset.slashIndex = String(index);
    option.innerHTML = `<span class="notes-menu__icon">${icon(command.icon, 16)}</span>`;
    const label = document.createElement('span');
    label.className = 'notes-slash__label';
    label.textContent = command.label;
    const hint = document.createElement('span');
    hint.className = 'notes-slash__hint';
    hint.textContent = command.hint;
    option.append(label, hint);
    items.push(option);
  });
  ui.slashList.replaceChildren(...items);
  const active = ui.slashList.querySelector<HTMLElement>('[aria-selected="true"]');
  if (active) {
    ui.body.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  }
}

function positionSlash(): void {
  const slash = state.slash;
  if (!slash) return;
  const caret = caretRect(ui.body, slash.start);
  const menu = ui.slashMenu;
  const width = menu.offsetWidth || 280;
  const height = menu.offsetHeight || 320;
  let top = caret.top + caret.height + 6;
  if (top + height > window.innerHeight - 12) top = Math.max(12, caret.top - height - 6);
  const left = Math.min(Math.max(12, caret.left - 8), window.innerWidth - width - 12);
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

function updateSlash(): void {
  if (!state.prefs.slash || ui.body.selectionStart !== ui.body.selectionEnd) {
    closeSlash();
    return;
  }
  const context = slashQuery(ui.body.value, ui.body.selectionStart);
  const items = context ? filterCommands(context.query) : [];
  if (!context || items.length === 0) {
    closeSlash();
    return;
  }
  const keep = state.slash && state.slash.start === context.start ? Math.min(state.slash.index, items.length - 1) : 0;
  state.slash = { ...context, items, index: keep };
  renderSlash();
  if (!slashOpen()) ui.slashMenu.showPopover();
  positionSlash();
}

function applySlash(index: number): void {
  const slash = state.slash;
  const command = slash?.items[index];
  if (!slash || !command) return;
  const caret = ui.body.selectionStart;
  closeSlash();
  replaceRange(ui.body, slash.start, caret, '');
  command.run(ui.body);
}

/* ---------- 命令 ---------- */

function runCommand(id: string): void {
  if (!activeNote()) return;
  if (effectiveMode() === 'preview') setMode(narrow.matches ? 'edit' : 'split');
  const area = ui.body;
  switch (id) {
    case 'bold':
      return toggleWrap(area, '**', '**', '粗体');
    case 'italic':
      return toggleWrap(area, '*', '*', '斜体');
    case 'strike':
      return toggleWrap(area, '~~', '~~', '删除线');
    case 'highlight':
      return toggleWrap(area, '==', '==', '高亮');
    case 'inline-code':
      return toggleWrap(area, '`', '`', '代码');
    case 'paragraph':
      return setLineKind(area, id as LineKind);
    default:
      COMMANDS.find((command) => command.id === id)?.run(area);
  }
}

function onBodyKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  const area = ui.body;

  if (state.slash && slashOpen()) {
    const count = state.slash.items.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      state.slash.index = (state.slash.index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
      renderSlash();
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      applySlash(state.slash.index);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSlash();
      return;
    }
  }

  const mod = IS_MAC ? event.metaKey : event.ctrlKey;
  if (mod) {
    const key = event.key.toLowerCase();
    let command = '';
    if (event.altKey) {
      command = { Digit0: 'paragraph', Digit1: 'h1', Digit2: 'h2', Digit3: 'h3', KeyC: 'code' }[event.code] ?? '';
    } else if (event.shiftKey) {
      command = { KeyX: 'strike', KeyH: 'highlight', Digit8: 'ul', Digit7: 'ol', Digit9: 'quote' }[event.code] ?? '';
    } else if (key === 'enter') {
      event.preventDefault();
      toggleTaskLines(area);
      return;
    } else {
      command = ({ b: 'bold', i: 'italic', e: 'inline-code', k: 'link' } as Record<string, string>)[key] ?? '';
    }
    if (command) {
      event.preventDefault();
      runCommand(command);
    }
    return;
  }

  if (event.key === 'Escape') {
    state.tabEscapes = true;
    return;
  }
  if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
    if (state.tabEscapes) {
      state.tabEscapes = false;
      return;
    }
    event.preventDefault();
    indentLines(area, event.shiftKey);
    return;
  }
  state.tabEscapes = false;

  if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
    if (continueBlock(area)) event.preventDefault();
    return;
  }

  const closing = WRAP_KEYS[event.key];
  if (closing && !event.altKey && area.value.slice(area.selectionStart, area.selectionEnd).trim()) {
    event.preventDefault();
    surround(area, event.key, closing);
  }
}

function onBodyPaste(event: ClipboardEvent): void {
  const data = event.clipboardData;
  if (!data) return;
  const text = data.getData('text/plain');
  if (!text && data.files.length) {
    event.preventDefault();
    showToast('暂不支持直接粘贴图片，可以先上传到图床，再用「图片」插入链接', undefined, 5000);
    return;
  }
  const url = text.trim();
  const area = ui.body;
  const selected = area.value.slice(area.selectionStart, area.selectionEnd);
  if (/^https?:\/\/\S+$/.test(url) && selected.trim() && !selected.includes('\n') && !/^https?:\/\//.test(selected.trim())) {
    event.preventDefault();
    replaceRange(area, area.selectionStart, area.selectionEnd, `[${selected}](${url})`);
  }
}

/* ---------- 弹出菜单 ---------- */

function anchorPopover(panel: HTMLElement, invoker: HTMLElement): void {
  const rect = invoker.getBoundingClientRect();
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const gap = 6;
  let top = rect.bottom + gap;
  if (top + height > window.innerHeight - 8 && rect.top - gap - height > 8) top = rect.top - gap - height;
  top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
  let left = rect.left;
  if (left + width > window.innerWidth - 8) left = Math.max(8, rect.right - width);
  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
}

function popoverInvoker(panel: HTMLElement): HTMLElement | undefined {
  return [...ui.root.querySelectorAll<HTMLElement>(`[popovertarget="${panel.id}"]`)].find(isVisible);
}

function setupPopovers(): void {
  // 键盘打开菜单时把焦点移进去；鼠标或触屏打开时焦点留在正文，手机键盘不会收起
  let byKeyboard = false;
  ui.root.addEventListener(
    'click',
    (event) => {
      if ((event.target as Element).closest('[popovertarget]')) byKeyboard = event.detail === 0;
    },
    true,
  );

  for (const panel of ui.root.querySelectorAll<HTMLElement>('[popover]:not(#notes-slash-menu)')) {
    panel.addEventListener('beforetoggle', (event) => {
      if ((event as ToggleEvent).newState === 'open') {
        panel.style.visibility = 'hidden';
        ui.tip.hidden = true;
      }
    });
    panel.addEventListener('toggle', (event) => {
      const open = (event as ToggleEvent).newState === 'open';
      const target = popoverInvoker(panel);
      target?.setAttribute('aria-expanded', String(open));
      if (!open) return;
      if (target) anchorPopover(panel, target);
      panel.style.visibility = '';
      if (byKeyboard) panel.querySelector<HTMLElement>('button:not([disabled]), [role="tab"]')?.focus({ preventScroll: true });
    });
  }

  window.addEventListener('resize', () => {
    for (const panel of ui.root.querySelectorAll<HTMLElement>('[popover]:not(#notes-slash-menu)')) {
      const target = panel.matches(':popover-open') ? popoverInvoker(panel) : undefined;
      if (target) anchorPopover(panel, target);
    }
    if (state.slash) positionSlash();
  });
}

function closePopover(node: Element): void {
  const panel = node.closest<HTMLElement>('[popover]');
  if (panel?.matches(':popover-open')) panel.hidePopover();
}

/* ---------- 导入导出与打印 ---------- */

async function importFiles(files: File[]): Promise<void> {
  let store = currentStore();
  let count = 0;
  let lastId = '';
  const failed: string[] = [];
  for (const file of files) {
    try {
      const text = await file.text();
      if (/\.json$/i.test(file.name) || file.type === 'application/json') {
        const imported = parseStore(JSON.parse(text));
        count += imported.notes.length;
        store = mergeStores(store, imported);
        lastId = imported.notes[0]?.id ?? lastId;
      } else if (/\.(md|markdown|txt)$/i.test(file.name) || file.type.startsWith('text/')) {
        const note = noteFromMarkdown(text, file.name);
        store = { notes: [note, ...store.notes], deleted: store.deleted };
        count += 1;
        lastId = note.id;
      } else {
        failed.push(file.name);
      }
    } catch {
      failed.push(file.name);
    }
  }
  applyStore(parseStore(store));
  if (lastId && state.notes.some((note) => note.id === lastId)) selectNote(lastId);
  persist();
  if (failed.length) showToast(`已导入 ${count} 篇，${failed.length} 个文件无法识别：${failed.join('、')}`, undefined, 6000);
  else if (count) showToast(`已导入 ${count} 篇记录`);
}

function exportAll(): void {
  const store = parseStore(currentStore());
  download(`codeverse-notes-${formatDate()}.json`, `${JSON.stringify({ version: 1, ...store }, null, 2)}\n`, 'application/json');
  showToast(`已导出 ${store.notes.length} 篇记录`);
}

function downloadMarkdown(): void {
  const note = activeNote();
  if (!note) return;
  download(`${safeFileName(note.title || '无标题')}.md`, noteToMarkdown(note), 'text/markdown;charset=utf-8');
}

function readPublishInput() {
  return {
    title: ui.publishTitle.value,
    description: ui.publishDescription.value,
    slug: normalizeBlogSlug(ui.publishSlug.value),
    tags: parseTags(ui.publishTags.value),
    category: ui.publishCategory.value,
    draft: ui.publishDraft.checked,
    body: ui.body.value,
  };
}

function showPublishError(message: string | null): void {
  ui.publishError.hidden = !message;
  ui.publishError.textContent = message ?? '';
}

function updatePublishFileHint(): void {
  const slug = normalizeBlogSlug(ui.publishSlug.value) || '….md';
  ui.publishFile.textContent = slug.endsWith('.md') ? slug : `${slug}.md`;
}

function publishSubmitLabel(): string {
  return ui.publishForm.dataset.overwrite === '1' ? '覆盖并发布' : '发布';
}

function refreshPublishNote(): void {
  const needToken = !state.token || !state.canPublish;
  ui.publishTokenHelp.hidden = !needToken;
  ui.publishConnect.textContent = state.token ? '更换令牌' : '连接 GitHub';
  if (!state.token) {
    ui.publishNote.textContent = `发布会提交到 ${BLOG_REPO}，随后 GitHub Actions 自动构建上线。当前只连了 Gist 的令牌发不出去，需要同时勾选 public_repo。`;
    return;
  }
  if (!state.canPublish) {
    ui.publishNote.textContent = `已连接${state.login ? ` @${state.login}` : ''}，但这个令牌写不了 ${BLOG_REPO}。${TOKEN_SCOPES_HINT}。`;
    return;
  }
  ui.publishNote.textContent = `将以${state.login ? ` @${state.login}` : '当前账号'} 提交到 ${BLOG_REPO}，GitHub Actions 会在后台构建并部署。访客没有仓库权限，不能发布。`;
}

function openPublishDialog(): void {
  const note = activeNote();
  if (!note || isBlankNote(note)) {
    showToast('先写一点内容再发布');
    return;
  }
  ui.publishTitle.value = note.title.trim() || '无标题';
  ui.publishDescription.value = noteExcerpt(note, 120);
  ui.publishSlug.value = suggestBlogSlug(note.title, note.id);
  ui.publishTags.value = note.tags.join('，');
  ui.publishCategory.value = '';
  ui.publishDraft.checked = false;
  ui.publishForm.dataset.overwrite = '';
  ui.publishSubmit.textContent = '发布';
  refreshPublishNote();
  showPublishError(null);
  updatePublishFileHint();
  ui.publishDialog.showModal();
  ui.publishDescription.focus();
  ui.publishDescription.select();
}

async function publishToBlog(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const input = readPublishInput();
  const error = validateBlogPublish(input);
  if (error) {
    showPublishError(error);
    return;
  }
  if (!state.token) {
    showPublishError('请先连接 GitHub，并使用能写入本站仓库的令牌');
    refreshPublishNote();
    return;
  }

  ui.publishSubmit.disabled = true;
  ui.publishSubmit.textContent = '发布中…';
  showPublishError(null);
  try {
    state.canPublish = await fetchRepoWriteAccess(state.token);
    refreshPublishNote();
    if (!state.canPublish) {
      showPublishError(`当前令牌写不了仓库。${TOKEN_SCOPES_HINT}`);
      return;
    }
    const result = await publishBlogPost(state.token, {
      slug: input.slug,
      title: input.title,
      markdown: noteToBlogMarkdown(input),
      overwrite: ui.publishForm.dataset.overwrite === '1',
    });
    state.canPublish = true;
    ui.publishDialog.close();
    const done = result.updated ? '已更新仓库里的文章' : '已提交到仓库';
    const extra = input.draft ? '草稿不会出现在博客列表。' : 'GitHub Actions 正在后台构建，大约一两分钟后会出现在博客里。';
    showToast(`${done}，${extra}`, { label: '查看进度', run: () => window.open(BLOG_ACTIONS_URL, '_blank', 'noopener,noreferrer') }, 8000);
  } catch (caught) {
    if (caught instanceof NotesRemoteError && caught.code === 'exists') {
      ui.publishForm.dataset.overwrite = '1';
      ui.publishSubmit.textContent = '覆盖并发布';
      showPublishError(`${caught.message}。确认是同一篇再点覆盖。`);
      return;
    }
    showPublishError(caught instanceof NotesRemoteError ? caught.message : '发布失败，请稍后重试');
    if (caught instanceof NotesRemoteError && caught.code === 'auth') {
      void fetchRepoWriteAccess(state.token)
        .then((ok) => {
          state.canPublish = ok;
          refreshPublishNote();
        })
        .catch(() => undefined);
    }
  } finally {
    ui.publishSubmit.disabled = false;
    if (ui.publishDialog.open) ui.publishSubmit.textContent = publishSubmitLabel();
  }
}

function fillPrint(): void {
  const note = activeNote();
  if (!note) return;
  const title = document.createElement('h1');
  title.textContent = note.title.trim() || '无标题';
  const meta = document.createElement('p');
  meta.className = 'notes-print__meta';
  meta.textContent = [formatFullTime(note.updatedAt), note.tags.map((tag) => `#${tag}`).join(' ')].filter(Boolean).join(' · ');
  const article = document.createElement('article');
  article.className = 'prose';
  if (renderFn) {
    article.innerHTML = renderFn(note.body);
    highlightBlocks(article);
  } else {
    const pre = document.createElement('pre');
    pre.textContent = note.body;
    article.append(pre);
  }
  ui.print.replaceChildren(title, meta, article);
}

async function printNote(): Promise<void> {
  await loadRenderer();
  fillPrint();
  window.print();
}

/* ---------- 事件 ---------- */

function onRootClick(event: MouseEvent): void {
  const target = event.target as Element;

  const item = target.closest<HTMLElement>('.notes-item');
  if (item?.dataset.id) {
    selectNote(item.dataset.id);
    return;
  }

  const filterChip = target.closest<HTMLElement>('[data-filter-tag]');
  if (filterChip) {
    const tag = filterChip.dataset.filterTag ?? '';
    state.tag = state.tag === tag ? '' : tag;
    renderList();
    return;
  }

  const removeButton = target.closest<HTMLElement>('[data-remove-tag]');
  if (removeButton?.dataset.removeTag) {
    removeTag(removeButton.dataset.removeTag);
    return;
  }

  const view = target.closest<HTMLElement>('[data-view]');
  if (view?.dataset.view) {
    setMode(view.dataset.view as Mode);
    return;
  }

  const glyphTab = target.closest<HTMLElement>('[data-glyph-tab]');
  if (glyphTab) {
    const tab = glyphTab.dataset.glyphTab;
    for (const button of ui.root.querySelectorAll<HTMLElement>('[data-glyph-tab]')) {
      button.setAttribute('aria-selected', String(button === glyphTab));
    }
    el('notes-glyph-emoji').hidden = tab !== 'emoji';
    el('notes-glyph-symbol').hidden = tab !== 'symbol';
    return;
  }

  const glyph = target.closest<HTMLElement>('[data-glyph]');
  if (glyph?.dataset.glyph) {
    closePopover(glyph);
    if (effectiveMode() === 'preview') setMode(narrow.matches ? 'edit' : 'split');
    insertGlyph(ui.body, glyph.dataset.glyph);
    return;
  }

  const templateButton = target.closest<HTMLElement>('[data-template]');
  if (templateButton) {
    const template = TEMPLATES.find((item) => item.id === templateButton.dataset.template);
    closePopover(templateButton);
    if (template) {
      if (templateButton.dataset.apply) applyTemplate(template);
      else newNote(template);
    }
    return;
  }

  const commandButton = target.closest<HTMLElement>('[data-cmd]');
  if (commandButton?.dataset.cmd) {
    closePopover(commandButton);
    runCommand(commandButton.dataset.cmd);
    return;
  }

  const slashItem = target.closest<HTMLElement>('[data-slash-index]');
  if (slashItem) {
    applySlash(Number(slashItem.dataset.slashIndex));
    return;
  }

  const copyButton = target.closest<HTMLElement>('[data-copy]');
  if (copyButton) {
    const code = copyButton.closest('.notes-code')?.querySelector('pre')?.textContent ?? '';
    void navigator.clipboard?.writeText(code).then(
      () => {
        copyButton.classList.add('is-done');
        copyButton.querySelector('span')!.textContent = '已复制';
        window.setTimeout(() => {
          copyButton.classList.remove('is-done');
          copyButton.querySelector('span')!.textContent = '复制';
        }, 1600);
      },
      () => showToast('复制失败，请手动选择代码'),
    );
    return;
  }

  const actionButton = target.closest<HTMLElement>('[data-action]');
  const action = actionButton?.dataset.action;
  if (!actionButton || !action) return;
  closePopover(actionButton);
  switch (action) {
    case 'new':
      return newNote();
    case 'drawer':
      return openDrawer();
    case 'drawer-close':
      return closeDrawer();
    case 'focus':
      return setFocusMode(!ui.root.classList.contains('is-focus'));
    case 'sync':
      if (ui.publishDialog.open) ui.publishDialog.close();
      return openSyncDialog();
    case 'sync-now':
      state.syncBlocked = false;
      void syncRemote();
      return;
    case 'sync-disconnect':
      return disconnectRemote();
    case 'pin':
      return togglePin();
    case 'publish':
      return openPublishDialog();
    case 'download':
      return downloadMarkdown();
    case 'print':
      void printNote();
      return;
    case 'prefs':
      fillPrefsForm();
      ui.prefsDialog.showModal();
      return;
    case 'help':
      ui.helpDialog.showModal();
      return;
    case 'delete':
      return deleteActive();
    case 'export':
      return exportAll();
    case 'import':
      ui.importInput.click();
      return;
    case 'clear-filter':
      state.query = '';
      state.tag = '';
      ui.query.value = '';
      renderList();
      return;
  }
}

function onGlobalKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  const mod = IS_MAC ? event.metaKey : event.ctrlKey;
  const key = event.key.toLowerCase();

  if (mod && !event.altKey && !event.shiftKey && key === 's') {
    event.preventDefault();
    flushLocal();
    if (state.token) {
      state.syncBlocked = false;
      void syncRemote();
    } else if (state.devSync) {
      void pushDev();
    }
    showToast(state.token ? '已保存，正在同步' : '已保存到这台设备', undefined, 1800);
    return;
  }
  if (mod && (key === '/' || event.code === 'Slash')) {
    event.preventDefault();
    if (!ui.helpDialog.open) ui.helpDialog.showModal();
    return;
  }
  if (mod && event.shiftKey && event.code === 'KeyF') {
    event.preventDefault();
    setFocusMode(!ui.root.classList.contains('is-focus'));
    return;
  }
  if (event.altKey && !mod && !event.shiftKey && ['Digit1', 'Digit2', 'Digit3'].includes(event.code) && activeNote()) {
    event.preventDefault();
    setMode((['edit', 'split', 'preview'] as const)[Number(event.code.slice(-1)) - 1]);
    return;
  }
  if (event.key === '/' && !mod && !event.altKey && !isEditable(event.target) && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    if (narrow.matches) openDrawer();
    ui.query.focus();
    ui.query.select();
    return;
  }
  if (event.key === 'Escape' && !document.querySelector('dialog[open]') && !ui.root.querySelector('[popover]:popover-open')) {
    if (ui.root.classList.contains('is-drawer')) {
      closeDrawer();
      return;
    }
    if (ui.root.classList.contains('is-focus') && !slashOpen()) {
      setFocusMode(false);
    }
  }
}

function onListKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const items = [...ui.list.querySelectorAll<HTMLElement>('.notes-item')];
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (index === -1) return;
  event.preventDefault();
  items[Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
}

function setupDrop(): void {
  let depth = 0;
  const hasFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    depth += 1;
    ui.dropzone.hidden = false;
  });
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) ui.dropzone.hidden = true;
  });
  window.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    ui.dropzone.hidden = true;
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length) void importFiles(files);
  });
}

function bindEvents(): void {
  ui.root.addEventListener('click', onRootClick);
  document.addEventListener('keydown', onGlobalKeydown);
  ui.list.addEventListener('keydown', onListKeydown);

  ui.root.addEventListener('mousedown', (event) => {
    if ((event.target as Element).closest('.notes-toolbar button, [popover] button, .notes-slash, .notes-starter button')) {
      event.preventDefault();
    }
  });

  ui.query.addEventListener('input', () => {
    state.query = ui.query.value;
    renderList();
  });
  ui.query.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && ui.query.value) {
      event.stopPropagation();
      ui.query.value = '';
      state.query = '';
      renderList();
    }
    if (event.key === 'Enter') {
      ui.list.querySelector<HTMLElement>('.notes-item')?.click();
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      ui.list.querySelector<HTMLElement>('.notes-item')?.focus();
    }
  });

  ui.title.addEventListener('input', () => {
    const note = activeNote();
    if (!note) return;
    note.title = ui.title.value;
    touch(note);
    ui.previewTitle.textContent = note.title.trim() || '无标题';
    ui.previewTitle.classList.toggle('is-placeholder', !note.title.trim());
    scheduleList();
    persist();
  });
  ui.title.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Enter' || (event.key === 'ArrowDown' && ui.title.selectionStart === ui.title.value.length)) {
      event.preventDefault();
      if (effectiveMode() === 'preview') return;
      ui.body.focus();
      ui.body.setSelectionRange(0, 0);
    }
  });

  ui.tagInput.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commitTagInput();
    } else if (event.key === 'Backspace' && !ui.tagInput.value) {
      const note = activeNote();
      const last = note?.tags[note.tags.length - 1];
      if (last) removeTag(last);
    }
  });
  ui.tagInput.addEventListener('input', () => {
    if (/[,，\s]/.test(ui.tagInput.value)) commitTagInput();
  });
  ui.tagInput.addEventListener('change', () => {
    if (ui.tagInput.value.trim()) commitTagInput();
  });
  ui.tagInput.addEventListener('blur', () => {
    if (ui.tagInput.value.trim()) commitTagInput();
  });

  ui.body.addEventListener('input', onBodyInput);
  ui.body.addEventListener('keydown', onBodyKeydown);
  ui.body.addEventListener('paste', onBodyPaste);
  ui.body.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (document.activeElement !== ui.body) closeSlash();
    }, 120);
    renderSelection();
  });
  ui.body.addEventListener('click', () => {
    if (state.slash) updateSlash();
  });
  ui.body.addEventListener('keyup', (event) => {
    if (state.slash && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) updateSlash();
  });
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === ui.body) renderSelection();
  });

  ui.editPane.addEventListener('mousedown', (event) => {
    const target = event.target as Element;
    if (event.button !== 0 || !activeNote()) return;
    if (target !== ui.editPane && !target.matches('.notes-sheet')) return;
    if (event.clientY < ui.body.getBoundingClientRect().top) return;
    event.preventDefault();
    ui.body.focus({ preventScroll: true });
    const end = ui.body.value.length;
    ui.body.setSelectionRange(end, end);
  });

  ui.editPane.addEventListener(
    'scroll',
    () => {
      syncPreviewScroll();
      if (state.slash) positionSlash();
    },
    { passive: true },
  );

  ui.preview.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.matches('input[data-task]')) toggleTaskFromPreview(input);
  });

  ui.importInput.addEventListener('change', () => {
    const files = [...(ui.importInput.files ?? [])];
    ui.importInput.value = '';
    if (files.length) void importFiles(files);
  });

  ui.toastAction.addEventListener('click', () => {
    const run = toastHandler;
    hideToast();
    run?.();
  });

  ui.syncForm.addEventListener('submit', (event) => void connectRemote(event));
  ui.token.addEventListener('input', () => {
    ui.syncError.hidden = true;
  });
  const tokenHelpLink = ui.publishTokenHelp.querySelector('a');
  if (tokenHelpLink) tokenHelpLink.href = TOKEN_CREATE_URL;
  ui.publishForm.addEventListener('submit', (event) => void publishToBlog(event));
  ui.publishSlug.addEventListener('input', () => {
    ui.publishForm.dataset.overwrite = '';
    updatePublishFileHint();
    if (!ui.publishError.hidden) showPublishError(null);
  });
  for (const field of [ui.publishTitle, ui.publishDescription, ui.publishTags, ui.publishCategory]) {
    field.addEventListener('input', () => {
      if (!ui.publishError.hidden) showPublishError(null);
    });
  }
  ui.prefsForm.addEventListener('input', readPrefsForm);
  ui.prefsForm.addEventListener('submit', (event) => event.preventDefault());

  for (const dialog of ui.root.querySelectorAll<HTMLDialogElement>('dialog')) {
    let pressedBackdrop = false;
    dialog.addEventListener('mousedown', (event) => {
      pressedBackdrop = event.target === dialog;
    });
    dialog.addEventListener('click', (event) => {
      if ((event.target === dialog && pressedBackdrop) || (event.target as Element).closest('[data-close]')) dialog.close();
      pressedBackdrop = false;
    });
  }

  narrow.addEventListener('change', () => {
    if (!narrow.matches) closeDrawer();
    applyMode();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushLocal();
      flushRemoteOnHide();
    } else if (state.token && !state.syncBlocked && Date.now() - state.lastPullAt > PULL_GAP) {
      void syncRemote();
    }
  });
  window.addEventListener('pagehide', () => {
    flushLocal();
    flushRemoteOnHide();
  });
  window.addEventListener('online', () => {
    if (state.token && state.sync === 'offline') void syncRemote();
  });
  window.addEventListener('offline', () => {
    if (state.token) {
      state.syncError = '网络已断开，恢复后会自动同步';
      setSync('offline');
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    const merged = mergeStores(currentStore(), loadLocalStore());
    if (serializeStore(merged) !== serializeStore(currentStore())) applyStore(merged);
  });
  window.addEventListener('beforeprint', fillPrint);

  window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (!listTimer) renderList();
    renderSaved();
  }, 60_000);
}

/* ---------- 启动 ---------- */

async function boot(): Promise<void> {
  const local = loadLocalStore();
  state.notes = local.notes;
  state.deleted = local.deleted;
  state.token = loadToken();
  state.login = loadLogin();

  let stored = '';
  try {
    stored = localStorage.getItem(ACTIVE_KEY) ?? '';
  } catch {
    stored = '';
  }
  state.activeId = state.notes.some((note) => note.id === stored) ? stored : (state.notes[0]?.id ?? '');

  renderList();
  fillEditor();
  applyMode();
  revealActiveItem();
  ui.root.dataset.ready = '';

  if (state.token) {
    void fetchRepoWriteAccess(state.token)
      .then((ok) => {
        state.canPublish = ok;
      })
      .catch(() => {
        state.canPublish = false;
      });
    if (!navigator.onLine) {
      state.syncError = '网络已断开，恢复后会自动同步';
      setSync('offline');
      return;
    }
    await syncRemote();
    return;
  }

  setSync('local');
  const dev = await loadDev();
  if (!dev) return;
  state.devSync = true;
  const merged = mergeStores(currentStore(), dev);
  if (serializeStore(merged) !== serializeStore(currentStore())) applyStore(merged);
  if (serializeStore(merged) !== serializeStore(dev)) void pushDev();
  setSync('dev');
}

export function initNotesApp(): void {
  const root = document.getElementById('notes-app');
  if (!root) return;
  ui = queryUi(root);
  state.prefs = loadPrefs();
  applyPrefs();
  for (const node of root.querySelectorAll<HTMLElement>('kbd[data-keys]')) {
    node.textContent = formatKeys(node.dataset.keys ?? '');
  }
  setupPopovers();
  setupTips();
  setupDrop();
  bindEvents();
  void boot();
  // 渲染器较大，空闲时预先加载，第一次切到预览不用等
  const idle = window.requestIdleCallback as typeof window.requestIdleCallback | undefined;
  if (idle) idle.call(window, () => void loadRenderer(), { timeout: 3000 });
  else window.setTimeout(() => void loadRenderer(), 1200);
}
