# 发现与决策

## 需求
- 全面修复项目中的高优先级和中优先级性能问题
- 重点保证手机上打开任意对话时能尽快看到内容
- 重点保证来回切换对话时足够流畅、尽量不重复加载
- 不优先处理日志噪音，优先处理真实性能瓶颈

## 研究发现
- `openSession()` 目前会等待 `session.get + session.messages + question.list + loadChatOptions` 全部完成后才写入消息，首屏阻塞明显
- 移动端没有像桌面端那样的会话状态缓存，切回已访问对话时会重新拉取
- SSE 事件会在高频 delta 下多次复制整份消息数组，并通过深监听同步整份预览缓存
- `ChatPane`、会话列表、桌面侧栏都存在消息变化即全量扫描的衍生计算
- `preloadHomeData()` 与 `refreshSessions()` 会为大量目录预热聊天选项，且每目录的 snapshot 会触发 5 个请求
- Worktree banner 挂载就会并发读取多个 Git 状态，本地 bridge 每次都会新起 git 子进程

## 技术决策
| 决策 | 依据 |
|----------|-----------|
| 将会话打开改为“消息优先、选项后置” | 首屏消息比模型/命令选项更影响体感性能 |
| 将单聊缓存从 `messages` 扩展为按 session 维护的轻量状态 | 这样移动端切换回旧会话可以即时复用 |
| 将预览缓存收缩为摘要结构 | 降低复制成本和内存占用，避免列表和主聊天共享整棵消息树 |
| 用版本号/尾部信号替代 deep watch 同步预览 | 降低高频 delta 下的响应式开销 |
| 将工作中状态与列表预览预计算为 map | 避免模板层重复调用导致的多次扫描 |
| 对 Git 状态读取做短时缓存与并发去重 | 降低多面板并发打开时的本地进程压力 |

## 已完成修复
- `openSession()` 支持先展示缓存或预览，再后台加载完整历史与选项，且移动端已有会话缓存复用
- `openDesktopSession()` 改为消息先到先渲染，聊天选项与 pending question 后置补齐
- SSE 更新不再对选中会话、桌面会话和缓存会话做无意义的整数组复制
- 取消了基于 `deep: true` 的整份消息预览同步，预览只保留尾部窗口
- `ChatPane` 合并消息衍生扫描，并将自动滚动限制为“用户仍贴底时”才触发
- 会话列表与桌面侧栏改为单次预计算 session UI 状态，消除模板重复求值
- `refreshSessions()` 可跳过不必要的 `project.list()`，聊天选项预热改为限量目录
- `git-bridge` 的 `/status` 请求加入短时缓存和并发去重，并在写操作后主动失效

## 遇到的问题
| 问题 | 解决方案 |
|-------|------------|
| 仓库无主后端代码，无法直接改服务端实现 | 通过优化前端调用方式与本地 bridge 行为降低后端压力 |

## 资源
- `src/composables/useOpencodeApp.ts`
- `src/composables/useOpencodeApp/sessionActions.ts`
- `src/composables/useOpencodeApp/messages.ts`
- `src/components/chat/ChatPane.vue`
- `src/pages/ConversationListView.vue`
- `src/components/layout/DesktopProjectSidebar.vue`
- `src/components/chat/WorktreeSessionBanner.vue`
- `scripts/git-bridge.js`

## 视觉/浏览器发现
- 本任务未使用浏览器或图片。

---
*每 2 次查看/浏览器/搜索操作后更新此文件*
*这可以防止丢失视觉信息*
