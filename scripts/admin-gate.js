/**
 * 写作后台 /admin 的访问密码门
 *
 * 密码存在 source/_data/site.yml 的 admin_password（明文），
 * 构建后由这里算成 SHA-256 注入 public/admin/index.html，前端比对。
 * 留空 = 不要密码，页面直接放行。
 *
 * ⚠️ 诚实说明：hexo-src 是公开仓库，明文密码所有人可见；
 *    这层只挡「随手点进来的人」，真正的权限保护是 Sveltia 的 GitHub Token。
 *    别把它当成真正的访问控制。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hashOf(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^[a-f0-9]{64}$/i.test(s)) return s.toLowerCase();
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

// source 下的静态 html 不走 after_render:html，所以直接在生成后改 public 文件
hexo.extend.filter.register('after_generate', function () {
  let pw = '';
  try {
    const file = path.join(hexo.base_dir, 'source', '_data', 'site.yml');
    if (fs.existsSync(file)) {
      const sd = require('js-yaml').load(fs.readFileSync(file, 'utf8')) || {};
      pw = sd.admin_password || '';
    }
  } catch (e) {
    console.warn('[admin-gate] site.yml 读取失败，密码门关闭：', e.message);
  }
  const hash = hashOf(pw);

  const target = path.join(hexo.public_dir, 'admin', 'index.html');
  if (!fs.existsSync(target)) return;
  let html = fs.readFileSync(target, 'utf8');

  // 幂等：先去掉旧的注入（如果有）
  html = html.replace(/<script id="wb-admin-hash">[\s\S]*?<\/script>/g, '');
  // 注入到 </head> 前；门脚本在 body 末尾读取 window.__WB_ADMIN_HASH__
  const inject = '<script id="wb-admin-hash">window.__WB_ADMIN_HASH__=' + JSON.stringify(hash) + ';</script>';
  if (html.indexOf('</head>') !== -1) {
    html = html.replace('</head>', inject + '</head>');
    fs.writeFileSync(target, html);
    console.log('[admin-gate] /admin 密码门', hash ? '已启用' : '未设置（直接放行）');
  }
});
