import fs from 'node:fs';
import path from 'node:path';

const RELATIVE_FILE = 'data/local-notes.json';
const MAX_BYTES = 2_000_000;

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
