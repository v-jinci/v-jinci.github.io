/**
 * 写作后台 /admin 的访问密码门
 *
 * 密码存在 source/_data/site.yml 的 admin_password（明文），
 * 构建时算成 SHA-256，直接内联写进 source/admin/index.html 的占位处，
 * Hexo 复制 source 时带着 hash 一起进 public，前端比对。
 * 留空 = 不要密码。
 *
 * ⚠️ 诚实说明：hexo-src 是公开仓库，明文密码所有人可见；
 *    这层只挡「随手点进来的人」，真正的权限保护是 Sveltia 的 GitHub Token。
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

const START = '<!--WB_HASH_START-->';
const END = '<!--WB_HASH_END-->';

hexo.extend.filter.register('before_generate', function () {
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

  const target = path.join(hexo.base_dir, 'source', 'admin', 'index.html');
  if (!fs.existsSync(target)) return;
  let html = fs.readFileSync(target, 'utf8');

  const block = START + '<script>window.__WB_ADMIN_HASH__=' + JSON.stringify(hash) + ';</script>' + END;
  const re = new RegExp(START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (re.test(html)) {
    html = html.replace(re, block);
  } else {
    console.warn('[admin-gate] index.html 里没找到 hash 占位标记，跳过');
    return;
  }
  fs.writeFileSync(target, html);
  console.log('[admin-gate] /admin 密码门', hash ? '已启用（内联 hash）' : '未设置（直接放行）');
});
