let theme = '';
let watching = false;

const MERMAID_ESM = 'https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs';

type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  run(options: { nodes: HTMLElement[] }): Promise<void>;
};

function currentTheme(): 'dark' | 'neutral' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'neutral';
}

function sourceOf(node: HTMLElement): string {
  return (node.dataset.source || node.textContent || '').trim();
}

async function loadMermaid(): Promise<MermaidApi> {
  const mod = (await import(/* @vite-ignore */ MERMAID_ESM)) as { default?: MermaidApi } & MermaidApi;
  return mod.default ?? mod;
}

export async function renderMermaid(root: ParentNode = document): Promise<void> {
  const nodes = [...root.querySelectorAll<HTMLElement>('pre.mermaid')].filter((node) => {
    const source = sourceOf(node);
    if (!source) return false;
    if (!node.dataset.source) node.dataset.source = source;
    return !node.querySelector('svg');
  });
  if (!nodes.length) return;

  const mermaid = await loadMermaid();
  const next = currentTheme();
  if (theme !== next) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: next,
    });
    theme = next;
  }

  try {
    await mermaid.run({ nodes });
  } catch (error) {
    console.warn('Mermaid 渲染失败', error);
  }
}

function resetMermaid(node: HTMLElement): void {
  const source = sourceOf(node);
  if (!source) return;
  node.dataset.source = source;
  node.removeAttribute('data-processed');
  node.replaceChildren(document.createTextNode(source));
}

export function bootMermaid(): void {
  void renderMermaid();
  if (watching) return;
  watching = true;
  const observer = new MutationObserver(() => {
    theme = '';
    for (const node of document.querySelectorAll<HTMLElement>('pre.mermaid')) resetMermaid(node);
    void renderMermaid();
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}
