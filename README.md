# Opencode Mobile Web Chat

一个手机优先的 opencode 网页客户端，当前架构是“单入口本地后端 + 同源 OpenCode 代理”。

- 页面入口：`/`
- 管理 API：`/api/auth/*`、`/api/admin/*`
- OpenCode 代理：`/oc/*`

这意味着你后面只需要把本地的 `127.0.0.1:9001` 暴露出去，就能让手机访问页面、管理接口和 OpenCode。

## 现在的架构

本项目不再使用旧的 GitBridge，改成了一个统一的本地后端：

- `scripts/local-backend.js`
  - 托管生产构建后的前端静态文件
  - 提供管理登录与会话接口
  - 提供 Git / 重启 OpenCode 等管理能力
  - 代理 `/oc/*` 到本地 `opencode serve`
- `bin/opchat.js`
  - 负责启动开发模式或生产模式
  - 负责拉起本地后端
- `opencode serve`
  - 仍然保持独立进程
  - 但对浏览器来说通过 `/oc` 同源访问

本地拓扑如下：

```text
开发模式
127.0.0.1:9000  -> Vite dev server
127.0.0.1:9001  -> local backend (/api/auth, /api/admin, /oc)
127.0.0.1:4096  -> opencode serve

生产模式
127.0.0.1:9001  -> local backend + built web + /api/auth + /api/admin + /oc
127.0.0.1:4096  -> opencode serve
```

## 功能边界

当前保留并支持：

- 项目列表
- 会话列表
- 文本对话
- 命令发送与结果查看
- Worktree 的 Git 状态 / 提交 / 合并 / 删除
- 从网页重启本地 OpenCode
- PWA 安装与浏览器通知

当前明确不做：

- 文件上传能力（后续再做）
- 把 OpenCode 聊天流量并入你自己的业务后端处理逻辑

## 依赖要求

- Node.js `>=18`
- 本机可执行 `opencode`
- 已安装项目依赖：`npm install`

可用自检：

```bash
node ./bin/opchat.js doctor
```

## 安装依赖

```bash
npm install --cache .npm-cache
```

如果你想本地调试 CLI，也可以：

```bash
npm link
opchat help
```

## 启动方式

### 开发模式

```bash
OPCHAT_ADMIN_PASSWORD='换成你的强密码' npm run dev
```

效果：

- 前端页面在 `http://127.0.0.1:9000`
- 管理 API 在 `http://127.0.0.1:9001/api/auth/*` 和 `http://127.0.0.1:9001/api/admin/*`
- 页面访问 OpenCode 时走同源 `/oc`
- Vite 会把 `/api/auth`、`/api/admin`、`/oc` 代理到 `127.0.0.1:9001`

### 生产模式

```bash
OPCHAT_ADMIN_PASSWORD='换成你的强密码' npm run web
```

效果：

- 先执行 `vue-tsc -b` + `vite build`
- 再由本地后端直接托管 `dist/`
- 页面入口是 `http://127.0.0.1:9001`

### 仅构建

```bash
npm run build
```

### 仅预览现有构建

```bash
OPCHAT_ADMIN_PASSWORD='换成你的强密码' npm run preview
```

注意：`preview` 不会重新构建，只会直接启动本地后端并托管已有的 `dist/`。

## 管理密码与环境变量

### 必须知道的事

管理面已经改成服务端鉴权，不再是前端自己拼一个口令就能调用接口。

后端读取两个管理员环境变量：

- `OPCHAT_ADMIN_USERNAME`：管理员用户名，默认 `admin`
- `OPCHAT_ADMIN_PASSWORD`：管理员密码，建议你显式设置

如果你没有设置 `OPCHAT_ADMIN_PASSWORD`，后端会在启动时自动生成一个临时密码，并打印在终端里：

```text
[local-backend] OPCHAT_ADMIN_PASSWORD 未设置，已生成临时管理密码：xxxx
```

这个临时密码：

- 每次启动都可能变化
- 适合本地临时调试
- 不适合长期远程访问

所以你真正要用手机远程访问时，强烈建议固定设置：

```bash
export OPCHAT_ADMIN_USERNAME='admin'
export OPCHAT_ADMIN_PASSWORD='一个足够长且随机的强密码'
npm run web
```

### 其他环境变量

- `OPENCODE_SERVER_ROOT`：`opencode serve` 的工作目录，默认 `$HOME`
- `OPENCODE_SERVER_PORT`：OpenCode 监听端口，默认 `4096`
- `OPCHAT_BACKEND_HOST`：本地后端监听地址，默认 `127.0.0.1`
- `OPCHAT_BACKEND_PORT`：本地后端端口，默认 `9001`
- `VITE_PORT`：开发模式下前端端口，默认 `9000`

