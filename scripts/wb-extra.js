/* ==========================================================
 *  由 /site 后台「细节开关」控制：
 *    img_zoom       图片点击放大
 *    uptime_*       页脚「已运行 XXX 天」
 *    index_style    首页文章卡片：one 单列 / two 双列
 *    notfound_*     自定义 404 页面（生成 public/404.html）
 * ========================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

function conf() {
  return (hexo.theme.config && hexo.theme.config.wb_look) || {};
}

function on(v, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  if (v === true || v === 1) return true;
  const s = String(v).trim().toLowerCase();
  return !(s === 'false' || s === '0' || s === 'off' || s === 'no');
}

hexo.extend.filter.register('after_render:html', function (str) {
  const c = conf();
  let css = '';
  let js = '';

  /* -------- 1. 图片点击放大 -------- */
  if (on(c.img_zoom, true)) {
    css +=
      '#article-container img{cursor:zoom-in}' +
      '.wb-zoom{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;' +
      'padding:3vh 3vw;background:rgba(5,9,18,.9);cursor:zoom-out;animation:wbfade .18s ease}' +
      '.wb-zoom img{max-width:100%;max-height:94vh;border-radius:10px;box-shadow:0 18px 60px rgba(0,0,0,.55)}' +
      '.wb-zoom .wb-zoom-tip{position:absolute;left:0;right:0;bottom:14px;text-align:center;color:rgba(255,255,255,.6);font-size:12px}' +
      '@keyframes wbfade{from{opacity:0}to{opacity:1}}';

    js +=
      '(function(){var box=null;' +
      'function shut(){if(box){box.parentNode.removeChild(box);box=null;document.documentElement.style.overflow="";}}' +
      'function show(src){shut();box=document.createElement("div");box.className="wb-zoom";' +
      'var im=document.createElement("img");im.src=src;box.appendChild(im);' +
      'var tip=document.createElement("div");tip.className="wb-zoom-tip";tip.textContent="点击任意位置关闭";box.appendChild(tip);' +
      'document.body.appendChild(box);document.documentElement.style.overflow="hidden";' +
      'box.addEventListener("click",shut);}' +
      'document.addEventListener("keydown",function(e){if(e.key==="Escape"||e.keyCode===27)shut();});' +
      'document.addEventListener("click",function(e){var t=e.target;' +
      'if(!t||t.tagName!=="IMG")return;if(!t.closest||!t.closest("#article-container"))return;' +
      'if(t.className&&String(t.className).indexOf("nozoom")>-1)return;' +
      'var a=t.closest("a");if(a){var h=a.getAttribute("href")||"";if(h&&!/\\.(png|jpe?g|gif|webp|svg|bmp)(\\?|$)/i.test(h))return;}' +
      'e.preventDefault();show(t.getAttribute("data-src")||t.currentSrc||t.src);},true);})();';
  }

  /* -------- 2. 页脚「已运行 XXX 天」 -------- */
  if (on(c.uptime_enable, true)) {
    const rawSince = c.uptime_since;
    const since = rawSince instanceof Date
      ? rawSince.toISOString().slice(0, 10)
      : String(rawSince || '2021-01-01').trim();
    const text = String(c.uptime_text || '本站已运行 {days} 天');
    css +=
      '.wb-uptime{display:block;width:fit-content;margin:12px auto 0;padding:4px 15px;border-radius:999px;' +
      'font-size:13px;line-height:1.7;letter-spacing:.02em;color:rgba(255,255,255,.92);' +
      'background:rgba(255,255,255,.13);border:1px solid rgba(255,255,255,.2);' +
      'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}';
    js +=
      '(function(){var s=' + JSON.stringify(since) + ',t=' + JSON.stringify(text) + ';' +
      'var d=new Date(String(s).replace(/-/g,"/")+" 00:00:00");if(isNaN(d.getTime()))return;' +
      'var n=Math.floor((Date.now()-d.getTime())/86400000);if(n<1)n=1;' +
      'var el=document.createElement("div");el.className="wb-uptime";' +
      'el.textContent=t.replace(/\\{days\\}/g,n).replace(/\\{since\\}/g,s);' +
      'var h=document.querySelector("#footer-wrap")||document.querySelector("#footer");' +
      'if(h){h.insertBefore(el,h.firstChild);}' +
      'else{var f=document.querySelector(".footer-copyright");if(f&&f.parentNode)f.parentNode.insertBefore(el,f);}})();';
  }

  /* -------- 3. 首页排版用主题原生 index_layout（在 /site 后台切换），这里无需注入 -------- */

  if (css) str = str.replace(/<\/head>/i, function () { return '<style id="wb-extra-css">' + css + '</style></head>'; });
  if (js) str = str.replace(/<\/body>/i, function () { return '<script id="wb-extra-js">' + js + '</script></body>'; });
  return str;
});

