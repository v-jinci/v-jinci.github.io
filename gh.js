/**
 * GitHub API 通道。
 *
 * 为什么要它：国内直连 github.com:443 经常 502 / 超时（git clone、git push 全挂），
 * 但 api.github.com 通常是通的。所以这里用 Git Data API 读写仓库，
 * 完全不碰 github.com，能绕开大部分网络问题。
 *
 * 用法：
 *   const gh = createGh({ user, token, slug: 'v-jinci/v-jinci.github.io' });
 *   await gh.head('hexo-src')            // 取分支最新提交
 *   await gh.treeMap('hexo-src')         // 取 { 'source/a.md': 'blobSha', ... }
 *   await gh.readBlob(sha)               // 读文件内容(Buffer)
 *   await gh.apply({ branch, message, upserts, deletes })  // 一次性提交多个文件
 */
const crypto = require('crypto');

function blobSha(buf) {
  return crypto.createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex');
}

module.exports = function createGh(opt) {
  const slug = opt.slug;
  const token = opt.token;
  const base = 'https://api.github.com';

  async function api(p, init) {
    const cfg = {
      method: (init && init.method) || 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
        'User-Agent': 'hexo-site',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    };
    if (init && init.body) {
      cfg.body = JSON.stringify(init.body);
      cfg.headers['Content-Type'] = 'application/json';
    }
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(base + p, cfg);
        const txt = await r.text();
        if (r.ok) return txt ? JSON.parse(txt) : {};
        if (r.status === 401 || r.status === 403) {
          const e = new Error('GitHub 拒绝访问（' + r.status + '）：令牌可能过期或权限不足');
          e.status = r.status;
          throw e;
        }
        lastErr = new Error('GitHub API ' + r.status + ' ' + txt.slice(0, 120));
      } catch (e) {
        if (e.status === 401 || e.status === 403) throw e;
        lastErr = e;
      }
      await new Promise((s) => setTimeout(s, 800 * (i + 1)));
    }
    throw lastErr;
  }

  async function head(branch) {
    const r = await api('/repos/' + slug + '/git/ref/heads/' + encodeURIComponent(branch));
    return r.object.sha;
  }

  /** 分支最新提交的完整文件表：路径 -> { sha, size } */
  async function treeMap(branch) {
    const sha = await head(branch);
    const r = await api('/repos/' + slug + '/git/trees/' + sha + '?recursive=1');
    const map = {};
    for (const it of r.tree || []) {
      if (it.type === 'blob') map[it.path] = { sha: it.sha, size: it.size };
    }
    return { commit: sha, map: map };
  }

  async function readBlob(sha) {
    const r = await api('/repos/' + slug + '/git/blobs/' + sha);
    return Buffer.from(r.content || '', r.encoding === 'base64' ? 'base64' : 'utf8');
  }

  /**
   * 一次提交里增改+删除多个文件。
   * upserts: { 'path': Buffer }   deletes: ['path', ...]
   */
  async function apply(p) {
    const branch = p.branch;
    const parent = await head(branch);
    const commit = await api('/repos/' + slug + '/git/commits/' + parent);

    const entries = [];
    for (const path of Object.keys(p.upserts || {})) {
      const buf = p.upserts[path];
      const b = await api('/repos/' + slug + '/git/blobs', {
        method: 'POST',
        body: { content: buf.toString('base64'), encoding: 'base64' }
      });
      entries.push({ path: path, mode: '100644', type: 'blob', sha: b.sha });
    }
    for (const path of p.deletes || []) {
      entries.push({ path: path, mode: '100644', type: 'blob', sha: null });
    }
    if (!entries.length) return { sha: parent, changed: 0 };

    const tree = await api('/repos/' + slug + '/git/trees', {
      method: 'POST',
      body: { base_tree: commit.tree.sha, tree: entries }
    });
    const newCommit = await api('/repos/' + slug + '/git/commits', {
      method: 'POST',
      body: { message: p.message, tree: tree.sha, parents: [parent] }
    });
    await api('/repos/' + slug + '/git/refs/heads/' + encodeURIComponent(branch), {
      method: 'PATCH',
      body: { sha: newCommit.sha, force: false }
    });
    return { sha: newCommit.sha, changed: entries.length };
  }

  return { head, treeMap, readBlob, apply, blobSha };
};

module.exports.blobSha = blobSha;