## 首次使用流程

### 本机使用

1. 启动服务：`OPCHAT_ADMIN_PASSWORD='...' npm run dev` 或 `npm run web`
2. 打开页面：开发模式访问 `http://127.0.0.1:9000`，生产模式访问 `http://127.0.0.1:9001`
3. 先输入“管理密码”登录管理面
4. 如果你的 OpenCode 自身还开了 Basic Auth，再输入 OpenCode 的账号和密码
5. 进入会话列表、项目列表后正常使用聊天和 Git 能力

### 手机远程使用

1. 先本机启动生产模式：

```bash
OPCHAT_ADMIN_PASSWORD='...' npm run web
```

2. 再把 `127.0.0.1:9001` 通过你自己的工具暴露出去，例如 ngrok
3. 手机访问这个外网地址
4. 先登录管理密码
5. 如有需要，再填写 OpenCode 的 Basic Auth

因为页面、管理 API、OpenCode 代理都挂在同一个入口下，所以只暴露 `9001` 即可。

## 当前认证模型

当前是两层认证：

### 1）管理面认证

用于保护：

- `/api/admin/*`
- `/oc/*`

特点：

- 由后端校验 `OPCHAT_ADMIN_PASSWORD`
- 登录成功后签发 `HttpOnly` session cookie
- 写操作额外带 CSRF token
- 未登录时，Git / 重启 / OpenCode 代理都不可访问

### 2）OpenCode Basic Auth

用于保护 OpenCode 自身的上游服务。

如果你的 `opencode serve` 开启了 Basic Auth，前端仍然需要再填写 OpenCode 的用户名和密码。

也就是说：

- 管理密码是“进入这套控制面”的密码
- OpenCode 用户名/密码是“调用 OpenCode 服务”的密码

这两者不是一回事。

## 设置页里几种地址的含义

设置页现在默认把 OpenCode 地址设成：

```text
/oc
```

这表示：

- 浏览器不会直接访问裸露的 `127.0.0.1:4096`
- 而是通过当前页面同源的 `/oc` 去访问 OpenCode

如果你之前存过旧地址：

- `http://127.0.0.1:4096`
- `http://localhost:4096`

应用会自动迁移成 `/oc`。

## 命令说明

### `opchat dev`

- 启动 Vite 开发服务器
- 启动本地后端
- 本地后端自动拉起 `opencode serve`

### `opchat web`

- 执行类型检查和生产构建
- 启动本地后端
- 由本地后端直接托管前端静态文件

### `opchat preview`

- 不重新构建
- 直接启动本地后端并托管已有 `dist/`

### `opchat build`

- 执行 `vue-tsc -b`
- 执行 `vite build`

### `opchat doctor`

检查：

- Node 版本
- `vite` 与 `vue-tsc`
- `opencode` 命令是否存在
- 路径和端口配置是否有效

## 与旧 GitBridge 的区别

旧版本：

- 单独的 GitBridge 只管 Git
- OpenCode 还是直接裸端口访问

现在：

- GitBridge 已删除
- 统一由本地后端承接 Git、重启、会话鉴权
- OpenCode 通过 `/oc` 同源代理接入
- 对外只需要一个入口：`9001`

## 安全建议

这是运行在你个人电脑上的管理面，不是默认可裸露公网的公共服务。

最低建议：

- 必须设置 `OPCHAT_ADMIN_PASSWORD`
- 必须使用 HTTPS 外网入口
- 建议 ngrok 再加一层 Basic Auth 或 OAuth
- 不要把密码设得太短
- 不要把外网地址随便公开

当前后端已经做了这些基础保护：

- 服务端 session cookie
- 管理接口鉴权
- `/oc` 代理鉴权
- 基础 CSRF 防护
- 登录频率限制

但你仍然应该明白：

- 只要你把这套东西暴露到公网，本质上就是在给自己的电脑开放一个远程管理面
- 所以请务必控制访问范围

## PWA 与通知

构建产物仍然包含：

- `manifest.webmanifest`
- `service-worker.js`

可以安装到桌面或主屏。

通知能力说明：

- 需要浏览器支持 Notification API 与 Service Worker
- 只有页面仍然存活于后台时，完成通知才有效
- 如果页面被彻底关闭，不会收到推送

## 已知限制

- 当前还没有文件上传功能
- 当前 Git 接口还没有做仓库白名单
- 管理密码是单管理员模型，不支持多用户
- 项目当前许可证仍是 `UNLICENSED`

## 建议的下一步

如果你要继续往“个人远程控制台”方向走，我建议优先做这两个：

1. Git 仓库白名单
2. 上传接口的安全边界设计
