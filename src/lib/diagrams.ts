type DiagramKind = 'mermaid' | 'plantuml';

type DiagramNode = {
  type: string;
  lang?: string | null;
  value?: string;
  children?: DiagramNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
    hChildren?: unknown[];
  };
};

const PLANTUML_LANGS = new Set(['plantuml', 'puml', 'uml', 'startuml']);

export function hasMermaid(source: string | undefined): boolean {
  if (!source) return false;
  return /```[^\n]*\bmermaid\b/i.test(source);
}

export function hasPlantuml(source: string | undefined): boolean {
  if (!source) return false;
  return /```[^\n]*\b(?:plantuml|puml|uml|startuml)\b/i.test(source) || /@startuml\b/i.test(source);
}

function diagramKind(lang: string | null | undefined, value: string | undefined): DiagramKind | null {
  const name = (lang ?? '').trim().toLowerCase();
  if (name === 'mermaid') return 'mermaid';
  if (PLANTUML_LANGS.has(name)) return 'plantuml';
  if (value && /^\s*@startuml\b/i.test(value)) return 'plantuml';
  return null;
}

function normalizePlantuml(source: string): string {
  const text = source.replace(/\r\n/g, '\n').trim();
  if (/@startuml\b/i.test(text)) return text;
  return `@startuml\n${text}\n@enduml`;
}

/** PlantUML 的 ~h 十六进制编码，不依赖压缩库，适合浏览器和构建期共用。 */
export function plantumlSvgUrl(source: string): string {
  const bytes = new TextEncoder().encode(normalizePlantuml(source));
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `https://www.plantuml.com/plantuml/svg/~h${hex}`;
}

function mermaidNode(source: string): DiagramNode {
  return {
    type: 'mermaidDiagram',
    data: {
      hName: 'pre',
      hProperties: { className: ['mermaid'] },
    },
    children: [{ type: 'text', value: source.replace(/\r\n/g, '\n').trim() }],
  };
}

function plantumlNode(source: string): DiagramNode {
  return {
    type: 'plantumlDiagram',
    data: {
      hName: 'figure',
      hProperties: { className: ['diagram', 'diagram-plantuml'] },
      hChildren: [
        {
          type: 'element',
          tagName: 'img',
          properties: {
            src: plantumlSvgUrl(source),
            alt: 'PlantUML 图',
            loading: 'lazy',
            decoding: 'async',
          },
          children: [],
        },
      ],
    },
  };
}

export function rewriteDiagramCode(node: DiagramNode): void {
  const children = node.children;
  if (!children) return;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.type === 'code') {
      const kind = diagramKind(child.lang, child.value);
      if (kind === 'mermaid') {
        children[index] = mermaidNode(child.value ?? '');
        continue;
      }
      if (kind === 'plantuml') {
        children[index] = plantumlNode(child.value ?? '');
        continue;
      }
    }
    rewriteDiagramCode(child);
  }
}

/** 把 mermaid / PlantUML 代码块转成可渲染节点，博客与记录预览共用。 */
export function remarkDiagrams() {
  return (tree: DiagramNode) => {
    rewriteDiagramCode(tree);
  };
}
