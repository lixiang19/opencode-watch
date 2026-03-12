# Opencode Mobile Web Chat

一个手机优先的 opencode 对话网页，只保留：

- 项目列表
- 会话列表
- 纯文本对话
- 命令发送与结果查看

## 开发

```bash
npm install --cache .npm-cache
npm link
opchat
```

或直接：

```bash
npx . dev
```

如果后续发布到 npm，目标用法就是：

```bash
npx opchat
# 或
npm i -g opchat && opchat
```

发布前：

```bash
npm login
npm publish
```

保留原来的脚本方式也可以：

```bash
npm run dev:all
```

默认行为：

- 前端运行在 `http://127.0.0.1:5173`
- `opencode serve` 运行在 `http://127.0.0.1:4096`
- `opencode serve` 默认在 `$HOME` 启动，并自动加上浏览器访问所需的 CORS

`opchat` 命令说明：

- `opchat` / `opchat dev`：启动 `opencode serve` + 前端开发服务
- `opchat web`：只启动前端开发服务
- `opchat build`：执行构建
- `opchat preview`：预览构建产物
- `opchat doctor`：检查本机 `node`、`vite`、`vue-tsc`、`opencode` 和端口配置是否可用

当前 CLI 会直接调用本地安装的 `vite`、`vue-tsc` 和 `opencode`，不再依赖 `npm run ...` 转发。

已知限制：

- 它不是独立打包的单文件 CLI，而是安装整个仓库后再跑其中的脚本
- 运行 `opchat dev` 仍然要求本机可用 `opencode` 命令
- `opchat build` 会先执行 `vue-tsc -b`，再执行 `vite build`
- 当前 `package.json` 的许可证是 `UNLICENSED`，如果你打算公开分发，最好补正式 LICENSE 文件并改掉这个字段

可选环境变量：

- `OPENCODE_SERVER_ROOT`：`opencode serve` 的工作目录
- `OPENCODE_SERVER_PORT`：服务端端口
- `VITE_PORT`：前端端口

## 构建

```bash
npm run build
```

构建产物会包含 `manifest.webmanifest` 与 `service-worker.js`，可作为 PWA 安装。

## 使用说明

1. 打开页面后填写 server 地址；如果本机 `opencode serve` 开启了 Basic Auth，同时填写用户名和密码。
2. 左侧先选项目，再选已有会话；如果没有历史会话，可以手动输入项目绝对路径后新建会话。
3. 底部可切换“文本对话”和“命令”模式。
4. 聊天区只显示文本 part，故意不渲染 tool、diff、权限等复杂结构。
5. 在“设置”页可以开启系统通知，并在浏览器支持时把网页安装到桌面或主屏。
6. 当前通知只在页面仍处于后台运行时生效；如果页面被彻底关闭，不会收到推送。
