'use strict';
/**
 * 可视化写作页 /write
 *  - 工具条：标题级别、字号、颜色、高亮、粗斜体下划线删除线、对齐、列表、引用、代码、链接、图片、表格、分割线
 *  - 图片：拖右下角改大小（所见即所得）、环绕切换（文字绕到旁边）、删除
 *  - 粘贴：从 Word / 网页粘过来自动清洗，只留安全的格式
 *  - 保存：生成 .md（front-matter + 正文）；带样式的部分自动转成内联 HTML，Hexo 原样保留
 */
const fs = require('fs');
const path = require('path');

/* ------------------------------ 小工具 ------------------------------ */

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > (limit || 20 * 1024 * 1024)) {
        reject(new Error('内容太大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unquote(v) {
  let s = String(v == null ? '' : v).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  return s.replace(/\\"/g, '"');
}

function postsDir(base) {
  return path.join(base, 'source', '_posts');
}

function draftsDir(base) {
  return path.join(base, 'source', '_drafts');
}

/* 把 "_drafts/xxx.md" 或 "xxx.md" 解析成真实路径（草稿放 _drafts，hexo 默认不生成，线上看不到） */
function resolveFile(base, file) {
  let s = String(file || '').replace(/\\/g, '/').trim();
  let inDrafts = false;
  if (s.indexOf('_drafts/') === 0) {
    inDrafts = true;
    s = s.slice('_drafts/'.length);
  }
  s = path.basename(s);
  if (!s || s.charAt(0) === '.' || s.indexOf('..') >= 0) throw new Error('文件名不对');
  const dir = inDrafts ? draftsDir(base) : postsDir(base);
  return { name: s, dir: dir, path: path.join(dir, s), inDrafts: inDrafts, label: (inDrafts ? '_drafts/' : '') + s };
}

/* 解析 front-matter，够用即可（title / date / tags / categories / password / img_width / img_float / description / cover / draft） */
function parsePost(raw) {
  let fm = '';
  let body = raw;
  if (raw.slice(0, 3) === '---') {
    const i = raw.indexOf('\n---', 3);
    if (i > 0) {
      fm = raw.slice(3, i);
      body = raw.slice(i + 4).replace(/^\s*\r?\n/, '');
    }
  }
  const get = (k) => {
    const m = fm.match(new RegExp('^' + k + ':[ \\t]*(.*)$', 'm'));
    return m ? unquote(m[1]) : '';
  };
  const list = (k) => {
    const inline = fm.match(new RegExp('^' + k + ':[ \\t]*\\[(.*)\\]', 'm'));
    if (inline) {
      return inline[1].split(',').map((s) => unquote(s)).filter(Boolean);
    }
    const block = fm.match(new RegExp('^' + k + ':[ \\t]*\\r?\\n((?:[ \\t]*-[ \\t]*.*\\r?\\n?)+)', 'm'));
    if (block) {
      return block[1].split(/\r?\n/).map((l) => unquote(l.replace(/^[ \t]*-[ \t]*/, ''))).filter(Boolean);
    }
    const one = get(k);
    return one ? [one] : [];
  };
  return {
    title: get('title'),
    date: get('date'),
    description: get('description'),
    cover: get('cover'),
    password: get('password'),
    imgWidth: get('img_width'),
    imgFloat: get('img_float'),
    draft: get('draft'),
    tags: list('tags'),
    categories: list('categories'),
    body: body,
  };
}

function listPosts(base) {
  const out = [];
  [
    { dir: postsDir(base), prefix: '', isDraft: false },
    { dir: draftsDir(base), prefix: '_drafts/', isDraft: true },
  ].forEach((box) => {
    let names = [];
    try {
      names = fs.readdirSync(box.dir).filter((f) => f.toLowerCase().endsWith('.md'));
    } catch (e) {
      return;
    }
    names.forEach((f) => {
      const fp = path.join(box.dir, f);
      try {
        const p = parsePost(fs.readFileSync(fp, 'utf8'));
        out.push({
          file: box.prefix + f,
          title: p.title || f.replace(/\.md$/i, ''),
          date: p.date,
          tags: p.tags,
          draft: box.isDraft || p.draft,
          mtime: fs.statSync(fp).mtimeMs,
        });
      } catch (e) {
        out.push({ file: box.prefix + f, title: f.replace(/\.md$/i, ''), date: '', tags: [], draft: box.isDraft, mtime: 0 });
      }
    });
  });
  out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || b.mtime - a.mtime);
  return out;
}

function normDate(s) {
  let t = String(s || '').trim().replace('T', ' ');
  if (!t) {
    const d = new Date();
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    t = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':00';
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t)) t += ':00';
  return t;
}

function slugOf(title) {
  let s = String(title || '')
    .replace(/[\\/:*?"<>|#%{}^~[\]]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!s) s = 'post';
  return s.slice(0, 40);
}

function yamlStr(s) {
  return '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function buildMarkdown(d) {
  const lines = ['---', 'title: ' + yamlStr(d.title || '无标题')];
  lines.push('date: ' + normDate(d.date));
  if (d.description) lines.push('description: ' + yamlStr(d.description));
  if (d.cover) lines.push('cover: ' + String(d.cover).trim());
  if (d.tags && d.tags.length) lines.push('tags: [' + d.tags.map((t) => yamlStr(t)).join(', ') + ']');
  if (d.categories && d.categories.length) lines.push('categories: [' + d.categories.map((t) => yamlStr(t)).join(', ') + ']');
  if (d.password) lines.push('password: ' + yamlStr(d.password));
  const iw = String(d.imgWidth || '').replace(/[^0-9.]/g, '');
  if (iw) lines.push('img_width: ' + iw);
  if (d.imgFloat && /^[lrc]$/.test(d.imgFloat)) lines.push('img_float: ' + d.imgFloat);
  if (d.draft) lines.push('draft: true');
  lines.push('---', '', String(d.markdown || '').replace(/\r\n/g, '\n').replace(/\s+$/, ''), '');
  return lines.join('\n');
}

/* ------------------------------ 页面 ------------------------------ */

function renderPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>写文章 · 可视化编辑器</title>
<style>
  *{box-sizing:border-box}
  html,body{margin:0;background:#f4f6fb;color:#1f2430;font:15px/1.75 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:860px;margin:0 auto;padding:20px 16px 120px}
  .top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
  .top h1{margin:0;font-size:19px;font-weight:700}
  .badge{font-size:11px;font-weight:400;background:#e8edff;color:#4a6cf7;border-radius:6px;padding:2px 7px;margin-left:6px;vertical-align:2px}
  .top .acts{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
  button{font:inherit;font-size:13px;border:1px solid #e2e6f0;background:#fff;color:#374151;border-radius:8px;padding:6px 12px;cursor:pointer}
  button:hover{border-color:#c9d2e8;background:#fafbff}
  button.primary{background:#4a6cf7;border-color:#4a6cf7;color:#fff}
  button.primary:hover{background:#3f5fe0}
  .meta{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px}
  .meta input{flex:1 1 180px;font:inherit;font-size:14px;border:1px solid #e2e6f0;background:#fff;border-radius:9px;padding:8px 11px;color:#1f2430}
  .meta input#title{flex:2 1 320px;font-size:17px;font-weight:600}
  .meta input::placeholder{color:#aab3c4;font-weight:400}
  .tbar{position:sticky;top:0;z-index:20;background:#fff;border:1px solid #e6e9f2;border-radius:12px 12px 0 0;padding:6px 8px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;box-shadow:0 2px 8px rgba(31,36,48,.05)}
  .tbar .sc{width:1px;height:18px;background:#e6e9f2;margin:0 4px}
  .tbar button{border:0;background:transparent;padding:4px 7px;border-radius:6px;font-size:13px;min-width:28px;line-height:1.5}
  .tbar button:hover{background:#eef2ff;color:#3f5fe0}
  .tbar button b{font-weight:800}
  .tbar select{font:inherit;font-size:12.5px;border:1px solid #e6e9f2;background:#fff;border-radius:6px;padding:4px 5px;color:#374151;max-width:112px}
  .tbar .sw{width:20px;height:20px;border-radius:5px;border:1px solid #dfe4f0;cursor:pointer;padding:0}
  .tbar .sw.on{outline:2px solid #4a6cf7;outline-offset:1px}
  .ed{background:#fff;border:1px solid #e6e9f2;border-top:0;border-radius:0 0 12px 12px;padding:22px 26px 40px;min-height:60vh;outline:none;font-size:16px;color:#242a38;overflow-wrap:break-word}
  .ed:empty:before{content:"在这里写正文。工具条上可以改字号、颜色、对齐；粘图片进来可以拖右下角改大小。";color:#b3bccd}
  .ed h2{font-size:22px;margin:22px 0 10px;padding-left:10px;border-left:4px solid #4a6cf7;line-height:1.4}
  .ed h3{font-size:18px;margin:20px 0 8px}
  .ed h4{font-size:16px;margin:18px 0 6px;color:#4b5563}
  .ed p{margin:12px 0}
  .ed ul,.ed ol{padding-left:26px;margin:12px 0}
  .ed blockquote{margin:14px 0;padding:10px 16px;border-left:4px solid #cbd5e1;background:#f8fafc;color:#4b5563;border-radius:0 8px 8px 0}
  .ed blockquote.n-tip{background:#eff6ff;border-left-color:#3b82f6;color:#1e3a5f}
  .ed blockquote.n-warn{background:#fffbeb;border-left-color:#f59e0b;color:#59430a}
  .ed blockquote.n-key{background:#f5f3ff;border-left-color:#8b5cf6;color:#3b2f63}
  .ed blockquote.n-danger{background:#fef2f2;border-left-color:#ef4444;color:#5e1d1d}
  .ed blockquote.n-fold{background:#f1f5f9;border-left-color:#94a3b8;color:#3f4a5a}
  .ed blockquote.n-quote{background:none;border:0;text-align:center;font-size:19px;color:#3b4252;padding:16px 8px}
  .ed pre{background:#1f2430;color:#e6ecff;padding:14px 16px;border-radius:10px;overflow:auto;font-size:13.5px;line-height:1.6}
  .ed code{font-family:ui-monospace,Consolas,monospace;background:#eef2ff;color:#3f5fe0;padding:1px 5px;border-radius:4px;font-size:.92em}
  .ed pre code{background:none;color:inherit;padding:0}
  .ed hr{border:0;border-top:1px dashed #d7deea;margin:24px 0}
  .ed table{border-collapse:collapse;width:100%;margin:14px 0;font-size:14.5px}
  .ed th,.ed td{border:1px solid #e2e8f2;padding:7px 10px;text-align:left}
  .ed th{background:#f6f8fc;font-weight:600}
  .ed a{color:#4a6cf7}
  .ed img{max-width:100%;height:auto;border-radius:8px;cursor:pointer;vertical-align:top}
  .ed img.sel{outline:3px solid #93a4f7;outline-offset:2px}
  .ed img[data-f="l"]{float:left;margin:4px 18px 10px 0}
  .ed img[data-f="r"]{float:right;margin:4px 0 10px 18px}
  .ed img[data-f="c"]{display:block;margin:14px auto}
  .ed::after{content:"";display:block;clear:both}
  .src{width:100%;min-height:62vh;font:13.5px/1.75 ui-monospace,Consolas,monospace;border:1px solid #e6e9f2;border-top:0;border-radius:0 0 12px 12px;padding:18px 20px;background:#fbfcff;color:#2b3242;outline:none;resize:vertical}
  .foot{display:flex;gap:14px;align-items:center;margin-top:10px;font-size:12.5px;color:#8b94a6;flex-wrap:wrap}
  .foot .sp{margin-left:auto}
  .foot button{font-size:12.5px;padding:4px 9px}
  #handle{position:fixed;width:14px;height:14px;border-radius:50%;background:#4a6cf7;border:2px solid #fff;box-shadow:0 1px 6px rgba(74,108,247,.6);cursor:nwse-resize;display:none;z-index:60}
  .imgbar{position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:50;background:#1f2430;color:#e8ecf7;border-radius:12px;padding:9px 14px;display:flex;gap:14px;align-items:center;font-size:12.5px;box-shadow:0 8px 28px rgba(15,23,42,.28);max-width:calc(100vw - 24px);flex-wrap:wrap}
  .imgbar[hidden]{display:none}
  .imgbar input[type=range]{width:120px;vertical-align:middle}
  .imgbar input[type=number]{width:56px;font:inherit;font-size:12.5px;border:1px solid #3a4356;background:#2b3242;color:#fff;border-radius:6px;padding:3px 6px}
  .imgbar select{font:inherit;font-size:12.5px;border:1px solid #3a4356;background:#2b3242;color:#fff;border-radius:6px;padding:4px 6px}
  .imgbar button{background:#2b3242;border-color:#3a4356;color:#e8ecf7;font-size:12px;padding:4px 9px}
  .imgbar button.danger{color:#ffb4b4;border-color:#5c3a3a}
  .modal{position:fixed;inset:0;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:center;z-index:80;padding:20px}
  .modal[hidden]{display:none}
  .modal .box{background:#fff;border-radius:14px;width:min(560px,100%);max-height:78vh;display:flex;flex-direction:column;overflow:hidden}
  .modal .hd{padding:14px 18px;border-bottom:1px solid #eef1f7;display:flex;align-items:center;font-weight:600}
  .modal .hd button{margin-left:auto}
  .modal .ls{overflow:auto;padding:8px}
  .modal .li{padding:9px 12px;border-radius:9px;cursor:pointer;font-size:14px}
  .modal .li:hover{background:#f2f5ff}
  .modal .li .d{font-size:12px;color:#98a1b3;margin-top:1px}
  .toast{position:fixed;left:50%;top:18px;transform:translateX(-50%);background:#1f2430;color:#fff;font-size:13px;padding:8px 16px;border-radius:9px;z-index:90;opacity:0;transition:opacity .2s;pointer-events:none}
  .toast.on{opacity:1}
  @media (max-width:620px){
    .ed{padding:16px 14px 30px;font-size:16px}
    .tbar{gap:2px;padding:5px}
    .tbar select{max-width:88px}
    .wrap{padding:14px 10px 130px}
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <h1>写文章<span class="badge">可视化 · 所见即所得</span></h1>
    <div class="acts">
      <button id="bOpen">打开旧文章</button>
      <button id="bNew">新建</button>
      <button id="bDraft">存草稿</button>
      <button id="bSave">保存</button>
      <button id="bGo" class="primary">保存并发布</button>
      <a href="/site" style="font-size:13px;color:#4a6cf7;align-self:center;text-decoration:none">站点设置</a>
    </div>
  </div>

  <div class="meta">
    <input id="title" placeholder="文章标题">
    <input id="date" placeholder="日期：2026-11-13 08:30（留空自动）">
    <input id="tags" placeholder="标签：生活, 记录（逗号隔开）">
    <input id="desc" placeholder="摘要（首页显示，可留空）">
    <input id="pass" placeholder="文章密码（留空=公开）">
  </div>

  <div class="tbar" id="tbar">
    <select id="blk" title="段落格式">
      <option value="p">正文</option>
      <option value="h2">大标题</option>
      <option value="h3">小标题</option>
      <option value="h4">更小标题</option>
      <option value="blockquote">引用</option>
      <option value="pre">代码块</option>
    </select>
    <span class="sc"></span>
    <select id="fsize" title="字号">
      <option value="">字号</option>
      <option value="13px">很小 13</option>
      <option value="15px">小 15</option>
      <option value="16px">正文 16</option>
      <option value="18px">大 18</option>
      <option value="20px">更大 20</option>
      <option value="24px">标题 24</option>
      <option value="28px">特大 28</option>
      <option value="32px">巨大 32</option>
    </select>
    <button class="sw" data-color="#1f2430" style="background:#1f2430" title="黑色"></button>
    <button class="sw" data-color="#c0392b" style="background:#c0392b" title="红"></button>
    <button class="sw" data-color="#d97706" style="background:#d97706" title="橙"></button>
    <button class="sw" data-color="#0f766e" style="background:#0f766e" title="绿"></button>
    <button class="sw" data-color="#2563eb" style="background:#2563eb" title="蓝"></button>
    <button class="sw" data-color="#7c3aed" style="background:#7c3aed" title="紫"></button>
    <label style="font-size:12px;color:#6b7280;display:flex;align-items:center;gap:3px" title="高亮底色">
      <input type="color" id="hl" value="#fff3a3" style="width:22px;height:20px;border:1px solid #dfe4f0;border-radius:5px;padding:0;background:#fff">
    </label>
    <span class="sc"></span>
    <button data-cmd="bold" title="加粗 Ctrl+B"><b>B</b></button>
    <button data-cmd="italic" title="斜体 Ctrl+I"><i>I</i></button>
    <button data-cmd="underline" title="下划线 Ctrl+U"><u>U</u></button>
    <button data-cmd="strikeThrough" title="删除线"><s>S</s></button>
    <span class="sc"></span>
    <button data-cmd="justifyLeft" title="左对齐">≡</button>
    <button data-cmd="justifyCenter" title="居中">≣</button>
    <button data-cmd="justifyRight" title="右对齐">≡</button>
    <span class="sc"></span>
    <button data-cmd="insertUnorderedList" title="圆点列表">• 列表</button>
    <button data-cmd="insertOrderedList" title="数字列表">1. 列表</button>
    <span class="sc"></span>
    <button id="bLink" title="插入链接">🔗</button>
    <button id="bImg" title="插入图片">🖼 图片</button>
    <button id="bTable" title="插入表格">▦ 表格</button>
    <button id="bBtn" title="插入按钮：填文字和网址，发布后变成圆角大按钮">🔘 按钮</button>
    <select id="noteSel" title="插入提醒卡片：自动生成引用块并上色，不用记写法">
      <option value="">💡 提示卡片</option>
      <option value="tip">💡 提示（蓝色）</option>
      <option value="warn">⚠️ 注意（黄色）</option>
      <option value="key">📌 重点（紫色）</option>
      <option value="danger">🚫 警告（红色）</option>
      <option value="fold">📂 折叠展开</option>
      <option value="quote">❝ 金句（居中大字）</option>
    </select>
    <button id="bHr" title="分割线">—</button>
    <button id="bClear" title="清除格式">✕ 格式</button>
    <span class="sp" style="margin-left:auto"></span>
    <button id="bMode" title="在可视化 / Markdown 源码之间切换">源码</button>
  </div>

  <div class="ed" id="ed" contenteditable="true"></div>
  <textarea class="src" id="src" hidden spellcheck="false"></textarea>

  <div class="foot">
    <span id="stat">0 字</span>
    <span id="msg"></span>
    <span class="sp"></span>
    <span>快捷键：Ctrl+B 粗 · Ctrl+I 斜 · Ctrl+S 保存</span>
  </div>
</div>

<div id="handle"></div>
<div class="imgbar" id="imgbar" hidden>
  <span>宽度 <input type="range" id="iw" min="10" max="100" step="5"><input type="number" id="iwn" min="10" max="100" step="5">%</span>
  <span>排版
    <select id="ifl">
      <option value="">整行居中</option>
      <option value="l">图在左·文字在右</option>
      <option value="r">图在右·文字在左</option>
      <option value="c">居中</option>
    </select>
  </span>
  <button id="iDel" class="danger">删除图片</button>
  <button id="iDone">完成</button>
</div>

<div class="modal" id="modal" hidden>
  <div class="box">
    <div class="hd">打开旧文章<button id="mClose">关闭</button></div>
    <div class="ls" id="mlist"></div>
  </div>
</div>
<div class="toast" id="toast"></div>

<input type="file" id="file" accept="image/*" multiple hidden>

<script>
(function () {
  var ed = document.getElementById('ed');
  var src = document.getElementById('src');
  var handle = document.getElementById('handle');
  var imgbar = document.getElementById('imgbar');
  var iw = document.getElementById('iw');
  var iwn = document.getElementById('iwn');
  var ifl = document.getElementById('ifl');
  var stat = document.getElementById('stat');
  var msg = document.getElementById('msg');
  var curImg = null;
  var mode = 'visual';
  var curFile = '';
  var curDraft = false;
  var BT = String.fromCharCode(96); // 反引号，避免和页面模板字符串打架

  function toast(t) {
    var el = document.getElementById('toast');
    el.textContent = t;
    el.classList.add('on');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('on'); }, 1800);
  }
  function say(t) { msg.textContent = t || ''; }
  function focusEd() { try { ed.focus(); } catch (e) {} }

  /* ---------- 字数 ---------- */
  function recount() {
    var t = mode === 'visual' ? (ed.innerText || '') : src.value;
    var n = t.replace(/\\s/g, '').length;
    stat.textContent = n + ' 字';
  }
  ed.addEventListener('input', function () { recount(); paintNotes(); });
  src.addEventListener('input', recount);

  /* ---------- 工具条基础命令 ---------- */
  function exec(cmd, val) {
    focusEd();
    try { document.execCommand(cmd, false, val || null); } catch (e) {}
    recount();
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tbar [data-cmd]'), function (b) {
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('click', function () { exec(b.getAttribute('data-cmd')); });
  });
  document.getElementById('blk').addEventListener('change', function () {
    exec('formatBlock', '<' + this.value + '>');
    this.value = 'p';
    this.blur();
  });
  document.getElementById('bHr').addEventListener('click', function () { exec('insertHorizontalRule'); });
  /* ---------- 提醒卡片：一键插入「引用块 + 提示：」，并在编辑区上色 ---------- */
  var NOTE_KINDS = {
    tip: { head: '提示：', body: '这里写要提醒读者的一句话。' },
    warn: { head: '注意：', body: '这里写容易出错、需要小心的地方。' },
    key: { head: '重点：', body: '这里写最想让读者记住的一句。' },
    danger: { head: '警告：', body: '这里写千万别做的事。' },
    fold: { head: '折叠：点这里展开', body: '点开之后才看到的内容写在这里。' },
    quote: { head: '', body: '这里写一句想让人记住的短话（60 字以内）' }
  };
  var NOTE_CLS = ['n-tip', 'n-warn', 'n-key', 'n-danger', 'n-fold', 'n-quote'];

  function closestBlock(node) {
    var el = node && node.nodeType === 1 ? node : node ? node.parentNode : null;
    while (el && el !== ed) {
      if (/^(P|DIV|H[1-6]|BLOCKQUOTE|LI|PRE|FIGURE|SECTION)$/.test(el.tagName)) return el;
      el = el.parentNode;
    }
    return null;
  }

  // 把一段内容插到光标所在段落后面，并留下一行空段落给用户接着写
  function attachBlock(box) {
    var tail = document.createElement('p');
    tail.appendChild(document.createElement('br'));
    focusEd();
    var sel = window.getSelection();
    var host = null;
    try {
      if (sel && sel.rangeCount && ed.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        host = closestBlock(sel.getRangeAt(0).startContainer);
      }
    } catch (e) {}
    if (!host) host = closestBlock(ed.lastElementChild);

    if (host && !String(host.textContent || '').trim() && host.tagName !== 'BLOCKQUOTE') {
      // 光标停在一个空段落里：直接把这个空段落换掉
      host.parentNode.insertBefore(box, host);
      host.parentNode.insertBefore(tail, host);
      host.parentNode.removeChild(host);
    } else if (host) {
      host.parentNode.insertBefore(tail, host.nextSibling);
      host.parentNode.insertBefore(box, tail);
    } else {
      ed.appendChild(box);
      ed.appendChild(tail);
    }
    return box;
  }

  function insertNote(kind) {
    var k = NOTE_KINDS[kind];
    if (!k) return;
    var box = document.createElement('blockquote');
    var first = document.createElement('p');
    first.textContent = k.head + (kind === 'fold' ? '' : k.body);
    box.appendChild(first);
    if (kind === 'fold') {
      var more = document.createElement('p');
      more.textContent = k.body;
      box.appendChild(more);
    }
    attachBlock(box);

    // 选中占位文字，直接打字就替换掉
    try {
      var r = document.createRange();
      r.selectNodeContents(first);
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    } catch (e) {}

    paintNotes();
    recount();
  }

  // 按首行文字给引用块上色，让人一眼看到「提示：」就是蓝色卡片
  function paintNotes() {
    Array.prototype.forEach.call(ed.querySelectorAll('blockquote'), function (bq) {
      NOTE_CLS.forEach(function (c) { bq.classList.remove(c); });
      var t = String(bq.textContent || '').replace(/^\\s+/, '');
      var cls = '';
      if (/^(提示|小提示|小贴士|技巧|TIP)/i.test(t)) cls = 'n-tip';
      else if (/^(注意|小心|NOTE)/i.test(t)) cls = 'n-warn';
      else if (/^(重点|要点|划重点|KEY)/i.test(t)) cls = 'n-key';
      else if (/^(警告|危险|重要|WARN)/i.test(t)) cls = 'n-danger';
      else if (/^(折叠|收起|展开|点开看|FOLD)/i.test(t)) cls = 'n-fold';
      else if (t.replace(/\\s/g, '').length <= 60 && !bq.querySelector('p + p')) cls = 'n-quote';
      if (cls) bq.classList.add(cls);
    });
  }
  document.getElementById('noteSel').addEventListener('change', function () {
    if (this.value) insertNote(this.value);
    this.value = '';
    this.blur();
  });

  /* 按钮：文字 + 网址 → 发布后变成圆角按钮 */
  document.getElementById('bBtn').addEventListener('click', function () {
    var text = window.prompt('按钮上写什么字？（建议 2~8 个字）', '点这里看看');
    if (text === null) return;
    text = String(text).trim() || '点这里看看';
    var url = window.prompt('点了按钮去哪？（网址，可省略 https://）', 'https://');
    if (url === null) return;
    url = String(url).trim();
    if (!url) { toast('没填网址，按钮没插入'); return; }
    if (!/^(https?:\\/\\/|\\/|mailto:)/i.test(url)) url = 'https://' + url;

    var p = document.createElement('p');
    p.appendChild(document.createTextNode('【按钮】'));
    var a = document.createElement('a');
    a.setAttribute('href', url);
    a.textContent = text;
    p.appendChild(a);
    attachBlock(p);

    try {
      var r = document.createRange();
      r.selectNodeContents(a);
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    } catch (e) {}
    toast('已插入：编辑区显示「【按钮】文字」是正常的，发布后才变成按钮');
    recount();
  });

  document.getElementById('bClear').addEventListener('click', function () {
    focusEd();
    try { document.execCommand('removeFormat'); } catch (e) {}
    var s = window.getSelection();
    if (s && s.rangeCount && !s.isCollapsed) {
      try { document.execCommand('formatBlock', false, '<p>'); } catch (e) {}
    }
  });

  /* 把选区包进带样式的 span（字号 / 颜色 / 高亮） */
  function wrapStyle(prop, val) {
    focusEd();
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) { toast('先选中要改的文字'); return; }
    var r = sel.getRangeAt(0);
    if (r.collapsed) { toast('先选中要改的文字'); return; }
    if (!ed.contains(r.commonAncestorContainer)) { toast('先选中正文里的文字'); return; }
    var frag = r.extractContents();
    // 去掉内部同名样式，避免层层嵌套
    Array.prototype.forEach.call(frag.querySelectorAll('[style]'), function (el) {
      el.style[prop] = '';
      if (!el.getAttribute('style')) {
        while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
        el.parentNode.removeChild(el);
      }
    });
    var span = document.createElement('span');
    span.style[prop] = val;
    span.appendChild(frag);
    r.insertNode(span);
    var nr = document.createRange();
    nr.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(nr);
    recount();
  }
  document.getElementById('fsize').addEventListener('change', function () {
    if (this.value) wrapStyle('fontSize', this.value);
    this.value = '';
    this.blur();
  });
  Array.prototype.forEach.call(document.querySelectorAll('.tbar .sw'), function (b) {
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });
    b.addEventListener('click', function () {
      wrapStyle('color', b.getAttribute('data-color'));
      Array.prototype.forEach.call(document.querySelectorAll('.tbar .sw'), function (x) { x.classList.remove('on'); });
      b.classList.add('on');
    });
  });
  document.getElementById('hl').addEventListener('change', function () {
    wrapStyle('backgroundColor', this.value);
  });

  /* ---------- 链接 ---------- */
  document.getElementById('bLink').addEventListener('click', function () {
    var sel = window.getSelection();
    var has = sel && sel.rangeCount && !sel.isCollapsed;
    var u = prompt('链接地址（https://… 或 /文章路径）', 'https://');
    if (!u) return;
    if (has) exec('createLink', u);
    else exec('insertHTML', '<a href="' + u.replace(/"/g, '') + '">' + u.replace(/</g, '') + '</a>');
  });

  /* ---------- 图片：上传 / 选中 / 拖角改大小 / 环绕 ---------- */
  var fileEl = document.getElementById('file');
  document.getElementById('bImg').addEventListener('click', function () { fileEl.click(); });
  fileEl.addEventListener('change', function () {
    var files = Array.prototype.slice.call(fileEl.files || []);
    fileEl.value = '';
    if (!files.length) return;
    say('正在处理图片…');
    var chain = Promise.resolve();
    files.forEach(function (f) {
      chain = chain.then(function () { return uploadImage(f); }).then(function (p) {
        if (p) insertImage(p, 100, '');
      });
    });
    chain.then(function () { say('图片已插入。点图片可以拖右下角改大小。'); }).catch(function (e) { say('上传失败：' + e.message); });
  });

  function shrink(file) {
    if (!/^image\\/(jpeg|png|webp|jpg)$/i.test(file.type)) return Promise.resolve(file);
    return new Promise(function (res) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1920;
        var w = img.naturalWidth;
        var h = img.naturalHeight;
        if (w <= max && file.size < 400 * 1024) { URL.revokeObjectURL(url); res(file); return; }
        var sc = Math.min(1, max / Math.max(w, h));
        var cv = document.createElement('canvas');
        cv.width = Math.round(w * sc);
        cv.height = Math.round(h * sc);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(function (b) {
          URL.revokeObjectURL(url);
          if (!b || b.size >= file.size) { res(file); return; }
          res(new File([b], (file.name || 'img').replace(/\\.\\w+$/, '') + '.webp', { type: 'image/webp' }));
        }, 'image/webp', 0.9);
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(file); };
      img.src = url;
    });
  }

  function uploadImage(file) {
    return shrink(file).then(function (f) {
      return fetch('/site/media?kind=img&shrink=0&name=' + encodeURIComponent(f.name || 'paste.png'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: f,
      }).then(function (r) { return r.json(); });
    }).then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || '服务端没返回路径');
      return j.path;
    });
  }

  function insertImage(pathUrl, pct, float) {
    var img = document.createElement('img');
    img.src = pathUrl;
    img.setAttribute('data-w', pct || 100);
    if (float) img.setAttribute('data-f', float);
    img.style.width = (pct || 100) + '%';
    if (float) img.style.float = float === 'r' ? 'right' : (float === 'l' ? 'left' : 'none');
    var sel = window.getSelection();
    if (sel && sel.rangeCount && ed.contains(sel.anchorNode)) {
      var r = sel.getRangeAt(0);
      r.deleteContents();
      r.insertNode(img);
      var p = document.createElement('p');
      p.innerHTML = '<br>';
      img.parentNode.insertBefore(p, img.nextSibling);
      var nr = document.createRange();
      nr.setStart(p, 0);
      nr.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nr);
    } else {
      ed.appendChild(img);
      var p2 = document.createElement('p');
      p2.innerHTML = '<br>';
      ed.appendChild(p2);
    }
    selectImg(img);
    recount();
  }

  function placeHandle() {
    if (!curImg) { handle.style.display = 'none'; return; }
    var r = curImg.getBoundingClientRect();
    handle.style.display = 'block';
    handle.style.left = (r.right - 8) + 'px';
    handle.style.top = (r.bottom - 8) + 'px';
  }
  window.addEventListener('scroll', function () { if (curImg) placeHandle(); }, true);
  window.addEventListener('resize', function () { if (curImg) placeHandle(); });

  function selectImg(img) {
    Array.prototype.forEach.call(ed.querySelectorAll('img.sel'), function (i) { i.classList.remove('sel'); });
    curImg = img || null;
    if (!img) {
      imgbar.hidden = true;
      handle.style.display = 'none';
      return;
    }
    img.classList.add('sel');
    imgbar.hidden = false;
    var pct = parseInt(img.getAttribute('data-w') || '', 10);
    if (!pct) pct = Math.round((parseFloat(img.style.width) || 100));
    if (!pct || pct < 10) pct = 100;
    iw.value = pct;
    iwn.value = pct;
    ifl.value = img.getAttribute('data-f') || '';
    placeHandle();
  }

  ed.addEventListener('click', function (e) {
    if (e.target && e.target.tagName === 'IMG') {
      e.preventDefault();
      selectImg(e.target);
    } else if (curImg) {
      selectImg(null);
    }
  });
  document.addEventListener('click', function (e) {
    if (!curImg) return;
    if (ed.contains(e.target) || imgbar.contains(e.target) || e.target === handle) return;
    selectImg(null);
  });

  function applyWidth(pct) {
    if (!curImg) return;
    pct = Math.max(10, Math.min(100, Math.round(pct / 5) * 5));
    curImg.style.width = pct + '%';
    curImg.setAttribute('data-w', pct);
    iw.value = pct;
    iwn.value = pct;
    placeHandle();
  }
  iw.addEventListener('input', function () { applyWidth(parseInt(this.value, 10) || 100); });
  iwn.addEventListener('change', function () { applyWidth(parseInt(this.value, 10) || 100); });
  ifl.addEventListener('change', function () {
    if (!curImg) return;
    var f = this.value;
    if (f) curImg.setAttribute('data-f', f); else curImg.removeAttribute('data-f');
    curImg.style.float = f === 'r' ? 'right' : (f === 'l' ? 'left' : 'none');
    if (f === 'c') { curImg.style.display = 'block'; curImg.style.margin = '14px auto'; }
    else { curImg.style.display = ''; curImg.style.margin = ''; }
    placeHandle();
  });
  document.getElementById('iDel').addEventListener('click', function () {
    if (curImg) { curImg.parentNode.removeChild(curImg); selectImg(null); recount(); }
  });
  document.getElementById('iDone').addEventListener('click', function () { selectImg(null); focusEd(); });

  /* 拖右下角改宽度 */
  var drag = null;
  handle.addEventListener('mousedown', function (e) {
    if (!curImg) return;
    e.preventDefault();
    var r = curImg.getBoundingClientRect();
    drag = { x: e.clientX, w: r.width, edw: ed.clientWidth || 1 };
  });
  document.addEventListener('mousemove', function (e) {
    if (!drag) return;
    e.preventDefault();
    var w = drag.w + (e.clientX - drag.x);
    applyWidth((w / drag.edw) * 100);
  });
  document.addEventListener('mouseup', function () { drag = null; });

  /* ---------- 表格 / 分割线 ---------- */
  document.getElementById('bTable').addEventListener('click', function () {
    var rc = prompt('几行几列？例如 3x4（3 行 4 列）', '2x3');
    if (!rc) return;
    var m = rc.toLowerCase().split('x');
    var rows = Math.max(1, Math.min(20, parseInt(m[0], 10) || 2));
    var cols = Math.max(1, Math.min(10, parseInt(m[1], 10) || 3));
    var html = '<table><tbody>';
    for (var i = 0; i < rows; i++) {
      html += '<tr>';
      for (var j = 0; j < cols; j++) {
        html += i === 0 ? '<th>表头</th>' : '<td>单元格</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    exec('insertHTML', html);
  });

  /* ---------- 粘贴清洗（Word / 网页） ---------- */
  var OK_TAGS = 'P,DIV,BR,SPAN,B,STRONG,I,EM,U,S,STRIKE,DEL,H1,H2,H3,H4,H5,H6,UL,OL,LI,BLOCKQUOTE,PRE,CODE,A,IMG,TABLE,THEAD,TBODY,TR,TD,TH,HR,SUB,SUP,FIGURE,FIGCAPTION';
  var OK_PROPS = ['font-size', 'color', 'background-color', 'text-align', 'font-weight', 'font-style', 'text-decoration'];

  function cleanStyle(el) {
    var st = el.getAttribute('style');
    if (!st) return;
    var keep = [];
    st.split(';').forEach(function (kv) {
      var i = kv.indexOf(':');
      if (i < 0) return;
      var k = kv.slice(0, i).trim().toLowerCase();
      var v = kv.slice(i + 1).trim();
      if (!v) return;
      // Word 的 mso-* / 表格布局样式一律丢掉
      if (OK_PROPS.indexOf(k) < 0) return;
      if (/expression|url\\(/i.test(v)) return;
      keep.push(k + ':' + v);
    });
    if (keep.length) el.setAttribute('style', keep.join(';'));
    else el.removeAttribute('style');
  }

  ed.addEventListener('paste', function (e) {
    var cd = e.clipboardData;
    if (!cd) return;
    var html = cd.getData('text/html');
    if (!html) return; // 纯文本走默认，保留换行
    e.preventDefault();
    var doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (err) { return; }
    var frag = document.createDocumentFragment();
    function walk(node, parent) {
      Array.prototype.forEach.call(node.childNodes, function (n) {
        if (n.nodeType === 3) {
          parent.appendChild(document.createTextNode(n.nodeValue));
          return;
        }
        if (n.nodeType !== 1) return;
        var tag = n.tagName;
        if (tag === 'BR') { parent.appendChild(document.createElement('br')); return; }
        if (OK_TAGS.indexOf(tag) < 0) { walk(n, parent); return; }
        var el = document.createElement(tag.toLowerCase());
        if (tag === 'A') {
          var href = n.getAttribute('href') || '';
          if (href && !/^javascript:/i.test(href)) el.setAttribute('href', href);
        }
        if (tag === 'IMG') {
          var s = n.getAttribute('src') || '';
          if (!s) return;
          el.setAttribute('src', s);
          el.setAttribute('data-w', 100);
          el.style.width = '100%';
        }
        if (tag === 'TD' || tag === 'TH') {
          var cs = n.getAttribute('colspan');
          if (cs && /^[0-9]{1,2}$/.test(cs)) el.setAttribute('colspan', cs);
        }
        cleanStyle(n);
        var st = n.getAttribute('style');
        if (st) el.setAttribute('style', st);
        parent.appendChild(el);
        walk(n, el);
      });
    }
    walk(doc.body, frag);
    var host = document.createElement('div');
    host.appendChild(frag);
    // 粘进来的零散内联（Word 常把整段包在 span 里）统一拆成段落
    var out = document.createElement('div');
    var buf = [];
    var flush = function () {
      if (!buf.length) return;
      var p = document.createElement('p');
      buf.forEach(function (x) { p.appendChild(x); });
      out.appendChild(p);
      buf = [];
    };
    Array.prototype.slice.call(host.childNodes).forEach(function (n) {
      if (n.nodeType === 1 && /^(P|DIV|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|PRE|HR|FIGURE)$/.test(n.tagName)) {
        flush();
        out.appendChild(n.cloneNode(true));
      } else {
        buf.push(n.cloneNode(true));
      }
    });
    flush();
    exec('insertHTML', out.innerHTML || '<p><br></p>');
    // 粘进来的 base64 图片：上传后再替换
    Array.prototype.forEach.call(ed.querySelectorAll('img[src^="data:"]'), function (img) {
      var s = img.getAttribute('src');
      say('正在保存粘贴进来的图片…');
      fetch(s).then(function (r) { return r.blob(); }).then(function (b) {
        return uploadImage(new File([b], 'pasted-' + Date.now() + '.png', { type: b.type || 'image/png' }));
      }).then(function (p) {
        if (p) { img.setAttribute('src', p); say('图片已保存到图库'); }
      }).catch(function () { say('有图片没保存成功，可在正文里重新插入'); });
    });
    recount();
  });

  /* ---------- Markdown 转换（可视化 → 源码） ---------- */
  function escMd(t) {
    return String(t)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  function imgMd(img) {
    var s = img.getAttribute('src') || '';
    if (!s) return '';
    s = s.replace(/[?&]w=[^&]*/g, '').replace(/[?&]f=[^&]*/g, '');
    var pct = parseInt(img.getAttribute('data-w') || '', 10);
    if (!pct) pct = Math.round(parseFloat(img.style.width) || 100);
    var f = img.getAttribute('data-f') || '';
    var q = [];
    if (pct && pct !== 100) q.push('w=' + pct + '%');
    if (f) q.push('f=' + f);
    if (q.length) s += (s.indexOf('?') > 0 ? '&' : '?') + q.join('&');
    return '![](' + s + ') ';
  }
  function inlineMd(node) {
    var out = '';
    Array.prototype.forEach.call(node.childNodes, function (n) {
      if (n.nodeType === 3) { out += escMd(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName;
      if (tag === 'BR') { out += '<br>'; return; }
      if (tag === 'IMG') { out += imgMd(n); return; }
      if (tag === 'STRONG' || tag === 'B') { out += '**' + inlineMd(n).trim() + '**'; return; }
      if (tag === 'EM' || tag === 'I') { out += '*' + inlineMd(n).trim() + '*'; return; }
      if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') { out += '~~' + inlineMd(n).trim() + '~~'; return; }
      if (tag === 'CODE') { out += BT + n.textContent + BT; return; }
      if (tag === 'A') {
        var href = n.getAttribute('href') || '';
        out += '[' + inlineMd(n).trim() + '](' + href + ')';
        return;
      }
      if (tag === 'U') { out += '<u>' + innerHtml(n) + '</u>'; return; }
      if (tag === 'SPAN') {
        var st = (n.getAttribute('style') || '').trim();
        if (st) {
          var bold = /font-weight(:|\\s*:)\\s*(bold|[6-9]00)/i.test(st);
          var inner = inlineMd(n);
          if (bold) inner = '**' + inner.trim() + '**';
          out += '<span style="' + st.replace(/"/g, '') + '">' + (bold ? inner.slice(2, -2) : inner) + '</span>';
          return;
        }
        out += inlineMd(n);
        return;
      }
      out += inlineMd(n);
    });
    return out;
  }
  function innerHtml(node) {
    var d = document.createElement('div');
    Array.prototype.forEach.call(node.childNodes, function (n) { d.appendChild(n.cloneNode(true)); });
    return d.innerHTML;
  }
  function tableMd(tb) {
    var rows = Array.prototype.slice.call(tb.querySelectorAll('tr'));
    if (!rows.length) return '';
    var lines = [];
    rows.forEach(function (tr, ri) {
      var cells = Array.prototype.slice.call(tr.children).map(function (c) {
        return inlineMd(c).replace(/\\|/g, '\\\\|').trim();
      });
      lines.push('| ' + cells.join(' | ') + ' |');
      if (ri === 0) lines.push('| ' + cells.map(function () { return '---'; }).join(' | ') + ' |');
    });
    return lines.join('\\n');
  }
  function listMd(listEl, depth) {
    var lines = [];
    var ordered = listEl.tagName === 'OL';
    var i = 0;
    Array.prototype.forEach.call(listEl.children, function (li) {
      if (li.tagName !== 'LI') return;
      i++;
      var clone = li.cloneNode(true);
      var nested = [];
      Array.prototype.forEach.call(clone.querySelectorAll('ul,ol'), function (nn) { nested.push(nn); });
      nested.forEach(function (nn) { if (nn.parentNode) nn.parentNode.removeChild(nn); });
      var txt = inlineMd(clone).trim();
      lines.push(new Array(depth + 1).join('  ') + (ordered ? i + '. ' : '- ') + txt);
      nested.forEach(function (nn) { lines.push(listMd(nn, depth + 1)); });
    });
    return lines.join('\\n');
  }

  function blockMd(node, depth) {
    var out = [];
    Array.prototype.forEach.call(node.childNodes, function (n) {
      if (n.nodeType === 3) {
        var t = n.nodeValue.replace(/\\s+/g, ' ').trim();
        if (t) out.push(t);
        return;
      }
      if (n.nodeType !== 1) return;
      var tag = n.tagName;
      if (/^H[1-6]$/.test(tag)) {
        out.push(new Array(Number(tag[1]) + 1).join('#') + ' ' + inlineMd(n).trim());
      } else if (tag === 'P' || tag === 'DIV' || tag === 'FIGURE' || tag === 'FIGCAPTION' || tag === 'SECTION') {
        var hasBlock = n.querySelector('p,div,ul,ol,table,blockquote,pre,h1,h2,h3,h4,h5,h6,figure');
        if (hasBlock) { out.push(blockMd(n, depth)); return; }
        var imgs = n.querySelectorAll('img');
        var body = inlineMd(n).trim();
        if (!body) return;
        if (imgs.length && !body.replace(/!\\[[^\\]]*\\]\\([^)]*\\)/g, '').trim()) out.push(body);
        else {
          var align = (n.getAttribute('style') || '').match(/text-align\\s*:\\s*(center|right)/i);
          if (align) out.push('<p style="text-align:' + align[1].toLowerCase() + '">' + innerHtml(n) + '</p>');
          else out.push(body);
        }
      } else if (tag === 'UL' || tag === 'OL') {
        out.push(listMd(n, depth));
      } else if (tag === 'BLOCKQUOTE') {
        var inner = blockMd(n, depth);
        // 空行写成「>」，否则多段引用会被拆成两个引用块
        out.push(inner.split('\\n').map(function (l) {
          return String(l).trim() ? '> ' + l : '>';
        }).join('\\n'));
      } else if (tag === 'PRE') {
        var code = (n.innerText != null ? n.innerText : n.textContent) || '';
        out.push(BT + BT + BT + '\\n' + code.replace(/\\s+$/, '') + '\\n' + BT + BT + BT);
      } else if (tag === 'HR') {
        out.push('---');
      } else if (tag === 'TABLE') {
        out.push(tableMd(n));
      } else if (tag === 'IMG') {
        out.push(imgMd(n));
      } else if (tag === 'BR') {
        // 忽略
      } else {
        out.push(inlineMd(n).trim());
      }
    });
    return out.filter(function (s) {
      var t = String(s).trim();
      return t !== '' && t !== '<br>' && t !== '<br/>' && t !== '<br />';
    }).join('\\n\\n');
  }
  function toMarkdown() {
    return blockMd(ed, 0).replace(/\\n{3,}/g, '\\n\\n').trim();
  }

  /* ---------- 源码 / 可视化 切换 ---------- */
  document.getElementById('bMode').addEventListener('click', function () {
    if (mode === 'visual') {
      var md = toMarkdown();
      src.value = md;
      src.hidden = false;
      ed.hidden = true;
      mode = 'src';
      this.textContent = '可视化';
      say('源码模式：直接改 Markdown，改完点「可视化」回来。');
    } else {
      renderMd(src.value);
      src.hidden = true;
      ed.hidden = false;
      mode = 'visual';
      this.textContent = '源码';
      say('');
    }
    recount();
  });

  function renderMd(md) {
    return fetch('/write/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: md }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || '渲染失败');
      ed.innerHTML = j.html || '';
      fixImages();
      paintNotes();
    });
  }
  /* 渲染回来之后，把 hexo 老文章里 <img> 上的 ?w= 读成编辑器里的宽度/环绕 */
  function fixImages() {
    Array.prototype.forEach.call(ed.querySelectorAll('img'), function (img) {
      var s = img.getAttribute('src') || '';
      var wm = s.match(/[?&]w=([0-9]{1,3})(%|%25)?/i);
      var fm = s.match(/[?&]f=([lrc])/i);
      var pct = wm ? parseInt(wm[1], 10) : 100;
      if (!pct || pct < 10) pct = 100;
      img.setAttribute('data-w', pct);
      img.style.width = pct + '%';
      if (fm) {
        img.setAttribute('data-f', fm[1].toLowerCase());
        if (fm[1] !== 'c') img.style.float = fm[1].toLowerCase() === 'r' ? 'right' : 'left';
      }
    });
  }

  /* ---------- 打开旧文章 ---------- */
  document.getElementById('bOpen').addEventListener('click', function () {
    var box = document.getElementById('mlist');
    box.innerHTML = '<div style="padding:12px;color:#98a1b3;font-size:13px">读取中…</div>';
    document.getElementById('modal').hidden = false;
    fetch('/write/list').then(function (r) { return r.json(); }).then(function (j) {
      var list = (j && j.posts) || [];
      if (!list.length) { box.innerHTML = '<div style="padding:12px;color:#98a1b3;font-size:13px">还没有文章</div>'; return; }
      box.innerHTML = list.map(function (p) {
        return '<div class="li" data-file="' + p.file.replace(/"/g, '&quot;') + '"><div>' + (p.draft ? '〔草稿〕' : '') + (p.title || p.file) + '</div><div class="d">' + (p.date || '') + ' · ' + p.file + '</div></div>';
      }).join('');
    }).catch(function (e) {
      box.innerHTML = '<div style="padding:12px;color:#c0392b;font-size:13px">读取失败：' + e.message + '</div>';
    });
  });
  document.getElementById('mClose').addEventListener('click', function () { document.getElementById('modal').hidden = true; });
  document.getElementById('modal').addEventListener('click', function (e) {
    if (e.target === this) this.hidden = true;
    var li = e.target.closest ? e.target.closest('.li') : null;
    if (!li) return;
    this.hidden = true;
    openPost(li.getAttribute('data-file'));
  });

  function openPost(file) {
    fetch('/write/load?file=' + encodeURIComponent(file)).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || '打开失败');
      curFile = j.file;
      curDraft = !!j.draft;
      document.getElementById('title').value = j.title || '';
      document.getElementById('date').value = j.date || '';
      document.getElementById('tags').value = (j.tags || []).join(', ');
      document.getElementById('desc').value = j.description || '';
      document.getElementById('pass').value = j.password || '';
      // 老文章默认进「源码」模式，避免把特殊写法（hexo 标签等）改坏
      if (mode === 'visual') { src.value = j.markdown || ''; }
      else { src.value = j.markdown || ''; }
      if (mode === 'visual') {
        document.getElementById('bMode').click();
      }
      src.value = j.markdown || '';
      recount();
      say('已打开 ' + j.file + '（当前是源码模式；点「可视化」可以像 Word 一样改，普通文章才建议切换）');
    }).catch(function (e) { toast('打开失败：' + e.message); });
  }

  /* ---------- 新建 ---------- */
  document.getElementById('bNew').addEventListener('click', function () {
    if (!confirm('新建一篇？当前没保存的内容会丢。')) return;
    curFile = '';
    curDraft = false;
    ['title', 'date', 'tags', 'desc', 'pass'].forEach(function (id) { document.getElementById(id).value = ''; });
    ed.innerHTML = '';
    src.value = '';
    if (mode === 'src') document.getElementById('bMode').click();
    say('新文章');
    recount();
    document.getElementById('title').focus();
  });

  /* ---------- 保存 ---------- */
  function payload(draft) {
    return {
      file: curFile || '',
      title: document.getElementById('title').value.trim() || '无标题',
      date: document.getElementById('date').value.trim(),
      tags: document.getElementById('tags').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      description: document.getElementById('desc').value.trim(),
      password: document.getElementById('pass').value.trim(),
      draft: !!draft,
      markdown: mode === 'visual' ? toMarkdown() : src.value,
    };
  }
  function save(draft, thenPublish) {
    // 已打开的草稿：点「保存」还是草稿；点「保存并发布」才转成正式文章
    var useDraft = thenPublish ? false : (draft || curDraft);
    var d = payload(useDraft);
    if (!d.markdown.trim()) { toast('正文还是空的'); return; }
    say('保存中…');
    fetch('/write/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.error) || '保存失败');
      curFile = j.file;
      curDraft = !!j.draft;
      say('已保存：source/' + j.file + (useDraft ? '（草稿：线上不显示，点「保存并发布」才会上线）' : ''));
      toast('已保存');
      if (thenPublish) {
        say('已保存，正在发布到线上…（1-2 分钟）');
        return fetch('/site/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
          .then(function (r) { return r.json(); })
          .then(function (p) {
            say(p && p.ok ? '已发布，1-2 分钟后网站更新' : '保存成功，但发布没成功：' + ((p && p.error) || '未知原因'));
          });
      }
    }).catch(function (e) { say('保存失败：' + e.message); toast('保存失败'); });
  }
  document.getElementById('bSave').addEventListener('click', function () { save(false, false); });
  document.getElementById('bDraft').addEventListener('click', function () { save(true, false); });
  document.getElementById('bGo').addEventListener('click', function () {
    if (!confirm('保存并发布到线上？（发布大约需要 1-2 分钟）')) return;
    save(false, true);
  });

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save(false, false);
    }
  });

  recount();
  say('可以直接开始写。图片拖进正文、或点「🖼 图片」上传后，拖右下角的圆点改大小。');

  // 给自动化测试留个口子（浏览器里不影响任何东西）
  window.__wbmd = toMarkdown;
})();
</script>
</body>
</html>`;
}

/* ------------------------------ 路由 ------------------------------ */

async function handle(hexo, req, res, options) {
  const base = hexo.base_dir;
  // Express 把 /write 挂载后会把前缀从 req.url 里剥掉，这里补回来统一处理
  let full = req.url || '/';
  if (full.indexOf('/write') !== 0) full = '/write' + (full.charAt(0) === '/' ? full : '/' + full);
  const url = full.split('?')[0];
  if (url !== '/write' && url !== '/write/' && url.indexOf('/write/') !== 0) return false;

  try {
    if (req.method === 'GET' && (url === '/write' || url === '/write/')) {
      const html = renderPage();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return true;
    }

    if (req.method === 'GET' && url === '/write/list') {
      sendJson(res, 200, { ok: true, posts: listPosts(base) });
      return true;
    }

    if (req.method === 'GET' && url === '/write/load') {
      const q = new URL(full, 'http://localhost').searchParams;
      const f = resolveFile(base, q.get('file'));
      if (!fs.existsSync(f.path)) throw new Error('这篇文章不存在了');
      const p = parsePost(fs.readFileSync(f.path, 'utf8'));
      sendJson(res, 200, {
        ok: true,
        file: f.label,
        draft: f.inDrafts || !!p.draft,
        title: p.title,
        date: p.date,
        description: p.description,
        cover: p.cover,
        password: p.password,
        imgWidth: p.imgWidth,
        imgFloat: p.imgFloat,
        tags: p.tags,
        categories: p.categories,
        markdown: p.body,
      });
      return true;
    }

    if (req.method === 'POST' && url === '/write/render') {
      const body = JSON.parse((await readBody(req)) || '{}');
      let html = '';
      try {
        const markedMod = require('marked');
        const inst = new markedMod.Marked();
        html = inst.parse(String(body.markdown || ''), { gfm: true, breaks: false });
      } catch (e) {
        throw new Error('Markdown 预览失败：' + ((e && e.message) || e));
      }
      sendJson(res, 200, { ok: true, html: html });
      return true;
    }

    if (req.method === 'POST' && url === '/write/save') {
      const d = JSON.parse((await readBody(req, 30 * 1024 * 1024)) || '{}');
      const target = d.draft ? draftsDir(base) : postsDir(base);
      fs.mkdirSync(target, { recursive: true });

      let old = null;
      let name = '';
      if (d.file) {
        old = resolveFile(base, d.file);
        name = old.name;
      } else {
        const day = String(normDate(d.date)).slice(0, 10);
        const slug = slugOf(d.title);
        name = day + '-' + slug + '.md';
        let n = 2;
        while (fs.existsSync(path.join(target, name))) {
          name = day + '-' + slug + '-' + n + '.md';
          n++;
        }
      }

      const md = buildMarkdown({
        title: d.title,
        date: d.date,
        description: d.description,
        cover: d.cover,
        tags: d.tags,
        categories: d.categories,
        password: d.password,
        imgWidth: d.imgWidth,
        imgFloat: d.imgFloat,
        draft: d.draft,
        markdown: d.markdown,
      });

      fs.writeFileSync(path.join(target, name), md, 'utf8');
      // 草稿 ↔ 正式 之间切换时，删掉旧位置那份，别留重复
      if (old && old.path !== path.join(target, name)) {
        try { fs.unlinkSync(old.path); } catch (e) {}
      }
      sendJson(res, 200, {
        ok: true,
        file: (d.draft ? '_drafts/' : '') + name,
        draft: !!d.draft,
        size: md.length,
      });
      return true;
    }

    sendJson(res, 404, { ok: false, error: '没有这个地址' });
    return true;
  } catch (e) {
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
    else {
      try { res.end(); } catch (e2) {}
    }
    return true;
  }
}

module.exports = { handle, renderPage };
