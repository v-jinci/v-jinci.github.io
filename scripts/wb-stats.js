/* ==========================================================
 *  把主题自带的第三方计数脚本，换成我们自托管的一份。
 *
 *  主题默认从 //busuanzi.ibruce.info/... 加载 busuanzi，
 *  这个域名在国内经常连不上，页面上的"访客数 / 总浏览量"
 *  就会一直转圈。这里把 <script> 的地址换成本站的
 *  /libs/stats/wb-stats.js（带超时、缓存、失败兜底）。
 * ========================================================== */
'use strict';

const LOCAL = '/libs/stats/wb-stats.js';

hexo.extend.filter.register('after_render:html', (str) => {
  if (typeof str !== 'string' || str.indexOf('busuanzi.ibruce.info') === -1) return str;
  return str.replace(
    /(src=["'])\/\/busuanzi\.ibruce\.info\/busuanzi\/[^"']*\.js(["'])/g,
    '$1' + LOCAL + '$2'
  );
});
