/**
 * 把「自定义背景图 / 副标题样式」写成 CSS 塞进 <head>。
 *
 * 为什么不用主题自带的 cover.default_cover：
 *   主题会把每篇文章的封面同时用作文章顶部大图，一设就会把顶部的
 *   V_bg 背景图顶掉。这里改用独立变量，只影响「上一篇 / 下一篇」卡片，
 *   顶部大图仍然听 default_top_img 的。
 *
 * 配置在 _config.butterfly.yml 的 wb_look，由 /site 后台写入：
 *   nav_bg       : 上下篇卡片背景
 *   sub_size     : 首页标语字号 px（0 = 跟随主题）
 *   sub_spacing  : 字间距 px
 *   sub_color    : 文字颜色（留空 = 跟随主题）
 *   sub_weight   : 字重（0 = 跟随主题）
 */
hexo.extend.filter.register('after_render:html', (str, data) => {
  const cfg = (hexo.theme.config && hexo.theme.config.wb_look) || {};
  const out = [];

  // 图片地址后面挂一个「文件修改时间」版本号。
  // 不带它的话，同名图片替换后浏览器 / CDN 还在用旧图，
  // 看起来就像「换了又自动恢复成原来的」。
  function cacheKey(p) {
    try {
      const fs = require('fs');
      const path = require('path');
      const abs = path.join(hexo.base_dir, 'source', String(p).replace(/^\/+/, ''));
      const st = fs.statSync(abs);
      return '?v=' + Math.floor(st.mtimeMs).toString(36);
    } catch (e) {
      return '';
    }
  }

  const navBg = String(cfg.nav_bg || '').trim();
  if (navBg) out.push(':root{--wb-nav-bg:url(\'' + navBg.replace(/'/g, "\\'") + cacheKey(navBg) + '\')}');

  // 页脚背景：主题是把 url 写在 #footer 的 inline style 上，
  // 这里用带版本号的地址覆盖掉，避免旧图缓存。
  const footerImg = String(hexo.theme.config.footer_img || '').trim();
  out.push(
    '#footer{background-image:' +
      (footerImg ? 'url("' + footerImg + cacheKey(footerImg) + '")' : 'none') +
      '!important;background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important}'
  );

  const size = Number(cfg.sub_size) || 0;
  const spacing = Number(cfg.sub_spacing) || 0;
  const weight = Number(cfg.sub_weight) || 0;
  const color = String(cfg.sub_color || '').trim();

  const subRules = [];
  if (size > 0) subRules.push('font-size:' + size + 'px');
  if (spacing !== 0) subRules.push('letter-spacing:' + spacing + 'px');
  if (weight > 0) subRules.push('font-weight:' + weight);
  if (color) subRules.push('color:' + color);
  if (subRules.length) {
    out.push('#page-header #site-subtitle #subtitle{' + subRules.join(';') + '}');
    if (color) out.push('#page-header #site-subtitle .typed-cursor{color:' + color + '}');
  }

  // 头像旋转：主题的 avatar.effect 要在 styl 编译期决定，改了经常不生效；
  // 这里改成运行时 CSS，开关即时可控（关掉就是彻底不动）。
  out.push(
    cfg.avatar_spin === false
      ? '.avatar-img{animation:none!important}'
      : '.avatar-img{animation:avatar_turn_around 2s linear infinite}'
  );

  // 图标：强制带上版本号，避免浏览器 / CDN 一直用旧 favicon
  const fav = String((hexo.theme.config && hexo.theme.config.favicon) || '').trim();
  let iconTags = '';
  if (fav) {
    const v = '?v=' + Date.now();
    iconTags =
      '<link rel="icon" href="' + fav + v + '">' +
      '<link rel="shortcut icon" href="' + fav + v + '">' +
      '<link rel="apple-touch-icon" href="' + fav + v + '">';
  }

  const style = '<style>' + out.join('') + '</style>';
  if (str.indexOf('</head>') === -1) return str;
  return str.replace('</head>', function () {
    return style + iconTags + '</head>';
  });
});
