/**
 * admin-patch.js — Tina 后台构建后的自动加固与同步
 * （发布脚本和本地预览脚本共用）
 *
 * 做三件事：
 * 1. 给 public/admin/index.html 注入两段防护脚本：
 *    - 防崩溃补丁：翻译插件等改写 DOM 时不炸编辑器（React issue #11538）
 *    - 报错透镜：编辑器崩溃时屏幕下方显示完整堆栈，方便排错
 * 2. 删掉 Tina 构建生成的 .gitignore（它会让发布时漏传后台文件）
 * 3. 把 public/admin 同步到 source/admin（发布目录）
 */
const fs = require('fs');
const path = require('path');

const DOM_GUARD = `    <script>
      // 防崩溃补丁（React 官方 issue #11538）：翻译插件等改写 DOM 时静默降级，不炸编辑器
      ;(function () {
        if (typeof Node === "undefined" || !Node.prototype || window.__tinaDomGuard) return
        window.__tinaDomGuard = true
        var _removeChild = Node.prototype.removeChild
        Node.prototype.removeChild = function (child) {
          try { return _removeChild.apply(this, arguments) } catch (e) { if (e && e.name === "NotFoundError") return child; throw e }
        }
        var _insertBefore = Node.prototype.insertBefore
        Node.prototype.insertBefore = function (newNode, refNode) {
          try { return _insertBefore.apply(this, arguments) } catch (e) {
            if (e && e.name === "NotFoundError" && refNode && refNode.parentNode !== this) return this.appendChild(newNode)
            throw e
          }
        }
      })()
    </script>`;

const ERR_LENS = `    <script>
      // 报错透镜：编辑器崩溃时把完整错误堆栈显示在屏幕上，方便截图排错
      ;(function () {
        if (window.__tinaErrLens) return
        window.__tinaErrLens = true
        function fmt(x) {
          if (x instanceof Error) return (x.stack || (x.name + ': ' + x.message))
          if (typeof x === 'string') return x
          try { return JSON.stringify(x) } catch (e) { return String(x) }
        }
        function show(title, text) {
          try {
            var key = 'tina_err_lens'
            var rec = { t: new Date().toLocaleString(), title: title, text: String(text).slice(0, 4000) }
            localStorage.setItem(key, JSON.stringify(rec))
            if (document.getElementById('__tinaErrOverlay')) return
            var d = document.createElement('div')
            d.id = '__tinaErrOverlay'
            d.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:55vh;overflow:auto;z-index:2147483647;background:#1e1e2e;color:#f5f5dc;font:12px/1.5 Consolas,monospace;padding:12px;border-top:3px solid #ff5555;white-space:pre-wrap;word-break:break-all;'
            var b = document.createElement('button')
            b.textContent = '复制报错'
            b.style.cssText = 'position:absolute;top:6px;right:8px;background:#444;color:#fff;border:0;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px;'
            b.onclick = function () { try { navigator.clipboard.writeText(rec.title + '\\n' + rec.text); b.textContent = '已复制 ✓' } catch (e) {} }
            var x = document.createElement('button')
            x.textContent = '×'
            x.style.cssText = 'position:absolute;top:6px;right:80px;background:#666;color:#fff;border:0;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:12px;'
            x.onclick = function () { d.remove() }
            d.appendChild(b); d.appendChild(x)
            var pre = document.createElement('div')
            pre.textContent = '【' + title + '】' + rec.t + '\\n' + rec.text
            d.appendChild(pre)
            ;(document.body || document.documentElement).appendChild(d)
          } catch (e) {}
        }
        window.addEventListener('error', function (ev) {
          show('页面报错', fmt(ev.error || ev.message))
        })
        window.addEventListener('unhandledrejection', function (ev) {
          show('未处理的Promise报错', fmt(ev.reason))
        })
        var _ce = console.error
        console.error = function () {
          try { show('控制台报错', Array.prototype.map.call(arguments, fmt).join('\\n')) } catch (e) {}
          return _ce.apply(console, arguments)
        }
      })()
    </script>`;

function applyAdminPatches(baseDir) {
  const base = baseDir || process.cwd();
  const htmlPath = path.join(base, 'public', 'admin', 'index.html');
  if (!fs.existsSync(htmlPath)) {
    console.log('  [admin-patch] public/admin/index.html 不存在，跳过');
    return false;
  }
  let html = fs.readFileSync(htmlPath, 'utf8');
  let changed = false;
  // 只在缺失时注入（可重复执行）
  if (html.indexOf('window.__tinaDomGuard') < 0) {
    html = html.replace(/(<title>[^<]*<\/title>\s*)/, '$1\n' + DOM_GUARD + '\n');
    changed = true;
  }
  if (html.indexOf('window.__tinaErrLens') < 0) {
    html = html.replace(/(<title>[^<]*<\/title>\s*)/, '$1\n' + ERR_LENS + '\n');
    changed = true;
  }
  // 确认入口 js 是本地路径
  if (html.indexOf('src="/admin/assets/index-') < 0 && /src="index/.test(html)) {
    console.log('  [admin-patch] 警告：入口脚本路径不是 /admin/assets/...，请检查构建配置');
  }
  if (changed) fs.writeFileSync(htmlPath, html);

  // 删除 Tina 生成的 .gitignore（会让发布漏传文件）
  for (const p of ['public/admin/.gitignore', 'source/admin/.gitignore']) {
    const gp = path.join(base, p);
    if (fs.existsSync(gp)) {
      fs.rmSync(gp);
      console.log('  [admin-patch] 已删除 ' + p + '（Tina 生成，会导致发布漏传）');
    }
  }

  // 同步到发布目录 source/admin
  const srcDir = path.join(base, 'source', 'admin');
  const pubDir = path.join(base, 'public', 'admin');
  if (fs.existsSync(srcDir)) fs.rmSync(srcDir, { recursive: true, force: true });
  fs.cpSync(pubDir, srcDir, { recursive: true });
  const gi = path.join(srcDir, '.gitignore');
  if (fs.existsSync(gi)) fs.rmSync(gi);
  console.log('  [admin-patch] 已同步 public/admin -> source/admin（含防崩溃补丁和报错透镜）');
  return true;
}

module.exports = { applyAdminPatches, DOM_GUARD, ERR_LENS };
