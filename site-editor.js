/**
 * 本地站点编辑器（只在本机运行）
 *
 * 访问：双击「2-打开写作后台.bat」后打开 http://localhost:4000/site
 *
 * 能改的东西分了 8 类：
 *   1 基本信息：标题 / 作者 / 副标题 / 描述 / 关键词 / 联系邮箱 / 起始年份 / 首页标语的速度和样式
 *   2 联系方式：关于页的联系卡片（微信 / QQ / GitHub / 邮箱…，可弹窗、可带二维码）
 *   3 外观图片：主页背景（多图轮播 / 视频）/ 首页大图 / 头像 / favicon / 上下篇背景 / 页脚背景
 *               / 简介 / 公告 + 几个开关
 *   4 导航菜单：增删、改名字、换图标、调顺序
 *   5 下载区：上传文件或填外链，自动算大小
 *   6 页面密码：给任意一个导航页单独加密码（可加可不加，随时改）
 *   7 评论区：开 / 关，服务地址，访客是否要登录
 *   8 留言管理：审核制留言（没有后端时用）
 *
 * 写文件的原则：能按行替换的就只动那几行，注释和别的配置原样保留；
 * 只有 _data 下的数据文件是整份重写（结构简单，手写序列化）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawnSync } = require('child_process');

/* 视频转码：优先用 @ffmpeg-installer/ffmpeg 自带的二进制，找不到就跳过压缩（不影响上传） */
function ffmpegExe() {
  const cands = ['@ffmpeg-installer/ffmpeg', 'ffmpeg-static'];
  for (const m of cands) {
    try {
      const p = require(m);
      const exe = typeof p === 'string' ? p : p && p.path;
      if (exe && fs.existsSync(exe)) return exe;
    } catch (e) {}
  }
  return null;
}

/* 把临时视频压到「最长边 1600、crf 28」——背景视频肉眼看不出差别，体积通常只剩 1/5 */
function shrinkVideo(inputPath, outputPath) {
  const exe = ffmpegExe();
  if (!exe) return { ok: false, reason: 'no-ffmpeg' };
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', inputPath,
    '-vf', "scale='min(1600,iw)':-2",
    '-c:v', 'libx264', '-crf', '28', '-preset', 'veryfast', '-profile:v', 'main',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart',
    outputPath,
  ];
  const r = spawnSync(exe, args, { timeout: 15 * 60 * 1000, windowsHide: true });
  if (r.status !== 0 || !fs.existsSync(outputPath)) {
    return { ok: false, reason: (r.stderr ? String(r.stderr).slice(-200) : 'ffmpeg 转码失败') };
  }
  return { ok: true };
}

/* 把 markdown / <img> 里某张图的 ?w= 参数改成指定值（空 = 去掉，恢复默认） */
function setImgWidth(raw, src, w, onHit) {
  const re = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const q = w ? '?w=' + w : '';
  let out = raw;
  const md = new RegExp('(!\\[[^\\]]*\\]\\()' + re + '((?:[?#&]w=[^&?#\\s]*)?)((?:\\s+"[^"]*")?\\))', 'g');
  out = out.replace(md, (m0, a, b, c) => { onHit(); return a + src + q + c; });
  const tag = new RegExp('(<img\\b[^>]*?\\bsrc=")' + re + '((?:[?#&]w=[^&?#\\s]*)?)(")', 'gi');
  out = out.replace(tag, (m0, a, b, c) => { onHit(); return a + src + q + c; });
  return out;
}

/* 只改 front-matter 里的某个字段；value 为空则删除该行。返回新的全文 */
function setFmField(raw, key, value) {
  const m = String(raw).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return raw;
  let fm = m[1];
  const lineRe = new RegExp('^' + key + ':.*(?:\\r?\\n)?', 'm');
  const v = String(value == null ? '' : value).trim();
  if (v) {
    const val = '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    fm = lineRe.test(fm)
      ? fm.replace(lineRe, key + ': ' + val + '\n')
      : fm.replace(/\s*$/, '') + '\n' + key + ': ' + val + '\n';
  } else if (lineRe.test(fm)) {
    fm = fm.replace(lineRe, '');
  }
  return raw.replace(m[1], fm);
}

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

