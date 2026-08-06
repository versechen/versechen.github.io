/**
 * 判断一段 Markdown 原文是否可能包含 remark-math 会识别的公式。
 *
 * 用于决定是否给页面加载 KaTeX 样式表。这里刻意偏向"宁可多判"：
 * 误判只是多下载一份样式，漏判则会让公式失去排版。
 */
export function hasMath(body: string | undefined): boolean {
  if (!body) return false;
  // 块级 $$...$$，以及不以空白紧邻定界符的行内 $...$
  return /\$\$[\s\S]*?\$\$/.test(body) || /\$[^\s$][^\n$]*\$/.test(body);
}
