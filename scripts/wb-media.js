/**
 * 本地预览时给视频 / 大图「正常」的 HTTP 行为。
 *
 * 为什么需要它：
 *   hexo-server 是把文件整段 pipe 出去的，响应里既没有 Content-Length，
 *   也不认 Range 请求 —— 浏览器因此不能拖动进度、不能分片缓冲，
 *   循环播放时每次都要从头再要一遍，看起来就是「视频一顿一顿」。
 *   这里在路由中间件之前拦下 /media/*，按标准静态文件的方式返回
 *   （Content-Length / Accept-Ranges: bytes / 206 Partial Content）。
 *
 * 只影响本地预览；线上（Netlify / Vercel）本来就支持 Range，不受影响。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
};

function serveFile(req, res, abs, stat) {
  const total = stat.size;
  const ext = path.extname(abs).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';

  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.setHeader('Last-Modified', stat.mtime.toUTCString());

  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : total - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= total) end = total - 1;
      if (start > end || start >= total) {
        res.statusCode = 416;
        res.setHeader('Content-Range', 'bytes */' + total);
        return res.end();
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + total);
      res.setHeader('Content-Length', end - start + 1);
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(abs, { start: start, end: end }).pipe(res);
    }
  }

  res.statusCode = 200;
  res.setHeader('Content-Length', total);
  if (req.method === 'HEAD') return res.end();
  return fs.createReadStream(abs).pipe(res);
}

// priority 1：排在 hexo-server 自带的 route / static 之前（它们默认 10）
hexo.extend.filter.register(
  'server_middleware',
  function (app) {
    const base = path.join(hexo.base_dir, 'source');
    const root = path.join(base, 'media');

    app.use(function (req, res, next) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      let url = '';
      try {
        url = decodeURIComponent(String(req.url || '').split('?')[0]);
      } catch (e) {
        return next();
      }
      if (url.indexOf('/media/') !== 0) return next();

      const abs = path.resolve(base, '.' + url);
      // 防目录穿越：只允许 source/media 里面的文件
      if (abs !== root && abs.indexOf(root + path.sep) !== 0) return next();

      let stat;
      try {
        stat = fs.statSync(abs);
      } catch (e) {
        return next();
      }
      if (!stat.isFile()) return next();

      serveFile(req, res, abs, stat);
    });
  },
  1
);
