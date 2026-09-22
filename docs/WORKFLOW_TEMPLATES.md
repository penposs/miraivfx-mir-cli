# 工作流基础范本

CLI 内置画布欢迎页的四个模块范例。先查看范本的节点和连线，再按用户需求调整，不再靠名称猜节点类型。

```powershell
mir-cli canvas templates list --json
mir-cli canvas templates list --task image --json
mir-cli canvas templates show character-three-view --json
mir-cli canvas templates show multi-reference-video --json
mir-cli canvas templates show story-script --json
mir-cli canvas templates show music-generation --json
```

这些命令完全离线，不需要登录。安装包包含 `examples/workflows/*.json`，从任意工作目录运行均可读取。`show` 返回完整 JSON，包括节点用途、连接方向、参数、参考来源和搭建命令参数数组。

## 四个模块怎么搭

| 需求 | 需要搭建的结构 | 生成后出现的结果 |
| --- | --- | --- |
| 文生图 / 角色三视图 | `image`；提示词直接填入生图节点 | `image → image-item` |
| 带参考图生图 | 复用或上传真实图片：`image-item → image` | 新的 `image-item` 结果 |
| 多图参考视频 | 多个 `image-item` 分别指向同一个 `seedance2` | `seedance2 → video-item` |
| 文生视频 | 精简为一个 `seedance2` | `video-item` 结果 |
| 故事、剧本 | 大纲 `agent → agent` 单集脚本；单步写作可只用一个 `agent` | 各自输出 `text` |
| 歌曲、配乐 | `suno`，直接填写歌词、曲名和风格 | `audio` 结果，数量以实际任务为准 |

`seedance` 是提示词助手，不能替代 `seedance2`。`text`、`audio`、`image-item`、`video-item` 是素材或结果，不执行对应的模型生成。历史 `video`、`llm`、旧供应商节点不能重新使用；`canvas node types --json` 提供当前节点和退役节点迁移提示。

四个范本体现常用结构，不要求每个项目都有五张参考图、两级 agent 或两个音乐结果。图生视频可以把实际生成成功的图片素材接到 `seedance2`。多镜头共享参考图时复用素材节点，只增加到各镜头生成节点的连线。

## 从 JSON 到真实画布

1. `templates show` 查看匹配范本；用 `canvas capabilities --json` 和 `canvas models --task image|video|audio|llm --json` 查询对应任务的实时能力。范本不固定模型 ID，不保证任意视频模型都支持多参、首尾帧、音频参考或特定分辨率。
2. 按需求调整 `nodes` 和 `connections`。`role: generation/reference` 是搭建对象；`role: generated-result` 只说明真实运行后的输出。`phase: setup` 是要创建的线；`phase: generated-result` 不在搭建阶段创建。
3. `setup_plan` 给出有序命令的 `argv` 数组，**不执行命令**。填写 `{{canvas_id}}`、提示词、当前模型及参数。先创建节点，把返回的 `node_id` 绑定到 `bind_node_id_as`；已有参考素材直接绑定现有 ID，跳过创建。
4. 创建节点的命令可追加 `--dry-run` 检查，执行已获授权的写入时追加 `--yes`。连线命令没有 dry-run，只能在目标明确时追加 `--yes`。`{{node.reference-1}}` 等必须替换成真实返回的 ID，不能直接提交占位符。
5. 参考图片使用用户已有素材或 `canvas upload --allow-upload` 返回的 URL。图片从左侧连入生成节点：`--from-node <reference_id> --to-node <generator_id>`。多个参考分别连接，不能串成图片链。节点创建命令的 `--connect-to` 方向是新节点到目标。
6. 按预定顺序连接多图参考，在网页输入区核对顺序与提示词引用编号。不要把旧 `assetOrder`、`receivedMedia` 或 `receivedImages` 当作参数复制。这些字段会包含旧节点和旧媒体标识。
7. 检查节点、参数和连线后打开画布，让用户在网页执行真实生成。故事两级 agent 按依赖顺序运行。CLI 搭建不意味着模型任务已经开始或已经成功。

Suno 歌词模式使用 `--mode custom --song-title ... --style ... --lyrics ...`；简单描述模式使用 `--mode description --description ...`；纯音乐使用 `--instrumental`，不强塞歌词便签。

## 来源与维护

四个源文件位于 `miraivfx-saas/frontend/public/canvas-templates/`，由 `frontend/src/pages/canvas/config/starterTemplates.ts` 引用：

- `story-script.json`
- `character-three-view.json`
- `multi-reference-video.json`
- `music-generation.json`

CLI 的同名 JSON 是结构范本，不是原始画布导出文件。每个文件的 `source` 记录来源路径、原文件 SHA-256 和转换说明。保留原范例的节点类型及连线拓扑，去掉历史用户媒体、任务、缓存输入、完成状态和旧模型选择；提示词改为用户可替换的输入。多图参考按源文件 `assetOrder` 对应的顺序重新命名节点。

更新时先核对网页节点与模型合同，再更新范本及 CLI 说明；不要把原始导出的用户素材和成功状态重新打包。运行 `npm test` 校验四个结构、创建参数、连线方向、输出排除和离线命令；使用 `npm pack --dry-run --json` 核对四个 JSON 随包分发。
