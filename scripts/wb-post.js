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

/* ------------------------- 1. 正文图片宽度 ------------------------- */

// 支持 ?w=60% / ?w=400px / #w=60%
function widthFromSrc(src) {
  const m = String(src || '').match(/[?#&]w=([0-9]{1,4}(?:\.[0-9]+)?)(%|px)?/i);
  if (!m) return '';
  const unit = (m[2] || '%').toLowerCase();
  const n = Number(m[1]);
  if (!n || n <= 0) return '';
  return n + unit;
}

function applyImgWidth(html, defaultWidth) {
  return String(html).replace(/<img\b[^>]*>/gi, (tag) => {
    const srcM = tag.match(/\bsrc=("([^"]*)"|'([^']*)')/i);
    const src = srcM ? srcM[2] || srcM[3] || '' : '';
    let w = widthFromSrc(src);
    if (!w && defaultWidth && defaultWidth < 100) w = defaultWidth + '%';
    if (!w) return tag;
    if (/style=/i.test(tag)) {
      return tag.replace(/style=("|')([^"']*)\1/i, (m0, q, v) => {
        if (/width\s*:/i.test(v)) return m0;
        return 'style=' + q + v.replace(/;?\s*$/, ';') + 'width:' + w + ';' + q;
      });
    }
    return tag.replace(/<img/i, '<img style="width:' + w + '"');
  });
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
  const defW = Number(cfg.post_img_width) || 100;

  data.content = applyImgWidth(data.content, defW);

  const pwd = data.password === 0 ? '0' : String(data.password || '').trim();
  if (pwd) {
    // 摘要位置只留一句话，卡片截断时看到的就是这句，不会漏出代码
    const tip = '<p class="wb-lock-tip">🔒 本文已加密，输入密码后查看正文。</p>';
    data.content = tip + splitLockAssets(lockBlock(encryptHtml(data.content, pwd)));
    data.excerpt = tip;
    data.description = data.description || '加密文章';
  }
  return data;
});

// 只有在含锁块的页面注入：样式进 <head>，脚本进 </body>（要在 DOM 之后执行才能找到锁块）
hexo.extend.filter.register('after_render:html', function (str) {
  if (typeof str !== 'string' || str.indexOf('class="wb-lock"') === -1) return str;
  const css = lockAssets.filter((s) => s.indexOf('<style') === 0).join('');
  const js = lockAssets.filter((s) => s.indexOf('<script') === 0).join('');
  let out = str;
  if (css && out.indexOf('</head>') !== -1) out = out.replace('</head>', css + '</head>');
  if (js) {
    if (out.indexOf('</body>') !== -1) out = out.replace('</body>', js + '</body>');
    else if (out.indexOf('</html>') !== -1) out = out.replace('</html>', js + '</html>');
  }
  return out;
});
