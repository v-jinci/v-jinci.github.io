/**
 * 文章页两个增强：
 *   1) 正文图片尺寸：默认宽度可按 /site 里设的比例显示；
 *      单张想单独调，就在图片地址后面加 ?w=60% 或 ?w=400px（Pages CMS 里直接改地址即可）。
 *   2) 加密文章：front-matter 里写 password: 你的密码，正文会在构建时用 AES-256-GCM 加密，
 *      网页上必须输入密码才解密显示（源码里也看不到明文）。
 */
'use strict';

const crypto = require('crypto');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------- 1. 正文图片宽度 / 排版 ------------------------- */

// 支持 ?w=60% / ?w=400px / #w=60%
function widthFromSrc(src) {
  const m = String(src || '').match(/[?#&]w=([0-9]{1,4}(?:\.[0-9]+)?)(%25|%|px)?/i);
  if (!m) return '';
  const unit = (m[2] || '%').toLowerCase() === 'px' ? 'px' : '%'; // %25 是编码后的 %，统一按百分比处理
  const n = Number(m[1]);
  if (!n || n <= 0) return '';
  return n + unit;
}

// 对齐方式：?f=l 左环绕（文字在右） / ?f=r 右环绕 / ?f=c 居中
function floatFromSrc(src) {
  const m = String(src || '').match(/[?#&]f=([a-z\u4e00-\u9fa5]+)/i);
  if (!m) return '';
  return normFloat(m[1]);
}

function normFloat(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return '';
  if (s === 'l' || s === 'left' || s === '左' || s === '左环绕') return 'l';
  if (s === 'r' || s === 'right' || s === '右' || s === '右环绕') return 'r';
  if (s === 'c' || s === 'center' || s === '中' || s === '居中') return 'c';
  if (s === 'n' || s === 'none' || s === 'block' || s === '整行') return 'c';
  return ''; // auto / 其它 → 交给默认规则
}

function pctOf(w) {
  const n = parseFloat(String(w || '').replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

function addStyle(tag, decl) {
  if (/style=("|')/i.test(tag)) {
    return tag.replace(/style=("|')([^"']*)\1/i, (m0, q, v) => 'style=' + q + v.replace(/;?\s*$/, ';') + decl + q);
  }
  return tag.replace(/<img/i, (m0) => m0 + ' style="' + decl + '"');
}

function addClass(tag, cls) {
  if (/class=("|')/i.test(tag)) {
    return tag.replace(/class=("|')([^"']*)\1/i, (m0, q, v) => 'class=' + q + (v + ' ' + cls).trim() + q);
  }
  return tag.replace(/<img/i, (m0) => m0 + ' class="' + cls + '"');
}

/**
 * 给正文图片加「宽度 + 排版」。
 *   defaultWidth : 整篇默认宽度（百分比数字）
 *   defaultFloat : 整篇默认排版 l / r / c / auto
 * 规则（优先级从高到低）：
 *   图片地址里的 ?w= / ?f=  >  front-matter 的 img_width / img_float  >  全站默认
 * 宽度小于 70% 且没指定排版时，自动「左环绕」——文字会绕到图片右侧，
 * 而不是缩成半宽、右边留一大片空白。
 */
function applyImgLayout(html, defaultWidth, defaultFloat) {
  const dW = pctOf(defaultWidth) || 100;
  const dF = normFloat(defaultFloat) || 'auto';
  return String(html).replace(/<img\b[^>]*>/gi, (tag) => {
    const srcM = tag.match(/\bsrc=("([^"]*)"|'([^']*)')/i);
    const src = srcM ? srcM[2] || srcM[3] || '' : '';

    let w = widthFromSrc(src);
    if (!w && dW > 0 && dW < 100) w = dW + '%';
    if (!w) return tag;

    let f = floatFromSrc(src) || dF;
    if (f === 'auto') f = pctOf(w) > 0 && pctOf(w) <= 70 ? 'l' : 'c'; // 小图环绕、大图居中

    const decls = [];
    decls.push('width:' + w);
    let cls = 'wb-fig';
    if (f === 'l') {
      cls += ' wb-fig-l';
      decls.push('float:left', 'margin:6px 18px 14px 0');
    } else if (f === 'r') {
      cls += ' wb-fig-r';
      decls.push('float:right', 'margin:6px 0 14px 18px');
    } else if (f === 'c') {
      cls += ' wb-fig-c';
      decls.push('display:block', 'margin:10px auto');
    }
    decls.push('max-width:100%', 'height:auto');

    let out = tag;
    if (!(/style=("|')([^"']*)\1/i.test(out) && /width\s*:/i.test(out.match(/style=("|')([^"']*)\1/i)[2]))) {
      out = addStyle(out, decls.join(';') + ';');
    }
    return addClass(out, cls);
  });
}

/* ------------- 1.5 正文写法约定（在 Pages CMS 里打几个字就出效果） -------------
 *
 *  提示框：用「引用块」，第一行写  提示：/ 注意：/ 重点：/ 警告：
 *  折叠块：引用块第一行写  折叠：标题
 *  金句  ：引用块里只写一句短话（60 字以内）
 *  图注  ：图片下一行写  *说明文字*
 *  并排  ：连着插 2~3 张图（中间不空行）
 *  步骤  ：有序列表第一项写  步骤：
 *  按钮  ：【按钮】后面跟一个链接
 *  表格  ：直接插表格，自动美化 + 手机上可横向滑
 * ---------------------------------------------------------------------- */

const WB_NOTE = [
  { re: /^(提示|小提示|小贴士|技巧|TIP)\s*[:：]?\s*/i, cls: 'wb-note-tip', name: '提示', icon: '💡' },
  { re: /^(注意|小心|NOTE)\s*[:：]?\s*/i, cls: 'wb-note-warn', name: '注意', icon: '⚠️' },
  { re: /^(重点|要点|划重点|KEY)\s*[:：]?\s*/i, cls: 'wb-note-key', name: '重点', icon: '📌' },
  { re: /^(警告|危险|重要|WARN)\s*[:：]?\s*/i, cls: 'wb-note-danger', name: '警告', icon: '🚫' },
];
const WB_FOLD = /^(折叠|收起|展开|点开看|FOLD)\s*[:：]?\s*/i;
const WB_STEP = /^(步骤|流程|做法|STEPS?)\s*[:：]\s*/i;

// 去掉标签后的纯文本
function plainText(html) {
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// 首段开头的关键字（允许关键字被加粗/斜体包着）
function stripKeywordPrefix(html, re) {
  const s = String(html);
  const lead = s.match(/^(\s*)((?:<(?:strong|b|em|i|span)\b[^>]*>)*)([\s\S]*)$/);
  if (!lead) return s;
  const m = lead[3].match(re);
  if (!m || !m[0]) return s;
  return lead[1] + lead[2] + lead[3].slice(m[0].length);
}

/* 图片改成「占满容器」：并排 / 图注里都用它，避免残留的浮动影响排版 */
function imgFull(tag) {
  const st = (tag.match(/style=("|')([^"']*)\1/i) || [])[2] || '';
  const keep = st
    .split(';')
    .filter((d) => /^\s*(max-width|border-radius|height|object-fit)\s*:/i.test(d))
    .join(';');
  const decl = 'width:100%;float:none;margin:0;display:block;' + (keep ? keep + ';' : '');
  let out = tag;
  // 去掉之前加的浮动类名，免得 CSS 里的 float 跟进来
  out = out.replace(/class=("|')([^"']*)\1/i, (m0, q, v) => {
    const cls = v.split(/\s+/).filter((c) => c && !/^wb-fig(-[lrc])?$/.test(c)).join(' ');
    return cls ? 'class=' + q + cls + q : '';
  });
  if (/style=("|')/i.test(out)) out = out.replace(/style=("|')([^"']*)\1/i, (m0, q) => 'style=' + q + decl + q);
  else out = out.replace(/<img/i, (m0) => m0 + ' style="' + decl + '"');
  return out.replace(/<img\s+/i, '<img ');
}

/* 图片 + 下一行 *说明*  →  带图注的 figure（浮动也跟着图走，文字照样能绕） */
function figBox(img, cap) {
  const st = (img.match(/style=("|')([^"']*)\1/i) || [])[2] || '';
  const w = ((st.match(/(?:^|;)\s*width\s*:\s*([^;]+)/i) || [])[1] || '').trim();
  const f = /float\s*:\s*left/i.test(st) ? 'l' : /float\s*:\s*right/i.test(st) ? 'r' : 'c';
  const boxStyle = w ? ' style="width:' + w + '"' : '';
  const text = String(cap).replace(/<[^>]*>/g, '').trim();
  return (
    '<figure class="wb-figbox wb-figbox--' + f + '"' + boxStyle + '>' +
    imgFull(img) +
    '<figcaption>' + text + '</figcaption></figure>'
  );
}

function addBtnClass(a) {
  if (/class=("|')/i.test(a)) {
    return a.replace(/class=("|')([^"']*)\1/i, (m0, q, v) => 'class=' + q + (v + ' wb-btn').trim() + q);
  }
  return a.replace(/<a\b/i, '<a class="wb-btn"');
}

function applyRichBlocks(html) {
  let out = String(html);

  /* ---- ① 引用块：提示框 / 折叠块 / 金句 ---- */
  out = out.replace(/<blockquote(\s[^>]*)?>([\s\S]*?)<\/blockquote>/gi, (m0, attr, inner) => {
    const pm = inner.match(/^(\s*)<p(\s[^>]*)?>([\s\S]*?)<\/p>/);
    const firstHtml = pm ? pm[3] : inner;
    const firstTxt = plainText(firstHtml);

    // 折叠块
    const fold = firstTxt.match(WB_FOLD);
    if (fold) {
      const body = pm ? inner.replace(pm[0], '') : '';
      const hasBody = plainText(body).length > 0;
      const title = (hasBody ? firstTxt.slice(fold[0].length).trim() : '') || '点开看更多';
      const content = hasBody ? body.trim() : pm ? '<p>' + firstTxt.slice(fold[0].length).trim() + '</p>' : '';
      return (
        '<details class="wb-fold"><summary>' + esc(title) + '</summary>' +
        '<div class="wb-fold-body">' + content + '</div></details>'
      );
    }

    // 提示框
    for (let i = 0; i < WB_NOTE.length; i++) {
      const k = WB_NOTE[i];
      if (!firstTxt.match(k.re)) continue;
      let body = inner;
      if (pm) {
        const restHtml = stripKeywordPrefix(pm[3], k.re);
        body = inner.replace(pm[0], plainText(restHtml) ? '<p>' + restHtml + '</p>' : '');
      }
      return (
        '<div class="wb-note ' + k.cls + '">' +
        '<div class="wb-note-h">' + k.icon + ' ' + k.name + '</div>' +
        '<div class="wb-note-b">' + body.trim() + '</div></div>'
      );
    }

    // 金句：只有一个短段落
    const one = inner.trim().match(/^<p(\s[^>]*)?>([\s\S]*?)<\/p>$/);
    if (one && !/<img/i.test(inner)) {
      const t = plainText(one[2]);
      if (t.length > 0 && t.length <= 60) return '<blockquote class="wb-quote">' + inner.trim() + '</blockquote>';
    }
    return m0;
  });

  /* ---- ② 步骤条：有序列表第一项写「步骤：」 ---- */
  out = out.replace(/<ol(\s[^>]*)?>([\s\S]*?)<\/ol>/gi, (m0, attr, inner) => {
    const li = inner.match(/^(\s*)<li(\s[^>]*)?>([\s\S]*?)<\/li>/);
    if (!li) return m0;
    if (!plainText(li[3]).match(WB_STEP)) return m0;
    const rest = stripKeywordPrefix(li[3], WB_STEP);
    const newInner = inner.replace(li[0], li[1] + '<li' + (li[2] || '') + '>' + rest + '</li>');
    return '<ol class="wb-steps">' + newInner + '</ol>';
  });

  /* ---- ③ 并排：一个段落里只有 2~3 张图 ---- */
  out = out.replace(/<p(\s[^>]*)?>([\s\S]*?)<\/p>/gi, (m0, attr, inner) => {
    const imgs = inner.match(/<img\b[^>]*>/gi);
    if (!imgs || imgs.length < 2 || imgs.length > 3) return m0;
    const left = inner
      .replace(/<img\b[^>]*>/gi, '')
      .replace(/<br\s*\/?>/gi, '')
      .replace(/&nbsp;/g, '')
      .replace(/\s+/g, '');
    if (left) return m0;
    return (
      '<div class="wb-cols wb-cols-' + imgs.length + '">' +
      imgs.map((t) => imgFull(t)).join('') +
      '</div>'
    );
  });

  /* ---- ④ 图注：图片紧跟着 *斜体说明*（同一段或下一段都认） ---- */
  out = out.replace(
    /<p(\s[^>]*)?>\s*(<img\b[^>]*>)\s*(?:<br\s*\/?>)?\s*<em>([\s\S]*?)<\/em>\s*<\/p>/gi,
    (m0, attr, img, cap) => figBox(img, cap)
  );
  out = out.replace(
    /<p(\s[^>]*)?>\s*(<img\b[^>]*>)\s*<\/p>\s*<p(\s[^>]*)?>\s*<em>([\s\S]*?)<\/em>\s*<\/p>/gi,
    (m0, a1, img, a2, cap) => figBox(img, cap)
  );

  /* ---- ⑤ 按钮：【按钮】+ 链接 ---- */
  out = out.replace(/<p(\s[^>]*)?>\s*【按钮】\s*(<a\b[\s\S]*?<\/a>)\s*<\/p>/gi, (m0, attr, a) => {
    return '<p class="wb-btn-row">' + addBtnClass(a) + '</p>';
  });

  /* ---- ⑥ 表格：外面套一层，手机上可以横向滑 ---- */
  if (out.indexOf('class="wb-table"') === -1) {
    out = out.replace(/<table\b/gi, '<div class="wb-table"><table').replace(/<\/table>/gi, '</table></div>');
  }

  return out;
}

/* --------------------------- 2. 文章加密 --------------------------- */

const ITER = 120000;

function encryptHtml(html, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(String(password), salt, ITER, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(html, 'utf8'), c.final()]);
  return Buffer.concat([salt, iv, ct, c.getAuthTag()]).toString('base64');
}

function lockBlock(payload) {
  const id = 'wblock-' + crypto.randomBytes(4).toString('hex');
  return (
    '<div class="wb-lock" id="' + id + '" data-p="' + esc(payload) + '" data-it="' + ITER + '">' +
    '<div class="wb-lock-box">' +
    '<div class="wb-lock-ico">🔒</div>' +
    '<div class="wb-lock-t">这篇是加密文章</div>' +
    '<div class="wb-lock-d">输入访问密码后查看正文</div>' +
    '<input class="wb-lock-in" type="password" autocomplete="off" placeholder="访问密码">' +
    '<button class="wb-lock-btn" type="button">解锁</button>' +
    '<div class="wb-lock-err"></div>' +
    '</div></div>' +
    '<style>' +
    '.wb-lock{display:flex;justify-content:center;padding:26px 0}' +
    '.wb-lock-box{width:100%;max-width:380px;text-align:center;padding:26px 22px;border-radius:16px;' +
    'background:var(--card-bg,#fff);box-shadow:0 8px 30px rgba(15,23,42,.10);border:1px solid rgba(148,163,184,.18)}' +
    '.wb-lock-ico{font-size:30px;line-height:1}' +
    '.wb-lock-t{margin-top:10px;font-size:17px;font-weight:600;color:var(--font-color,#1f2937)}' +
    '.wb-lock-d{margin-top:6px;font-size:13px;color:#94a3b8}' +
    '.wb-lock-in{width:100%;margin-top:16px;padding:10px 12px;border-radius:10px;' +
    'border:1px solid rgba(148,163,184,.45);background:transparent;color:inherit;outline:none}' +
    '.wb-lock-in:focus{border-color:#38bdf8;box-shadow:0 0 0 3px rgba(56,189,248,.15)}' +
    '.wb-lock-btn{margin-top:12px;width:100%;padding:10px 12px;border:0;border-radius:10px;cursor:pointer;' +
    'background:linear-gradient(120deg,#2563eb,#06b6d4);color:#fff;font-weight:600}' +
    '.wb-lock-btn:disabled{opacity:.6;cursor:default}' +
    '.wb-lock-err{margin-top:8px;font-size:12px;color:#ef4444;min-height:16px}' +
    '</style>' +
    '<script>(function(){' +
    'var box=document.getElementById("' + id + '");if(!box)return;' +
    'var inp=box.querySelector(".wb-lock-in"),btn=box.querySelector(".wb-lock-btn"),err=box.querySelector(".wb-lock-err");' +
    'function b64(s){var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u}' +
    'async function run(){' +
    'var pwd=inp.value;if(!pwd){err.textContent="请输入密码";return}' +
    'btn.disabled=true;err.textContent="";' +
    'try{' +
    'var raw=b64(box.dataset.p),it=Number(box.dataset.it)||120000;' +
    'var salt=raw.slice(0,16),iv=raw.slice(16,28),data=raw.slice(28);' +
    'var base=await crypto.subtle.importKey("raw",new TextEncoder().encode(pwd),"PBKDF2",false,["deriveKey"]);' +
    'var key=await crypto.subtle.deriveKey({name:"PBKDF2",salt:salt,iterations:it,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["decrypt"]);' +
    'var buf=await crypto.subtle.decrypt({name:"AES-GCM",iv:iv,tagLength:128},key,data);' +
    'var html=new TextDecoder().decode(buf);' +
    'var wrap=document.createElement("div");wrap.className="wb-lock-done";wrap.innerHTML=html;' +
    'box.parentNode.replaceChild(wrap,box);' +
    '}catch(e){err.textContent="密码不对，再试一次";btn.disabled=false;}' +
    '}' +
    'btn.addEventListener("click",run);' +
    'inp.addEventListener("keydown",function(e){if(e.key==="Enter")run()});' +
    'inp.focus();' +
    '})();</script>'
  );
}

/* ---------------------- 3. 系列 / 转载 / 目录开关 ---------------------- */

function seriesBlock(name, data) {
  let list = [];
  try {
    // 用数据库模型拿全部文章：locals.get('posts') 在渲染单篇时还不完整（只拿到一部分）
    const model = hexo.model ? hexo.model('Post') : null;
    const arr = model && typeof model.toArray === 'function' ? model.toArray() : [];
    list = arr
      .filter((p) => String(p.series == null ? '' : p.series).trim() === name)
      .sort((a, b) => Number(a.date) - Number(b.date));
  } catch (e) {
    list = [];
  }
  if (list.length < 2) return '';

  const root = hexo.config.root || '/';
  const base = root.slice(-1) === '/' ? root : root + '/';
  const items = list
    .map((p) => {
      const same = (p.path && data.path && p.path === data.path) || (p._id && data._id && p._id === data._id);
      const href = base + String(p.path || '').replace(/^\//, '');
      const title = esc(p.title || '无标题');
      const day = p.date && p.date.format ? p.date.format('YYYY-MM-DD') : '';
      return (
        '<li>' + (same ? '<strong>' + title + '</strong>（当前这篇）' : '<a href="' + href + '">' + title + '</a>') +
        (day ? ' <span class="wb-series-d">' + day + '</span>' : '') +
        '</li>'
      );
    })
    .join('');

  return (
    '<div class="wb-series"><div class="wb-series-t">📚 系列合集 · ' + esc(name) +
    '（共 ' + list.length + ' 篇）</div><ul>' + items + '</ul></div>'
  );
}

function reprintBlock(name, url) {
  const u = String(url || '').trim();
  const n = String(name || '').trim() || u;
  if (!u && !n) return '';
  const link = u
    ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(n) + '</a>'
    : esc(n);
  return '<div class="wb-reprint">📎 本文转载自 ' + link + '，版权归原作者所有' + (u ? '。' : '') + '</div>';
}

/* ------------------------------ 挂载 ------------------------------ */

/* 锁的样式和脚本从正文里抽出来，统一注入 <head>：
   否则首页/归档卡片把正文当纯文本截断时，会把 .wb-lock{...} 当成摘要显示 */
const lockAssets = [];

function splitLockAssets(html) {
  let rest = html;
  const css = rest.match(/<style>[\s\S]*?<\/style>/i);
  if (css) {
    rest = rest.replace(css[0], '');
    if (lockAssets.indexOf(css[0]) === -1) lockAssets.push(css[0]);
  }
  const js = rest.match(/<script>[\s\S]*?<\/script>/i);
  if (js) {
    rest = rest.replace(js[0], '');
    if (lockAssets.indexOf(js[0]) === -1) lockAssets.push(js[0]);
  }
  return rest;
}

hexo.extend.filter.register('after_post_render', function (data) {
  if (!data || typeof data.content !== 'string') return data;

  const cfg = (hexo.theme.config && hexo.theme.config.wb_look) || {};
  // 优先级：单张图片地址里的 ?w=  >  这篇文章 front-matter 的 img_width（Pages CMS 里选）  >  全站默认值
  const own = Number(String(data.img_width || '').replace(/[^\d.]/g, ''));
  const defW = own ? own : Number(cfg.post_img_width) || 100;
  // 排版：l 左环绕 / r 右环绕 / c 居中 / auto（宽度小就自动环绕）
  const defF = normFloat(data.img_float) || normFloat(cfg.post_img_float) || 'auto';

  data.content = applyImgLayout(data.content, defW, defF);

  // 正文写法约定：提示框 / 折叠 / 金句 / 图注 / 并排 / 步骤 / 按钮 / 表格
  data.content = applyRichBlocks(data.content);

  const pwd = data.password === 0 ? '0' : String(data.password || '').trim();
  if (pwd) {
    // 摘要位置只留一句话，卡片截断时看到的就是这句，不会漏出代码
    const tip = '<p class="wb-lock-tip">🔒 本文已加密，输入密码后查看正文。</p>';
    data.content = tip + splitLockAssets(lockBlock(encryptHtml(data.content, pwd)));
    data.excerpt = tip;
    data.postDesc = tip; // 主题首页卡片优先用这个，避免把锁块的说明文字重复贴出来
    data.description = data.description || '加密文章';
  }

  // ↓ 下面这些统一加在加密之后，加密文章也能看到（合集目录、来源、目录开关）
  // 系列：同系列的文章自动在文末串成一份目录
  const series = String(data.series == null ? '' : data.series).trim();
  if (series) {
    const block = seriesBlock(series, data);
    if (block) data.content += block;
  }

  // 转载来源
  if (data.reprint_url || data.reprint_name) {
    data.content += reprintBlock(data.reprint_name, data.reprint_url);
  }

  // 目录开关（toc: false）：留一个看不见的记号，由下面 after_render 注入隐藏样式
  if (data.toc === false) data.content += '<span class="wb-notoc" hidden></span>';

  return data;
});

// 只有需要的页面才注入：锁块的样式进 <head>、脚本进 </body>（要在 DOM 之后执行才能找到锁块）
// 另外处理 toc: false（隐藏右侧目录）——用正文里那个看不见的记号判断
hexo.extend.filter.register('after_render:html', function (str) {
  if (typeof str !== 'string') return str;
  let out = str;

  if (out.indexOf('wb-notoc') !== -1 && out.indexOf('</head>') !== -1) {
    out = out.replace('</head>', '<style>#card-toc{display:none!important}</style></head>');
  }

  if (out.indexOf('class="wb-lock"') === -1) return out;
  const css = lockAssets.filter((s) => s.indexOf('<style') === 0).join('');
  const js = lockAssets.filter((s) => s.indexOf('<script') === 0).join('');
  if (css && out.indexOf('</head>') !== -1) out = out.replace('</head>', css + '</head>');
  if (js) {
    if (out.indexOf('</body>') !== -1) out = out.replace('</body>', js + '</body>');
    else if (out.indexOf('</html>') !== -1) out = out.replace('</html>', js + '</html>');
  }
  return out;
});
