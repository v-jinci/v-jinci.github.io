/**
 * 本地站点编辑器（只在本机运行）
 *
 * 访问：双击「2-打开写作后台.bat」后打开 http://localhost:4000/site
 *
 * 能改的东西分了 7 类：
 *   1 基本信息：标题 / 作者 / 副标题 / 描述 / 关键词 / 联系邮箱 / 起始年份
 *   2 外观图片：首页大图 / 头像 / 浏览器标签小图标 / 简介 / 公告 / 首页标语 + 几个开关
 *   3 导航菜单：增删、改名字、换图标、调顺序
 *   4 下载区：上传文件或填外链，自动算大小
 *   5 页面密码：给任意一个导航页单独加密码（可加可不加，随时改）
 *   6 评论区：开 / 关，服务地址，访客是否要登录
 *   7 留言管理：审核制留言（没有后端时用）
 *
 * 写文件的原则：能按行替换的就只动那几行，注释和别的配置原样保留；
 * 只有 _data 下的数据文件是整份重写（结构简单，手写序列化）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = { register };

function register(hexo, opts) {
  const options = opts || {};
  hexo.extend.filter.register('server_middleware', (app) => {
    app.use('/site', (req, res) => handle(hexo, req, res, options));
  });
}

/* ------------------------------ 工具 ------------------------------ */

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function readYaml(file, fallback) {
  try {
    const yaml = require('js-yaml');
    return yaml.load(readText(file)) || fallback || {};
  } catch (e) {
    return fallback || {};
  }
}

