# 发现与决策

## 需求

- 在当前任务目录内直接完成独立网页项目
- 项目目标是手机网页上的 opencode 对话界面
- 页面需要能看到项目列表
- 页面需要能看到对应项目的会话列表
- 页面需要进入会话并继续对话
- 页面需要可以直接下发 opencode 命令并看到结果
- 只显示文本内容，不显示 tool 数据流，优先保证移动端性能
- 其他复杂功能都不要：不做文件树、终端、MCP、diff、权限 UI、附件、多面板
- 需要保证最后整体可以通过一条命令启动
- 可以参考当前项目已有代码和集成方式，但不能复用、引入或直接拷贝实现
- 前端直接连接 `opencode serve`，不要 Node 中间层

## 研究发现

- 参考项目是 Electron + Vue 3 + TypeScript 应用，现有 chat 逻辑主要在 `src/renderer/src/composables/useChatStream.ts`。
- `src/main/services/OpencodeService.ts:506` 会在项目目录下启动 `opencode serve`，可作为新仓库编写启动脚本时的参考。
- `src/main/services/OpencodeService.ts:562` 说明前端最终拿到的是 `http://127.0.0.1:{port}` 这样的 base URL，新项目可以直接消费这个概念。
- `src/main/services/OpencodeIpcHandler.ts:43` 到 `src/main/services/OpencodeIpcHandler.ts:72` 说明当前仓库把“服务生命周期管理”和“聊天接口调用”分开了；新仓库则只保留后者，直接访问 HTTP API。
- `src/renderer/src/composables/useChatStream.ts:160`、`src/renderer/src/composables/useChatStream.ts:185`、`src/renderer/src/composables/useChatStream.ts:320` 已覆盖创建会话、读取会话消息、发送消息等核心流程。
- `src/renderer/src/composables/useChatStream.ts:248` 到 `src/renderer/src/composables/useChatStream.ts:294` 目前会同时处理 text、reasoning、tool、file 等 part，新项目只需参考 text 聚合逻辑，从零实现自己的消息转换。
- `src/renderer/src/composables/useChatStream.ts:502` 到 `src/renderer/src/composables/useChatStream.ts:653` 已验证 opencode 事件流里关键的是 `message.updated`、`message.part.updated`、`session.status`、`session.idle`。
- `src/renderer/src/pages/Chat/components/ChatSidebar.vue:233` 到 `src/renderer/src/pages/Chat/components/ChatSidebar.vue:323` 展示了“先拉会话列表再进入会话”的基本使用模式，可作为页面组织参考。
- 官方文档确认 `opencode serve` 暴露 REST + SSE，不支持 WebSocket；最关键接口是 `/session`、`/session/:id`、`/session/:id/message`、`/event`。
- 官方文档确认 `opencode serve --cors ...` 可做浏览器访问控制，因此一条命令启动脚本里必须把 CORS 一起处理掉。
- 进一步调研显示，浏览器端应自行按 `sessionID` 过滤 `/event` SSE 推送，服务端当前不会按会话筛选。
- 进一步调研显示，session 归属项目主要依靠 `directory` 字段，创建指定项目新会话时应显式携带 `directory`。
- 本机实际联调发现 `opencode serve` 很可能启用了 Basic Auth；只要在 SDK client 上带 `Authorization` 头，REST 和 SSE 都可正常工作。

## 技术决策

| 决策                                  | 依据                                                 |
| ------------------------------------- | ---------------------------------------------------- |
| 前端直接访问 `opencode serve`         | 用户要求继续精简架构，不增加 Node 中间层             |
| 新项目完全从零编写                    | 当前仓库只作为 API 使用示例和交互思路参考            |
| 项目列表按 session 的 `directory` 聚合 | 这是“接续本机已有对话”最直接且最稳定的实现路径       |
| 流式层只处理 text 增量和少量状态事件  | 这正好满足移动端性能目标，也和用户的功能边界完全一致 |
| UI 只做项目页、会话页、聊天页三层导航 | 结构最清晰，手机上成本最低                           |
| 命令发送复用会话 API                  | 用户强调“下达命令和查看结果”，应与文本对话并列支持   |
| 启动命令统一封装为一个 script         | 最终交付体验更简单                                   |
| 前端显式支持 Basic Auth              | 真实环境已经存在 401 鉴权，必须处理才能接续本机对话  |

## 遇到的问题

| 问题                                                                | 解决方案                                         |
| ------------------------------------------------------------------- | ------------------------------------------------ |
| 直连 `opencode serve` 后，CORS 和启动命令需要在新仓库里一次性处理好 | 用单命令脚本统一带上 `--cors` 和固定端口         |
| 当前项目 UI 过于复杂，不适合直接裁剪成移动端页面                    | 只参考会话与事件处理思路，不复用原有复杂页面结构 |
| 官方文档与社区信息对 `project.list()` 描述不稳定                    | 优先采用 `session.directory` 聚合项目，降低依赖   |

## 资源

- 官方文档：`https://opencode.ai/docs/server/`
- 现有启动示例：`src/main/services/OpencodeService.ts:506`
- 现有 HTTP 生命周期入口：`src/main/services/OpencodeIpcHandler.ts:43`
- 现有会话流逻辑参考：`src/renderer/src/composables/useChatStream.ts:160`
- 现有消息转换参考：`src/renderer/src/composables/useChatStream.ts:238`
- 现有事件订阅参考：`src/renderer/src/composables/useChatStream.ts:502`
- 现有页面组织参考：`src/renderer/src/pages/Chat/components/ChatSidebar.vue:233`

## 视觉/浏览器发现

- 适合本任务的视觉方向是“工业工具感极简”：浅底、深字、单一强调色、明确边框和密度控制。
- 手机界面不应出现桌面式多栏布局，建议统一为单列页面 + 底部输入框 + 顶部返回/切换入口。
- 为了性能与注意力集中，消息列表只渲染纯文本气泡，避免 tool 卡片、折叠面板和复杂 markdown 装饰。
- 视觉方向保持“工业工具感极简”，但交互优先于装饰，连接状态、当前项目和会话状态必须始终可见。

---

_每 2 次查看/浏览器/搜索操作后更新此文件_
_这可以防止丢失视觉信息_
