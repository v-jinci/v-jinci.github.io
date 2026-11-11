/**
 * 主页背景：多图轮播 / 视频背景
 *
 * 为什么不用主题自带的 default_top_img：
 *   它只能放一张，而且不支持视频。这里在 #page-header 里塞一层自己的
 *   <div class="wb-hero">，用 CSS 淡入淡出，和主题原生的样式互不干扰
 *   （原生那张图的 inline background-image 会被 .wb-hero-on 关掉）。
 *
 * 配置在 _config.butterfly.yml 的 wb_look.*，由本机 /site 后台写入：
 *   hero_images  : 图片列表，多于 1 张自动轮播
 *   hero_video   : 视频路径（mp4/webm），设了它就用视频，图片只当封面
 *   hero_interval: 切换间隔（秒）
 *   hero_scope   : home = 只首页，all = 全站
 *   hero_overlay : 遮罩深浅（0-60，百分比）
 */
'use strict';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

hexo.extend.filter.register('after_render:html', (str) => {
  const cfg = (hexo.theme.config && hexo.theme.config.wb_look) || {};
  const images = (Array.isArray(cfg.hero_images) ? cfg.hero_images : [])
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  const video = String(cfg.hero_video || '').trim();
  if (!images.length && !video) return str;

  const interval = Math.min(60, Math.max(2, Number(cfg.hero_interval) || 6));
  const overlay = Math.min(60, Math.max(0, Number(cfg.hero_overlay) || 0));
  const scope = String(cfg.hero_scope || 'home') === 'all' ? 'all' : 'home';

  const m = str.match(/<header[^>]*id="page-header"[^>]*>/);
  if (!m) return str;
  // 「仅首页」时，判断依据就是主题给首页头图加的 full_page 类
  if (scope === 'home' && m[0].indexOf('full_page') === -1) return str;

  const poster = images[0] ? ' poster="' + esc(images[0]) + '"' : '';
  let layers = '';
  // 先放图片层，再放视频层：视频在上面，图片在下面当兜底。
  // （原来视频在最底层，被第一张图完全盖住 —— 所以「只有一个、不切换、没视频」。）
  if (images.length) {
    layers += images
      .map((src, i) => '<div class="wb-slide' + (i === 0 ? ' on' : '') + '" style="background-image:url(' + esc(src) + ')"></div>')
      .join('');
  }
  if (video) {
    layers +=
      '<video class="wb-hero-video" autoplay muted loop playsinline preload="auto"' + poster + '>' +
      '<source src="' + esc(video) + '"></video>';
  }

  const hero = '<div class="wb-hero" aria-hidden="true">' + layers + '</div>';

  let tag = m[0];
  if (/class="/.test(tag)) tag = tag.replace(/class="([^"]*)"/, 'class="$1 wb-hero-on"');
  else tag = tag.replace('<header', '<header class="wb-hero-on"');

  str = str.replace(m[0], function () { return tag + hero; });

  const css =
    '<style>' +
    '#page-header.wb-hero-on{background-image:none!important;background-color:#0a0f1c}' +
    '#page-header .wb-hero{position:absolute;inset:0;overflow:hidden;z-index:0;pointer-events:none}' +
    '#page-header .wb-hero::after{content:"";position:absolute;inset:0;background:rgba(6,12,24,' + overlay / 100 + ')}' +
    '#page-header .wb-slide{position:absolute;inset:0;background-size:cover;background-position:center;' +
    'background-repeat:no-repeat;opacity:0;transition:opacity 1.4s ease;will-change:opacity}' +
    '#page-header .wb-slide.on{opacity:1}' +
    '#page-header .wb-hero-video{position:absolute;inset:0;z-index:1;width:100%;height:100%;object-fit:cover;' +
    'opacity:0;transition:opacity .8s ease;background:transparent}' +
    '#page-header .wb-hero-video.on{opacity:1}' +
    '#page-header>#site-info,#page-header>#post-info,#page-header>#page-site-info,#page-header>#scroll-down{z-index:2}' +
    '@media (prefers-reduced-motion:reduce){#page-header .wb-slide{transition:none}}' +
    '</style>';

  let js = '';
  if (images.length > 1 || video) {
    js =
      '<script>(function(){' +
      'var box=document.querySelector("#page-header .wb-hero");if(!box)return;' +
      // 视频：能播就淡入盖住图片；播不了（编码不支持 / 文件没传上去）就自动退回图片轮播。
      'var v=box.querySelector(".wb-hero-video");' +
      'if(v){' +
      'v.addEventListener("playing",function(){v.classList.add("on")});' +
      'v.addEventListener("error",function(){v.classList.remove("on");v.style.display="none"});' +
      'var ps=v.play&&v.play();if(ps&&ps.catch)ps.catch(function(){});' +
      '}' +
      'var s=box.querySelectorAll(".wb-slide");if(s.length<2)return;' +
      'if(window.matchMedia&&window.matchMedia("(prefers-reduced-motion:reduce)").matches)return;' +
      'var i=0,t=setInterval(function(){s[i].classList.remove("on");i=(i+1)%s.length;s[i].classList.add("on");},' +
      interval * 1000 + ');' +
      'document.addEventListener("visibilitychange",function(){' +
      'if(document.hidden){clearInterval(t);}else{clearInterval(t);t=setInterval(function(){' +
      's[i].classList.remove("on");i=(i+1)%s.length;s[i].classList.add("on");},' + interval * 1000 + ');}});' +
      '})();</script>';
  }

  if (str.indexOf('</head>') !== -1) str = str.replace('</head>', function () { return css + '</head>'; });
  if (js && str.indexOf('</body>') !== -1) str = str.replace('</body>', function () { return js + '</body>'; });
  return str;
});
