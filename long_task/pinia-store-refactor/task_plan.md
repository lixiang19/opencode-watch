# 任务计划：Pinia 全局状态重构

## 目标
将当前 opencode 全局状态彻底切换为 Pinia store，移除 `app-context` 兼容层，并在首页完成聊天选项预取。

## 当前阶段
阶段 5

## 阶段列表

### 阶段 1：需求与发现
- [x] 理解用户意图
- [x] 确定约束和需求
- [x] 在 findings.md 中记录发现
- **状态：** complete

### 阶段 2：规划与结构
- [x] 定义技术方案
- [x] 确定 Pinia 接入点与迁移范围
- [x] 记录决策及其依据
- **状态：** complete

### 阶段 3：实现
- [x] 接入 Pinia 并创建 store
- [x] 移除 `app-context` 包装层
- [x] 将组件改为直接使用 Pinia store
- [x] 保留首页预取逻辑
- **状态：** complete

### 阶段 4：测试与验证
- [x] 执行构建验证
- [x] 修复迁移产生的问题
- [x] 记录验证结果
- **状态：** complete

### 阶段 5：交付
- [ ] 审查输出文件
- [ ] 整理改动说明
- [ ] 交付给用户
- **状态：** in_progress

## 关键问题
1. 是否彻底移除 `useOpencodeState()` 兼容入口？
2. 组件层是继续保留 `.value` 风格还是切换为 Pinia 原生访问？

## 已做决策
| Decision | Rationale |
|----------|-----------|
| 使用 Pinia 作为全局状态容器 | 满足用户要求，避免伪全局注入 |
| 首页进入时预取聊天选项 | 避免下拉首次点击触发接口等待 |
| 组件直接使用 `useOpencodeStore()` | 去掉中间层，状态访问语义更统一 |

## 遇到的错误
| Error | Attempt | Resolution |
|-------|---------|------------|
| npm cache EACCES | 1 | 改用项目内 `npm_config_cache` 安装依赖 |

## 注意事项
- 继续推进时优先删除兼容层，而不是继续叠加包装
- 组件迁移后统一直接依赖 `useOpencodeStore()`
