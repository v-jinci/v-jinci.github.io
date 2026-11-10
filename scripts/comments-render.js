/**
 * 留言板渲染
 *
 * 数据放在 source/_data/comments.yml，由本机 http://localhost:4000/site 的
 * 「留言管理」维护（也可以自己手写）。
 *
 * 构建时把 source/messageBoard/index.md 里的 <!--COMMENTS--> 占位符，
 * 替换成下面这套卡片。零后端、零请求，留言就是构建产物的一部分。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PLACEHOLDER = '<!--COMMENTS-->';

const PALETTE = ['#4a6cf7', '#e46a76', '#f0a04b', '#3fae8f', '#8b6bd9', '#3a8ee6'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 时间统一成 2026-11-10 22:30 这种样子（YAML 可能把它解析成 Date） */
function fmtDate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 16).replace('T', ' ');
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3] + ' ' + (m[4] || '00') + ':' + (m[5] || '00');
  return s;
}

/** 正文：转义 + 换行 + 只放行 http(s) 链接 */
function fmtText(s) {
  const raw = String(s == null ? '' : s);
  const parts = raw.split(/(\[[^\]\n]{1,80}\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>"')]+)/g);
  return parts
    .map((p) => {
      const md = p.match(/^\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]+)\)$/);
      if (md) {
        return '<a href="' + esc(md[2]) + '" target="_blank" rel="noopener nofollow">' + esc(md[1]) + '</a>';
      }
      if (/^https?:\/\//.test(p)) {
        return '<a href="' + esc(p) + '" target="_blank" rel="noopener nofollow">' + esc(p) + '</a>';
      }
      return esc(p).replace(/\r?\n/g, '<br>');
    })
    .join('');
}

function colorOf(name) {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return PALETTE[h % PALETTE.length];
}

function loadComments(baseDir) {
  const file = path.join(baseDir, 'source', '_data', 'comments.yml');
  if (!fs.existsSync(file)) return [];
  try {
    const yaml = require('js-yaml');
    const data = yaml.load(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('[留言板] comments.yml 解析失败：' + e.message);
    return [];
  }
}

const STYLE = `
<style>
.wb-cl{margin:26px 0 6px;font-size:15px;line-height:1.75;color:var(--wbc-text,#4c4948)}
.wb-cl *{box-sizing:border-box}
.wb-cl-head{display:flex;align-items:baseline;gap:8px;margin:0 0 14px;font-size:14px;color:var(--wbc-sub,#858585)}
.wb-cl-head b{font-size:15px;color:var(--wbc-text,#4c4948)}
.wb-cl-item{display:flex;gap:12px;padding:16px 18px;margin-bottom:12px;border-radius:12px;background:var(--wbc-card,#fff);border:1px solid var(--wbc-line,#e3e8f7);box-shadow:0 1px 6px rgba(31,36,48,.04)}
.wb-cl-avatar{flex:0 0 auto;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:17px;font-weight:600;letter-spacing:1px;background-attachment:center;background-size:cover}
.wb-cl-body{flex:1 1 auto;min-width:0}
.wb-cl-meta{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:5px}
.wb-cl-name{font-weight:600;font-size:15px;color:var(--wbc-text,#4c4948)}
.wb-cl-time{font-size:12px;color:var(--wbc-sub,#9aa3b2)}
.wb-cl-text{word-break:break-word;white-space:normal}
.wb-cl-text a{color:#4a6cf7;text-decoration:none;border-bottom:1px solid rgba(74,108,247,.35)}
.wb-cl-reply{margin-top:12px;padding:10px 13px;border-left:3px solid #4a6cf7;border-radius:0 8px 8px 0;background:var(--wbc-reply,#f5f7ff);font-size:14px}
.wb-cl-reply .who{display:block;font-size:12px;color:#4a6cf7;margin-bottom:3px;font-weight:600}
.wb-cl-empty{padding:34px 18px;text-align:center;border:1px dashed var(--wbc-line,#dce2f2);border-radius:12px;color:var(--wbc-sub,#9aa3b2);font-size:14px}
html[data-theme="dark"] .wb-cl,body.dark .wb-cl{--wbc-text:#c8ccd4;--wbc-sub:#8b93a1;--wbc-card:rgba(255,255,255,.045);--wbc-line:rgba(255,255,255,.10);--wbc-reply:rgba(74,108,247,.13)}
@media (max-width:768px){.wb-cl-item{padding:14px}.wb-cl-avatar{width:34px;height:34px;font-size:15px}}
</style>`;

function render(list) {
  const items = (Array.isArray(list) ? list : []).filter((c) => c && c.name && c.content && !c.hidden);
  // 新的排前面（时间格式统一成 YYYY-MM-DD HH:mm，可以直接比字符串）
  items.sort((a, b) => String(fmtDate(b.date)).localeCompare(String(fmtDate(a.date))));
  const total = items.length;

  let body;
  if (!total) {
    body = '<div class="wb-cl-empty">还没有留言，第一封就等你了。</div>';
  } else {
    body = items
      .map((c) => {
        const name = String(c.name);
        const initial = esc(Array.from(name.trim())[0] || '?');
        const reply = c.reply ? '<div class="wb-cl-reply"><span class="who">站长回复</span>' + fmtText(c.reply) + '</div>' : '';
        return (
          '<div class="wb-cl-item">' +
          '<div class="wb-cl-avatar" style="background:' + colorOf(name) + '">' + initial + '</div>' +
          '<div class="wb-cl-body">' +
          '<div class="wb-cl-meta"><span class="wb-cl-name">' + esc(name) + '</span><span class="wb-cl-time">' + esc(fmtDate(c.date)) + '</span></div>' +
          '<div class="wb-cl-text">' + fmtText(c.content) + '</div>' +
          reply +
          '</div></div>'
        );
      })
      .join('');
  }

  return (
    STYLE +
    '<div class="wb-cl">' +
    '<div class="wb-cl-head"><b>' + total + ' 条留言</b>' +
    (total ? '<span>按时间倒序 · 都是我审核后放上来的</span>' : '') +
    '</div>' +
    body +
    '</div>'
  );
}

hexo.extend.filter.register('after_render:html', function (str) {
  if (typeof str !== 'string' || str.indexOf(PLACEHOLDER) === -1) return str;
  const list = loadComments(hexo.base_dir);
  return str.replace(PLACEHOLDER, () => render(list));
});
