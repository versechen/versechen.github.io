import fs from 'node:fs';
import path from 'node:path';

const RELATIVE_FILE = 'data/local-notes.json';
const BLOG_DIR = 'src/content/blog';
const MAX_BYTES = 2_000_000;
const BLOG_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 200;
const MAX_BODY = 100_000;
const MAX_TAGS = 12;
const MAX_TAG = 40;
const MAX_CATEGORY = 40;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        reject(new Error('记录内容过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function isLoopback(req) {
  const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1';
}

function yamlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildBlogMarkdown(input) {
  const tags = [...new Set(input.tags)];
  const now = new Date();
  const pubDate = `${MONTHS[now.getMonth()]} ${now.getDate()} ${now.getFullYear()}`;
  const lines = [
    '---',
    `title: ${yamlQuote(input.title)}`,
    `description: ${yamlQuote(input.description)}`,
    `pubDate: ${yamlQuote(pubDate)}`,
    `tags: [${tags.map((tag) => yamlQuote(tag)).join(', ')}]`,
  ];
  if (input.category) lines.push(`category: ${yamlQuote(input.category)}`);
  if (input.draft) lines.push('draft: true');
  lines.push('---', '', input.body, '');
  return `${lines.join('\n')}\n`;
}

function parsePublish(raw) {
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('发布内容格式不正确');
  const title = String(data.title ?? '').trim();
  const description = String(data.description ?? '').trim().replace(/\s+/g, ' ');
  const slug = String(data.slug ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const category = String(data.category ?? '').trim();
  const body = String(data.body ?? '').replace(/\r\n/g, '\n').trim();
  const tags = (Array.isArray(data.tags) ? data.tags : String(data.tags ?? '').split(/[,，]/))
    .map((tag) => String(tag).trim())
    .filter(Boolean);
  if (!title) throw new Error('请填写标题');
  if (title.length > MAX_TITLE) throw new Error(`标题不能超过 ${MAX_TITLE} 字`);
  if (!description) throw new Error('请填写简介，发布后会显示在博客列表里');
  if (description.length > MAX_DESCRIPTION) throw new Error(`简介不能超过 ${MAX_DESCRIPTION} 字`);
  if (!slug || !BLOG_SLUG.test(slug)) throw new Error('文件名只能用小写字母、数字和连字符');
  if (category.length > MAX_CATEGORY) throw new Error(`分类不能超过 ${MAX_CATEGORY} 字`);
  if (tags.length > MAX_TAGS) throw new Error(`每篇最多 ${MAX_TAGS} 个标签`);
  if (tags.some((tag) => tag.length > MAX_TAG)) throw new Error(`单个标签不能超过 ${MAX_TAG} 字`);
  if (!body) throw new Error('正文是空的，写一点再发布');
  if (body.length > MAX_BODY) throw new Error(`正文不能超过 ${MAX_BODY} 字`);
  return {
    title,
    description,
    slug,
    category,
    body,
    tags,
    draft: Boolean(data.draft),
    overwrite: Boolean(data.overwrite),
  };
}

/**
 * 仅在 astro dev 中挂载。静态构建不会执行 configureServer，
 * 线上站点继续使用浏览器本地草稿。
 */
export function notesDevPlugin() {
  return {
    name: 'codeverse-notes',
    configureServer(server) {
      const file = path.resolve(server.config.root, RELATIVE_FILE);

      server.middlewares.use('/api/notes', async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (req.method === 'POST' && (url === '/publish' || url === '/api/notes/publish')) {
          if (!isLoopback(req)) {
            sendJson(res, 403, { error: '只能在本机写入博客文章，避免外人直接发布' });
            return;
          }
          try {
            const input = parsePublish(await readBody(req));
            const dir = path.resolve(server.config.root, BLOG_DIR);
            const target = path.resolve(dir, `${input.slug}.md`);
            if (path.dirname(target) !== dir) {
              sendJson(res, 400, { error: '文件名不合法' });
              return;
            }
            if (fs.existsSync(target) && !input.overwrite) {
              sendJson(res, 409, { error: `src/content/blog/${input.slug}.md 已存在`, exists: true, file: `${input.slug}.md` });
              return;
            }
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(target, buildBlogMarkdown(input));
            sendJson(res, 200, { ok: true, file: `${input.slug}.md`, path: `${BLOG_DIR}/${input.slug}.md`, draft: input.draft });
          } catch (error) {
            sendJson(res, 400, { error: error instanceof Error ? error.message : '发布失败' });
          }
          return;
        }

        if (req.method === 'GET') {
          try {
            const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{"notes":[],"deleted":[]}';
            const store = JSON.parse(raw);
            sendJson(res, 200, store && typeof store === 'object' ? store : { notes: [], deleted: [] });
          } catch {
            sendJson(res, 500, { error: '读取本机记录失败' });
          }
          return;
        }

        if (req.method === 'PUT') {
          try {
            const raw = await readBody(req);
            const store = JSON.parse(raw);
            // 兼容早期只存笔记数组的格式
            if (!Array.isArray(store) && !Array.isArray(store?.notes)) {
              sendJson(res, 400, { error: '记录格式不正确' });
              return;
            }
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`);
            sendJson(res, 200, { ok: true });
          } catch {
            sendJson(res, 400, { error: '保存本机记录失败' });
          }
          return;
        }

        next();
      });
    },
  };
}