/* -------- 4. 生成 404.html（GitHub Pages 会自动用它） -------- */
hexo.extend.filter.register('after_generate', function () {
  const c = conf();
  const site = hexo.config || {};
  if (!on(c.notfound_enable, true)) return;

  const code = String(c.notfound_title || '404');
  const sub = String(c.notfound_subtitle || '这一页走丢了');
  const text = String(c.notfound_text || '地址可能拼错、文章可能挪了位置，也可能它从来就没存在过。');
  const btn = String(c.notfound_btn || '回到首页');
  const name = String(site.title || '');
  const esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  const html = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="robots" content="noindex">',
    '<title>' + esc(code + ' · ' + name) + '</title>',
    '<style>',
    '*{box-sizing:border-box}html,body{margin:0;height:100%}',
    'body{display:flex;align-items:center;justify-content:center;padding:24px;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;',
    'background:#0b1020;color:#fff;overflow:hidden}',
    'body::before{content:"";position:fixed;inset:0;pointer-events:none;',
    'background:radial-gradient(60% 60% at 15% 10%,rgba(99,102,241,.55),transparent 60%),',
    'radial-gradient(55% 55% at 85% 20%,rgba(236,72,153,.42),transparent 62%),',
    'radial-gradient(70% 70% at 50% 110%,rgba(16,185,129,.4),transparent 60%)}',
    'body::after{content:"";position:fixed;inset:0;pointer-events:none;',
    'background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),',
    'linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:46px 46px;',
    'mask-image:radial-gradient(70% 70% at 50% 40%,#000 40%,transparent 100%);',
    '-webkit-mask-image:radial-gradient(70% 70% at 50% 40%,#000 40%,transparent 100%)}',
    '.wb404{position:relative;z-index:2;text-align:center;max-width:620px;',
    'padding:44px 34px;border-radius:22px;background:rgba(14,20,38,.55);',
    'border:1px solid rgba(255,255,255,.14);box-shadow:0 24px 70px rgba(0,0,0,.45);',
    'backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}',
    '.wb404 .code{font-size:clamp(64px,15vw,110px);font-weight:800;line-height:1;letter-spacing:.06em;',
    'background:linear-gradient(120deg,#a5b4fc,#f0abfc 45%,#6ee7b7);-webkit-background-clip:text;',
    'background-clip:text;color:transparent}',
    '.wb404 h1{margin:14px 0 0;font-size:clamp(20px,4vw,26px);font-weight:600}',
    '.wb404 p{margin:14px 0 0;color:rgba(255,255,255,.72);font-size:15px;line-height:1.9}',
    '.wb404 .btns{margin-top:26px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap}',
    '.wb404 a{display:inline-block;padding:11px 26px;border-radius:999px;font-size:15px;',
    'text-decoration:none;transition:transform .2s ease,background .2s ease}',
    '.wb404 a.main{background:linear-gradient(120deg,#6366f1,#a855f7);color:#fff;font-weight:600;',
    'box-shadow:0 10px 26px rgba(99,102,241,.4)}',
    '.wb404 a.ghost{color:rgba(255,255,255,.85);border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.06)}',
    '.wb404 a:hover{transform:translateY(-2px)}',
    '.wb404 .site{margin-top:22px;font-size:12px;letter-spacing:.14em;color:rgba(255,255,255,.4)}',
    '</style>',
    '</head>',
    '<body>',
    '<main class="wb404">',
    '<div class="code">' + esc(code) + '</div>',
    '<h1>' + esc(sub) + '</h1>',
    '<p>' + esc(text) + '</p>',
    '<div class="btns">',
    '<a class="main" href="/">' + esc(btn) + '</a>',
    '<a class="ghost" href="/messageBoard/">留言告诉我</a>',
    '</div>',
    '<div class="site">' + esc(name) + '</div>',
    '</main>',
    '</body>',
    '</html>',
  ].join('\n');

  const dir = hexo.public_dir || path.join(hexo.base_dir, 'public');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '404.html'), html, 'utf8');
  } catch (e) {
    hexo.log.warn('wb-extra: 404.html 写入失败 ' + e.message);
  }
});
