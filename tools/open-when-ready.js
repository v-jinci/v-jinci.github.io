// 等本地服务真正开始监听后，自动用默认浏览器打开页面
// 用法：node scripts/open-when-ready.js <端口1> <端口2> -- <url1> <url2>
// 逻辑：先轮询端口（同时试 IPv4 与 IPv6），全部就绪后再逐个打开 URL
const net = require('net');
const { spawn } = require('child_process');

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const ports = (sep === -1 ? argv : argv.slice(0, sep)).map(Number).filter(Boolean);
const urls = sep === -1 ? [] : argv.slice(sep + 1);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 记录触发情况，方便排错（不打扰用户）
function logReady(line) {
  try {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', '.workbuddy');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'open-when-ready.log'), new Date().toISOString() + ' ' + line + '\n', 'utf8');
  } catch (e) {
    /* 日志失败不影响主流程 */
  }
}

function probe(host, port, timeout = 1200) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

async function portReady(port) {
  // 同时探测 IPv4 与 IPv6 回环
  const [v4, v6] = await Promise.all([probe('127.0.0.1', port), probe('::1', port)]);
  return v4 || v6;
}

function openUrl(url) {
  if (process.env.OPEN_WHEN_READY_DRY === '1') {
    console.log('[dry-run] 本应打开:', url);
    return true;
  }
  // Windows: start "" <url>；其它平台用 xdg-open / open
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch (e) {
    return false;
  }
}

(async () => {
  if (!ports.length) process.exit(0);
  // 最多等 5 分钟（首次编译 + 索引可能较慢）
  const deadline = Date.now() + 5 * 60 * 1000;
  const pending = new Set(ports);
  while (pending.size && Date.now() < deadline) {
    for (const p of [...pending]) {
      if (await portReady(p)) pending.delete(p);
    }
    if (pending.size) await sleep(1000);
  }
  if (pending.size) {
    logReady('等待超时，未就绪端口: ' + [...pending].join(','));
    process.exit(2); // 没等到，交给用户手动处理
  }
  logReady('端口就绪: ' + ports.join(',') + ' -> 打开 ' + urls.join(' , '));
  // 给服务一点热身时间（vite 首次预构建）
  await sleep(1500);
  for (const u of urls) {
    const ok = openUrl(u);
    logReady('打开' + (ok ? '成功: ' : '失败: ') + u);
    await sleep(600);
  }
})();
