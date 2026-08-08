/** 项目状态展示文案 */
export const PROJECT_STATUS_LABEL: Record<string, string> = {
  active: '已上线',
  wip: '开发中',
  archived: '已归档',
};

/**
 * project-docs 集合的 id 形如 `codeverse/getting-started`。
 * 拆出项目 slug 与文档相对路径（不含扩展名）。
 */
export function parseProjectDocId(id: string): { project: string; path: string } {
  const slash = id.indexOf('/');
  if (slash === -1) return { project: id, path: 'index' };
  return {
    project: id.slice(0, slash),
    path: id.slice(slash + 1) || 'index',
  };
}

/** 文档站 URL：index 落在目录根路径 */
export function projectDocHref(project: string, path: string): string {
  if (!path || path === 'index') return `/projects/${project}/docs/`;
  return `/projects/${project}/docs/${path}/`;
}