function fmtScalar(v) {
  const s = String(v == null ? '' : v);
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  if (s === 'true' || s === 'false') return s;
  if (s === '') return "''";
  const needsQuote = /^\s|\s$/.test(s) || /[:#\[\]{},&*!|>'"%@`]/.test(s);
  if (!needsQuote) return s;
  if (s.indexOf("'") === -1) return "'" + s + "'";
  if (s.indexOf('"') === -1) return '"' + s + '"';
  return "'" + s.replace(/'/g, "''") + "'";
}

function findBlock(lines, names) {
  let start = 0;
  let end = lines.length;
  let indent = -1;
  for (let n = 0; n < names.length; n++) {
    const name = names[n];
    let hit = -1;
    let hitIndent = -1;
    for (let i = start; i < end; i++) {
      const m = lines[i].match(/^(\s*)([^\s:#][^:]*):(.*)$/);
      if (!m) continue;
      const ind = m[1].length;
      if (indent >= 0 && ind <= indent) break;
      if (m[2].trim() !== name) continue;
      hit = i;
      hitIndent = ind;
      break;
    }
    if (hit < 0) return null;
    indent = hitIndent;
    start = hit + 1;
    let e = start;
    for (; e < end; e++) {
      const line = lines[e];
      if (!line.trim() || /^\s*#/.test(line)) continue;
      if (line.match(/^(\s*)/)[1].length <= indent) break;
    }
    end = e;
  }
  return { indent, start, end };
}

function setScalar(raw, keyPath, value) {
  const lines = raw.split(/\r?\n/);
  const parent = keyPath.slice(0, -1);
  const key = keyPath[keyPath.length - 1];
  const blk = parent.length ? findBlock(lines, parent) : { indent: -1, start: 0, end: lines.length };
  if (!blk) return null;
  const want = parent.length ? blk.indent + 2 : 0;
  for (let i = blk.start; i < blk.end; i++) {
    const m = lines[i].match(/^(\s*)([^\s:#][^:]*):(.*)$/);
    if (m && m[2].trim() === key && m[1].length === want) {
      lines[i] = m[1] + key + ': ' + fmtScalar(value);
      return lines.join('\n');
    }
  }
  return null;
}

function setList(raw, keyPath, items) {
  const lines = raw.split(/\r?\n/);
  const blk = findBlock(lines, keyPath);
  if (!blk) return null;
  const itemIndent = ' '.repeat(blk.indent + 2);
  const next = items.filter((s) => String(s).trim() !== '').map((s) => itemIndent + '- ' + fmtScalar(s));
  let end = blk.end;
  while (end > blk.start && (!lines[end - 1].trim() || /^\s*#/.test(lines[end - 1]))) end--;
  return lines.slice(0, blk.start).concat(next, lines.slice(end)).join('\n');
}

/** 整块替换一个映射（menu / social），pairs: [[key, rawValue], ...] */
function setMapRaw(raw, keyPath, pairs) {
  const lines = raw.split(/\r?\n/);
  const blk = findBlock(lines, keyPath);
  if (!blk) return null;
  const itemIndent = ' '.repeat(blk.indent + 2);
  const next = pairs
    .filter((p) => p && String(p[0]).trim() && String(p[1]).trim())
    .map((p) => itemIndent + String(p[0]).trim() + ': ' + String(p[1]).trim());
  let end = blk.end;
  while (end > blk.start && (!lines[end - 1].trim() || /^\s*#/.test(lines[end - 1]))) end--;
  return lines.slice(0, blk.start).concat(next, lines.slice(end)).join('\n');
}

function writeIfChanged(file, raw, next, touched, label) {
  if (next == null || next === raw) return;
  if (raw.indexOf('\r\n') !== -1) next = next.replace(/\r?\n/g, '\r\n');
  fs.writeFileSync(file, next, 'utf8');
  touched.push(label);
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

function safeName(name, fallbackExt) {
  let n = String(name || '').split(/[\\/]/).pop() || '';
  n = n.replace(/[\\/:*?"<>|\r\n\t]+/g, '-').replace(/^[.\s]+/, '').trim();
  if (!n) n = 'file-' + Date.now() + (fallbackExt || '');
  return n.slice(0, 80);
}

/* ------------------------------ 数据文件 ------------------------------ */

const F_SITE_DATA = ['source', '_data', 'site.yml'];
const F_DOWNLOADS = ['source', '_data', 'downloads.yml'];
const F_COMMENTS = ['source', '_data', 'comments.yml'];

function loadSiteData(base) {
  const d = readYaml(path.join(base, ...F_SITE_DATA), {});
  return { mail: d.mail || '', sections: d.sections || {} };
}

function dumpSiteData(d) {
  const out = ['# 由 http://localhost:4000/site 后台维护，一般不用手改', '', 'mail: ' + JSON.stringify(String(d.mail || ''))];
  out.push('sections:');
  const keys = Object.keys(d.sections || {});
  if (!keys.length) out.push('  {}');
  keys.forEach((k) => {
    const v = String(d.sections[k] || '');
    out.push('  ' + k + ': ' + (v ? JSON.stringify(v) : "''"));
  });
  return out.join('\n') + '\n';
}

function loadDownloads(base) {
  const d = readYaml(path.join(base, ...F_DOWNLOADS), []);
  return Array.isArray(d) ? d : [];
}

function dumpDownloads(list) {
  const out = [
    '# 下载区清单：在 http://localhost:4000/site 的「下载区」里增删改',
    '#',
    '# file: /files/xxx.zip      -> 文件放在 source/files/ 里，跟着仓库一起发布',
    '# url:  https://...          -> 外部链接（网盘等），不占仓库体积',
  ];
  (Array.isArray(list) ? list : []).forEach((x) => {
    if (!x || !String(x.name || '').trim()) return;
    out.push('- name: ' + JSON.stringify(String(x.name).trim()));
    if (String(x.desc || '').trim()) out.push('  desc: ' + JSON.stringify(String(x.desc).trim()));
    out.push('  file: ' + JSON.stringify(String(x.file || '').trim()));
    out.push('  url: ' + JSON.stringify(String(x.url || '').trim()));
    out.push('  size: ' + JSON.stringify(String(x.size || '').trim()));
    out.push('  date: ' + JSON.stringify(String(x.date || '').trim()));
    if (x.hidden) out.push('  hidden: true');
  });
  return out.join('\n') + '\n';
}

function loadComments(base) {
  const list = readYaml(path.join(base, ...F_COMMENTS), []);
  return Array.isArray(list) ? list : [];
}

function dumpComments(list) {
  const out = ['# 留言数据：在 http://localhost:4000/site 的「留言管理」里改，一般不用手写', '# hidden: true 是不显示，删掉这一行就是显示'];
  (Array.isArray(list) ? list : []).forEach((c) => {
    if (!c || !String(c.name || '').trim() || !String(c.content || '').trim()) return;
    out.push('- name: ' + JSON.stringify(String(c.name).trim()));
    out.push('  date: ' + JSON.stringify(String(c.date || '').trim()));
    out.push('  content: ' + JSON.stringify(String(c.content)));
    if (String(c.reply || '').trim()) out.push('  reply: ' + JSON.stringify(String(c.reply).trim()));
    if (c.hidden) out.push('  hidden: true');
  });
  return out.join('\n') + '\n';
}

function writeWhole(base, parts, text, touched, label) {
  const file = path.join(base, ...parts);
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    raw = '';
  }
  if (raw === text) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  touched.push(label);
}

/* ------------------------------ 图片上传 ------------------------------ */

const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/avif': '.avif',
};

function saveDataUrl(base, dataUrl, suggestName) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const ext = MIME_EXT[m[1].toLowerCase()];
  if (!ext) return null;
  let name = String(suggestName || '').replace(/\.[^.]+$/, '');
  name = name
    .replace(/[\u4e00-\u9fa5]+/g, '')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .replace(/^[.-]+|[-]+$/g, '')
    .slice(0, 40);
  if (!name) name = 'pic-' + Date.now();
  const fileName = name + ext;
  const dir = path.join(base, 'source', 'img');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), Buffer.from(m[2], 'base64'));
  return '/img/' + fileName;
}

/* ------------------------------ 读取当前值 ------------------------------ */

const PAGE_SECTIONS = [
  { key: 'about', name: '关于', url: '/about/' },
  { key: 'downloads', name: '下载区', url: '/downloads/' },
  { key: 'messageBoard', name: '留言板', url: '/messageBoard/' },
  { key: 'link', name: '友链', url: '/link/' },
  { key: 'history', name: '编年史', url: '/history/' },
  { key: 'archives', name: '归档', url: '/archives/' },
  { key: 'tags', name: '标签', url: '/tags/' },
  { key: 'categories', name: '分类', url: '/categories/' },
];

function loadCurrent(base) {
  const siteFile = path.join(base, '_config.yml');
  const themeFile = path.join(base, '_config.butterfly.yml');
  const themeDefault = path.join(base, 'node_modules', 'hexo-theme-butterfly', '_config.yml');
  const site = readYaml(siteFile, {});
  const mine = readYaml(themeFile, {});
  const def = fs.existsSync(themeDefault) ? readYaml(themeDefault, {}) : {};
  const theme = Object.assign({}, def, mine);
  ['avatar', 'footer', 'aside', 'subtitle', 'darkmode', 'toc', 'index_post_content', 'comments', 'waline'].forEach((k) => {
    theme[k] = Object.assign({}, def[k] || {}, mine[k] || {});
  });
  theme.aside.card_author = Object.assign({}, (def.aside || {}).card_author || {}, (mine.aside || {}).card_author || {});
  theme.aside.card_announcement = Object.assign({}, (def.aside || {}).card_announcement || {}, (mine.aside || {}).card_announcement || {});
  theme.footer.owner = Object.assign({}, (def.footer || {}).owner || {}, (mine.footer || {}).owner || {});
  theme.subtitle.sub = (mine.subtitle && mine.subtitle.sub) || (def.subtitle && def.subtitle.sub) || [];
  theme.waline.option = Object.assign({}, (def.waline || {}).option || {}, (mine.waline || {}).option || {});
  const menuRaw = mine.menu || def.menu || {};
  const nav = Object.keys(menuRaw).map((name) => {
    const v = String(menuRaw[name] || '');
    const idx = v.indexOf('||');
    return { name, path: (idx === -1 ? v : v.slice(0, idx)).trim(), icon: idx === -1 ? '' : v.slice(idx + 2).trim() };
  });
  return {
    site,
    theme,
    nav,
    social: mine.social || {},
    comments: loadComments(base),
    siteData: loadSiteData(base),
    downloads: loadDownloads(base),
    sections: PAGE_SECTIONS,
  };
}

/* ------------------------------ 请求处理 ------------------------------ */

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBuffer(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > (limit || 12 * 1024 * 1024)) {
        reject(new Error('文件太大，超出上限'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readBody(req, limit) {
  return readBuffer(req, limit || 14 * 1024 * 1024).then((b) => b.toString('utf8'));
}

async function handle(hexo, req, res, options) {
  const base = hexo.base_dir;
  const url = (req.url || '/').split('?')[0];
  try {
    if (req.method === 'GET' && (url === '/' || url === '' || url === '/index.html')) {
      const cur = loadCurrent(base);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(renderPage(cur));
      return;
    }

    // 下载区文件上传：原始二进制，避免 base64 膨胀
    if (req.method === 'POST' && url === '/file') {
      const q = new URL(req.url, 'http://localhost').searchParams;
      const name = safeName(q.get('name'));
      const buf = await readBuffer(req, 90 * 1024 * 1024);
      if (!buf.length) throw new Error('文件是空的');
      const dir = path.join(base, 'source', 'files');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), buf);
      sendJson(res, 200, { ok: true, path: '/files/' + name, size: buf.length });
      return;
    }

    if (req.method === 'POST' && url === '/save') {
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}');
      const touched = [];
      const siteFile = path.join(base, '_config.yml');
      const themeFile = path.join(base, '_config.butterfly.yml');

      /* --- 图片先落地 --- */
      const pick = (fileKey, pathKey, label) => {
        if (data[fileKey] && data[fileKey].dataUrl) {
          const p = saveDataUrl(base, data[fileKey].dataUrl, data[fileKey].name || label);
          if (!p) throw new Error(label + '格式不支持（png / jpg / webp / gif / svg / ico）');
          return p;
        }
        return data[pathKey];
      };
      const avatarPath = pick('avatarFile', 'avatarPath', '头像');
      const bannerPath = pick('bannerFile', 'bannerPath', '大图');
      const faviconPath = pick('faviconFile', 'faviconPath', '图标');
      const navBgPath = pick('navBgFile', 'navBgPath', '上下篇背景');
      const footerBgPath = pick('footerBgFile', 'footerBgPath', '页脚背景');

      /* --- _config.yml --- */
      let siteRaw = readText(siteFile);
      let siteNext = siteRaw;
      [
        ['title', data.title],
        ['subtitle', data.subtitle],
        ['description', data.description],
        ['keywords', data.keywords],
        ['author', data.author],
        ['language', data.language],
      ].forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        const r = setScalar(siteNext, [k], v);
        if (r != null) siteNext = r;
      });
      writeIfChanged(siteFile, siteRaw, siteNext, touched, '站点信息');

      /* --- _config.butterfly.yml --- */
      let thRaw = readText(themeFile);
      let thNext = thRaw;
      const bool = (v) => (v ? 'true' : 'false');
      const themeKeys = [
        [['index_img'], bannerPath],
        [['default_top_img'], bannerPath],
        [['avatar', 'img'], avatarPath],
        [['avatar', 'effect'], data.avatarEffect === undefined ? undefined : bool(data.avatarEffect)],
        [['favicon'], faviconPath],
        [['footer', 'owner', 'since'], data.since],
        [['footer', 'custom_text'], data.footerText],
        [['aside', 'card_author', 'description'], data.authorDesc],
        [['aside', 'card_announcement', 'content'], data.notice],
        [['aside', 'enable'], data.asideEnable === undefined ? undefined : bool(data.asideEnable)],
        [['toc', 'post'], data.tocEnable === undefined ? undefined : bool(data.tocEnable)],
        [['darkmode', 'enable'], data.darkmode === undefined ? undefined : bool(data.darkmode)],
        [['readmode'], data.readmode === undefined ? undefined : bool(data.readmode)],
        [['index_post_content', 'length'], data.postLength],
        [['waline', 'serverURL'], data.walineURL],
        [['waline', 'option', 'login'], data.guestLogin === undefined ? undefined : (data.guestLogin ? 'disable' : 'enable')],
      ];
      themeKeys.forEach(([p, v]) => {
        if (v === undefined || v === null || v === '') return;
        const r = setScalar(thNext, p, v);
        if (r != null) thNext = r;
      });
      if (Array.isArray(data.subLines)) {
        const r = setList(thNext, ['subtitle', 'sub'], data.subLines);
        if (r != null) thNext = r;
      }
      if (data.commentUse !== undefined) {
        const r = setScalar(thNext, ['comments', 'use'], data.commentUse);
        if (r != null) thNext = r;
      }
      // 文章底部「上一篇 / 下一篇」的背景（wb_look.nav_bg，经 scripts/wb-look.js 注入）
      // 只有真改了才写，避免无意义的提交。
      if (navBgPath) {
        const curNav = ((require('js-yaml').load(thRaw) || {}).wb_look || {}).nav_bg || '';
        if (String(navBgPath) !== String(curNav)) {
          const r = setScalar(thNext, ['wb_look', 'nav_bg'], navBgPath);
          if (r != null) thNext = r;
        }
      }
      // 页脚背景：允许清空（清空 = 纯色页脚）
      if (footerBgPath !== undefined && footerBgPath !== null) {
        const r = setScalar(thNext, ['footer_img'], footerBgPath);
        if (r != null) thNext = r;
      }
      // 社交链接整块重写
      if (data.github !== undefined || data.mail !== undefined) {
        const pairs = [];
        if (String(data.github || '').trim()) pairs.push(['fab fa-github', String(data.github).trim() + ' || Github']);
        if (String(data.mail || '').trim()) pairs.push(['fas fa-envelope', 'mailto:' + String(data.mail).trim() + ' || Email']);
        const r = setMapRaw(thNext, ['social'], pairs);
        if (r != null) thNext = r;
      }
      // 导航菜单整块重写（按界面里的顺序）
      if (Array.isArray(data.nav)) {
        const pairs = data.nav
          .filter((n) => n && String(n.name || '').trim() && String(n.path || '').trim())
          .map((n) => {
            const icon = String(n.icon || '').trim();
            return [String(n.name).trim(), String(n.path).trim() + (icon ? ' || ' + icon : '')];
          });
        if (pairs.length) {
          const r = setMapRaw(thNext, ['menu'], pairs);
          if (r != null) thNext = r;
        }
      }
      writeIfChanged(themeFile, thRaw, thNext, touched, '外观与导航');

      /* --- 联系邮箱同步到页面正文 --- */
      const mail = String(data.mail || '').trim();
      if (mail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
        ['source/about/index.md', 'source/messageBoard/index.md', 'source/link/index.md'].forEach((rel) => {
          const f = path.join(base, rel);
          if (!fs.existsSync(f)) return;
          const raw2 = fs.readFileSync(f, 'utf8');
          const next2 = raw2.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, mail);
          if (next2 !== raw2) {
            fs.writeFileSync(f, next2, 'utf8');
            touched.push('页面里的邮箱');
          }
        });
      }

      /* --- site.yml：邮箱 + 页面密码 --- */
      const siteData = loadSiteData(base);
      if (mail) siteData.mail = mail;
      if (Array.isArray(data.sections)) {
        siteData.sections = siteData.sections || {};
        data.sections.forEach((s) => {
          if (!s || !s.key) return;
          if (s.protect) {
            const pw = String(s.password || '').trim();
            if (pw) siteData.sections[s.key] = sha256(pw);
          } else {
            siteData.sections[s.key] = '';
          }
        });
      }
      writeWhole(base, F_SITE_DATA, dumpSiteData(siteData), touched, '页面密码');

      /* --- 下载区 --- */
      if (Array.isArray(data.downloads)) {
        writeWhole(base, F_DOWNLOADS, dumpDownloads(data.downloads), touched, '下载区');
      }

      /* --- 留言 --- */
      if (Array.isArray(data.comments)) {
        writeWhole(base, F_COMMENTS, dumpComments(data.comments), touched, '留言');
      }

      // 让预览立刻更新
      try {
        if (typeof hexo.load === 'function') await hexo.load();
        else await hexo.call('generate', {});
      } catch (e) {
        /* 文件已保存，重新载入失败也不影响下次启动 */
      }

      sendJson(res, 200, { ok: true, touched: touched.length ? touched : ['（没有变化）'] });
      return;
    }

    if (req.method === 'POST' && url === '/publish') {
      if (typeof options.publish !== 'function') {
        sendJson(res, 500, { ok: false, error: '当前进程不支持一键发布，请回到黑窗口双击「1-发布到网站.bat」。' });
        return;
      }
      const log = await options.publish();
      sendJson(res, 200, { ok: true, log: log || '' });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
}

/* ------------------------------ 页面 ------------------------------ */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderPage(cur) {
  const site = cur.site || {};
  const theme = cur.theme || {};
  const aside = theme.aside || {};
  const author = aside.card_author || {};
  const notice = aside.card_announcement || {};
  const owner = (theme.footer || {}).footer || {};
  const footerOwner = (theme.footer || {}).owner || {};
  const footerText = (theme.footer || {}).custom_text || '';
  const avatar = (theme.avatar || {}).img || '';
  const banner = theme.index_img || theme.default_top_img || '';
  const favicon = theme.favicon || '';
  const navBg = (theme.wb_look || {}).nav_bg || '';
  const footerBg = typeof theme.footer_img === 'string' ? theme.footer_img : '';
  const subs = (theme.subtitle && theme.subtitle.sub) || [];
  const waline = theme.waline || {};
  const social = cur.social || {};
  const github = social['fab fa-github'] || '';
  const mail = cur.siteData.mail || '';
  const sections = cur.siteData.sections || {};
  const downloads = cur.downloads || [];

  const pwRows = PAGE_SECTIONS.map((s) => {
    const on = !!sections[s.key];
    return (
      '<div class="pw-item" data-key="' + esc(s.key) + '">' +
      '<div class="pw-name">' + esc(s.name) + '<span class="pw-url">' + esc(s.url) + '</span>' +
      '<span class="pw-state ' + (on ? 'on' : '') + '">' + (on ? '已设密码' : '公开') + '</span></div>' +
      '<div class="pw-ctl">' +
      '<label class="chk"><input type="checkbox" class="pw-toggle"' + (on ? ' checked' : '') + '><span>需要密码</span></label>' +
      '<input type="password" class="pw-input" placeholder="' + (on ? '输入新密码可修改' : '设置一个密码') + '" autocomplete="new-password">' +
      '</div></div>'
    );
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>站点设置 · 本地编辑</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#f4f6fb;color:#1f2430;font:15px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:940px;margin:0 auto;padding:26px 18px 90px}
  h1{margin:0 0 6px;font-size:22px}
  .sub{color:#6b7280;font-size:13px;margin-bottom:18px}
  .sub a{color:#4a6cf7;text-decoration:none}
  .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;position:sticky;top:0;background:#f4f6fb;padding:8px 0;z-index:9}
  .tabs button{border:1px solid #e6e9f2;background:#fff;border-radius:9px;padding:7px 14px;font:inherit;font-size:13px;color:#4b5563;cursor:pointer}
  .tabs button.on{background:#4a6cf7;border-color:#4a6cf7;color:#fff}
  .panel{display:none}
  .panel.on{display:block}
  .card{background:#fff;border:1px solid #e6e9f2;border-radius:14px;padding:18px 20px;margin-bottom:16px;box-shadow:0 2px 10px rgba(31,36,48,.04)}
  .card h2{margin:0 0 14px;font-size:15px;color:#374151;letter-spacing:.3px;display:flex;align-items:center;gap:8px}
  .card .desc{font-size:12.5px;color:#9aa3b2;margin:-8px 0 14px;line-height:1.7}
  .row{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px}
  .field{flex:1 1 240px;min-width:180px}
  label{display:block;font-size:13px;color:#4b5563;margin-bottom:5px}
  input[type=text],input[type=password],input[type=number],textarea,select{width:100%;padding:9px 11px;border:1px solid #dfe3ee;border-radius:9px;font:inherit;background:#fbfcff;color:#1f2430}
  input:focus,textarea:focus,select:focus{outline:none;border-color:#8aa2f7;background:#fff}
  textarea{resize:vertical;min-height:64px}
  .hint{font-size:12px;color:#9aa3b2;margin-top:4px;line-height:1.6}
  .media{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
  .thumb{width:96px;height:96px;border-radius:10px;border:1px solid #e6e9f2;background:#f0f2f9 center/cover no-repeat;flex:0 0 auto}
  .thumb.wide{width:260px;height:78px}
  .thumb.ico{width:48px;height:48px}
  .actions{position:sticky;bottom:0;background:linear-gradient(to top,#f4f6fb 65%,rgba(244,246,251,0));padding:16px 0 6px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;z-index:9}
  button{border:0;border-radius:10px;padding:11px 20px;font:inherit;cursor:pointer}
  .primary{background:#4a6cf7;color:#fff}
  .primary:disabled{opacity:.55;cursor:default}
  .ghost{background:#eef1fa;color:#3c4a68}
  .mini{padding:7px 12px;font-size:13px;background:#eef1fa;color:#3c4a68;border-radius:8px}
  .mini.danger{background:#fdecec;color:#c62828}
  .status{font-size:13px;color:#4b5563}
  .ok{color:#0f8a4a}.err{color:#c62828}
  .badge{display:inline-block;font-size:11px;color:#6b7280;background:#eef1fa;border-radius:6px;padding:1px 7px;vertical-align:2px}
  .item{border:1px solid #eef1fa;border-radius:11px;padding:14px;margin-bottom:12px;background:#fbfcff}
  .item .row{margin-bottom:0}
  .item .field{margin-top:10px}
  .item .field:first-child{margin-top:0}
  .empty{font-size:13px;color:#9aa3b2;padding:10px 0 14px}
  .pw-item{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:12px 0;border-bottom:1px dashed #eef1fa}
  .pw-item:last-child{border-bottom:0}
  .pw-name{flex:1 1 220px;font-size:14px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
  .pw-url{font-size:12px;color:#9aa3b2}
  .pw-state{font-size:11px;border-radius:5px;padding:1px 6px;background:#f2f3f6;color:#8b93a1}
  .pw-state.on{background:#e8f5ee;color:#0f8a4a}
  .pw-ctl{display:flex;gap:10px;align-items:center;flex:0 0 auto}
  .pw-ctl input[type=password]{width:190px}
  .chk{display:flex;align-items:center;gap:6px;font-size:13px;color:#4b5563;margin:0;white-space:nowrap}
  .chk input{width:16px;height:16px}
  .switches{display:flex;gap:18px;flex-wrap:wrap}
  .switches .chk{padding:4px 0}
  .warn{background:#fff8e6;border:1px solid #ffe3a3;color:#8a6d1f;font-size:12.5px;border-radius:9px;padding:9px 12px;line-height:1.7;margin-top:10px}
</style>
</head>
<body>
<div class="wrap">
  <h1>站点设置<span class="badge">仅本机可改</span></h1>
  <div class="sub">改完点「保存」，本地预览立刻变；点「保存并发布到线上」1-2 分钟后网站更新。返回 <a href="/">网站预览</a> · <a href="/admin">写文章后台</a></div>

  <div class="tabs" id="tabs">
    <button data-tab="basic" class="on">基本信息</button>
    <button data-tab="look">外观图片</button>
    <button data-tab="nav">导航菜单</button>
    <button data-tab="dl">下载区</button>
    <button data-tab="pw">页面密码</button>
    <button data-tab="cm">评论区</button>
    <button data-tab="msg">留言管理</button>
  </div>

  <form id="f">
    <!-- ===== 1 基本信息 ===== -->
    <div class="panel on" id="p-basic">
      <div class="card">
        <h2>站点文字</h2>
        <div class="row">
          <div class="field"><label>站点标题（浏览器标签 / 左上角）</label><input type="text" id="title" value="${esc(site.title)}"></div>
          <div class="field"><label>作者名字</label><input type="text" id="author" value="${esc(site.author)}"></div>
        </div>
        <div class="row">
          <div class="field"><label>副标题（标题旁边那句）</label><input type="text" id="subtitle" value="${esc(site.subtitle)}"></div>
          <div class="field"><label>关键词（逗号分隔，给搜索引擎）</label><input type="text" id="keywords" value="${esc(site.keywords)}"></div>
        </div>
        <div class="row">
          <div class="field" style="flex:2 1 340px"><label>站点描述</label><input type="text" id="description" value="${esc(site.description)}"></div>
          <div class="field" style="flex:0 1 160px"><label>语言</label><input type="text" id="language" value="${esc(site.language || 'zh-CN')}"></div>
        </div>
        <div class="field"><label>首页轮播标语（一行一句，会逐字打出来）</label>
          <textarea id="subLines" rows="4">${esc(subs.join('\n'))}</textarea>
        </div>
      </div>

      <div class="card">
        <h2>联系方式</h2>
        <div class="row">
          <div class="field"><label>对外显示的邮箱</label><input type="text" id="mail" value="${esc(mail)}">
            <div class="hint">改这里会同时改掉：顶部图标、关于页、留言板里写的邮箱。</div>
          </div>
          <div class="field"><label>GitHub 主页</label><input type="text" id="github" value="${esc(github)}"></div>
        </div>
      </div>

      <div class="card">
        <h2>页脚</h2>
        <div class="row">
          <div class="field" style="max-width:180px"><label>起始年份</label><input type="text" id="since" value="${esc(footerOwner.since)}"></div>
          <div class="field" style="flex:2 1 340px"><label>页脚附加文字（可空）</label><input type="text" id="footerText" value="${esc(footerText)}">
            <div class="hint">会显示成「© 起始年份 - 今年 By 作者名」后面再跟这段文字。</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== 2 外观 ===== -->
    <div class="panel" id="p-look">
      <div class="card">
        <h2>首页 / 内页顶部大图</h2>
        <div class="media">
          <div class="thumb wide" id="bannerThumb" style="background-image:url('${esc(banner)}')"></div>
          <div style="flex:1 1 260px">
            <input type="file" id="bannerFile" accept="image/*">
            <div class="hint">建议 1920×600 左右的横向图，jpg 体积小。选图后自动存到 source/img/。</div>
            <div class="field" style="margin-top:8px;margin-bottom:0"><label>或者直接填路径</label><input type="text" id="bannerPath" value="${esc(banner)}"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>文章底部「上一篇 / 下一篇」背景</h2>
        <div class="media">
          <div class="thumb wide" id="navBgThumb" style="background-image:url('${esc(navBg)}')"></div>
          <div style="flex:1 1 260px">
            <input type="file" id="navBgFile" accept="image/*">
            <div class="hint">建议横图（1200×600 以上）。文字会盖在上面，所以<b>深色图更好看</b>；系统会自动再压一层暗色遮罩，保证字看得清。</div>
            <div class="field" style="margin-top:8px;margin-bottom:0"><label>或者直接填路径</label><input type="text" id="navBgPath" value="${esc(navBg)}"></div>
            <div class="hint">想换回自带的深色渐变：把上面填成 <code>/img/nav-cover.svg</code></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>页脚（网页最下面那条）背景</h2>
        <div class="media">
          <div class="thumb wide" id="footerBgThumb" style="background-image:url('${esc(footerBg)}')"></div>
          <div style="flex:1 1 260px">
            <input type="file" id="footerBgFile" accept="image/*">
            <div class="hint">同样建议深色横图（1600×400 左右）。页脚文字是白色的，浅色图会看不清。</div>
            <div class="field" style="margin-top:8px;margin-bottom:0"><label>或者直接填路径</label><input type="text" id="footerBgPath" value="${esc(footerBg)}"></div>
            <div class="hint">留空 = 纯色页脚。自带图：<code>/img/footer-bg.svg</code></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>侧边栏</h2>
        <div class="media">
          <div class="thumb" id="avatarThumb" style="background-image:url('${esc(avatar)}')"></div>
          <div style="flex:1 1 260px">
            <input type="file" id="avatarFile" accept="image/*">
            <div class="hint">正方形最好（≥300×300）。选图后自动上传。</div>
            <div class="field" style="margin-top:8px;margin-bottom:0"><label>或者直接填路径</label><input type="text" id="avatarPath" value="${esc(avatar)}"></div>
          </div>
        </div>
        <div class="row" style="margin-top:14px">
          <div class="field"><label>作者简介（头像下面一句）</label><input type="text" id="authorDesc" value="${esc(author.description)}"></div>
        </div>
        <div class="field"><label>公告卡片文字</label><input type="text" id="notice" value="${esc(notice.content)}"></div>
      </div>

      <div class="card">
        <h2>浏览器标签上的小图标（favicon）</h2>
        <div class="media">
          <div class="thumb ico" id="faviconThumb" style="background-image:url('${esc(favicon)}')"></div>
          <div style="flex:1 1 260px">
            <input type="file" id="faviconFile" accept=".ico,.png,.svg,.jpg,.jpeg,.webp">
            <div class="hint">支持 .ico / .png / .svg，建议正方形、32×32 以上。改完浏览器可能要强刷（Ctrl+F5）或等一会儿才变。</div>
            <div class="field" style="margin-top:8px;margin-bottom:0"><label>或者直接填路径</label><input type="text" id="faviconPath" value="${esc(favicon)}"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>显示开关</h2>
        <div class="desc">不确定就保持默认，改错了点「保存」前刷新页面即可恢复。</div>
        <div class="switches">
          <label class="chk"><input type="checkbox" id="asideEnable"${aside.enable === false ? '' : ' checked'}><span>显示侧边栏</span></label>
          <label class="chk"><input type="checkbox" id="tocEnable"${(theme.toc || {}).post ? ' checked' : ''}><span>文章右侧显示目录</span></label>
          <label class="chk"><input type="checkbox" id="darkmode"${(theme.darkmode || {}).enable ? ' checked' : ''}><span>右下角深色模式按钮</span></label>
          <label class="chk"><input type="checkbox" id="readmode"${theme.readmode ? ' checked' : ''}><span>阅读模式按钮</span></label>
          <label class="chk"><input type="checkbox" id="avatarEffect"${(theme.avatar || {}).effect ? ' checked' : ''}><span>头像旋转特效</span></label>
        </div>
        <div class="row" style="margin-top:14px">
          <div class="field" style="max-width:220px"><label>首页文章摘要字数</label><input type="number" id="postLength" value="${esc((theme.index_post_content || {}).length || 260)}"></div>
        </div>
      </div>
    </div>

    <!-- ===== 3 导航 ===== -->
    <div class="panel" id="p-nav">
      <div class="card">
        <h2>顶部导航菜单</h2>
        <div class="desc">顺序就是显示顺序。改完记得保存；删掉某项后它就不在导航里了（页面本身还在，直接输网址仍能打开）。</div>
        <div id="navList"></div>
        <button type="button" class="ghost" id="navAdd">+ 添加一项</button>
        <div class="warn">常用图标（复制到「图标」框里）：<br>
          fas fa-home 首页 · fas fa-archive 归档 · fas fa-tags 标签 · fas fa-folder-open 分类 · fas fa-link 友链 ·
          fas fa-history 编年史 · far fa-comment-dots 留言板 · fas fa-download 下载 · fas fa-user 关于 · fas fa-rss 订阅
        </div>
      </div>
    </div>

    <!-- ===== 4 下载区 ===== -->
    <div class="panel" id="p-dl">
      <div class="card">
        <h2>下载区文件<span class="badge">放在 /downloads/ 页面</span></h2>
        <div class="desc">两种来源二选一：上传到本站（占仓库体积），或者填外部链接（网盘等，不占体积）。大小不填会自动读实际文件大小。</div>
        <div id="dlList"></div>
        <button type="button" class="ghost" id="dlAdd">+ 添加一个文件</button>
        <div class="warn">
          <b>GitHub Pages 的硬限制，传之前先看：</b><br>
          · 单个文件 <b>100 MB</b> 是硬上限，超过直接推不上去；实际建议 ≤ 50 MB<br>
          · 整个站点建议 ≤ 1 GB（软限制，超了会警告甚至限流）<br>
          · 每月流量约 100 GB（软限制），个人博客基本用不到<br>
          · 超过 50 MB 的大文件（视频、大安装包）建议放网盘，这里只填链接
        </div>
        <div class="warn">
          这一页如果设了访问密码，没解锁前看不到文件列表；但静态站的文件本身是公开的，<b>真要保密请用加密压缩包</b>。
        </div>
      </div>
    </div>

    <!-- ===== 5 页面密码 ===== -->
    <div class="panel" id="p-pw">
      <div class="card">
        <h2>给每个页面单独设密码<span class="badge">可选</span></h2>
        <div class="desc">勾上「需要密码」并输入密码，保存后这一页要先输密码才能看内容。不勾就是公开。想改密码就重新输一个；想取消，取消勾选再保存。</div>
        <div id="pwList">${pwRows}</div>
        <div class="warn">
          这是<b>前端校验</b>：能挡住随手点进来的人，但页面和文件本身仍在公开仓库里，懂技术的人可以绕过。
          真正的机密请用加密压缩包（密码单独告诉我）。密码只存 SHA-256，忘了就在这儿重设。
        </div>
      </div>
    </div>

    <!-- ===== 6 评论区 ===== -->
    <div class="panel" id="p-cm">
      <div class="card">
        <h2>评论区</h2>
        <div class="row">
          <div class="field" style="max-width:220px"><label>是否开启</label>
            <select id="commentUse">
              <option value="Waline"${(theme.comments || {}).use === 'Waline' ? ' selected' : ''}>开启（Waline）</option>
              <option value=""${!(theme.comments || {}).use ? ' selected' : ''}>关闭，全站不显示评论</option>
            </select>
          </div>
          <div class="field" style="flex:2 1 320px"><label>Waline 服务地址</label><input type="text" id="walineURL" value="${esc(waline.serverURL || '')}">
            <div class="hint">就是那个 netlify 转发地址，别填带一长串随机字符的临时地址（重新部署会失效）。</div>
          </div>
        </div>
        <label class="chk" style="margin-top:6px"><input type="checkbox" id="guestLogin"${((waline.option || {}).login === 'disable') ? ' checked' : ''}><span>访客不用登录，填昵称就能留言</span></label>
        <div class="hint" style="margin-top:8px">管理后台：<a href="https://weiblog-comments.netlify.app/ui" target="_blank" rel="noopener">weiblog-comments.netlify.app/ui</a>（用注册留言板时的邮箱和密码登录）</div>
      </div>
    </div>

    <!-- ===== 7 留言 ===== -->
    <div class="panel" id="p-msg">
      <div class="card">
        <h2>留言管理<span class="badge">审核后显示</span></h2>
        <div class="desc">这一套是「没有后端」时的备用方案：别人发邮件给你 → 你在这儿手工添加 → 发布后出现在留言板上。现在留言板用的是 Waline，这里的留言不会显示在留言板页面（留给以后切回来用）。</div>
        <div id="cmList"></div>
        <button type="button" class="ghost" id="cmAdd">+ 添加一条留言</button>
      </div>
    </div>

    <div class="actions">
      <button type="submit" class="primary" id="saveBtn">保存</button>
      <button type="button" class="ghost" id="publishBtn">保存并发布到线上</button>
      <span class="status" id="status"></span>
    </div>
  </form>
</div>

<script type="application/json" id="bootData">${JSON.stringify({
    comments: cur.comments || [],
    nav: cur.nav || [],
    downloads: downloads,
  }).replace(/</g, '\\u003c')}</script>
<script>
var $ = function (s) { return document.querySelector(s); };
var statusEl = $('#status');
function setStatus(text, kind) { statusEl.textContent = text; statusEl.className = 'status ' + (kind || ''); }
var boot = JSON.parse(document.getElementById('bootData').textContent || '{}');
var picked = { avatar: null, banner: null, favicon: null, navBg: null, footerBg: null };

/* ---- 标签切换 ---- */
$('#tabs').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-tab]');
  if (!b) return;
  Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (x) { x.classList.remove('on'); });
  Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (x) { x.classList.remove('on'); });
  b.classList.add('on');
  var p = document.getElementById('p-' + b.getAttribute('data-tab'));
  if (p) p.classList.add('on');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* ---- 图片选择 ---- */
function hookFile(input, key, thumbId) {
  var el = document.getElementById(input);
  if (!el) return;
  el.addEventListener('change', function () {
    var f = el.files && el.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      picked[key] = { name: f.name, dataUrl: r.result };
      var t = document.getElementById(thumbId);
      if (t) t.style.backgroundImage = 'url(' + r.result + ')';
      setStatus('已选择新图片，记得点保存', '');
    };
    r.readAsDataURL(f);
  });
}
hookFile('avatarFile', 'avatar', 'avatarThumb');
hookFile('bannerFile', 'banner', 'bannerThumb');
hookFile('faviconFile', 'favicon', 'faviconThumb');
hookFile('navBgFile', 'navBg', 'navBgThumb');
hookFile('footerBgFile', 'footerBg', 'footerBgThumb');

/* ---- 导航 ---- */
var ICONS = ['fas fa-home','fas fa-archive','fas fa-tags','fas fa-folder-open','fas fa-link','fas fa-history','far fa-comment-dots','fas fa-download','fas fa-user','fas fa-rss','fas fa-book','fas fa-camera','fas fa-music','fas fa-code'];
function navRow(n) {
  n = n || { name: '', path: '', icon: 'fas fa-link' };
  var el = document.createElement('div');
  el.className = 'item nav-item';
  var opts = ICONS.map(function (i) { return '<option value="' + i + '">' + i + '</option>'; }).join('');
  el.innerHTML =
    '<div class="row">' +
    '<div class="field" style="flex:0 1 150px"><label>名称</label><input type="text" data-k="name" value="' + esc2(n.name) + '"></div>' +
    '<div class="field" style="flex:0 1 170px"><label>链接</label><input type="text" data-k="path" value="' + esc2(n.path) + '" placeholder="/about/"></div>' +
    '<div class="field" style="flex:1 1 200px"><label>图标（可改）</label><input type="text" data-k="icon" list="iconList" value="' + esc2(n.icon) + '"></div>' +
    '<div class="field" style="flex:0 0 auto;margin-top:26px;display:flex;gap:6px">' +
    '<button type="button" class="mini nav-up">↑</button>' +
    '<button type="button" class="mini nav-down">↓</button>' +
    '<button type="button" class="mini danger nav-del">删除</button>' +
    '</div></div>';
  el.querySelector('.nav-up').addEventListener('click', function () { move(el, -1); });
  el.querySelector('.nav-down').addEventListener('click', function () { move(el, 1); });
  el.querySelector('.nav-del').addEventListener('click', function () { el.remove(); setStatus('已删除一项（未保存）', ''); });
  return el;
}
function move(el, dir) {
  var list = el.parentNode;
  if (dir < 0 && el.previousElementSibling) list.insertBefore(el, el.previousElementSibling);
  if (dir > 0 && el.nextElementSibling) list.insertBefore(el.nextElementSibling, el);
}
function initNav() {
  var list = $('#navList');
  list.innerHTML = '';
  var data = boot.nav || [];
  if (!data.length) { var e = document.createElement('div'); e.className = 'empty'; e.textContent = '还没有导航项'; list.appendChild(e); return; }
  data.forEach(function (d) { list.appendChild(navRow(d)); });
}
$('#navAdd').addEventListener('click', function () {
  var e = $('#navList .empty'); if (e) e.remove();
  var el = navRow({ name: '新页面', path: '/', icon: 'fas fa-link' });
  $('#navList').appendChild(el);
  el.querySelector('[data-k=name]').focus();
});
function collectNav() {
  return Array.prototype.map.call(document.querySelectorAll('#navList .nav-item'), function (el) {
    return {
      name: el.querySelector('[data-k=name]').value.trim(),
      path: el.querySelector('[data-k=path]').value.trim(),
      icon: el.querySelector('[data-k=icon]').value.trim(),
    };
  }).filter(function (n) { return n.name && n.path; });
}

/* ---- 下载区 ---- */
function dlRow(d) {
  d = d || { name: '', desc: '', file: '', url: '', size: '', date: '', hidden: false };
  var el = document.createElement('div');
  el.className = 'item dl-item';
  el.innerHTML =
    '<div class="row">' +
    '<div class="field" style="flex:1 1 220px"><label>文件名称</label><input type="text" data-k="name" value="' + esc2(d.name) + '" placeholder="比如：2026 笔记合集.zip"></div>' +
    '<div class="field" style="flex:0 1 120px"><label>大小</label><input type="text" data-k="size" value="' + esc2(d.size) + '" placeholder="自动"></div>' +
    '<div class="field" style="flex:0 1 130px"><label>日期</label><input type="text" data-k="date" value="' + esc2(d.date) + '" placeholder="2026-11-11"></div>' +
    '<div class="field" style="flex:0 0 auto;margin-top:26px;display:flex;gap:10px;align-items:center">' +
    '<label class="chk"><input type="checkbox" data-k="hidden"' + (d.hidden ? ' checked' : '') + '><span>隐藏</span></label>' +
    '<button type="button" class="mini danger dl-del">删除</button>' +
    '</div></div>' +
    '<div class="field"><label>说明（可空）</label><input type="text" data-k="desc" value="' + esc2(d.desc) + '"></div>' +
    '<div class="row" style="margin-top:10px">' +
    '<div class="field" style="flex:1 1 260px"><label>本站文件路径（上传后自动填）</label><input type="text" data-k="file" value="' + esc2(d.file) + '" placeholder="/files/xxx.zip"></div>' +
    '<div class="field" style="flex:0 0 auto;margin-top:26px"><input type="file" class="dl-upload"></div>' +
    '</div>' +
    '<div class="field"><label>或：外部链接（网盘等，填了优先用链接之外的本站文件）</label><input type="text" data-k="url" value="' + esc2(d.url) + '" placeholder="https://..."></div>' +
    '<div class="dl-state hint"></div>';
  el.querySelector('.dl-del').addEventListener('click', function () {
    if (!confirm('删掉这一条？点保存后才真正消失。')) return;
    el.remove();
    setStatus('已删除一项（未保存）', '');
  });
  var up = el.querySelector('.dl-upload');
  up.addEventListener('change', function () {
    var f = up.files && up.files[0];
    if (!f) return;
    if (f.size > 90 * 1024 * 1024) { el.querySelector('.dl-state').textContent = '超过 90MB，GitHub 推不上去，请改用网盘链接'; return; }
    el.querySelector('.dl-state').textContent = '上传中… ' + f.name;
    fetch('/site/file?name=' + encodeURIComponent(f.name), { method: 'POST', body: f })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || '上传失败');
        el.querySelector('[data-k=file]').value = j.path;
        el.querySelector('[data-k=size]').value = fmtSize(j.size);
        el.querySelector('.dl-state').textContent = '已上传：' + j.path + '（' + fmtSize(j.size) + '）';
        setStatus('文件已上传，记得保存', '');
      })
      .catch(function (err) { el.querySelector('.dl-state').textContent = '上传失败：' + err.message; });
  });
  return el;
}
function fmtSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
function initDl() {
  var list = $('#dlList');
  list.innerHTML = '';
  var data = boot.downloads || [];
  if (!data.length) { var e = document.createElement('div'); e.className = 'empty'; e.textContent = '还没有文件'; list.appendChild(e); return; }
  data.forEach(function (d) { list.appendChild(dlRow(d)); });
}
$('#dlAdd').addEventListener('click', function () {
  var e = $('#dlList .empty'); if (e) e.remove();
  var el = dlRow({ date: today() });
  $('#dlList').appendChild(el);
  el.querySelector('[data-k=name]').focus();
});
function collectDl() {
  return Array.prototype.map.call(document.querySelectorAll('#dlList .dl-item'), function (el) {
    return {
      name: el.querySelector('[data-k=name]').value.trim(),
      desc: el.querySelector('[data-k=desc]').value.trim(),
      file: el.querySelector('[data-k=file]').value.trim(),
      url: el.querySelector('[data-k=url]').value.trim(),
      size: el.querySelector('[data-k=size]').value.trim(),
      date: el.querySelector('[data-k=date]').value.trim(),
      hidden: el.querySelector('[data-k=hidden]').checked,
    };
  }).filter(function (d) { return d.name; });
}

/* ---- 页面密码 ---- */
function collectSections() {
  return Array.prototype.map.call(document.querySelectorAll('.pw-item'), function (el) {
    return {
      key: el.getAttribute('data-key'),
      protect: el.querySelector('.pw-toggle').checked,
      password: el.querySelector('.pw-input').value,
    };
  });
}

/* ---- 留言 ---- */
var cmData = boot.comments || [];
var cmList = $('#cmList');
function esc2(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function today() { var d = new Date(); var p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
function nowText() { var d = new Date(); var p = function (n) { return String(n).padStart(2, '0'); }; return today() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
function addCm(c) {
  c = c || {};
  var el = document.createElement('div');
  el.className = 'item cm-item';
  el.innerHTML =
    '<div class="row">' +
    '<div class="field" style="flex:0 0 150px"><label>昵称</label><input type="text" data-k="name" value="' + esc2(c.name || '') + '"></div>' +
    '<div class="field" style="flex:0 0 170px"><label>时间</label><input type="text" data-k="date" value="' + esc2(c.date || nowText()) + '"></div>' +
    '<div class="field" style="flex:0 0 100px"><label>状态</label><div style="display:flex;align-items:center;gap:6px;height:38px"><label class="chk"><input type="checkbox" data-k="visible"' + (c.hidden ? '' : ' checked') + '><span>公开</span></label></div></div>' +
    '<div class="field" style="flex:0 0 auto;margin-top:26px"><button type="button" class="mini danger cm-del">删除</button></div>' +
    '</div>' +
    '<div class="field"><label>留言内容</label><textarea data-k="content" rows="2">' + esc2(c.content || '') + '</textarea></div>' +
    '<div class="field"><label>站长回复（可空）</label><input type="text" data-k="reply" value="' + esc2(c.reply || '') + '"></div>';
  el.querySelector('.cm-del').addEventListener('click', function () {
    if (!confirm('删掉这条留言？点保存后才真正消失。')) return;
    el.remove();
    setStatus('已删除 1 条（未保存）', '');
  });
  cmList.appendChild(el);
  return el;
}
function renderCm() {
  cmList.innerHTML = '';
  if (!cmData.length) { var d = document.createElement('div'); d.className = 'empty'; d.textContent = '还没有留言。'; cmList.appendChild(d); return; }
  cmData.forEach(addCm);
}
$('#cmAdd').addEventListener('click', function () {
  var e = cmList.querySelector('.empty'); if (e) e.remove();
  var el = addCm({});
  el.scrollIntoView({ block: 'center' });
  el.querySelector('[data-k=name]').focus();
});
function collectCm() {
  return Array.prototype.map.call(cmList.querySelectorAll('.cm-item'), function (el) {
    return {
      name: el.querySelector('[data-k=name]').value.trim(),
      date: el.querySelector('[data-k=date]').value.trim(),
      content: el.querySelector('[data-k=content]').value.trim(),
      reply: el.querySelector('[data-k=reply]').value.trim(),
      hidden: !el.querySelector('[data-k=visible]').checked,
    };
  });
}

/* ---- 收集 & 提交 ---- */
function val(id) { var el = document.getElementById(id); return el ? el.value : undefined; }
function chk(id) { var el = document.getElementById(id); return el ? el.checked : undefined; }
function collect() {
  var out = {
    title: val('title'), author: val('author'), subtitle: val('subtitle'),
    keywords: val('keywords'), description: val('description'), language: val('language'),
    mail: val('mail'), github: val('github'), since: val('since'), footerText: val('footerText'),
    bannerPath: val('bannerPath'), avatarPath: val('avatarPath'), faviconPath: val('faviconPath'),
    navBgPath: val('navBgPath'), footerBgPath: val('footerBgPath'),
    authorDesc: val('authorDesc'), notice: val('notice'),
    postLength: val('postLength'),
    asideEnable: chk('asideEnable'), tocEnable: chk('tocEnable'),
    darkmode: chk('darkmode'), readmode: chk('readmode'), avatarEffect: chk('avatarEffect'),
    commentUse: val('commentUse'), walineURL: val('walineURL'), guestLogin: chk('guestLogin'),
    nav: collectNav(),
    downloads: collectDl(),
    sections: collectSections(),
    comments: collectCm(),
  };
  out.subLines = String(val('subLines') || '').split('\\n').map(function (s) { return s.trim(); }).filter(Boolean);
  if (picked.avatar) out.avatarFile = picked.avatar;
  if (picked.banner) out.bannerFile = picked.banner;
  if (picked.favicon) out.faviconFile = picked.favicon;
  if (picked.navBg) out.navBgFile = picked.navBg;
  if (picked.footerBg) out.footerBgFile = picked.footerBg;
  return out;
}
async function post(url, body) {
  var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  var j = await r.json().catch(function () { return {}; });
  if (!r.ok || j.ok === false) throw new Error(j.error || ('请求失败 ' + r.status));
  return j;
}
$('#f').addEventListener('submit', async function (e) {
  e.preventDefault();
  var btn = $('#saveBtn');
  btn.disabled = true;
  setStatus('正在保存…');
  try {
    var j = await post('/site/save', collect());
    picked = { avatar: null, banner: null, favicon: null, navBg: null, footerBg: null };
    setStatus('已保存：' + (j.touched || []).join('、') + '。本地预览已刷新；线上要点「保存并发布」。', 'ok');
  } catch (err) {
    setStatus('保存失败：' + err.message, 'err');
  } finally {
    btn.disabled = false;
  }
});
$('#publishBtn').addEventListener('click', async function () {
  var btn = $('#publishBtn');
  btn.disabled = true;
  setStatus('先保存，再推送…（约 30 秒，别关窗口）');
  try {
    await post('/site/save', collect());
    picked = { avatar: null, banner: null, favicon: null, navBg: null, footerBg: null };
    await post('/site/publish', {});
    setStatus('已推送！GitHub 正在编译，1-2 分钟后刷新 https://v-jinci.github.io 就能看到。', 'ok');
  } catch (err) {
    setStatus('发布失败：' + err.message + '（可回黑窗口双击「1-发布到网站.bat」重试）', 'err');
  } finally {
    btn.disabled = false;
  }
});

/* ---- 初始化动态列表（把服务端渲染的行换成可交互的） ---- */
initNav();
initDl();
renderCm();
</script>
<datalist id="iconList">
  <option value="fas fa-home"></option><option value="fas fa-archive"></option><option value="fas fa-tags"></option>
  <option value="fas fa-folder-open"></option><option value="fas fa-link"></option><option value="fas fa-history"></option>
  <option value="far fa-comment-dots"></option><option value="fas fa-download"></option><option value="fas fa-user"></option>
  <option value="fas fa-rss"></option><option value="fas fa-book"></option><option value="fas fa-camera"></option>
</datalist>
</body>
</html>`;
}
