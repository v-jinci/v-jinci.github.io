/**
 * 站点信息编辑器（只在本机运行）
 *
 * 访问：启动 start-admin.bat 后打开 http://localhost:4000/site
 * 能改：站点标题 / 副标题 / 描述 / 关键词 / 作者
 *       首页顶部大图 / 轮播标语
 *       侧边栏头像 / 作者简介 / 公告
 *       页脚起始年份
 *
 * 写文件时用「按行替换」，只动目标那几行，其余内容和注释原样保留，
 * 所以不会破坏 _config.yml 里的 deploy、admin 等配置。
 */
const fs = require('fs');
const path = require('path');

module.exports = { register };

function register(hexo, opts) {
  const options = opts || {};
  hexo.extend.filter.register('server_middleware', (app) => {
    app.use('/site', (req, res) => handle(hexo, req, res, options));
  });
}

/* ------------------------------ YAML 读写 ------------------------------ */

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
  if (/^-?\d+(\.\d+)?$/.test(s)) return s; // 纯数字不加引号（如 since: 2021）
  if (s === '') return "''";
  // 只有可能被 YAML 误解析的值才加引号，中文正文保持原样，改完 diff 更干净
  const needsQuote = /^\s|\s$/.test(s) || /[:#\[\]{},&*!|>'"%@`]/.test(s);
  if (!needsQuote) return s;
  if (s.indexOf("'") === -1) return "'" + s + "'";
  if (s.indexOf('"') === -1) return '"' + s + '"';
  return "'" + s.replace(/'/g, "''") + "'";
}

/** 在 lines 里按路径找到某个块的范围（不含块标题行） */
function findBlock(lines, names) {
  let start = 0;
  let end = lines.length;
  let indent = -1;
  for (let n = 0; n < names.length; n++) {
    const name = names[n];
    let hit = -1;
    let hitIndent = -1;
    for (let i = start; i < end; i++) {
      const m = lines[i].match(/^(\s*)([A-Za-z0-9_-]+):(.*)$/);
      if (!m) continue;
      const ind = m[1].length;
      if (indent >= 0 && ind <= indent) break;
      if (m[2] !== name) continue;
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

/** 改一个标量值：path 为 ['avatar','img'] 这种 */
function setScalar(raw, keyPath, value) {
  const lines = raw.split(/\r?\n/);
  const parent = keyPath.slice(0, -1);
  const key = keyPath[keyPath.length - 1];
  const blk = parent.length ? findBlock(lines, parent) : { indent: -1, start: 0, end: lines.length };
  if (!blk) return null;
  const want = parent.length ? blk.indent + 2 : 0;
  for (let i = blk.start; i < blk.end; i++) {
    const m = lines[i].match(/^(\s*)([A-Za-z0-9_-]+):(.*)$/);
    if (m && m[2] === key && m[1].length === want) {
      lines[i] = m[1] + key + ': ' + fmtScalar(value);
      return lines.join('\n');
    }
  }
  return null;
}

/** 改一个字符串列表：如 subtitle.sub */
function setList(raw, keyPath, items) {
  const lines = raw.split(/\r?\n/);
  const blk = findBlock(lines, keyPath);
  if (!blk) return null;
  const itemIndent = ' '.repeat(blk.indent + 2);
  const next = items.filter((s) => String(s).trim() !== '').map((s) => itemIndent + '- ' + fmtScalar(s));
  // 块尾的空行和注释不算内容，替换时保留它们
  let end = blk.end;
  while (end > blk.start && (!lines[end - 1].trim() || /^\s*#/.test(lines[end - 1]))) end--;
  const out = lines.slice(0, blk.start).concat(next, lines.slice(end));
  return out.join('\n');
}

function writeIfChanged(file, raw, next, touched, label) {
  if (next == null || next === raw) return;
  // 原文件是 CRLF 就写回 CRLF，避免整份文件被当成「全部修改」
  if (raw.indexOf('\r\n') !== -1) next = next.replace(/\r?\n/g, '\r\n');
  fs.writeFileSync(file, next, 'utf8');
  touched.push(label);
}

/* ------------------------------ 留言数据 ------------------------------ */

const COMMENTS_FILE = ['source', '_data', 'comments.yml'];

function loadComments(base) {
  const list = readYaml(path.join(base, ...COMMENTS_FILE), []);
  return Array.isArray(list) ? list : [];
}

/** 手写序列化，格式固定、中文不转义、diff 干净 */
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

function writeComments(base, list, touched) {
  const file = path.join(base, ...COMMENTS_FILE);
  const next = dumpComments(list);
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    raw = '';
  }
  if (raw === next) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next, 'utf8');
  touched.push('留言');
}

/* ------------------------------ 图片上传 ------------------------------ */

const MIME_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg' };

function saveDataUrl(base, dataUrl, suggestName) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const ext = MIME_EXT[m[1].toLowerCase()];
  if (!ext) return null;
  let name = String(suggestName || '').replace(/\.[^.]+$/, '');
  name = name
    .replace(/[\u4e00-\u9fa5]+/g, '') // 中文名转成 ASCII，避免网址里出现编码后的乱码
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

function loadCurrent(base) {
  const siteFile = path.join(base, '_config.yml');
  const themeFile = path.join(base, '_config.butterfly.yml');
  const themeDefault = path.join(base, 'node_modules', 'hexo-theme-butterfly', '_config.yml');
  const site = readYaml(siteFile, {});
  const mine = readYaml(themeFile, {});
  const def = fs.existsSync(themeDefault) ? readYaml(themeDefault, {}) : {};
  const theme = Object.assign({}, def, mine);
  // 深合并两层就够用了
  ['avatar', 'footer', 'aside', 'subtitle'].forEach((k) => {
    theme[k] = Object.assign({}, def[k] || {}, mine[k] || {});
  });
  theme.aside.card_author = Object.assign({}, (def.aside || {}).card_author || {}, (mine.aside || {}).card_author || {});
  theme.aside.card_announcement = Object.assign({}, (def.aside || {}).card_announcement || {}, (mine.aside || {}).card_announcement || {});
  theme.footer.owner = Object.assign({}, (def.footer || {}).owner || {}, (mine.footer || {}).owner || {});
  theme.subtitle.sub = (mine.subtitle && mine.subtitle.sub) || (def.subtitle && def.subtitle.sub) || [];
  return { site, theme, comments: loadComments(base) };
}

/* ------------------------------ 请求处理 ------------------------------ */

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > (limit || 12 * 1024 * 1024)) {
        reject(new Error('图片太大了，请压缩到 10MB 以内再上传'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handle(hexo, req, res, options) {
  const base = hexo.base_dir;
  const url = (req.url || '/').split('?')[0];
  try {
    if (req.method === 'GET' && (url === '/' || url === '' || url === '/index.html')) {
      const cur = loadCurrent(base);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(renderPage(cur, url));
      return;
    }

    if (req.method === 'POST' && url === '/save') {
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}');
      const touched = [];
      const siteFile = path.join(base, '_config.yml');
      const themeFile = path.join(base, '_config.butterfly.yml');

      // 图片先落地，再写路径
      let avatarPath = data.avatarPath;
      if (data.avatarFile && data.avatarFile.dataUrl) {
        avatarPath = saveDataUrl(base, data.avatarFile.dataUrl, data.avatarFile.name || 'avatar');
        if (!avatarPath) throw new Error('头像格式不支持（png / jpg / webp / gif / svg）');
      }
      let bannerPath = data.bannerPath;
      if (data.bannerFile && data.bannerFile.dataUrl) {
        bannerPath = saveDataUrl(base, data.bannerFile.dataUrl, data.bannerFile.name || 'banner');
        if (!bannerPath) throw new Error('大图格式不支持（png / jpg / webp / gif / svg）');
      }

      let siteRaw = readText(siteFile);
      let siteNext = siteRaw;
      const siteKeys = [
        ['title', data.title],
        ['subtitle', data.subtitle],
        ['description', data.description],
        ['keywords', data.keywords],
        ['author', data.author],
      ];
      siteKeys.forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        const r = setScalar(siteNext, [k], v);
        if (r != null) siteNext = r;
      });
      writeIfChanged(siteFile, siteRaw, siteNext, touched, '站点标题等信息');

      let thRaw = readText(themeFile);
      let thNext = thRaw;
      const themeKeys = [
        [['index_img'], bannerPath],
        [['default_top_img'], bannerPath],
        [['avatar', 'img'], avatarPath],
        [['footer', 'owner', 'since'], data.since],
        [['aside', 'card_author', 'description'], data.authorDesc],
        [['aside', 'card_announcement', 'content'], data.notice],
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
      writeIfChanged(themeFile, thRaw, thNext, touched, '外观设置');

      // 留言：整份覆盖写入 source/_data/comments.yml
      if (Array.isArray(data.comments)) writeComments(base, data.comments, touched);

      // 让预览立刻更新：重新载入配置并重新生成
      try {
        if (typeof hexo.load === 'function') await hexo.load();
        else await hexo.call('generate', {});
      } catch (e) {
        /* 重新载入失败不影响文件已保存，下次启动也会生效 */
      }

      sendJson(res, 200, { ok: true, touched: touched.length ? touched : ['（没有变化）'] });
      return;
    }

    if (req.method === 'POST' && url === '/publish') {
      if (typeof options.publish !== 'function') {
        sendJson(res, 500, { ok: false, error: '当前进程不支持一键发布，请回到黑窗口双击 publish.bat。' });
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

function renderPage(cur, mountUrl) {
  const site = cur.site || {};
  const theme = cur.theme || {};
  const aside = theme.aside || {};
  const author = aside.card_author || {};
  const notice = aside.card_announcement || {};
  const owner = (theme.footer || {}).owner || {};
  const avatar = (theme.avatar || {}).img || '';
  const banner = theme.index_img || theme.default_top_img || '';
  const subs = (theme.subtitle && theme.subtitle.sub) || [];

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>站点信息 · 本地编辑</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#f4f6fb;color:#1f2430;font:15px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:880px;margin:0 auto;padding:28px 18px 80px}
  h1{margin:0 0 6px;font-size:22px}
  .sub{color:#6b7280;font-size:13px;margin-bottom:22px}
  .sub a{color:#4a6cf7;text-decoration:none}
  .card{background:#fff;border:1px solid #e6e9f2;border-radius:14px;padding:18px 20px;margin-bottom:16px;box-shadow:0 2px 10px rgba(31,36,48,.04)}
  .card h2{margin:0 0 14px;font-size:15px;color:#374151;letter-spacing:.3px}
  .row{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:12px}
  .field{flex:1 1 240px;min-width:200px}
  label{display:block;font-size:13px;color:#4b5563;margin-bottom:5px}
  input[type=text],textarea{width:100%;padding:9px 11px;border:1px solid #dfe3ee;border-radius:9px;font:inherit;background:#fbfcff;color:#1f2430}
  input[type=text]:focus,textarea:focus{outline:none;border-color:#8aa2f7;background:#fff}
  textarea{resize:vertical;min-height:64px}
  .hint{font-size:12px;color:#9aa3b2;margin-top:4px}
  .media{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
  .thumb{width:96px;height:96px;border-radius:10px;border:1px solid #e6e9f2;background:#f0f2f9 center/cover no-repeat;flex:0 0 auto}
  .thumb.wide{width:260px;height:78px}
  .actions{position:sticky;bottom:0;background:linear-gradient(to top,#f4f6fb 60%,rgba(244,246,251,0));padding:16px 0 6px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  button{border:0;border-radius:10px;padding:11px 20px;font:inherit;cursor:pointer}
  .primary{background:#4a6cf7;color:#fff}
  .primary:disabled{opacity:.55;cursor:default}
  .ghost{background:#eef1fa;color:#3c4a68}
  .status{font-size:13px;color:#4b5563}
  .ok{color:#0f8a4a}.err{color:#c62828}
  .badge{display:inline-block;font-size:11px;color:#6b7280;background:#eef1fa;border-radius:6px;padding:1px 7px;margin-left:6px;vertical-align:2px}
  .cm-item{border:1px solid #eef1fa;border-radius:11px;padding:14px;margin-bottom:12px;background:#fbfcff}
  .cm-item .row{margin-bottom:0}
  .cm-item .field{margin-top:10px}
  .cm-item .field:first-child{margin-top:0}
  .cm-empty{font-size:13px;color:#9aa3b2;padding:10px 0 14px}
  .cm-tag{font-size:11px;border-radius:5px;padding:1px 6px;background:#e8f5ee;color:#0f8a4a;margin-left:6px}
  .cm-tag.off{background:#f2f3f6;color:#8b93a1}
</style>
</head>
<body>
<div class="wrap">
  <h1>站点信息<span class="badge">仅本机可改</span></h1>
  <div class="sub">改完点「保存」，左边预览会自动刷新；想让线上也更新，点「保存并发布」。返回 <a href="/">网站预览</a> · <a href="/admin">写文章后台</a></div>

  <form id="f">
    <div class="card">
      <h2>首页文字</h2>
      <div class="row">
        <div class="field"><label>站点标题（浏览器标签、左上角）</label><input type="text" name="title" value="${esc(site.title)}"></div>
        <div class="field"><label>作者名字</label><input type="text" name="author" value="${esc(site.author)}"></div>
      </div>
      <div class="row">
        <div class="field"><label>副标题（标题旁边那句）</label><input type="text" name="subtitle" value="${esc(site.subtitle)}"></div>
        <div class="field"><label>关键词（逗号分隔，给搜索引擎看）</label><input type="text" name="keywords" value="${esc(site.keywords)}"></div>
      </div>
      <div class="field"><label>站点描述</label><input type="text" name="description" value="${esc(site.description)}"></div>
      <div class="field" style="margin-top:12px"><label>首页轮播标语（一行一句，会逐字打出来）</label>
        <textarea name="subLines" rows="4">${esc(subs.join('\n'))}</textarea>
      </div>
    </div>

    <div class="card">
      <h2>首页顶部大图</h2>
      <div class="media">
        <div class="thumb wide" id="bannerThumb" style="background-image:url('${esc(banner)}')"></div>
        <div style="flex:1 1 260px">
          <input type="file" id="bannerFile" accept="image/*">
          <div class="hint">建议 1920×500 左右的横向图，jpg 体积小。选图后会自动上传到 source/img/。</div>
          <div class="field" style="margin-top:8px"><label>或者直接填图片路径</label><input type="text" name="bannerPath" value="${esc(banner)}"></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>侧边栏头像</h2>
      <div class="media">
        <div class="thumb" id="avatarThumb" style="background-image:url('${esc(avatar)}')"></div>
        <div style="flex:1 1 260px">
          <input type="file" id="avatarFile" accept="image/*">
          <div class="hint">正方形最好（≥300×300）。选图后自动上传。</div>
          <div class="field" style="margin-top:8px"><label>或者直接填图片路径</label><input type="text" name="avatarPath" value="${esc(avatar)}"></div>
        </div>
      </div>
      <div class="row" style="margin-top:12px">
        <div class="field"><label>作者简介（头像下面一句）</label><input type="text" name="authorDesc" value="${esc(author.description)}"></div>
      </div>
      <div class="field"><label>公告卡片文字</label><input type="text" name="notice" value="${esc(notice.content)}"></div>
    </div>

    <div class="card">
      <h2>页脚</h2>
      <div class="row">
        <div class="field" style="max-width:200px"><label>起始年份</label><input type="text" name="since" value="${esc(owner.since)}"></div>
        <div class="field" style="flex:2 1 320px"><label>&nbsp;</label><div class="hint" style="margin-top:10px">页脚会显示成「© 起始年份 - 今年 By ${esc(site.author || '')}」。</div></div>
      </div>
    </div>

    <div class="card">
      <h2>留言管理<span class="badge">审核后显示</span></h2>
      <div class="hint" style="margin-bottom:14px">别人发邮件给你 → 点「添加一条留言」，填昵称和内容 → 保存 → 发布，留言就出现在留言板上。不想公开的取消「公开」勾选，内容还留在文件里。</div>
      <div id="cmList"></div>
      <button type="button" class="ghost" id="cmAdd">+ 添加一条留言</button>
    </div>

    <div class="actions">
      <button type="submit" class="primary" id="saveBtn">保存</button>
      <button type="button" class="ghost" id="publishBtn">保存并发布到线上</button>
      <span class="status" id="status"></span>
    </div>
  </form>
</div>

<script type="application/json" id="cmData">${JSON.stringify(cur.comments || []).replace(/</g, '\\u003c')}</script>
<script>
const $ = (s) => document.querySelector(s);
const statusEl = $('#status');
function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = 'status ' + (kind || '');
}
let picked = { avatar: null, banner: null };

function hookFile(input, key, thumbId) {
  const el = document.getElementById(input);
  if (!el) return;
  el.addEventListener('change', () => {
    const f = el.files && el.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      picked[key] = { name: f.name, dataUrl: r.result };
      const t = document.getElementById(thumbId);
      t.style.backgroundImage = 'url(' + r.result + ')';
      setStatus('已选择新图片，记得点保存', '');
    };
    r.readAsDataURL(f);
  });
}
hookFile('avatarFile', 'avatar', 'avatarThumb');
hookFile('bannerFile', 'banner', 'bannerThumb');

/* ---- 留言管理 ---- */
const cmData = JSON.parse(document.getElementById('cmData').textContent || '[]');
const cmList = $('#cmList');
function esc2(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function nowText() {
  const d = new Date();
  const p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function addItem(c) {
  c = c || {};
  const el = document.createElement('div');
  el.className = 'cm-item';
  el.innerHTML =
    '<div class="row">' +
      '<div class="field" style="flex:0 0 150px"><label>昵称</label><input type="text" data-k="name" value="' + esc2(c.name || '') + '"></div>' +
      '<div class="field" style="flex:0 0 165px"><label>时间</label><input type="text" data-k="date" value="' + esc2(c.date || nowText()) + '"></div>' +
      '<div class="field" style="flex:0 0 92px"><label>状态</label><div style="display:flex;align-items:center;gap:6px;height:38px"><input type="checkbox" data-k="visible" style="width:16px;height:16px"' + (c.hidden ? '' : ' checked') + '><span style="font-size:13px;color:#4b5563">公开</span></div></div>' +
      '<div class="field" style="flex:1 1 70px;display:flex;align-items:flex-end"><button type="button" class="ghost cm-del" style="padding:9px 14px;font-size:13px;color:#c62828;background:#fdecec">删除</button></div>' +
    '</div>' +
    '<div class="field"><label>留言内容</label><textarea data-k="content" rows="2">' + esc2(c.content || '') + '</textarea></div>' +
    '<div class="field"><label>站长回复（可空）</label><input type="text" data-k="reply" value="' + esc2(c.reply || '') + '"></div>';
  el.querySelector('.cm-del').addEventListener('click', function () {
    if (!confirm('删掉这条留言？点保存后才真正消失。')) return;
    el.remove();
    setStatus('已删除 1 条（还没保存）', '');
  });
  cmList.appendChild(el);
  return el;
}
function renderComments() {
  cmList.innerHTML = '';
  if (!cmData.length) {
    const d = document.createElement('div');
    d.className = 'cm-empty';
    d.textContent = '还没有留言。';
    cmList.appendChild(d);
    return;
  }
  cmData.forEach(addItem);
}
renderComments();
$('#cmAdd').addEventListener('click', function () {
  const empty = cmList.querySelector('.cm-empty');
  if (empty) empty.remove();
  const el = addItem({});
  el.scrollIntoView({ block: 'center' });
  el.querySelector('[data-k=name]').focus();
});
function collectComments() {
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

function collect() {
  const fd = new FormData($('#f'));
  const out = {};
  fd.forEach((v, k) => { out[k] = v; });
  out.subLines = String(out.subLines || '').split('\\n').map((s) => s.trim()).filter(Boolean);
  if (picked.avatar) out.avatarFile = picked.avatar;
  if (picked.banner) out.bannerFile = picked.banner;
  out.comments = collectComments();
  return out;
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || ('请求失败 ' + r.status));
  return j;
}

$('#f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#saveBtn');
  btn.disabled = true;
  setStatus('正在保存…');
  try {
    const j = await post('/site/save', collect());
    picked = { avatar: null, banner: null };
    setStatus('已保存：' + (j.touched || []).join('、') + '。预览 1 秒后刷新，线上要点「保存并发布」。', 'ok');
  } catch (err) {
    setStatus('保存失败：' + err.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

$('#publishBtn').addEventListener('click', async () => {
  const btn = $('#publishBtn');
  btn.disabled = true;
  setStatus('先保存，再推送…（约 30 秒，别关窗口）');
  try {
    await post('/site/save', collect());
    picked = { avatar: null, banner: null };
    const j = await post('/site/publish', {});
    setStatus('已推送！GitHub 正在编译，1-2 分钟后刷新 https://v-jinci.github.io 就能看到。', 'ok');
    if (j.log) console.log(j.log);
  } catch (err) {
    setStatus('发布失败：' + err.message + '（可以回黑窗口双击 publish.bat 重试）', 'err');
  } finally {
    btn.disabled = false;
  }
});
</script>
</body>
</html>`;
}
