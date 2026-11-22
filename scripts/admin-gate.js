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
const O_START = '<!--WB_ORDER_START-->';
const O_END = '<!--WB_ORDER_END-->';

function replaceBlock(html, start, end, block, name) {
  const re = new RegExp(start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!re.test(html)) {
    console.warn('[admin-gate] index.html 里没找到 ' + name + ' 占位标记，跳过');
    return html;
  }
  return html.replace(re, block);
}

hexo.extend.filter.register('before_generate', function () {
  let pw = '';
  let order = [];
  try {
    const file = path.join(hexo.base_dir, 'source', '_data', 'site.yml');
    if (fs.existsSync(file)) {
      const sd = require('js-yaml').load(fs.readFileSync(file, 'utf8')) || {};
      pw = sd.admin_password || '';
      if (Array.isArray(sd.editor_components)) {
        order = sd.editor_components.map(function (x) { return String(x).trim(); }).filter(Boolean);
      }
    }
  } catch (e) {
    console.warn('[admin-gate] site.yml 读取失败，密码门关闭：', e.message);
  }
  const hash = hashOf(pw);

  const target = path.join(hexo.base_dir, 'source', 'admin', 'index.html');
  if (!fs.existsSync(target)) return;
  let html = fs.readFileSync(target, 'utf8');

  const block = START + '<script>window.__WB_ADMIN_HASH__=' + JSON.stringify(hash) + ';</script>' + END;
  html = replaceBlock(html, START, END, block, 'hash');

  // 正文「插入」菜单顺序：在 /admin 站点设置 → 基本信息 → 正文工具栏顺序 里拖动，
  // 保存到 site.yml，构建时内联进页面，所有设备打开后自动用新顺序。
  const oblock = O_START + '<script>window.__WB_EDITOR_ORDER__=' + JSON.stringify(order) + ';</script>' + O_END;
  html = replaceBlock(html, O_START, O_END, oblock, 'order');

  fs.writeFileSync(target, html);
  console.log('[admin-gate] /admin 密码门', hash ? '已启用（内联 hash）' : '未设置（直接放行）');
  console.log('[admin-gate] 正文工具栏顺序', order.length ? order.length + ' 项（已内联）' : '未设置（用默认顺序）');
});
