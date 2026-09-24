import type { HighlighterCore, LanguageInput } from 'shiki/core';

const GRAMMARS: Record<string, LanguageInput> = {
  astro: () => import('shiki/langs/astro.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  dart: () => import('shiki/langs/dart.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  nginx: () => import('shiki/langs/nginx.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
};

const ALIASES: Record<string, string> = {
  'c++': 'cpp',
  cjs: 'javascript',
  console: 'bash',
  cs: 'csharp',
  docker: 'dockerfile',
  golang: 'go',
  js: 'javascript',
  json5: 'json',
  jsonc: 'json',
  kt: 'kotlin',
  md: 'markdown',
  mjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  svg: 'xml',
  ts: 'typescript',
  yml: 'yaml',
  zsh: 'bash',
};

const CACHE_LIMIT = 80;

let highlighter: HighlighterCore | undefined;
let loadingCore: Promise<HighlighterCore> | undefined;
const loaded = new Set<string>();
const loading = new Map<string, Promise<void>>();
const cache = new Map<string, string>();

function grammarName(lang: string): string | undefined {
  const key = lang.trim().toLowerCase();
  const name = ALIASES[key] ?? key;
  return name in GRAMMARS ? name : undefined;
}

function loadCore(): Promise<HighlighterCore> {
  loadingCore ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')])
    .then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
      createHighlighterCore({
        themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
        langs: [],
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      }),
    )
    .then((core) => {
      highlighter = core;
      return core;
    })
    .catch((error: unknown) => {
      loadingCore = undefined;
      throw error;
    });
  return loadingCore;
}

function loadGrammar(name: string): Promise<void> {
  let task = loading.get(name);
  if (!task) {
    task = loadCore()
      .then((core) => core.loadLanguage(GRAMMARS[name]))
      .then(() => {
        loaded.add(name);
      })
      .catch(() => {
        loading.delete(name);
      });
    loading.set(name, task);
  }
  return task;
}

function highlighted(name: string, code: string): string | undefined {
  const key = `${name}\u0000${code}`;
  const hit = cache.get(key);
  if (hit !== undefined || !highlighter || !loaded.has(name)) return hit;
  let html: string;
  try {
    html = highlighter.codeToHtml(code, {
      lang: name,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    });
  } catch {
    return undefined;
  }
  cache.set(key, html);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return html;
}

function apply(pre: HTMLElement, html: string): void {
  const template = document.createElement('template');
  template.innerHTML = html;
  const shell = template.content.querySelector('pre');
  const source = shell?.querySelector('code');
  const target = pre.querySelector('code');
  if (!shell || !source || !target) return;
  target.innerHTML = source.innerHTML;
  pre.setAttribute('style', shell.getAttribute('style') ?? '');
  pre.classList.add('astro-code');
}

/** 给预览里的代码块着色；语法文件第一次用到时才下载，同样的代码直接复用上次的结果。 */
export function highlightCode(root: ParentNode): void {
  for (const pre of root.querySelectorAll<HTMLElement>('pre[data-lang]')) {
    const name = grammarName(pre.dataset.lang ?? '');
    const code = pre.querySelector('code')?.textContent?.replace(/\n$/, '');
    if (!name || !code) continue;
    const html = highlighted(name, code);
    if (html) {
      apply(pre, html);
      continue;
    }
    void loadGrammar(name).then(() => {
      const later = highlighted(name, code);
      if (later && pre.isConnected) apply(pre, later);
    });
  }
}
