# 玮的博客 · 本地使用说明

站点用 **Hexo 7 + Butterfly 5** 搭建，写作靠一个网页后台，不用敲命令。

---

## 一、三个 bat，双击就完事

| 双击这个 | 作用 |
| --- | --- |
| `setup-github.bat` | **只需一次**：粘贴 GitHub 令牌，之后发布全自动 |
| `start-admin.bat` | 启动 **写作后台**，自动打开 `http://localhost:4000/admin` |
| `preview.bat` | 只看不改：本地预览网站效果 |
| `publish.bat` | 生成并发布到 GitHub Pages（线上生效） |

后台账号：`admin`
后台密码：`weiblog2026`

> 想改密码跟我说一声，我重新生成一段加密串写进 `_config.yml`。

---

## 二、写一篇日志（三步）

1. 双击 `start-admin.bat`，浏览器会打开后台。
2. 点 **Posts → 右上角 New Post**，填标题、写正文。左边写 Markdown，右边实时预览。
3. 写完点右上角 **Publish**，弹窗里的标题/路径保持默认就行 —— 它会自动生成并推送到线上。

不想走后台也行：把 `.md` 文件丢进 `source/_posts/`，一样会被识别。

### Markdown 最常用的几个

```markdown
## 二级标题
**加粗**  *斜体*  [链接](https://example.com)
- 无序列表
1. 有序列表

> 引用一段话

![图片说明](图片名.jpg)
```

---

## 三、图片怎么放

已经开了「文章资源文件夹」。新建文章时，Hexo 会同时建一个**同名文件夹**，
把图片拖进去，正文里写 `![说明](图片名.jpg)` 即可，不用管路径。

---

## 四、想改站点信息，只改这两个文件

| 文件 | 改什么 |
| --- | --- |
| `_config.yml` | 站点标题、副标题、作者、网址、每页文章数 |
| `_config.butterfly.yml` | 顶部导航、头像、个人简介、侧边栏卡片、深色模式、搜索 |

改完 `Ctrl+C` 关掉服务窗口，再双击 `start-admin.bat` 就能看到变化。

---

## 五、第一次发布要准备 GitHub 令牌

发布配置已经写好了：

```yaml
repo: https://github.com/v-jinci/v-jinci.github.io.git
branch: master
```

GitHub 早就不允许用登录密码推送了，需要一次性弄个令牌：

1. 打开 GitHub → 右上头像 → **Settings** → 左侧最下 **Developer settings**
   → **Personal access tokens** → **Tokens (classic)** → **Generate new token**
2. 勾选 `repo` 这一项，生成后**复制那串字符**（只显示一次）
3. 双击 `setup-github.bat`，粘贴一次令牌。它会当场向 GitHub 验证，通过才算成功。
4. 之后双击 `publish.bat` 就是全自动的，不会再问账号密码。

> 换电脑、令牌过期或被撤销时，重跑一次 `setup-github.bat` 覆盖即可。

---

## 六、目录结构（知道这几个就够）

```
_config.yml            站点主配置
_config.butterfly.yml  主题配置
run.js                 启动器（不用改，除非换端口）
source/_posts/         所有文章，一篇一个 md
source/about/          关于页
source/link/           友链页
source/messageBoard/   留言板
source/history/        编年史
scaffolds/post.md      新建文章时的模板（可自己改默认抬头）
public/                生成出来的网页（自动生成，别手动改）
```

---

## 七、遇到问题

- **提示 `'node' 不是内部或外部命令`**：本机没装 Node.js。`_run.bat` 会自动去找可用的 node.exe（
  系统安装的 → `C:\Program Files\nodejs` → WorkBuddy 自带的那份），正常情况下双击 bat 不会报错。
  如果仍然报“Node.js not found”，装一个 [Node.js LTS](https://nodejs.org) 即可。
- **提示 4000 端口被占用**：说明已经有一个预览/后台窗口开着。这不是故障，直接用浏览器打开
  http://localhost:4000 就能用；想重启就先关掉那个黑窗口（按 `Ctrl + C`）再双击。
  实在想换端口：改 `run.js` 里两处 `4000` 为 `4001`。
- **页面样式没更新**：`publish.bat` 会先清理再生成，正常不会出现；本地预览按 `Ctrl+F5` 强刷。
- **文章 404**：检查文件名和 front-matter 里的 `title`、`date` 是否正常。
- **发布失败**：`publish.bat` 现在会把 git 的原始报错原样打出来，并直接说明原因（令牌无效 / 网络代理 / 目录权限）。
  按它给的提示处理即可，不用猜。最常见两种：
  - 令牌被拒（`Authentication failed`）→ 重新生成令牌，跑 `setup-github.bat` 覆盖；
  - 连不上 GitHub（`CONNECT tunnel` / `Could not resolve host`）→ 关掉代理或加速器再试。
- **任何报错**：把黑窗口里 `—— git 原始输出 ——` 那几行发给我即可，前面的生成列表不用带。
