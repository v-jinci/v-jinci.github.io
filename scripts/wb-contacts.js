/**
 * 关于页的联系方式卡片
 *
 * 数据在 source/_data/site.yml 的 contacts（由本机 /site 后台的「联系方式」维护）。
 * 用法：在页面里写 <!--WB_CONTACTS-->，构建时换成卡片列表。
 *
 * 交互：
 *   - 填了 href（http 或 mailto）→ 直接是个链接；
 *   - 没填 href → 点一下弹出小窗，显示账号/号码 + 二维码 + 备注，带「复制」。
 *
 * 样式尽量跟着主题的 CSS 变量走，深色模式下自动变。
 */
'use strict';

const PLACEHOLDER = '<!--WB_CONTACTS-->';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function build(list) {
  const cards = list
    .map((c) => {
      const label = String(c.label || '').trim();
      const icon = String(c.icon || 'fas fa-link').trim();
      const value = String(c.value || '').trim();
      const href = String(c.href || '').trim();
      const qr = String(c.qr || '').trim();
      const hint = String(c.hint || '').trim();
      const iconHtml = '<i class="' + esc(icon) + '"></i>';
      const sub = value || (qr ? '点开看二维码' : '点开查看');
      const body =
        iconHtml +
        '<span class="wb-c-text"><b>' + esc(label) + '</b><em>' + esc(sub) + '</em></span>';
      if (href) {
        const ext = /^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : '';
        return '<a class="wb-contact" href="' + esc(href) + '"' + ext + '>' + body + '</a>';
      }
      return (
        '<button type="button" class="wb-contact" data-label="' + esc(label) +
        '" data-value="' + esc(value) + '" data-qr="' + esc(qr) +
        '" data-hint="' + esc(hint) + '">' + body + '</button>'
      );
    })
    .join('');

  return (
    '<div class="wb-contacts">' + cards + '</div>' +
    '<div class="wb-cmodal" id="wb-cmodal" aria-hidden="true">' +
    '<div class="wb-cmodal-mask" data-close="1"></div>' +
    '<div class="wb-cmodal-box" role="dialog" aria-modal="true">' +
    '<div class="wb-cmodal-head"><i class="fas fa-link"></i><b></b>' +
    '<button type="button" class="wb-cmodal-x" data-close="1" aria-label="关闭">×</button></div>' +
    '<div class="wb-cmodal-val"><span></span><button type="button" class="wb-copy">复制</button></div>' +
    '<img class="wb-cmodal-qr" alt="二维码" loading="lazy">' +
    '<div class="wb-cmodal-hint"></div>' +
    '</div></div>'
  );
}

const CSS =
  '<style>' +
  '.wb-contacts{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin:18px 0 6px}' +
  '.wb-contact{display:flex;align-items:center;gap:12px;width:100%;text-align:left;cursor:pointer;' +
  'padding:13px 15px;border-radius:12px;border:1px solid rgba(128,128,128,.22);' +
  'background:var(--card-bg,#fff);color:var(--font-color,#1f2430);text-decoration:none;' +
  'transition:transform .25s ease,box-shadow .25s ease,border-color .25s ease;font:inherit}' +
  '.wb-contact:hover{transform:translateY(-2px);border-color:var(--theme-color,#4a6cf7);' +
  'box-shadow:0 8px 20px rgba(31,36,48,.10)}' +
  '.wb-contact i{font-size:22px;width:26px;text-align:center;color:var(--theme-color,#4a6cf7);flex:0 0 auto}' +
  '.wb-contact .wb-c-text{display:flex;flex-direction:column;line-height:1.35;min-width:0}' +
  '.wb-contact .wb-c-text b{font-size:14px;font-weight:600}' +
  '.wb-contact .wb-c-text em{font-style:normal;font-size:12.5px;opacity:.62;' +
  'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.wb-cmodal{position:fixed;inset:0;z-index:9999;display:none}' +
  '.wb-cmodal.on{display:block}' +
  '.wb-cmodal-mask{position:absolute;inset:0;background:rgba(6,12,24,.55);backdrop-filter:blur(2px)}' +
  '.wb-cmodal-box{position:relative;max-width:320px;margin:12vh auto 0;padding:20px 20px 18px;' +
  'background:var(--card-bg,#fff);color:var(--font-color,#1f2430);border-radius:16px;' +
  'box-shadow:0 24px 60px rgba(0,0,0,.28);text-align:center}' +
  '.wb-cmodal-head{display:flex;align-items:center;gap:8px;justify-content:center;font-size:15px;margin-bottom:12px}' +
  '.wb-cmodal-head i{color:var(--theme-color,#4a6cf7)}' +
  '.wb-cmodal-x{position:absolute;right:10px;top:8px;border:0;background:transparent;font-size:22px;' +
  'line-height:1;cursor:pointer;color:inherit;opacity:.5}' +
  '.wb-cmodal-x:hover{opacity:1}' +
  '.wb-cmodal-val{display:flex;align-items:center;gap:8px;justify-content:center;margin:6px 0 14px}' +
  '.wb-cmodal-val span{font-size:15px;word-break:break-all;font-weight:600}' +
  '.wb-copy{border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;font:inherit;' +
  'font-size:12px;padding:3px 9px;border-radius:7px;cursor:pointer;flex:0 0 auto}' +
  '.wb-copy:hover{border-color:var(--theme-color,#4a6cf7);color:var(--theme-color,#4a6cf7)}' +
  '.wb-cmodal-qr{display:none;width:200px;height:200px;object-fit:contain;margin:0 auto 10px;border-radius:10px;background:#fff}' +
  '.wb-cmodal-qr.on{display:block}' +
  '.wb-cmodal-hint{font-size:12.5px;opacity:.6;line-height:1.6}' +
  '</style>';

