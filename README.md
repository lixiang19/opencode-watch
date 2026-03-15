# Opencode Mobile Web Chat

一个手机优先的 OpenCode 网页客户端，当前架构是“本地后端负责门禁与本机能力，前端直接连接用户配置的 OpenCode”。

- 页面入口：`/`
- 管理 API：`/api/auth/*`、`/api/admin/*`
- OpenCode：浏览器直连你在设置页填写的 `URL / 账号 / 密码`

## 现在的架构

- `scripts/local-backend.js`
  - 托管生产构建后的前端静态文件
  - 提供管理登录与会话接口
  - 提供 Git 管理能力
  - 预留后续文件相关接口
- `bin/opchat.js`
  - 负责启动开发模式或生产模式
  - 负责拉起本地后端
  - 负责顺带拉起 `opencode serve`
- 浏览器前端
  - 先通过管理密码门禁
  - 再直接连接设置页里唯一的一套 OpenCode 配置
  - 文本聊天和 SSE 实时事件都不再经过本地后端转发

本地拓扑如下：

```text
开发模式
127.0.0.1:9000  -> Vite dev server
127.0.0.1:9001  -> local backend (/api/auth, /api/admin)
0.0.0.0:4096    -> opencode serve

生产模式
127.0.0.1:9001  -> local backend + built web + /api/auth + /api/admin
0.0.0.0:4096    -> opencode serve
```

## 功能边界

当前保留并支持：

- 项目列表
- 会话列表
- 文本对话
- SSE 实时订阅
- 命令发送与结果查看
- Worktree 的 Git 状态 / 提交 / 合并 / 删除
- PWA 安装与浏览器通知

当前明确不做：

- 文件上传能力（后续再做）
- 把 OpenCode 聊天流量并入你自己的业务后端处理逻辑
- 通过本地后端代理 OpenCode

## 依赖要求

- Node.js `>=18`
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
- `opencode serve` 会随脚本自动启动在 `0.0.0.0:4096`
- Vite 只代理 `/api/auth` 和 `/api/admin`
- 页面中的 OpenCode 连接由浏览器直接访问你填写的 OpenCode URL

### 生产模式

```bash
OPCHAT_ADMIN_PASSWORD='换成你的强密码' npm run web
```

效果：

- 先执行 `vue-tsc -b` + `vite build`
- 再由本地后端直接托管 `dist/`，并自动启动 `opencode serve`
- 页面入口是 `http://127.0.0.1:9001`

### 仅构建

```bash
npm run build
```

### 仅预览现有构建

```bash
OPCHAT_ADMIN_PASSWORD='换成你的强密码' npm run preview
```

注意：`preview` 不会重新构建，只会直接启动本地后端、`opencode serve` 并托管已有的 `dist/`。

## 管理密码与环境变量

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

其他环境变量：

- `OPCHAT_BACKEND_HOST`：本地后端监听地址，默认 `127.0.0.1`
- `OPCHAT_BACKEND_PORT`：本地后端端口，默认 `9001`
- `VITE_PORT`：开发模式下前端端口，默认 `9000`
- `OPENCODE_SERVER_PORT`：`opencode serve` 端口，默认 `4096`
- `OPENCODE_SERVER_ROOT`：启动 `opencode serve` 时的工作目录，默认 `$HOME`
- `OPCHAT_OPENCODE_CORS`：额外追加到 `opencode serve --cors` 的来源列表，多个值用英文逗号分隔

默认会固化以下启动参数：

```bash
opencode serve \
  --hostname 0.0.0.0 \
  --port 4096 \
  --cors http://localhost:5173
```

脚本还会自动补上当前项目实际使用的前端来源，例如 `http://127.0.0.1:9000`、`http://localhost:9000`、`http://127.0.0.1:9001`、`http://localhost:9001`。

如果 `4096` 上已经有一个可访问的 `opencode serve`，脚本会直接复用它，不会重复拉起；只有端口被别的进程占用时才会报错。

如果你还要放行外网前端域名，可以这样：

```bash
OPCHAT_OPENCODE_CORS='https://your-frontend.example.com' npm run web
```

## 首次使用流程

### 本机使用

1. 启动服务：`OPCHAT_ADMIN_PASSWORD='...' npm run dev` 或 `npm run web`
2. 打开页面：开发模式访问 `http://127.0.0.1:9000`，生产模式访问 `http://127.0.0.1:9001`
3. 先输入管理密码登录管理面
4. 首次进入时填写唯一的一套 OpenCode `URL / 账号 / 密码`
5. 页面直接连接这个 OpenCode，之后可以在设置页随时修改

### 手机远程使用

1. 本机先启动生产模式：

```bash
OPCHAT_ADMIN_PASSWORD='...' npm run web
```

2. 再把 `127.0.0.1:9001` 通过你自己的工具暴露出去，例如 ngrok
3. 手机访问这个外网地址
4. 先登录管理密码
5. 再填写或复用本地保存的 OpenCode 配置

注意：手机浏览器会直接请求你填写的 OpenCode 地址，所以目标 OpenCode 需要满足：

- 允许当前网页来源的 CORS
- 如果网页走 HTTPS，则 OpenCode 也必须走 HTTPS
- SSE 直连可用

## 当前认证模型

当前仍然是两层认证，但语义已经分离：

### 1）管理面认证

用于保护：

- `/api/admin/*`

特点：

- 由后端校验 `OPCHAT_ADMIN_PASSWORD`
- 登录成功后签发 `HttpOnly` session cookie
- 写操作额外带 CSRF token
- 未登录时，Git 和未来文件接口都不可访问

### 2）OpenCode Basic Auth

用于保护 OpenCode 自身。

如果你的 OpenCode 开启了 Basic Auth，前端会直接携带你在设置页填写的账号和密码去连接它。

也就是说：

- 管理密码是“进入这套站点控制面”的密码
- OpenCode 用户名/密码是“调用 OpenCode 服务”的密码

这两者不是一回事。
