/**
 * 把「自定义背景图」写成 CSS 变量塞进 <head>。
 *
 * 为什么不用主题自带的 cover.default_cover：
 *   主题会把每篇文章的封面同时用作文章顶部大图，一设就会把顶部的
 *   V_bg 背景图顶掉。这里改用独立变量，只影响「上一篇 / 下一篇」卡片，
 *   顶部大图仍然听 default_top_img 的。
 *
 * 配置在 _config.butterfly.yml 的 wb_look.nav_bg，由 /site 后台写入。
 */
hexo.extend.filter.register('after_render:html', (str, data) => {
  const cfg = (hexo.theme.config && hexo.theme.config.wb_look) || {};
  const navBg = String(cfg.nav_bg || '').trim();
  if (!navBg) return str;

  const safe = navBg.replace(/'/g, "\\'");
  const style = "<style>:root{--wb-nav-bg:url('" + safe + "')}</style>";
  if (str.indexOf('</head>') === -1) return str;
  return str.replace('</head>', style + '</head>');
});
