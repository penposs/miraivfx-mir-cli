# 画布节点同步记录

核对日期：2026-09-16。基准为本地画布项目源码，不代表已经发布到生产。

- 画布 Git SHA：`1ce8393bbd26378332406d0613a43e31b1e1d3b6`
- CLI 修改前 Git SHA：`c3c14c63f77b0e94a1ef158df9e1990b087d68d6`
- 当前节点目录：[node-catalog.ts](../src/canvas/node-catalog.ts)
- 参数及命令：[COMMANDS.md](COMMANDS.md)

## 当前 AI 面板

截图中的六个节点原本已有对应类型；本次同步入口、名称、参数处理与文档。

| 画布名称 | 节点类型 | CLI 创建命令 | 本次处理 |
| --- | --- | --- | --- |
| 提示词agent | `agent` | `canvas node add-agent` | 修正名称，保留角色指令、模板和 LLM 参数 |
| Suno 音乐 | `suno` | `canvas node add-suno` | 支持 V4.5+、V5、V5.5 显示版本，局部更新不重置版本、模型和纯音乐开关 |
| Seedance 提示词助手 | `seedance` | `canvas node add-seedance` | 修正名称与说明，明确这是文本提示词助手 |
| 特惠视频生成 seedance minimax | `seedance2` | `canvas node add-seedance2` | 统一承载 Seedance、Megaby、RunningHub H3/MiniMax 模型，校验显式模型及主要参数 |
| 全景图生成 | `panorama-gen` | `canvas node add-panorama-gen` | 校验 2k/4k 画质，补齐前置 LLM 参数开关与模板映射 |
| 深度视频 | `depth-map` | `canvas node add-depth-map` | 同步侧栏默认设置，JSON 输入同样执行参数验证 |

完整可创建目录保留 21 类节点，包含素材、文本、画板、专业相机、虚拟实拍、集线器、抽帧、超分、尺寸调整、切分和全景预览。侧栏没有展示全部工具节点，不能仅凭截图删除它们。

## 下架入口

移除 13 个旧类型的创建、更新和克隆支持，同时删除旧专用默认值、参数映射及示例。错误信息提供替代节点，但不会静默转换旧参数。历史画布仍可查看和删除，未改写用户已有画布。

| 旧类型 | 核对依据 | 新入口 |
| --- | --- | --- |
| `video` | 当前侧栏及右键菜单的视频创建均使用 `seedance2` | `seedance2` |
| `megaby-video` | 已并入统一视频组件，仅保留历史节点适配 | `seedance2`，选择可用 Megaby 模型 |
| `llm` | 当前侧栏及右键菜单的文本生成创建使用 `agent` | `agent` |
| `seedance-volc` | `SHOW_SEEDANCE_VOLC_ENTRY = false` | `seedance2`，重新选择当前可用模型 |
| `seedance2-rh-standard` | `SHOW_SEEDANCE_RUNNINGHUB_ENTRY = false` | `seedance2`，重新选择当前可用模型 |
| `runninghub` | `SHOW_LEGACY_RUNNINGHUB_ENTRY = false` | 当前视频用途使用 `seedance2` |
| `vibex-webapp` | 当前侧栏已无此创建入口 | `seedance2` |
| `seedance2-runninghub`、`sora2-runninghub`、`rh-config`、`rh-param`、`rh-main` | 旧 RunningHub 类型，当前侧栏及右键菜单没有独立创建入口 | 当前视频用途使用 `seedance2` |
| `blocking-3d` | 已不在前端 `NodeType` 与后端允许类型中 | `v-camera` |

旧 RunningHub 任意工作流并不等价于统一视频节点；替代建议只覆盖当前视频用途，不进行自动迁移。后端为读取历史画布保留的类型，不再视为 CLI 当前可创建节点。

## 核对源码

以下路径均相对于画布仓库：

- `frontend/src/pages/canvas/components/Sidebar.tsx`：当前入口、关闭开关和 Suno/深度默认值。
- `frontend/src/pages/canvas/components/MirCanvas.tsx`：右键菜单、工具动作及执行字段。
- `frontend/src/pages/canvas/components/CanvasNode.tsx`：Suno 版本和表单。
- `frontend/src/pages/canvas/components/SeedanceVideoNode.tsx`：统一模型入口、历史适配、模型参数支持。
- `frontend/src/pages/canvas/services/seedanceVideoModel.ts`：模型分类和各通道不支持的字段。
- `frontend/src/pages/canvas/services/browserDepthModel.ts`：深度设置范围及默认值。
- `frontend/src/pages/canvas/types/mirCanvasTypes.ts`：当前序列化类型。
- `backend/app/api/canvas.py`：历史允许列表和公开模型元数据。

## 验证与使用

验证：TypeScript 构建通过；节点测试 11 项、原有虚拟实拍测试 78 项，共 89 项通过。检查命令：

```powershell
npm run build
node --test tests/canvas-nodes.test.mjs
node --test tests/v-camera.test.mjs tests/v-camera-previs.test.mjs
node dist/cli.js canvas node types --json
git diff --check
```

在此仓库目录使用 `node dist/cli.js` 可运行本次构建。`canvas node types --json` 离线显示当前目录；在线 `canvas capabilities --json` 返回 CLI 与后端支持类型的交集，并将后端原始列表保留在 `server_safe_canvas_node_types`。

模型相关默认值仍由网页当前模型目录决定。CLI 校验显式模型、通道限制以及主要字段的枚举和数值范围，并不替代服务端完整校验。生成、浏览器深度处理未在线运行。本次未部署画布服务、发布 npm 包或替换系统全局安装。