const JS =
  '<script>(function(){' +
  'var box=document.getElementById("wb-cmodal");if(!box)return;' +
  'var ic=box.querySelector(".wb-cmodal-head i"),ti=box.querySelector(".wb-cmodal-head b");' +
  'var va=box.querySelector(".wb-cmodal-val span"),qr=box.querySelector(".wb-cmodal-qr");' +
  'var hi=box.querySelector(".wb-cmodal-hint"),cp=box.querySelector(".wb-copy");' +
  'function close(){box.classList.remove("on");box.setAttribute("aria-hidden","true");}' +
  'box.addEventListener("click",function(e){if(e.target.getAttribute("data-close"))close();});' +
  'document.addEventListener("keydown",function(e){if(e.key==="Escape")close();});' +
  'document.querySelectorAll(".wb-contact[data-label]").forEach(function(btn){' +
  'btn.addEventListener("click",function(){' +
  'var d=btn.dataset;ti.textContent=d.label||"";va.textContent=d.value||"";' +
  'ic.className=(btn.querySelector("i")||{}).className||"fas fa-link";' +
  'if(d.qr){qr.src=d.qr;qr.classList.add("on");}else{qr.removeAttribute("src");qr.classList.remove("on");}' +
  'hi.textContent=d.hint||"";' +
  'va.parentNode.style.display=d.value?"flex":"none";' +
  'cp.style.display=d.value?"":"none";' +
  'box.classList.add("on");box.setAttribute("aria-hidden","false");' +
  '});});' +
  'cp.addEventListener("click",function(){var t=va.textContent||"";' +
  'if(navigator.clipboard){navigator.clipboard.writeText(t).then(function(){cp.textContent="已复制";setTimeout(function(){cp.textContent="复制";},1200);});}' +
  'else{var ta=document.createElement("textarea");ta.value=t;document.body.appendChild(ta);ta.select();' +
  'try{document.execCommand("copy");cp.textContent="已复制";setTimeout(function(){cp.textContent="复制";},1200);}catch(e){}ta.remove();}});' +
  '})();</script>';

hexo.extend.filter.register('after_render:html', (str) => {
  if (str.indexOf(PLACEHOLDER) === -1) return str;

  const data = (hexo.locals.get('data') || {}).site || {};
  const list = (Array.isArray(data.contacts) ? data.contacts : []).filter((c) => {
    if (!c || c.hidden) return false;
    const label = String(c.label || '').trim();
    if (!label) return false;
    return String(c.value || '').trim() || String(c.href || '').trim() || String(c.qr || '').trim();
  });

  let html;
  if (!list.length) {
    html = '<p class="wb-contacts-empty">还没有设置联系方式，去 <code>/site</code> 后台的「联系方式」里加。</p>';
  } else {
    html = build(list);
  }

  let out = str.replace(PLACEHOLDER, function () { return html; });
  if (out.indexOf('</head>') !== -1) out = out.replace('</head>', function () { return CSS + '</head>'; });
  if (out.indexOf('</body>') !== -1) out = out.replace('</body>', function () { return JS + '</body>'; });
  return out;
});