/** setScalar 的加强版：键不存在就插到父块末尾（父块必须已存在） */
function ensureScalar(raw, keyPath, value) {
  const lines = raw.split(/\r?\n/);
  const parent = keyPath.slice(0, -1);
  const key = keyPath[keyPath.length - 1];
  const blk = parent.length ? findBlock(lines, parent) : { indent: -1, start: 0, end: lines.length };
  if (!blk) return null;
  const want = parent.length ? blk.indent + 2 : 0;
  for (let i = blk.start; i < blk.end; i++) {
    const m = lines[i].match(/^(\s*)([^\s:#][^:]*):(.*)$/);
    if (m && m[2].trim() === key && m[1].length === want) {
      lines[i] = ' '.repeat(want) + key + ': ' + fmtScalar(value);
      return lines.join('\n');
    }
  }
  let at = blk.end;
  while (at > blk.start && (!lines[at - 1].trim() || /^\s*#/.test(lines[at - 1]))) at--;
  lines.splice(at, 0, ' '.repeat(want) + key + ': ' + fmtScalar(value));
  return lines.join('\n');
}

/** 找出某个键所在的行号（找不到返回 -1） */
function findKeyLine(lines, names) {
  let start = 0;
  let end = lines.length;
  let indent = -1;
  let hit = -1;
  for (let n = 0; n < names.length; n++) {
    const name = names[n];
    let found = -1;
    let foundIndent = -1;
    for (let i = start; i < end; i++) {
      const m = lines[i].match(/^(\s*)([^\s:#][^:]*):(.*)$/);
      if (!m) continue;
      const ind = m[1].length;
      if (indent >= 0 && ind <= indent) break;
      if (m[2].trim() !== name) continue;
      found = i;
      foundIndent = ind;
      break;
    }
    if (found < 0) return -1;
    indent = foundIndent;
    start = found + 1;
    hit = found;
    let e = start;
    for (; e < end; e++) {
      const line = lines[e];
      if (!line.trim() || /^\s*#/.test(line)) continue;
      if (line.match(/^(\s*)/)[1].length <= indent) break;
    }
    end = e;
  }
  return hit;
}

/** setList 的加强版：列表不存在就整块插到父块末尾 */
function ensureList(raw, keyPath, items) {
  const lines = raw.split(/\r?\n/);
  const parent = keyPath.slice(0, -1);
  const key = keyPath[keyPath.length - 1];
  const list = items.filter((s) => String(s == null ? '' : s).trim() !== '');
  const blk = findBlock(lines, keyPath);

  if (blk) {
    // 原来是 key: [] 这种内联写法，先还原成块写法，否则会拼出非法 YAML
    const ki = findKeyLine(lines, keyPath);
    if (ki >= 0 && /:\s*\S/.test(lines[ki])) lines[ki] = lines[ki].replace(/:\s*\S.*$/, ':');
    const itemIndent = ' '.repeat(blk.indent + 2);
    const next = list.map((s) => itemIndent + '- ' + fmtScalar(s));
    let end = blk.end;
    while (end > blk.start && (!lines[end - 1].trim() || /^\s*#/.test(lines[end - 1]))) end--;
    return lines.slice(0, blk.start).concat(next, lines.slice(end)).join('\n');
  }

  const pblk = parent.length ? findBlock(lines, parent) : { indent: -1, start: 0, end: lines.length };
  if (!pblk) return null;
  const want = parent.length ? pblk.indent + 2 : 0;
  let at = pblk.end;
  while (at > pblk.start && (!lines[at - 1].trim() || /^\s*#/.test(lines[at - 1]))) at--;
  const add = [' '.repeat(want) + key + ':'];
  list.forEach((s) => add.push(' '.repeat(want + 2) + '- ' + fmtScalar(s)));
  lines.splice(at, 0, ...add);
  return lines.join('\n');
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

/** 文件名只留 ASCII，避免中文名在 URL / CSS 里出问题 */
function asciiName(name, fallbackExt) {
  let n = String(name || '').split(/[\\/]/).pop() || '';
  n = n.replace(/[\u4e00-\u9fa5]/g, '');
  n = n.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+|[-]+$/g, '');
  const ext = (n.match(/\.[A-Za-z0-9]+$/) || [''])[0];
  let base = (ext ? n.slice(0, -ext.length) : n).slice(0, 40);
  if (!base) base = 'wb-' + Date.now();
  return base + (ext || fallbackExt || '');
}

/* ------------------------------ 数据文件 ------------------------------ */

const F_SITE_DATA = ['source', '_data', 'site.yml'];
const F_DOWNLOADS = ['source', '_data', 'downloads.yml'];
const F_COMMENTS = ['source', '_data', 'comments.yml'];

function loadSiteData(base) {
  const d = readYaml(path.join(base, ...F_SITE_DATA), {});
  return {
    mail: d.mail || '',
    sections: d.sections || {},
    contacts: Array.isArray(d.contacts) ? d.contacts : null,
  };
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

  const cs = Array.isArray(d.contacts) ? d.contacts : [];
  out.push('');
  out.push('# 关于页的联系方式卡片：写 <!--WB_CONTACTS--> 的地方会显示它们');
  out.push('# hidden: true = 暂时不显示，但内容留着');
  out.push('contacts:');
  if (!cs.length) out.push('  []');
  cs.forEach((c) => {
    if (!c || !String(c.label || '').trim()) return;
    out.push('  - label: ' + JSON.stringify(String(c.label).trim()));
    out.push('    icon: ' + JSON.stringify(String(c.icon || 'fas fa-link').trim()));
    if (String(c.value || '').trim()) out.push('    value: ' + JSON.stringify(String(c.value).trim()));
    if (String(c.href || '').trim()) out.push('    href: ' + JSON.stringify(String(c.href).trim()));
    if (String(c.qr || '').trim()) out.push('    qr: ' + JSON.stringify(String(c.qr).trim()));
    if (String(c.hint || '').trim()) out.push('    hint: ' + JSON.stringify(String(c.hint).trim()));
    if (c.hidden) out.push('    hidden: true');
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
  // 文件名带上内容指纹：换图就换地址，浏览器/图床不会继续用旧缓存；
  // 同一张图重复上传只会得到同一个名字，不会越堆越多。
  const buf = Buffer.from(m[2], 'base64');
  const fp = require('crypto').createHash('sha1').update(buf).digest('hex').slice(0, 8);
  const fileName = name + '-' + fp + ext;
  const dir = path.join(base, 'source', 'img');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), buf);
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
  ['avatar', 'footer', 'aside', 'subtitle', 'darkmode', 'toc', 'index_post_content', 'comments', 'waline', 'wb_look'].forEach((k) => {
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

  const siteData = loadSiteData(base);
  // 第一次打开「联系方式」时给个能直接用的起点（GitHub + 邮箱取自现有配置）
  if (!siteData.contacts) {
    const githubUrl = String((mine.social || {})['fab fa-github'] || '').trim();
    siteData.contacts = [];
    if (githubUrl) {
      siteData.contacts.push({
        label: 'GitHub',
        icon: 'fab fa-github',
        value: githubUrl.replace(/^https?:\/\/(www\.)?github\.com\//i, '@'),
        href: githubUrl,
      });
    }
    if (siteData.mail) {
      siteData.contacts.push({ label: '邮箱', icon: 'fas fa-envelope', value: siteData.mail, href: 'mailto:' + siteData.mail });
    }
    siteData.contacts.push(
      { label: '微信', icon: 'fab fa-weixin', value: '', qr: '', hidden: true },
      { label: 'QQ', icon: 'fab fa-qq', value: '', hidden: true }
    );
  }

  return {
    site,
    theme,
    nav,
    social: mine.social || {},
    comments: loadComments(base),
    siteData,
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

    // 图片 / 视频上传：原始二进制直接写进 source/img（图片）或 source/media（视频）
    // 带 shrink=1 时：视频先转码压小（图片在浏览器端压，不经过这里）
    if (req.method === 'POST' && url === '/media') {
      const q = new URL(req.url, 'http://localhost').searchParams;
      const isVideo = q.get('kind') === 'video';
      const wantShrink = q.get('shrink') === '1';
      const name = asciiName(q.get('name'), isVideo ? '.mp4' : '.png');
      const buf = await readBuffer(req, isVideo ? 150 * 1024 * 1024 : 20 * 1024 * 1024);
      if (!buf.length) throw new Error('文件是空的');
      const sub = isVideo ? 'media' : 'img';
      const dir = path.join(base, 'source', sub);
      fs.mkdirSync(dir, { recursive: true });

      let out = buf;
      let shrunk = false;
      let note = '';
      if (isVideo && wantShrink) {
        const tmpIn = path.join(os.tmpdir(), 'wb-up-' + Date.now() + path.extname(name));
        const tmpOut = tmpIn.replace(/(\.[^.]+)?$/, '-small.mp4');
        try {
          fs.writeFileSync(tmpIn, buf);
          const r = shrinkVideo(tmpIn, tmpOut);
          if (r.ok) {
            const small = fs.readFileSync(tmpOut);
            if (small.length && small.length < buf.length) {
              out = small;
              shrunk = true;
            }
          } else if (r.reason === 'no-ffmpeg') {
            note = '本机没装视频压缩工具，视频按原样上传了';
          } else {
            note = '视频压缩失败，按原样上传';
          }
        } catch (e) {
          note = '视频压缩失败，按原样上传';
        } finally {
          try { fs.unlinkSync(tmpIn); } catch (e) {}
          try { fs.unlinkSync(tmpOut); } catch (e) {}
        }
      }

      fs.writeFileSync(path.join(dir, name), out);
      sendJson(res, 200, {
        ok: true,
        path: '/' + sub + '/' + name,
        size: out.length,
        originalSize: buf.length,
        shrunk: shrunk,
        note: note,
      });
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
      // 图标固定存成 site-icon.*：主题自带一个同名 favicon.ico（蝴蝶），
      // 同一个文件名会被主题的静态文件覆盖，导致「上传了还是旧图标」。
      const faviconPath = (data.faviconFile && data.faviconFile.dataUrl)
        ? (saveDataUrl(base, data.faviconFile.dataUrl, 'site-icon') ||
           (function () { throw new Error('图标格式不支持（ico / png / jpg / svg）'); })())
        : data.faviconPath;
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
        [['avatar', 'effect'], 'false'],
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
      // ---- 主页背景（多图轮播 / 视频）与首页标语样式 ----
      const numOr = (v) => {
        if (v === undefined || v === null || String(v).trim() === '') return undefined;
        const n = Number(v);
        return isNaN(n) ? undefined : n;
      };
      if (Array.isArray(data.heroImages)) {
        const r = ensureList(thNext, ['wb_look', 'hero_images'], data.heroImages);
        if (r != null) thNext = r;
      }
      [
        [['wb_look', 'hero_video'], data.heroVideo === undefined ? undefined : String(data.heroVideo).trim()],
        [['wb_look', 'hero_interval'], numOr(data.heroInterval)],
        [['wb_look', 'hero_scope'], data.heroScope],
        [['wb_look', 'hero_overlay'], numOr(data.heroOverlay)],
        [['wb_look', 'sub_size'], numOr(data.subSize)],
        [['wb_look', 'sub_spacing'], numOr(data.subSpacing)],
        [['wb_look', 'sub_color'], data.subColor === undefined ? undefined : String(data.subColor).trim()],
        [['wb_look', 'sub_weight'], numOr(data.subWeight)],
        [['subtitle', 'typed_option', 'typeSpeed'], numOr(data.typeSpeed)],
        [['subtitle', 'typed_option', 'backSpeed'], numOr(data.backSpeed)],
        [['subtitle', 'typed_option', 'backDelay'], numOr(data.backDelay)],
        [['subtitle', 'typed_option', 'loop'], data.typedLoop === undefined ? undefined : (data.typedLoop ? 'true' : 'false')],
      ].forEach(([p, v]) => {
        if (v === undefined) return;
        const r = ensureScalar(thNext, p, v);
        if (r != null) thNext = r;
      });

      // ---- 细节开关：图片放大 / 运行天数 / 首页卡片样式 / 404 页面 ----
      const boolStr = (v) => (v === undefined ? undefined : (v ? 'true' : 'false'));
      const strOr = (v) => (v === undefined ? undefined : String(v).trim());
      [
        [['wb_look', 'img_zoom'], boolStr(data.imgZoom)],
        [['wb_look', 'uptime_enable'], boolStr(data.uptimeEnable)],
        [['wb_look', 'uptime_since'], strOr(data.uptimeSince)],
        [['wb_look', 'uptime_text'], strOr(data.uptimeText)],
        [['index_layout'], numOr(data.indexStyle)],
        [['wb_look', 'notfound_enable'], boolStr(data.notfoundEnable)],
        [['wb_look', 'notfound_title'], strOr(data.nfTitle)],
        [['wb_look', 'notfound_subtitle'], strOr(data.nfSub)],
        [['wb_look', 'notfound_text'], strOr(data.nfText)],
        [['wb_look', 'notfound_btn'], strOr(data.nfBtn)],
        // 头像旋转：不依赖主题 styl 编译（主题的 avatar.effect 改动后常常不生效），
        // 统一写进 wb_look.avatar_spin，由 scripts/wb-look.js 注入/关闭动画。
        [['wb_look', 'avatar_spin'], boolStr(data.avatarEffect)],
        // 正文图片默认宽度 / 上传自动压缩
        [['wb_look', 'post_img_width'], numOr(data.postImgWidth)],
        [['wb_look', 'upload_shrink'], boolStr(data.uploadShrink)],
      ].forEach(([p, v]) => {
        if (v === undefined) return;
        const r = ensureScalar(thNext, p, v);
        if (r != null) thNext = r;
      });

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

      /* --- site.yml：邮箱 + 页面密码 + 联系方式 --- */
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
      if (Array.isArray(data.contacts)) {
        siteData.contacts = data.contacts
          .filter((c) => c && String(c.label || '').trim())
          .map((c) => ({
            label: String(c.label).trim(),
            icon: String(c.icon || 'fas fa-link').trim(),
            value: String(c.value || '').trim(),
            href: String(c.href || '').trim(),
            qr: String(c.qr || '').trim(),
            hint: String(c.hint || '').trim(),
            hidden: !!c.hidden,
          }));
        // 邮箱改了，联系方式里的邮箱跟着改
        if (mail) {
          siteData.contacts.forEach((c) => {
            if (/^mailto:/i.test(c.href)) c.href = 'mailto:' + mail;
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.value)) c.value = mail;
          });
        }
      }
      writeWhole(base, F_SITE_DATA, dumpSiteData(siteData), touched, '联系方式 / 页面密码');

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

      // 把「最终落盘的值」回传前端：上传后文件名会带内容指纹，
      // 前端输入框如果不跟着更新，下次保存就会把旧路径写回去
      // （这就是「换完图又自动恢复成原来那张」的根源）。
      let paths = {};
      try {
        const th = require('js-yaml').load(thNext) || {};
        paths = {
          avatarPath: (th.avatar && th.avatar.img) || '',
          bannerPath: th.index_img || '',
          faviconPath: th.favicon || '',
          navBgPath: (th.wb_look && th.wb_look.nav_bg) || '',
          footerBgPath: typeof th.footer_img === 'string' ? th.footer_img : '',
        };
      } catch (e) { /* 解析失败就不回传，前端保持原样 */ }

      sendJson(res, 200, { ok: true, touched: touched.length ? touched : ['（没有变化）'], paths: paths });
      return;
    }

    // 单篇文章密码：只改 front-matter 里的 password，不动正文
    if (req.method === 'POST' && url === '/postpass') {
      const data = JSON.parse((await readBody(req)) || '{}');
      const file = String(data.file || '');
      const pwd = String(data.password || '').trim();
      if (!/^[^\\/]+\.md$/i.test(file)) throw new Error('文件名不合法');
      const abs = path.join(base, 'source', '_posts', file);
      if (!fs.existsSync(abs)) throw new Error('找不到这篇文章：' + file);
      const raw = readText(abs);
      const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!m) throw new Error('这篇文章开头没有 front-matter（--- 包起来的那段）');
      let fm = m[1];
      const lineRe = /^password:.*(?:\r?\n)?/m;
      if (pwd) {
        const val = '"' + pwd.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        fm = lineRe.test(fm)
          ? fm.replace(lineRe, 'password: ' + val + '\n')
          : fm.replace(/\s*$/, '') + '\npassword: ' + val + '\n';
      } else if (lineRe.test(fm)) {
        fm = fm.replace(lineRe, '');
      }
      const next = raw.replace(m[1], fm);
      if (next !== raw) fs.writeFileSync(abs, next);
      try {
        if (typeof hexo.load === 'function') await hexo.load();
      } catch (e) { /* 文件已写入 */ }
      sendJson(res, 200, { ok: true, password: pwd });
      return;
    }

    // 正文图片大小：只改图片地址后面的 ?w= 参数，正文其它内容一个字都不动
    if (req.method === 'POST' && url === '/postimg') {
      const data = JSON.parse((await readBody(req)) || '{}');
      const file = String(data.file || '');
      if (!/^[^\\/]+\.md$/i.test(file)) throw new Error('文件名不合法');
      const abs = path.join(base, 'source', '_posts', file);
      if (!fs.existsSync(abs)) throw new Error('找不到这篇文章：' + file);
      let raw = readText(abs);
      const items = Array.isArray(data.images) ? data.images : [];
      let changed = 0;
      items.forEach((it) => {
        const src = String(it.src || '').trim();
        const w = String(it.width || '').trim();
        if (!src) return;
        raw = setImgWidth(raw, src, w, () => { changed++; });
      });
      if (changed) {
        const next = raw;
        if (next !== readText(abs)) fs.writeFileSync(abs, next);
        try { if (typeof hexo.load === 'function') await hexo.load(); } catch (e) { /* 已写入 */ }
      }
      // 整篇图片宽度（front-matter 的 img_width），和 Pages CMS 里那个下拉是同一个字段
      if (data.imgWidth !== undefined) {
        let raw2 = readText(abs);
        const cur2 = (raw2.match(/^img_width:\s*(.+)$/m) || [])[1];
        const now = cur2 ? cur2.replace(/["']/g, '').trim() : '';
        const want = String(data.imgWidth || '').trim();
        if (now !== want) {
          raw2 = setFmField(raw2, 'img_width', want);
          fs.writeFileSync(abs, raw2);
          changed++;
          try { if (typeof hexo.load === 'function') await hexo.load(); } catch (e) { /* 已写入 */ }
        }
      }
      sendJson(res, 200, { ok: true, changed: changed });
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
  const wb = theme.wb_look || {};
  const wbOn = function (v, dflt) {
    if (v === undefined || v === null || v === '') return dflt === false ? '' : ' checked';
    const s = String(v).trim().toLowerCase();
    return s === 'false' || s === '0' || s === 'off' ? '' : ' checked';
  };
  const heroImages = Array.isArray(wb.hero_images) ? wb.hero_images : [];
  const heroVideo = typeof wb.hero_video === 'string' ? wb.hero_video : '';
  const typed = (theme.subtitle && theme.subtitle.typed_option) || {};
  const contacts = cur.siteData.contacts || [];
  const footerBg = typeof theme.footer_img === 'string' ? theme.footer_img : '';
  const subs = (theme.subtitle && theme.subtitle.sub) || [];
  const waline = theme.waline || {};
  const social = cur.social || {};
  const github = social['fab fa-github'] || '';
  // 文章列表（给「文章密码」用）：只读 front-matter，不动正文
  const postList = (function () {
    const dir = path.join(hexo.base_dir, 'source', '_posts');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => /\.md$/i.test(f))
      .map((f) => {
        const raw = readText(path.join(dir, f));
        const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const fm = m ? m[1] : '';
        const t = fm.match(/^title:\s*(.+)$/m);
        const p = fm.match(/^password:\s*(.+)$/m);
        const clean = (s) => String(s || '').trim().replace(/^["']|["']$/g, '');
        // 顺便扫一遍正文里的图片，给「正文图片大小」面板用
        const body = m ? raw.slice(m[0].length) : raw;
        const images = [];
        const seen = {};
        const pushImg = (u) => {
          const src = String(u || '').trim();
          if (!src || !/^(\/|https?:)/i.test(src) || seen[src]) return;
          seen[src] = 1;
          const wm = src.match(/[?#&]w=([^&?#]+)/);
          images.push({ src: src.replace(/[?#&]w=[^&?#]*/g, ''), full: src, w: wm ? wm[1] : '' });
        };
        const mdRe = /!\[[^\]]*\]\(([^)\s]+)/g;
        let mm;
        while ((mm = mdRe.exec(body))) pushImg(mm[1]);
        const imgRe = /<img\b[^>]*\bsrc=["']([^"']+)/gi;
        while ((mm = imgRe.exec(body))) pushImg(mm[1]);

        const iw = fm.match(/^img_width:\s*(.+)$/m);
        return {
          file: f,
          title: clean(t && t[1]) || f.replace(/\.md$/, ''),
          password: clean(p && p[1]),
          imgWidth: clean(iw && iw[1]),
          images: images,
        };
      })
      .sort((a, b) => (a.file < b.file ? 1 : -1));
  })();
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

  // 「正文图片大小」面板：按文章列出正文里的每张图 + 可手填的宽度
  const numOf = (w) => String(w || '').replace(/[^\d.]/g, '');
  const shortName = (src) => {
    const base = String(src).split('/').pop().split('?')[0] || '图片';
    if (base.length <= 26) return base;
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 ? base.slice(dot) : '';
    return base.slice(0, 26 - ext.length - 1) + '…' + ext;
  };

  const imgRows = postList
    .filter((p) => p.images && p.images.length)
    .map((p) => {
      const rows = p.images
        .map((im) => {
          const v = numOf(im.w);
          const pct = v ? Math.min(100, Math.max(10, Number(v))) : 100;
          return (
            '<div class="pi-row" data-src="' + esc(im.src) + '">' +
            '<div class="pi-frame"><img class="pi-thumb" src="' + esc(im.src) + '" alt="" loading="lazy" style="width:' + pct + '%"></div>' +
            '<div class="pi-meta">' +
            '<div class="pi-name" title="' + esc(im.src) + '">' + esc(shortName(im.src)) + '</div>' +
            '<div class="pi-sub">' + (v ? '单独设置 ' + esc(v) + '%' : '跟随整篇') + '</div>' +
            '</div>' +
            '<div class="pi-ctl">' +
            '<input class="pi-w" type="number" min="10" max="100" step="1" value="' + esc(v) + '" placeholder="跟随">' +
            '<span class="pi-pct">%</span>' +
            '</div>' +
            '</div>'
          );
        })
        .join('');
      return (
        '<div class="pi-post" data-file="' + esc(p.file) + '">' +
        '<div class="pi-head">' +
        '<div class="pi-title" title="' + esc(p.file) + '">' + esc(p.title) + '</div>' +
        '<div class="pi-all"><span>整篇</span>' +
        '<input class="pi-all-w" type="number" min="10" max="100" step="1" value="' + esc(numOf(p.imgWidth)) + '" placeholder="跟全站"><span class="pi-pct">%</span>' +
        '</div>' +
        '</div>' +
        rows +
        '</div>'
      );
    })
    .join('');

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
  /* 正文图片面板 */
  .pi-post{background:#fff;border:1px solid #e8ecf3;border-radius:12px;padding:12px 14px;margin-top:12px}
  .pi-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-bottom:8px;border-bottom:1px solid #eef1f6}
  .pi-title{flex:1 1 140px;min-width:0;font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pi-all{display:flex;align-items:center;gap:4px;font-size:12px;color:#7b8698;flex:0 0 auto;white-space:nowrap}
  .pi-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #f1f4f9;min-width:0}
  .pi-row:last-child{border-bottom:0}
  .pi-frame{flex:0 0 150px;width:150px;height:94px;border-radius:8px;background:#eef1f6;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .pi-thumb{max-width:100%;max-height:100%;width:auto;height:auto;border-radius:6px;transition:width .15s ease}
  .pi-meta{flex:1 1 0;min-width:0;overflow:hidden}
  .pi-name{font-size:12.5px;color:#4b5563;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pi-sub{font-size:11px;color:#9aa7bd;line-height:1.3;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pi-ctl{flex:0 0 auto;display:flex;align-items:center;gap:3px}
  .pi-ctl input,.pi-all input{width:62px;padding:6px 6px;border-radius:8px;border:1px solid #d7dce6;background:#fff;font-size:13px;text-align:center}
  .pi-ctl input:focus,.pi-all input:focus{outline:2px solid #c7d2fe;border-color:#93a4f7}
  .pi-pct{font-size:12px;color:#9aa7bd}
  @media (max-width:560px){
    .pi-post{padding:10px}
    .pi-frame{flex-basis:96px;width:96px;height:64px}
    .pi-title{flex-basis:100%}
  }
</style>
</head>
<body>
<div class="wrap">
  <h1>站点设置<span class="badge">仅本机可改</span></h1>
  <div class="sub">改完点「保存」，本地预览立刻变；点「保存并发布到线上」1-2 分钟后网站更新。返回 <a href="/">网站预览</a> · <a href="/admin">写文章后台</a></div>

  <div class="tabs" id="tabs">
    <button data-tab="basic" class="on">基本信息</button>
    <button data-tab="ct">联系方式</button>
    <button data-tab="look">外观图片</button>
    <button data-tab="nav">导航菜单</button>
    <button data-tab="dl">下载区</button>
    <button data-tab="pw">页面密码</button>
    <button data-tab="cm">评论区</button>
    <button data-tab="msg">留言管理</button>
    <button data-tab="img">正文图片</button>
    <button data-tab="misc">细节开关</button>
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
        <div class="row" style="margin-top:12px">
          <div class="field" style="max-width:170px"><label>打字速度（毫秒/字）</label><input type="number" id="typeSpeed" min="10" max="500" value="${esc(typed.typeSpeed == null ? 150 : typed.typeSpeed)}">
            <div class="hint">越小越快：40 飞快、80 正常、150 慢</div>
          </div>
          <div class="field" style="max-width:170px"><label>每句停多久（毫秒）</label><input type="number" id="backDelay" min="0" max="10000" value="${esc(typed.backDelay == null ? 1500 : typed.backDelay)}"></div>
          <div class="field" style="max-width:170px"><label>删字速度（毫秒/字）</label><input type="number" id="backSpeed" min="10" max="300" value="${esc(typed.backSpeed == null ? 50 : typed.backSpeed)}"></div>
          <div class="field" style="max-width:150px"><label>一直循环</label>
            <select id="typedLoop">
              <option value="1"${typed.loop === false ? '' : ' selected'}>循环播放</option>
              <option value="0"${typed.loop === false ? ' selected' : ''}>打完就停</option>
            </select>
          </div>
        </div>
        <div class="row">
          <div class="field" style="max-width:150px"><label>字号 px</label><input type="number" id="subSize" min="0" max="80" value="${esc(wb.sub_size || 0)}">
            <div class="hint">0 = 跟随主题</div>
          </div>
          <div class="field" style="max-width:150px"><label>字间距 px</label><input type="number" id="subSpacing" min="-5" max="20" value="${esc(wb.sub_spacing || 0)}"></div>
          <div class="field" style="max-width:150px"><label>字重</label>
            <select id="subWeight">
              ${[0, 300, 400, 500, 600, 700].map((w) => '<option value="' + w + '"' + (Number(wb.sub_weight || 0) === w ? ' selected' : '') + '>' + (w === 0 ? '跟随主题' : w) + '</option>').join('')}
            </select>
          </div>
          <div class="field" style="max-width:200px"><label>颜色</label><input type="text" id="subColor" value="${esc(wb.sub_color || '')}" placeholder="留空跟随主题，如 #ffffff">
          </div>
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

    <!-- ===== 1.5 联系方式 ===== -->
    <div class="panel" id="p-ct">
      <div class="card">
        <h2>关于页的联系方式<span class="badge">显示在 /about/</span></h2>
        <div class="desc">
          除了 GitHub 和邮箱，还能放微信、QQ、Telegram 等。<b>填了「链接」就是普通链接</b>（点了直接跳转）；
          <b>没填链接就点一下弹出小窗</b>，显示账号 / 号码和二维码，带「复制」按钮。
          不想让它出现在网页上，勾「不显示」即可（内容留着）。
        </div>
        <div id="ctList"></div>
        <button type="button" class="ghost" id="ctAdd">+ 添加一个</button>
        <div class="warn">
          图标是 Font Awesome 写法，常用的：<br>
          fab fa-weixin 微信 · fab fa-qq QQ · fab fa-telegram 电报 · fab fa-weibo 微博 ·
          fab fa-bilibili B站 · fab fa-x-twitter X · fab fa-discord Discord · fab fa-github GitHub ·
          fas fa-envelope 邮箱 · fas fa-comments 其他<br>
          二维码图片建议正方形、300×300 以上。
        </div>
      </div>
    </div>

    <!-- ===== 2 外观 ===== -->
    <div class="panel" id="p-look">
      <div class="card">
        <h2>主页背景：多图轮播 / 视频<span class="badge">推荐</span></h2>
        <div class="desc">
          放 2 张以上会自动淡入淡出轮播，顺序就是下面列表的顺序；也能传一段短视频当背景
          （视频优先，图片只作为加载前的封面）。这里设了之后，会盖掉下面那张「顶部大图」。
        </div>
        <div id="heroList"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button type="button" class="ghost" id="heroAddBtn">+ 添加图片</button>
          <input type="file" id="heroPick" accept="image/*" multiple style="display:none">
          <span class="hint" id="heroState"></span>
        </div>
        <div class="row" style="margin-top:14px">
          <div class="field" style="max-width:170px"><label>切换间隔（秒）</label><input type="number" id="heroInterval" min="2" max="60" value="${esc(wb.hero_interval == null ? 6 : wb.hero_interval)}"></div>
          <div class="field" style="max-width:190px"><label>作用范围</label>
            <select id="heroScope">
              <option value="home"${String(wb.hero_scope || 'home') === 'all' ? '' : ' selected'}>只首页</option>
              <option value="all"${String(wb.hero_scope || 'home') === 'all' ? ' selected' : ''}>全站每一页</option>
            </select>
          </div>
          <div class="field" style="max-width:190px"><label>压暗程度 %</label><input type="number" id="heroOverlay" min="0" max="60" value="${esc(wb.hero_overlay == null ? 20 : wb.hero_overlay)}">
            <div class="hint">图片太亮、标题看不清就调大</div>
          </div>
        </div>
        <div class="row">
          <div class="field" style="flex:1 1 300px"><label>视频背景（mp4 / webm，建议 ≤ 15MB）</label>
            <input type="text" id="heroVideoPath" value="${esc(heroVideo)}" placeholder="留空 = 只用图片">
            <div class="hint">手机和电脑都会自动静音循环播放；动效太强的话建议加一层压暗。</div>
          </div>
          <div class="field" style="flex:0 0 auto;margin-top:26px">
            <input type="file" id="heroVideoPick" accept="video/mp4,video/webm">
          </div>
        </div>
        <div class="hint" id="heroVideoState"></div>
        <div class="warn">
          体积提醒：图片单张控制在 500KB 以内、视频 15MB 以内。GitHub 单文件上限 100MB，
          但太大了手机打开会很久。视频建议 6–12 秒循环、无音轨。
        </div>
      </div>

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
            <div class="hint">支持 .ico / .png / .svg，建议正方形、32×32 以上。会自动存成 /img/site-icon.*（不和主题内置图标撞名）。改完浏览器可能要强刷（Ctrl+F5）才变。</div>
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
          <label class="chk"><input type="checkbox" id="avatarEffect"${wb.avatar_spin === false ? '' : ' checked'}><span>头像旋转特效</span></label>
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
    <!-- ===== 正文图片大小 ===== -->
    <div class="panel" id="p-img">
      <div class="card">
        <h2>正文图片大小<span class="badge">不用改代码</span></h2>
        <div class="desc">先看每篇文章右上角的「整篇图片」：选一个宽度就能管整篇的图，不用一张张调。想单独调某张，再改它自己那一行。</div>
        <div class="warn">在 Pages CMS 里在线写文章时，文章表单里同样有「正文图片宽度」这一项，选一下就行，不用回本地改。这里只用做批量微调。</div>
        <div id="postImgList">${imgRows || '<div class="hint">文章正文里还没插入图片。</div>'}</div>
        <button type="button" id="postImgSave" style="margin-top:14px">保存图片大小</button>
        <div class="hint" id="postImgState" style="margin-top:8px"></div>
      </div>
    </div>

    <!-- ===== 9 细节开关 ===== -->
    <div class="panel" id="p-misc">
      <div class="card">
        <h2>小细节<span class="badge">可随时开关</span></h2>
        <div class="desc">都是不影响正文的小功能，勾 / 取消勾选后点「保存」即可。</div>
        <div class="row">
          <div class="field" style="flex:1 1 240px">
            <label><input type="checkbox" id="imgZoom"${wbOn(wb.img_zoom, true)}> 正文图片点击放大</label>
            <div class="hint">点文章里的图全屏看原图，按 Esc 或再点一下关闭。</div>
          </div>
          <div class="field" style="flex:1 1 240px">
            <label><input type="checkbox" id="uptimeEnable"${wbOn(wb.uptime_enable, true)}> 页脚显示「已运行 XXX 天」</label>
            <div class="hint">按今天的日期自动算，不用每年改。</div>
          </div>
        </div>
        <div class="row">
          <div class="field" style="max-width:210px"><label>建站日期</label>
            <input type="date" id="uptimeSince" value="${esc(wb.uptime_since || '2021-01-01')}">
            <div class="hint">从这天开始数天数</div>
          </div>
          <div class="field" style="flex:1 1 260px"><label>显示文字</label>
            <input type="text" id="uptimeText" value="${esc(wb.uptime_text || '本站已运行 {days} 天')}">
            <div class="hint">{days} 换成天数，{since} 换成上面的日期。</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>首页文章排版</h2>
        <div class="desc">改的是首页那个文章列表的排列方式（主题原生排版，手机上都会自动适配）。</div>
        <div class="field" style="max-width:380px"><label>排列方式</label>
          <select id="indexStyle">
            <option value="3"${String(theme.index_layout) === '3' ? ' selected' : ''}>交错小卡片（现在这样）</option>
            <option value="1"${String(theme.index_layout) === '1' ? ' selected' : ''}>图文大卡片 · 图在左</option>
            <option value="2"${String(theme.index_layout) === '2' ? ' selected' : ''}>图文大卡片 · 图在右</option>
            <option value="6"${String(theme.index_layout) === '6' ? ' selected' : ''}>瀑布流 A</option>
            <option value="7"${String(theme.index_layout) === '7' ? ' selected' : ''}>瀑布流 B（更紧凑）</option>
          </select>
          <div class="hint">选"图文大卡片"时，文章要自己设置了封面图才会显示图（Pages CMS 表单里有"封面图"一格）；没设封面的文章会显示成纯文字卡。</div>
        </div>
      </div>

      <div class="card">
        <h2>正文图片与上传</h2>
        <div class="row">
          <div class="field" style="max-width:260px"><label>正文图片默认宽度</label>
            <select id="postImgWidth">
              <option value="100"${Number(wb.post_img_width) === 100 || wb.post_img_width === undefined ? ' selected' : ''}>100%（撑满正文）</option>
              <option value="85"${Number(wb.post_img_width) === 85 ? ' selected' : ''}>85%（略收一点）</option>
              <option value="70"${Number(wb.post_img_width) === 70 ? ' selected' : ''}>70%（画面内留白）</option>
              <option value="60"${Number(wb.post_img_width) === 60 ? ' selected' : ''}>60%（小一点）</option>
              <option value="50"${Number(wb.post_img_width) === 50 ? ' selected' : ''}>50%（半宽）</option>
            </select>
            <div class="hint">想单独调某一张：在图片地址后面加 <code>?w=60%</code> 或 <code>?w=400px</code>，这张就按那个大小显示。</div>
          </div>
          <div class="field" style="flex:1 1 280px">
            <label><input type="checkbox" id="uploadShrink"${wbOn(wb.upload_shrink, true)}> 上传图片 / 视频时自动压缩</label>
            <div class="hint">图片：最长边 1920px 转 webp；视频：最长边 1600px、CRF 28 重编码（体积通常只剩 1/5）；肉眼看不出差别。上传时会显示压缩前后大小。</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>文章密码<span class="badge">单篇加密</span></h2>
        <div class="desc">填了密码的文章，网页上必须输密码才显示正文（构建时就加密，查看网页源码也看不到内容）。留空并保存＝取消密码。Pages CMS 里也有同一个「访问密码」格子。</div>
        <div id="postPassList" class="hint">读取中…</div>
      </div>

      <div class="card">
        <h2>自定义 404 页面<span class="badge">输错网址时</span></h2>
        <div class="desc">别人访问不存在的地址时看到的页面。留空就用默认文字。</div>
        <div class="row">
          <div class="field" style="max-width:160px"><label>大数字</label>
            <input type="text" id="nfTitle" value="${esc(wb.notfound_title || '404')}">
          </div>
          <div class="field" style="flex:1 1 240px"><label>小标题</label>
            <input type="text" id="nfSub" value="${esc(wb.notfound_subtitle || '这一页走丢了')}">
          </div>
        </div>
        <div class="field"><label>说明文字</label>
          <textarea id="nfText" rows="2">${esc(wb.notfound_text || '地址可能拼错、文章可能挪了位置，也可能它从来就没存在过。')}</textarea>
        </div>
        <div class="row">
          <div class="field" style="max-width:220px"><label>按钮文字</label>
            <input type="text" id="nfBtn" value="${esc(wb.notfound_btn || '回到首页')}">
          </div>
          <div class="field" style="flex:0 0 auto;margin-top:26px">
            <label><input type="checkbox" id="nfEnable"${wbOn(wb.notfound_enable, true)}> 启用自定义 404</label>
          </div>
        </div>
      </div>
    </div>

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
    contacts: contacts,
    heroImages: heroImages,
    posts: postList,
  }).replace(/</g, '\\u003c')}</script>
<script>
var $ = function (s) { return document.querySelector(s); };
var statusEl = $('#status');
function setStatus(text, kind) { statusEl.textContent = text; statusEl.className = 'status ' + (kind || ''); }
var boot = JSON.parse(document.getElementById('bootData').textContent || '{}');var picked = { avatar: null, banner: null, favicon: null, navBg: null, footerBg: null };

/* 细节开关：把 checkbox / 输入框的值并进原来的表单数据 */
function collectAll() {
  var d = collect();
  var cb = function (id, k) { var el = document.getElementById(id); if (el) d[k] = !!el.checked; };
  var tx = function (id, k) { var el = document.getElementById(id); if (el) d[k] = el.value; };
  tx('postImgWidth', 'postImgWidth');
  cb('uploadShrink', 'uploadShrink');
  cb('imgZoom', 'imgZoom');
  cb('uptimeEnable', 'uptimeEnable');
  cb('notfoundEnable', 'notfoundEnable');
  tx('uptimeSince', 'uptimeSince');
  tx('uptimeText', 'uptimeText');
  tx('indexStyle', 'indexStyle');
  tx('nfTitle', 'nfTitle');
  tx('nfSub', 'nfSub');
  tx('nfText', 'nfText');
  tx('nfBtn', 'nfBtn');
  return d;
}

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
function kb(n) { return n >= 1024 * 1024 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
function wantShrink() { var el = document.getElementById('uploadShrink'); return !el || el.checked; }
/* 浏览器里先把图缩小再上传：最长边 1920、webp 质量 0.86，画质基本无损 */
function shrinkImage(file) {
  return new Promise(function (resolve) {
    if (file.type !== 'image/jpeg' && file.type !== 'image/png' && file.type !== 'image/webp') return resolve(file);
    if (file.size < 200 * 1024) return resolve(file);
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function () {
      var max = 1920;
      var s = Math.min(1, max / Math.max(img.width, img.height));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * s));
      c.height = Math.max(1, Math.round(img.height * s));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      function done(blob) {
        URL.revokeObjectURL(url);
        if (!blob || blob.size >= file.size * 0.92) return resolve(file);
        var webp = blob.type === 'image/webp';
        var name = file.name.replace(/\.[^.]+$/, '') + (webp ? '.webp' : '.jpg');
        var out = new File([blob], name, { type: blob.type });
        out._from = file.size;
        resolve(out);
      }
      try {
        c.toBlob(function (b) {
          if (b && b.type === 'image/webp') return done(b);
          c.toBlob(done, 'image/jpeg', 0.86);
        }, 'image/webp', 0.86);
      } catch (e) { URL.revokeObjectURL(url); resolve(file); }
    };
    img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

function hookFile(input, key, thumbId) {
  var el = document.getElementById(input);
  if (!el) return;
  el.addEventListener('change', function () {
    var f = el.files && el.files[0];
    if (!f) return;
    setStatus('处理图片…', '');
    var prep = wantShrink() ? shrinkImage(f) : Promise.resolve(f);
    prep.then(function (f2) {
      var r = new FileReader();
      r.onload = function () {
        picked[key] = { name: f2.name, dataUrl: r.result };
        var t = document.getElementById(thumbId);
        if (t) t.style.backgroundImage = 'url(' + r.result + ')';
        var note = f2.size < f.size ? '（已压缩 ' + kb(f.size) + ' → ' + kb(f2.size) + '）' : '';
        setStatus('已选择新图片' + note + '，记得点保存', '');
      };
      r.readAsDataURL(f2);
    });
  });
}
hookFile('avatarFile', 'avatar', 'avatarThumb');
hookFile('bannerFile', 'banner', 'bannerThumb');
hookFile('faviconFile', 'favicon', 'faviconThumb');
hookFile('navBgFile', 'navBg', 'navBgThumb');
hookFile('footerBgFile', 'footerBg', 'footerBgThumb');

/* 保存后用服务器回传的真实路径刷新输入框和缩略图（上传会改名，不回填就会写回旧路径） */
function applySavedPaths(p) {
  if (!p) return;
  var map = [
    ['avatarPath', 'avatarThumb'],
    ['bannerPath', 'bannerThumb'],
    ['faviconPath', 'faviconThumb'],
    ['navBgPath', 'navBgThumb'],
    ['footerBgPath', 'footerBgThumb'],
  ];
  map.forEach(function (m) {
    var v = p[m[0]];
    if (typeof v !== 'string' || !v) return;
    var inp = document.getElementById(m[0]);
    if (inp) inp.value = v;
    var t = document.getElementById(m[1]);
    if (t) t.style.backgroundImage = 'url(' + v + ')';
  });
}

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

/* ---- 主页背景 ---- */
function uploadMedia(file, kind) {
  var prep = kind === 'img' && wantShrink() ? shrinkImage(file) : Promise.resolve(file);
  return prep
    .then(function (f) {
      var q = '/site/media?kind=' + kind + '&name=' + encodeURIComponent(f.name) + (wantShrink() ? '&shrink=1' : '');
      return fetch(q, { method: 'POST', body: f });
    })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j.ok) throw new Error(j.error || '上传失败');
      return j;
    });
}
function heroRow(src) {
  var el = document.createElement('div');
  el.className = 'item hero-item';
  el.innerHTML =
    '<div class="row" style="align-items:center;margin-bottom:0">' +
    '<div class="thumb" style="width:132px;height:70px"></div>' +
    '<div class="field" style="flex:1 1 200px;margin-top:0"><input type="text" data-k="src" value="' + esc2(src || '') + '"></div>' +
    '<div style="display:flex;gap:6px">' +
    '<button type="button" class="mini hero-up">↑</button>' +
    '<button type="button" class="mini hero-down">↓</button>' +
    '<button type="button" class="mini danger hero-del">删除</button>' +
    '</div></div>';
  var th = el.querySelector('.thumb');
  var inp = el.querySelector('[data-k=src]');
  var paint = function () {
    var v = inp.value.trim();
    th.style.backgroundImage = v ? 'url("' + v + '")' : 'none';
  };
  paint();
  inp.addEventListener('input', paint);
  el.querySelector('.hero-up').addEventListener('click', function () { move(el, -1); });
  el.querySelector('.hero-down').addEventListener('click', function () { move(el, 1); });
  el.querySelector('.hero-del').addEventListener('click', function () { el.remove(); setStatus('已删除一张背景图（未保存）', ''); });
  return el;
}
function initHero() {
  var list = $('#heroList');
  list.innerHTML = '';
  var data = boot.heroImages || [];
  if (!data.length) { var e = document.createElement('div'); e.className = 'empty'; e.textContent = '还没有设置，现在用的是下面那张「顶部大图」。'; list.appendChild(e); return; }
  data.forEach(function (s) { list.appendChild(heroRow(s)); });
}
function collectHero() {
  return Array.prototype.map.call(document.querySelectorAll('#heroList .hero-item'), function (el) {
    return el.querySelector('[data-k=src]').value.trim();
  }).filter(Boolean);
}
$('#heroAddBtn').addEventListener('click', function () { $('#heroPick').click(); });
$('#heroPick').addEventListener('change', function () {
  var files = Array.prototype.slice.call(this.files || []);
  if (!files.length) return;
  var picks = files.slice(0, 8);
  var state = $('#heroState');
  var done = 0;
  var fail = 0;
  picks.reduce(function (chain, f) {
    return chain.then(function () {
      state.textContent = '上传中… ' + f.name + '（' + (done + 1) + '/' + picks.length + '）';
      return uploadMedia(f, 'img').then(function (j) {
        var e = $('#heroList .empty'); if (e) e.remove();
        $('#heroList').appendChild(heroRow(j.path));
        done++;
      }).catch(function (err) { fail++; state.textContent = '失败：' + f.name + '（' + err.message + '）'; });
    });
  }, Promise.resolve()).then(function () {
    state.textContent = '已上传 ' + done + ' 张' + (fail ? '，失败 ' + fail + ' 张' : '') + '，记得点保存';
    if (done) setStatus('背景图已上传，记得保存', '');
    $('#heroPick').value = '';
  });
});
$('#heroVideoPick').addEventListener('change', function () {
  var f = this.files && this.files[0];
  if (!f) return;
  var st = $('#heroVideoState');
  var big = f.size > 3 * 1024 * 1024;
  st.textContent = '上传中… ' + f.name + (wantShrink() && big ? '（正在压缩，大视频要等十几秒）' : '');
  uploadMedia(f, 'video').then(function (j) {
    $('#heroVideoPath').value = j.path;
    var note = '';
    if (j.shrunk) note = '，已压缩 ' + fmtSize(j.originalSize) + ' → ' + fmtSize(j.size);
    else if (j.note) note = '，' + j.note;
    st.textContent = '已上传：' + j.path + '（' + fmtSize(j.size) + note + '），记得点保存';
    setStatus('视频已上传' + (j.shrunk ? '并压缩' : '') + '，记得保存', '');
  }).catch(function (err) { st.textContent = '上传失败：' + err.message; });
  this.value = '';
});

/* ---- 联系方式 ---- */
function ctRow(c) {
  c = c || { label: '', icon: 'fab fa-weixin', value: '', href: '', qr: '', hint: '', hidden: false };
  var el = document.createElement('div');
  el.className = 'item ct-item';
  el.innerHTML =
    '<div class="row">' +
    '<div class="field" style="flex:0 1 120px"><label>名称</label><input type="text" data-k="label" value="' + esc2(c.label || '') + '" placeholder="微信"></div>' +
    '<div class="field" style="flex:0 1 190px"><label>图标</label><input type="text" data-k="icon" value="' + esc2(c.icon || '') + '" placeholder="fab fa-weixin"></div>' +
    '<div class="field" style="flex:1 1 160px"><label>账号 / 号码</label><input type="text" data-k="value" value="' + esc2(c.value || '') + '"></div>' +
    '<div class="field" style="flex:0 0 auto;margin-top:26px;display:flex;gap:6px">' +
    '<button type="button" class="mini ct-up">↑</button>' +
    '<button type="button" class="mini ct-down">↓</button>' +
    '<button type="button" class="mini danger ct-del">删除</button>' +
    '</div></div>' +
    '<div class="row">' +
    '<div class="field" style="flex:1 1 220px"><label>链接（可空，填了就直接跳转）</label><input type="text" data-k="href" value="' + esc2(c.href || '') + '" placeholder="https://… 或 mailto:…"></div>' +
    '<div class="field" style="flex:1 1 180px"><label>备注（弹窗里的小字，可空）</label><input type="text" data-k="hint" value="' + esc2(c.hint || '') + '"></div>' +
    '<div class="field" style="flex:0 0 auto;margin-top:26px"><label class="chk"><input type="checkbox" data-k="hidden"' + (c.hidden ? ' checked' : '') + '><span>不显示</span></label></div>' +
    '</div>' +
    '<div class="row" style="margin-bottom:0">' +
    '<div class="field" style="flex:1 1 220px;margin-top:0"><label>二维码图片（可空）</label><input type="text" data-k="qr" value="' + esc2(c.qr || '') + '" placeholder="/img/qr.png"></div>' +
    '<div class="field" style="flex:0 0 auto;margin-top:20px"><input type="file" class="ct-up-file" accept="image/*"></div>' +
    '<div class="field" style="flex:0 0 auto;margin-top:20px"><span class="hint ct-state"></span></div>' +
    '</div>';
  el.querySelector('.ct-up').addEventListener('click', function () { move(el, -1); });
  el.querySelector('.ct-down').addEventListener('click', function () { move(el, 1); });
  el.querySelector('.ct-del').addEventListener('click', function () {
    if (!confirm('删掉这一项？点保存后才真正消失。')) return;
    el.remove();
    setStatus('已删除一项（未保存）', '');
  });
  var up = el.querySelector('.ct-up-file');
  up.addEventListener('change', function () {
    var f = up.files && up.files[0];
    if (!f) return;
    el.querySelector('.ct-state').textContent = '上传中…';
    uploadMedia(f, 'img').then(function (j) {
      el.querySelector('[data-k=qr]').value = j.path;
      el.querySelector('.ct-state').textContent = '已上传';
      setStatus('二维码已上传，记得保存', '');
    }).catch(function (err) { el.querySelector('.ct-state').textContent = '失败：' + err.message; });
  });
  return el;
}
function initCt() {
  var list = $('#ctList');
  list.innerHTML = '';
  var data = boot.contacts || [];
  if (!data.length) { var e = document.createElement('div'); e.className = 'empty'; e.textContent = '还没有联系方式'; list.appendChild(e); return; }
  data.forEach(function (c) { list.appendChild(ctRow(c)); });
}
$('#ctAdd').addEventListener('click', function () {
  var e = $('#ctList .empty'); if (e) e.remove();
  var el = ctRow({});
  $('#ctList').appendChild(el);
  el.querySelector('[data-k=label]').focus();
});
function collectCt() {
  return Array.prototype.map.call(document.querySelectorAll('#ctList .ct-item'), function (el) {
    return {
      label: el.querySelector('[data-k=label]').value.trim(),
      icon: el.querySelector('[data-k=icon]').value.trim(),
      value: el.querySelector('[data-k=value]').value.trim(),
      href: el.querySelector('[data-k=href]').value.trim(),
      qr: el.querySelector('[data-k=qr]').value.trim(),
      hint: el.querySelector('[data-k=hint]').value.trim(),
      hidden: el.querySelector('[data-k=hidden]').checked,
    };
  }).filter(function (c) { return c.label; });
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
    heroImages: collectHero(), heroVideo: val('heroVideoPath'),
    heroInterval: val('heroInterval'), heroScope: val('heroScope'), heroOverlay: val('heroOverlay'),
    subSize: val('subSize'), subSpacing: val('subSpacing'), subColor: val('subColor'), subWeight: val('subWeight'),
    typeSpeed: val('typeSpeed'), backSpeed: val('backSpeed'), backDelay: val('backDelay'),
    typedLoop: val('typedLoop') === '1',
    contacts: collectCt(),
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
    var j = await post('/site/save', collectAll());
    applySavedPaths(j.paths);
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
    var jj = await post('/site/save', collectAll());
    applySavedPaths(jj.paths);
    picked = { avatar: null, banner: null, favicon: null, navBg: null, footerBg: null };
    await post('/site/publish', {});
    setStatus('已推送！GitHub 正在编译，1-2 分钟后刷新 https://v-jinci.github.io 就能看到。', 'ok');
  } catch (err) {
    setStatus('发布失败：' + err.message + '（可回黑窗口双击「1-发布到网站.bat」重试）', 'err');
  } finally {
    btn.disabled = false;
  }
});

/* 文章密码列表：每篇文章一行，改完点该行「保存密码」 */
function initPosts() {
  var box = document.getElementById('postPassList');
  if (!box) return;
  var list = boot.posts || [];
  if (!list.length) { box.textContent = '还没有文章。'; return; }
  box.innerHTML = '';
  list.forEach(function (p) {
    var row = document.createElement('div');
    row.className = 'row';
    row.style.cssText = 'align-items:flex-end;margin-bottom:10px';
    row.innerHTML =
      '<div class="field" style="flex:2 1 240px;margin-bottom:0"><label>' + String(p.title).replace(/[<>&]/g, '') + '</label>' +
      '<div class="hint" style="margin:2px 0 0">' + String(p.file).replace(/[<>&]/g, '') + '</div></div>' +
      '<div class="field" style="flex:1 1 160px;margin-bottom:0"><input type="text" placeholder="留空＝公开"></div>' +
      '<div class="field" style="flex:0 0 auto;margin-bottom:0"><button type="button" class="ghost">保存密码</button></div>';
    var inp = row.querySelector('input');
    inp.value = p.password || '';
    var btn = row.querySelector('button');
    btn.addEventListener('click', function () {
      btn.disabled = true;
      post('/site/postpass', { file: p.file, password: inp.value }).then(function (r) {
        p.password = r.password || '';
        setStatus('「' + p.title + '」' + (p.password ? '已设为加密' : '已取消密码') + '，记得点「保存并发布」', 'ok');
      }).catch(function (e) {
        setStatus('保存失败：' + e.message, 'err');
      }).then(function () { btn.disabled = false; });
    });
    box.appendChild(row);
  });
}

/* ---- 初始化动态列表（把服务端渲染的行换成可交互的） ---- */
initNav();
initPosts();
initDl();
initHero();
initCt();
renderCm();

/* 正文图片大小：收集每篇文章的图片宽度，逐篇保存 */
(function () {
  var btnSave = document.getElementById('postImgSave');
  if (!btnSave) return;

  // 手填数字时，左边缩略图立刻按比例缩放（相对整篇宽度），边填边看效果
  function clampW(v) {
    var n = parseFloat(String(v || '').replace(/[^\d.]/g, ''));
    if (!n || isNaN(n)) return '';
    return String(Math.min(100, Math.max(10, Math.round(n))));
  }
  function paint(scope, row) {
    var inp = row.querySelector('.pi-w');
    var own = clampW(inp && inp.value);
    var all = scope.querySelector('.pi-all-w');
    var fallback = clampW(all && all.value) || 100;
    var pct = own ? Number(own) : Number(fallback);
    var th = row.querySelector('.pi-thumb');
    if (th) th.style.width = pct + '%';
    var sub = row.querySelector('.pi-sub');
    if (sub) sub.textContent = own ? '单独设置 ' + own + '%' : '跟随整篇' + (clampW(all && all.value) ? '（' + clampW(all.value) + '%）' : '');
  }

  Array.prototype.forEach.call(document.querySelectorAll('.pi-row'), function (row) {
    var scope = row.closest('.pi-post') || document;
    var inp = row.querySelector('.pi-w');
    if (inp) inp.addEventListener('input', function () { paint(scope, row); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.pi-all-w'), function (inp) {
    var scope = inp.closest('.pi-post') || document;
    inp.addEventListener('input', function () {
      Array.prototype.forEach.call(scope.querySelectorAll('.pi-row'), function (row) { paint(scope, row); });
    });
  });

  btnSave.addEventListener('click', function () {
    var state = document.getElementById('postImgState');
    var posts = document.querySelectorAll('#postImgList .pi-post');
    if (!posts.length) return;
    var jobs = [];
    Array.prototype.forEach.call(posts, function (p) {
      var imgs = [];
      Array.prototype.forEach.call(p.querySelectorAll('.pi-row'), function (r) {
        var v = clampW(r.querySelector('.pi-w').value);
        imgs.push({ src: r.getAttribute('data-src'), width: v ? v + '%' : '' });
      });
      var allW = p.querySelector('.pi-all-w');
      var body = { file: p.getAttribute('data-file'), images: imgs };
      if (allW) body.imgWidth = clampW(allW.value);
      jobs.push(post('/site/postimg', body));
    });
    state.textContent = '保存中…';
    btnSave.disabled = true;
    Promise.all(jobs)
      .then(function (res) {
        var n = 0;
        (res || []).forEach(function (r) { n += (r && r.changed) || 0; });
        state.textContent = '已保存（' + n + ' 处改动）。本地预览刷新即可看到；线上需要点「保存并发布」。';
        setStatus('正文图片大小已更新', 'ok');
      })
      .catch(function (e) { state.textContent = '保存失败：' + e.message; })
      .then(function () { btnSave.disabled = false; });
  });
})();
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
