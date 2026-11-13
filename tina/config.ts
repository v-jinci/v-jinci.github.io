/**
 * Tina CMS 配置（第三套编辑器，像 Word 最多的那个）
 *
 * 怎么用（第一次要花 3 分钟）：
 *   1. 打开 https://app.tina.io → 用 GitHub 账号登录 → 创建 Organization（免费）
 *   2. 里面添加项目：选择仓库 v-jinci/v-jinci.github.io，分支选 hexo-src
 *   3. TinaCloud 会给你 clientId 和 token（Settings → API Keys）
 *   4. 把两个值填到下面 clientId / token 的引号里
 *   5. 以后编辑入口就是 https://app.tina.io —— 登录后在内容列表里写文章
 *
 * 注意：
 *   - 这套配置只影响 Tina 自己的后台，不影响现有构建流程（GitHub Actions 不用改）
 *   - 想要「打开网站页面直接点着改」那种体验，才需要改构建流程，先不用
 *   - 字段和 .pages.yml / source/cms/config.yml 保持一致，改一处记得同步另外两处
 */
import { defineConfig } from 'tinacms'

export default defineConfig({
  // ↓↓↓ 注册 TinaCloud 后把拿到的两个值填进引号里 ↓↓↓
  clientId: '14d79fd2-cdd2-45f0-84c3-36c8b89fcbde',
  token: '63283ae37561ea645896c59302453fe5612d02a7',

  branch: 'hexo-src',

  // Tina 自带后台页面的发布位置：发布后打开 你的网址/admin 即可编辑
  build: {
    outputFolder: 'admin',
    publicFolder: 'public',
  },

  // 图片库：媒体文件提交到仓库的 source/img/，编辑器里显示为 /img/xxx.png
  // （publicFolder = 网站静态根目录；mediaRoot 是相对于它的子目录）
  media: {
    tina: {
      mediaRoot: 'img',
      publicFolder: 'source',
    },
  },

  schema: {
    collections: [
    {
      name: 'posts',
      label: '文章',
      description: '博客文章集合（改动此描述可触发 TinaCloud 重新索引）',
      path: 'source/_posts',
      format: 'md',
      frontmatter_format: 'yaml',
      fields: [
        { name: 'title', label: '标题', type: 'string', isTitle: true, required: true },
        {
          name: 'date',
          label: '发布日期',
          type: 'datetime',
          dateFormat: 'YYYY-MM-DD',
          timeFormat: 'HH:mm:ss',
          // 注意：这里不能写 format: 'YYYY-MM-DD HH:mm:ss'！
          // 本版本的 Tina 后台会把字符串 format 当函数调用，导致点开任何文章
          // 都报 "u is not a function"。日期显示由 dateFormat/timeFormat 控制。
        },
        { name: 'description', label: '摘要（首页卡片的两行简介）', type: 'string', required: false },
        { name: 'tags', label: '标签', type: 'string', list: true, required: false },
        { name: 'categories', label: '分类', type: 'string', list: true, required: false },
        { name: 'cover', label: '封面图（可不填）', type: 'image', required: false },
        { name: 'series', label: '系列 / 专栏', type: 'string', required: false },
        {
          name: 'sticky',
          label: '置顶',
          type: 'string',
          required: false,
          ui: {
            component: 'select',
            options: [
              { label: '不置顶（默认）', value: '0' },
              { label: '置顶 1（最优先）', value: '1' },
              { label: '置顶 2', value: '2' },
              { label: '置顶 3', value: '3' },
            ],
          },
        },
        { name: 'comments', label: '显示评论区', type: 'boolean', required: false },
        { name: 'toc', label: '显示右侧目录', type: 'boolean', required: false },
        { name: 'password', label: '访问密码（留空＝公开）', type: 'string', required: false },
        { name: 'img_width', label: '正文图片宽度（百分比数字）', type: 'string', required: false },
        {
          name: 'img_float',
          label: '正文图片排版',
          type: 'string',
          required: false,
          ui: {
            component: 'select',
            options: [
              { label: '自动（窄图左环绕）', value: 'auto' },
              { label: '左环绕 —— 图片在左，文字在右', value: 'l' },
              { label: '右环绕 —— 图片在右，文字在左', value: 'r' },
              { label: '居中 —— 图片单独一行', value: 'c' },
            ],
          },
        },
        { name: 'permalink', label: '自定义链接（一般不用改，锁定旧文章的网址）', type: 'string', required: false },
        { name: 'reprint_name', label: '转载来源名称', type: 'string', required: false },
        { name: 'reprint_url', label: '转载原文链接', type: 'string', required: false },
        // 老文章常见字段，保留防止被删
        { name: 'top_img', label: '顶部大图（老字段）', type: 'string', required: false },
        { name: 'updated', label: '更新时间（老字段）', type: 'datetime', required: false },
        { name: 'author', label: '作者（老字段）', type: 'string', required: false },
        {
          name: 'body',
          label: '正文',
          type: 'rich-text',
          isBody: true,
          ui: {
            description:
              '排版小抄：提示框＝引用块开头写「提示：/注意：/重点：/警告：」；折叠＝「折叠：标题」；金句＝引用块只写一句短话；图注＝图片下一行 *说明*；并排＝连着插两张图；步骤＝有序列表第一句「步骤：」；按钮＝【按钮】+链接',
          },
        },
      ],
    },
    ],
  },
})
