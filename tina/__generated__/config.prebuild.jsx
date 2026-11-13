// tina/config.ts
import { defineConfig } from "tinacms";
var config_default = defineConfig({
  // ↓↓↓ 注册 TinaCloud 后把拿到的两个值填进引号里 ↓↓↓
  clientId: "14d79fd2-cdd2-45f0-84c3-36c8b89fcbde",
  token: "63283ae37561ea645896c59302453fe5612d02a7",
  branch: "hexo-src",
  // Tina 自带后台页面的发布位置：发布后打开 你的网址/admin 即可编辑
  build: {
    outputFolder: "admin",
    publicFolder: "public"
  },
  // 图片库：媒体文件提交到仓库的 source/img/，编辑器里显示为 /img/xxx.png
  // （publicFolder = 网站静态根目录；mediaRoot 是相对于它的子目录）
  media: {
    tina: {
      mediaRoot: "img",
      publicFolder: "source"
    }
  },
  // 云端后台顶栏显示「在新标签页预览网站」按钮
  // （说明：本版本的云端后台不支持分屏实时预览，分屏「边看边改」用本地 7-边看边改.bat）
  ui: {
    previewUrl: ({ branch }) => ({ url: "https://v-jinci.github.io/" })
  },
  schema: {
    collections: [
      {
        name: "posts",
        label: "\u6587\u7AE0",
        description: "\u535A\u5BA2\u6587\u7AE0\u96C6\u5408\uFF08\u6539\u52A8\u6B64\u63CF\u8FF0\u53EF\u89E6\u53D1 TinaCloud \u91CD\u65B0\u7D22\u5F15\uFF09",
        path: "source/_posts",
        format: "md",
        frontmatter_format: "yaml",
        fields: [
          { name: "title", label: "\u6807\u9898", type: "string", isTitle: true, required: true },
          {
            name: "date",
            label: "\u53D1\u5E03\u65E5\u671F",
            type: "datetime",
            dateFormat: "YYYY-MM-DD",
            timeFormat: "HH:mm:ss"
            // 注意：这里不能写 format: 'YYYY-MM-DD HH:mm:ss'！
            // 本版本的 Tina 后台会把字符串 format 当函数调用，导致点开任何文章
            // 都报 "u is not a function"。日期显示由 dateFormat/timeFormat 控制。
          },
          { name: "description", label: "\u6458\u8981\uFF08\u9996\u9875\u5361\u7247\u7684\u4E24\u884C\u7B80\u4ECB\uFF09", type: "string", required: false },
          { name: "tags", label: "\u6807\u7B7E", type: "string", list: true, required: false },
          { name: "categories", label: "\u5206\u7C7B", type: "string", list: true, required: false },
          { name: "cover", label: "\u5C01\u9762\u56FE\uFF08\u53EF\u4E0D\u586B\uFF09", type: "image", required: false },
          { name: "series", label: "\u7CFB\u5217 / \u4E13\u680F", type: "string", required: false },
          {
            name: "sticky",
            label: "\u7F6E\u9876",
            type: "string",
            required: false,
            ui: {
              component: "select",
              options: [
                { label: "\u4E0D\u7F6E\u9876\uFF08\u9ED8\u8BA4\uFF09", value: "0" },
                { label: "\u7F6E\u9876 1\uFF08\u6700\u4F18\u5148\uFF09", value: "1" },
                { label: "\u7F6E\u9876 2", value: "2" },
                { label: "\u7F6E\u9876 3", value: "3" }
              ]
            }
          },
          { name: "comments", label: "\u663E\u793A\u8BC4\u8BBA\u533A", type: "boolean", required: false },
          { name: "toc", label: "\u663E\u793A\u53F3\u4FA7\u76EE\u5F55", type: "boolean", required: false },
          { name: "password", label: "\u8BBF\u95EE\u5BC6\u7801\uFF08\u7559\u7A7A\uFF1D\u516C\u5F00\uFF09", type: "string", required: false },
          { name: "img_width", label: "\u6B63\u6587\u56FE\u7247\u5BBD\u5EA6\uFF08\u767E\u5206\u6BD4\u6570\u5B57\uFF09", type: "string", required: false },
          {
            name: "img_float",
            label: "\u6B63\u6587\u56FE\u7247\u6392\u7248",
            type: "string",
            required: false,
            ui: {
              component: "select",
              options: [
                { label: "\u81EA\u52A8\uFF08\u7A84\u56FE\u5DE6\u73AF\u7ED5\uFF09", value: "auto" },
                { label: "\u5DE6\u73AF\u7ED5 \u2014\u2014 \u56FE\u7247\u5728\u5DE6\uFF0C\u6587\u5B57\u5728\u53F3", value: "l" },
                { label: "\u53F3\u73AF\u7ED5 \u2014\u2014 \u56FE\u7247\u5728\u53F3\uFF0C\u6587\u5B57\u5728\u5DE6", value: "r" },
                { label: "\u5C45\u4E2D \u2014\u2014 \u56FE\u7247\u5355\u72EC\u4E00\u884C", value: "c" }
              ]
            }
          },
          { name: "permalink", label: "\u81EA\u5B9A\u4E49\u94FE\u63A5\uFF08\u4E00\u822C\u4E0D\u7528\u6539\uFF0C\u9501\u5B9A\u65E7\u6587\u7AE0\u7684\u7F51\u5740\uFF09", type: "string", required: false },
          { name: "reprint_name", label: "\u8F6C\u8F7D\u6765\u6E90\u540D\u79F0", type: "string", required: false },
          { name: "reprint_url", label: "\u8F6C\u8F7D\u539F\u6587\u94FE\u63A5", type: "string", required: false },
          // 老文章常见字段，保留防止被删
          { name: "top_img", label: "\u9876\u90E8\u5927\u56FE\uFF08\u8001\u5B57\u6BB5\uFF09", type: "string", required: false },
          { name: "updated", label: "\u66F4\u65B0\u65F6\u95F4\uFF08\u8001\u5B57\u6BB5\uFF09", type: "datetime", required: false },
          { name: "author", label: "\u4F5C\u8005\uFF08\u8001\u5B57\u6BB5\uFF09", type: "string", required: false },
          {
            name: "body",
            label: "\u6B63\u6587",
            type: "rich-text",
            isBody: true,
            ui: {
              description: "\u6392\u7248\u5C0F\u6284\uFF1A\u63D0\u793A\u6846\uFF1D\u5F15\u7528\u5757\u5F00\u5934\u5199\u300C\u63D0\u793A\uFF1A/\u6CE8\u610F\uFF1A/\u91CD\u70B9\uFF1A/\u8B66\u544A\uFF1A\u300D\uFF1B\u6298\u53E0\uFF1D\u300C\u6298\u53E0\uFF1A\u6807\u9898\u300D\uFF1B\u91D1\u53E5\uFF1D\u5F15\u7528\u5757\u53EA\u5199\u4E00\u53E5\u77ED\u8BDD\uFF1B\u56FE\u6CE8\uFF1D\u56FE\u7247\u4E0B\u4E00\u884C *\u8BF4\u660E*\uFF1B\u5E76\u6392\uFF1D\u8FDE\u7740\u63D2\u4E24\u5F20\u56FE\uFF1B\u6B65\u9AA4\uFF1D\u6709\u5E8F\u5217\u8868\u7B2C\u4E00\u53E5\u300C\u6B65\u9AA4\uFF1A\u300D\uFF1B\u6309\u94AE\uFF1D\u3010\u6309\u94AE\u3011+\u94FE\u63A5"
            }
          }
        ]
      }
    ]
  }
});
export {
  config_default as default
};
