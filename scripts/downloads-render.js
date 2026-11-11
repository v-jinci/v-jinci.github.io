/**
 * 下载区渲染
 *
 * 数据在 source/_data/downloads.yml，由本机 /site 后台维护。
 * 构建时把 source/downloads/index.md 里的 <!--DOWNLOADS--> 换成文件列表。
 *
 * 注意：这里的「密码保护」是前端遮挡，目的是让随手点进来的人看不到列表。
 * 链接用 base64 存放，源码里不出现明文地址；解锁后才写进 href。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PLACEHOLDER = '<!--DOWNLOADS-->';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function b64(s) {
  return Buffer.from(String(s), 'utf8').toString('base64');
}

function fmtSize(n) {
  const v = Number(n);
  if (!v || v <= 0) return '';
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return (v / 1024).toFixed(v < 10240 ? 1 : 0) + ' KB';
  if (v < 1024 * 1024 * 1024) return (v / 1024 / 1024).toFixed(v < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
  return (v / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function load(baseDir) {
  const file = path.join(baseDir, 'source', '_data', 'downloads.yml');
  if (!fs.existsSync(file)) return [];
  try {
    const data = require('js-yaml').load(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('[下载区] downloads.yml 解析失败：' + e.message);
    return [];
  }
}

/** 仓库内文件的真实大小（构建时读磁盘，省得手填） */
function diskSize(baseDir, file) {
  const rel = String(file || '').replace(/^\/+/, '');
  if (!rel) return 0;
  const abs = path.join(baseDir, 'source', rel);
  try {
    return fs.statSync(abs).size;
  } catch (e) {
    return 0;
  }
}

function extOf(name) {
  const m = String(name || '').match(/\.([A-Za-z0-9]{1,6})$/);
  return m ? m[1].toUpperCase() : 'FILE';
}

const STYLE = `
<style>
.wb-dl{margin:6px 0 8px;font-size:15px}
.wb-dl *{box-sizing:border-box}
.wb-dl-head{display:flex;align-items:baseline;gap:10px;margin:0 0 14px;font-size:13px;color:var(--wbd-sub,#8b93a1)}
.wb-dl-head b{font-size:15px;color:var(--wbd-text,#4c4948)}
.wb-dl-item{display:flex;align-items:center;gap:14px;padding:14px 16px;margin-bottom:10px;border-radius:12px;background:var(--wbd-card,#fff);border:1px solid var(--wbd-line,#e3e8f7);box-shadow:0 1px 6px rgba(31,36,48,.04);transition:.18s}
.wb-dl-item:hover{border-color:#b9c6f5;transform:translateY(-1px)}
.wb-dl-icon{flex:0 0 auto;width:46px;height:46px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;letter-spacing:.5px;color:#fff;background:linear-gradient(135deg,#4a6cf7,#7b95ff)}
.wb-dl-main{flex:1 1 auto;min-width:0}
.wb-dl-name{font-weight:600;font-size:15px;color:var(--wbd-text,#4c4948);word-break:break-all}
.wb-dl-desc{font-size:13px;color:var(--wbd-sub,#858585);margin-top:3px;line-height:1.6}
.wb-dl-meta{font-size:12px;color:var(--wbd-sub,#9aa3b2);margin-top:6px;display:flex;gap:12px;flex-wrap:wrap}
.wb-dl-btn{flex:0 0 auto;display:inline-block;padding:9px 18px;border-radius:9px;background:#4a6cf7;color:#fff!important;font-size:14px;text-decoration:none;border:0}
.wb-dl-btn:hover{background:#3f5ee0;color:#fff}
.wb-dl-btn.ext{background:#eef1fa;color:#3c4a68!important}
.wb-dl-btn.ext:hover{background:#e2e7f7}
.wb-dl-empty{padding:32px 18px;text-align:center;border:1px dashed var(--wbd-line,#dce2f2);border-radius:12px;color:var(--wbd-sub,#9aa3b2);font-size:14px}
html[data-theme="dark"] .wb-dl,body.dark .wb-dl{--wbd-text:#c8ccd4;--wbd-sub:#8b93a1;--wbd-card:rgba(255,255,255,.045);--wbd-line:rgba(255,255,255,.10)}
html[data-theme="dark"] .wb-dl-btn.ext,body.dark .wb-dl-btn.ext{background:rgba(255,255,255,.10);color:#c8ccd4!important}
@media (max-width:768px){
  .wb-dl-item{padding:12px;gap:10px;flex-wrap:wrap}
  .wb-dl-icon{width:38px;height:38px;font-size:10px}
  .wb-dl-btn{width:100%;text-align:center;margin-top:4px}
}
</style>`;

function render(items, baseDir) {
  const list = (Array.isArray(items) ? items : []).filter((x) => x && !x.hidden && String(x.name || '').trim());
  const total = list.length;

  let body;
  if (!total) {
    body = '<div class="wb-dl-empty">还没有放文件。上传后在 /site 后台点「保存并发布」就会出现在这里。</div>';
  } else {
    body = list
      .map((x) => {
        const target = String(x.file || '').trim() || String(x.url || '').trim();
        const isExt = !String(x.file || '').trim() && !!String(x.url || '').trim();
        const size = fmtSize(x.size) || fmtSize(diskSize(baseDir, x.file));
        const date = String(x.date || '').trim();
        const meta = [];
        if (size) meta.push(size);
        if (date) meta.push(date);
        meta.push(isExt ? '外部链接' : '本站文件');
        const attrs = isExt ? ' target="_blank" rel="noopener"' : ' download';
        const href = target ? '<a class="wb-dl-btn' + (isExt ? ' ext' : '') + '" data-wb-href="' + b64(target) + '"' + attrs + '>' + (isExt ? '前往下载' : '下载') + '</a>' : '';
        return (
          '<div class="wb-dl-item">' +
          '<div class="wb-dl-icon">' + esc(extOf(x.file || x.url || x.name)) + '</div>' +
          '<div class="wb-dl-main">' +
          '<div class="wb-dl-name">' + esc(x.name) + '</div>' +
          (x.desc ? '<div class="wb-dl-desc">' + esc(x.desc) + '</div>' : '') +
          '<div class="wb-dl-meta">' + meta.map((m) => '<span>' + esc(m) + '</span>').join('') + '</div>' +
          '</div>' +
          href +
          '</div>'
        );
      })
      .join('');
  }

  return (
    STYLE +
    '<div class="wb-dl">' +
    '<div class="wb-dl-head"><b>' + total + ' 个文件</b>' +
    '<span>密码只在页面里校验，请勿用于存放机密文件</span></div>' +
    body +
    '</div>'
  );
}

hexo.extend.filter.register('after_render:html', function (str) {
  if (typeof str !== 'string' || str.indexOf(PLACEHOLDER) === -1) return str;
  return str.replace(PLACEHOLDER, () => render(load(hexo.base_dir), hexo.base_dir));
});
