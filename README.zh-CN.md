<div align="center">

# dsh-freetap

**在 DSH（DeepSeek Harness）里原生使用 OpenCode Zen 的免费匿名模型。**

无需 API Key。无需注册。无需额外进程。

[![npm](https://img.shields.io/npm/v/dsh-freetap)](https://www.npmjs.com/package/dsh-freetap)
[![license](https://img.shields.io/npm/l/dsh-freetap)](https://github.com/ddldxiacan/dsh-freetap/blob/master/LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-blue)](https://github.com/ddldxiacan/dsh-freetap)

[English](README.md) | 简体中文

</div>

---

dsh-freetap 会向 DSH 注册一个原生的 `LlmAdapter`，直接流式对接
[OpenCode Zen](https://opencode.ai/zen) 的**匿名免费通道**——也就是
OpenCode 官方 CLI 无需登录即可使用的那批免费模型，它们会以 `dsh-freetap`
这个常规 provider 出现在你的 DSH 模型选择器里。

插件发出的请求与 OpenCode CLI 的流量完全同形（相同的 User-Agent、相同的
关联请求头），模型目录通过三级回退链保持新鲜。不用登录任何账号，也不用
自己部署任何东西。

## 特性

- **零凭据、零配置**——匿名通道不需要任何 Key；装好、重启、开聊
- **原生 adapter，无 sidecar**——一个 npm 包，没有子进程、没有二进制、没有本地端口（旧版 Go sidecar 不随包发行，见 `legacy/`）
- **CLI 同形伪装**——请求携带 OpenCode CLI 的 User-Agent 和整套会话/请求/项目关联头，按会话派生
- **思考等级可选**——带推理的免费模型在 DSH 模型选择器里出现思考等级选项（模型声明档位的按声明展示，其余提供 Off/Minimal/Low/Medium/High）；Off 向上游发送 `reasoning_effort: "none"` 真正停思考，不选则保持上游默认
- **按声明支持图片输入**——只要 [models.dev](https://models.dev) 的模型条目在 `modalities.input` 里列了 `image`，图片附件就会被放行；只声明 `text` 的模型仍然拒绝；元数据缺省时退回已验证的视觉家族
- **实时目录 + 三级回退**——上游实时列表 ∩ 元数据判定免费，断网时依次回退到磁盘缓存与已验证的静态名单
- **自愈能力**——启动期快速重试、周期刷新，并落盘健康快照便于排查
- **规范的错误呈现**——上游故障（限流、鉴权、超时、传输）以分类的 finish 原因送达 DSH，重试策略始终由 DSH 掌控

## 安装

从预构建的 Release 安装，无需构建步骤，也不需要工具链。

```sh
dsh plugin --profile web add https://github.com/ddldxiacan/dsh-freetap/releases/download/v0.5.1/dsh-freetap-0.5.1.tgz
```

就这一条，不用加任何参数，退出码 0。然后**重启 DSH**，在模型选择器的 **dsh-freetap** 分组里挑模型即可。

环境要求：DSH（DeepSeek Harness）0.1.7 及以上、带 web profile；Node.js ≥ 20（DSH 能跑就满足）；
出站 HTTPS 需可达 `opencode.ai` 与 `models.dev`。

整个安装只装 **7 个**小包，且**不执行任何依赖的构建脚本**，所以在全新机器上、pnpm 默认（严格）
策略下就能直接装成功。这是本包刻意保证的性质，原因见下一节。

### 为什么安装不需要任何参数

更早的版本在运行时依赖完整的 `@earendil-works/pi-ai` 供应商矩阵，其中两个传递依赖自带安装脚本，
pnpm 默认拦截，并把它升级成硬失败：

```
Error: ERR_PNPM_IGNORED_BUILDS
  × adding a new package
  ╰─▶ Ignored build scripts: @google/genai@1.52.0, protobufjs@7.6.6
```

更麻烦的是：pnpm 报错时**已经把依赖写进** profile 的 `package.json` 了，而 DSH 只在 pnpm
退出码为 0 时才把包注册成 profile *bundle*。结果插件装上了却从不加载——模型选择器空白，
输出里也没有任何解释。

现在从源头解决，而不是让用户照着一长串说明去绕：这层线协议代码**已随包的 `lib/` 一起打包**，
那些依赖根本不会被安装。当前发布包只依赖 `yaml`、`undici`、`partial-json` 和
`@deepseek-ai/schemastery`，它们都不执行脚本。

**确认真的注册上了**：profile 的 `package.json` 里，`dsh-freetap` 必须出现在
`dsh.profile.bundles` 下，而不只是 `dependencies` 里。

### 在可视化界面里安装（推荐给不用命令行的用户）

**设置 → 插件 → 安装**，把 tarball 链接粘进去：

```
https://github.com/ddldxiacan/dsh-freetap/releases/download/v0.5.1/dsh-freetap-0.5.1.tgz
```

一次就能装好，不会弹「需要允许安装脚本」——包里已经没有任何声明安装脚本的依赖。

万一你确实看到那个授权面板，说明你装的是 0.5.1 之前的旧构建：升级即可，或点「允许这些脚本并重试」。

### 其他安装方式

**直接从 GitHub 安装**（不经过 registry）：

```sh
dsh plugin --profile web add github:ddldxiacan/dsh-freetap
```

这条路径之所以可用，是因为仓库根本身就是那个可安装的插件：它带着 `dsh` 清单，
而构建产物已提交在 `packages/plugin/lib/` 下。git 安装无法执行构建——pnpm 会拦截
git 依赖的 prepare 脚本——所以把构建产物一并提交，才让这条路径成立。
需要稳定版本时建议锁定 tag：

```sh
dsh plugin --profile web add github:ddldxiacan/dsh-freetap#v0.5.1
```

**从 npm 安装**（已发布版本）：

```sh
dsh plugin --profile web add dsh-freetap
```

**验证**：重启 `dsh web`，打开模型选择器，在 **dsh-freetap** 分组里选模型即可。

### 更新

按你当初安装的来源选一条，都是就地更新。

**Release tarball** —— 用带版本号的那个资产，不要用 `latest`：

```sh
# 把 0.5.1 换成你要升到的版本
dsh plugin --profile web add https://github.com/ddldxiacan/dsh-freetap/releases/download/v0.5.1/dsh-freetap-0.5.1.tgz
```

不带版本号的 `releases/latest/download/...` 地址**无法**更新已安装的版本：pnpm 早已把该
URL 连同完整性哈希固定进 `pnpm-lock.yaml`，同一个 URL 会被判为已解析
（「Lockfile is up to date, resolution step is skipped」），加 `--force`、`pnpm update`、
`pnpm install --force`、删掉 `node_modules` 重装都绕不过去——只有每次发布都不同的 URL
才会重新解析。如果你正卡在还没有带版本资产的旧版本上，做一次性迁移（先移除再装，或者
直接用带版本的地址，后者即使在旧版本上也能生效）：

```sh
dsh plugin --profile web remove dsh-freetap
dsh plugin --profile web add https://github.com/ddldxiacan/dsh-freetap/releases/latest/download/dsh-freetap.tgz
```

**git 安装**：跟随 master（git 依赖每次都会重新解析）：

```sh
dsh plugin --profile web add github:ddldxiacan/dsh-freetap
```

**npm 安装**：

```sh
dsh plugin --profile web add dsh-freetap@latest
```

然后重启 DSH。确认新版本是否生效：比对 profile 里
`node_modules/<包名>/package.json` 的版本，并查看健康快照
`~/.dsh-freetap/adapter-status.json`。

如果某次更新后插件装在 `node_modules` 里却始终不加载，那就是[安装](#安装)一节讲的
`ERR_PNPM_IGNORED_BUILDS` 那个坑：先 `remove` 再 `add`，让它重新算作新依赖，
DSH 才会把它注册为 bundle。

## 配置

默认配置开箱即用。需要覆盖时，编辑 profile 的 `cordis.patch.yml`。
其中 `name` 必须是你实际安装的那个包名：git 安装、release tarball 与 npm
安装现在都是同一个名字 `dsh-freetap`。

```yaml
- id: dsh-freetap
  name: dsh-freetap
  config:
    mode: adapter        # adapter（默认）| sidecar
    providerId: dsh-freetap
    refreshSeconds: 300  # 目录刷新周期（秒）
```

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `mode` | `adapter` | `adapter`：原生 LlmAdapter 直连 Zen。`sidecar`：旧版本地 agent 模式，不随包发行——请从 `legacy/agent` 自行构建并通过 `agentPath` 指定。 |
| `providerId` | `dsh-freetap` | 在 DSH 中显示的 provider 名称。 |
| `refreshSeconds` | `300` | 实时目录刷新间隔；定价元数据每 24 小时刷新。 |
| `agentPath` | 自动解析 | 仅 sidecar：agent 二进制路径。 |
| `agentArgs` | — | 仅 sidecar：传给 agent 的额外 CLI 参数。 |
| `restartDelayMs` / `restartMaxDelayMs` / `maxConsecutiveCrashes` | `1000` / `60000` / `5` | 仅 sidecar：重启退避与熔断阈值。 |
| `firstEventMs` / `bodyIdleMs` / `responsesBodyIdleMs` | `30000` / `120000` / `300000` | 仅 adapter，插件 0.3.7 起支持：流存活超时，单位毫秒，取 `1` 到 `600000` 的整数。分别控制首事件等待、流中静默，以及 Responses 模型（`muse-spark-*`）的静默下限。冷启动慢时可调大 `firstEventMs`。不设置则使用默认值；修改后重启 DSH。 |

## 工作原理

```
DSH 会话
   │  harness chunk（block-start / text-delta / usage / finish …）
   ▼
ZenAdapter（注册的 LlmAdapter）
   │  pi-ai openai-completions 流式
   ▼
https://opencode.ai/zen/v1        ← Authorization: Bearer public
   携带与 CLI 同形的请求头：
     user-agent: opencode/…
     x-opencode-client, x-opencode-session, x-session-affinity,
     X-Session-Id, x-opencode-request, x-opencode-project
```

- **会话关联**——session/project id 由会话首条用户消息经 SHA-256 派生
  （同一会话稳定、不可逆推），每个请求再附带一个全新的随机 id，与 CLI 行为一致。
- **目录回退链**——S1：实时 `GET /v1/models`；S2：models.dev 定价元数据判定
  "免费"；S3：编译期验证的静态名单。上游故障时由磁盘缓存（约 7 天有效期）兜底。
- **韧性**——adapter 在启动时立即注册；若首次目录拉取撞上网络尚未就绪
  （VPN/TUN 重连、DNS 等），会以短周期重试（约 1 分钟内），随后转入常规刷新。
- **sidecar 模式**（`mode: sidecar`，旧版）——拉起本地 Go agent（
  [opencode2api](https://github.com/jasonxu114514/opencode2api) 的单租户移植版），
  监听 `127.0.0.1:<随机端口>`、token 鉴权，并注册标准 `llm-pi-ai` 路由。
  **不随包发行**；请从 `legacy/agent` 构建（`go build ./cmd/agent`）并把
  `agentPath` 指向产物。

## 健康状态与排查

插件在每轮刷新后写入健康快照：

```
~/.dsh-freetap/adapter-status.json
```

```json
{
  "status": "ready",
  "total": 64,
  "exposed": 9,
  "lastError": "",
  "writtenAt": "2026-08-29T07:01:54.915Z"
}
```

| 现象 | 可能原因与处理 |
| --- | --- |
| `403 FreeTierError` / "OpenCode's free tier can only be used from within OpenCode" | 上游限制免费通道的客户端，插件会保留该说明；这不是个人 API 密钥错误。请使用上游支持的 OpenCode 客户端或正式 API 服务。 |
| 启动页报 `Failed to load plugins … list slot "plugins.item" requires options.id`，或 IP 池条目没有配置页 | DSH 早于 0.1.7 的插件页契约。升级 DSH 到 0.1.7（推荐最新）；页面挂载门控是 `configForms.whileServed`，0.1.6 及更早上整页不出现，模型路由不受影响。 |
| 安装插件后 DSH 0.1.7/0.2 无法启动，报 `pending … settingsScope` | 更新插件到 0.3.5；DSH 0.2 的 IP 池设置在插件页的 dsh-freetap 条目里。 |
| 只有 3 个模型 | 启动时网络未就绪，重试会在约 1 分钟内补齐；看 `adapter-status.json` 里的 `lastError`。 |
| `lastError: "fetch failed"` 持续出现 | 出站 HTTPS 到 `opencode.ai` 被拦截；检查代理/VPN 规则。 |
| 对话中报限流错误（`429 … Endpoint is unavailable`） | 匿名通道按 IP 限额，免费模型竞争大。[#51](https://github.com/FishBottle7/opencode2dsh/issues/51) 修复后，插件的 provider 重试策略会静默扛过 429 突发（8 次重试、约 1s→20s 退避、每步最坏约 90s），不再直接抛给用户；仍被打满时可降低思考强度、换一个竞争较小的 `-free` 模型，或在插件设置页开启 IP 池（多出口轮换）。 |
| 思考耗尽输出预算，没有正文 | 插件 0.3.6 会在模型支持 Off 时关闭思考重试一次。已有任何正文或工具调用则不会重试。重试保持原输出上限，仍可能失败，两次请求的用量合并统计。不支持 Off 的模型（如 Muse）需要手动调整设置或更换模型。 |
| Muse 报 `REGION_BLOCKED` / "This model is not available in your country" | Zen 不向当前网络地区提供该模型。插件 0.3.5 保留上游解释；旧版会把这个 403 误报为 API 密钥无效。匿名通道不需要个人密钥，可使用当前地区可用的模型。 |
| 连接 `127.0.0.1:*` 报错 | 残留的 sidecar 路由遮蔽了 adapter；插件 ≥ 0.2.1 启动时会自动清理。 |
| 安装时报 `ERR_PNPM_IGNORED_BUILDS` | 你装的是 0.5.1 之前的旧构建，它依赖的 `pi-ai` 会带入 `@google/genai` 与 `protobufjs`（两者都有安装脚本）。升级到 0.5.1+ 即可——新版已把这层打包进来，只依赖无脚本的包。若必须留在旧版，加 `--config.strict-dep-builds=false`。 |

## 安全性

- 不涉及任何机密：匿名通道的 Key 就是字面量 `public`；插件不存储任何东西，也没有任何遥测。
- 安装产物仅限 `lib/`；不执行任何依赖的构建脚本。
- 所有请求均从你的机器直连 `opencode.ai` / `models.dev`。

## 开发

```sh
git clone https://github.com/ddldxiacan/dsh-freetap.git
cd dsh-freetap/packages/plugin
pnpm install
pnpm typecheck && pnpm test
pnpm build                    # 打包到 lib/
```

旧版 Go sidecar 在 `legacy/agent`（`go test ./...`）。架构说明与移植记录见 `docs/`。

发布：在 `packages/plugin` 执行 `pnpm pack`（prepack 会构建并同步文档）。

## 致谢

- [**opencode2dsh**](https://github.com/FishBottle7/opencode2dsh)，作者
  [@FishBottle7](https://github.com/FishBottle7)——本项目的上游，也是改名前的名字。
  它的整体架构、目录回退链与请求伪装实现是这个分支的基础；上文引用的 issue 编号
  均指该仓库。
- [**opencode2api**](https://github.com/jasonxu114514/opencode2api)，作者
  [@jasonxu114514](https://github.com/jasonxu114514)——`legacy/agent` 里的旧版
  Go sidecar 是其匿名通道实现的移植版，目录回退链与请求伪装细节同样源自它。
  本项目能成立，全靠它踩过的路。
- [OpenCode](https://opencode.ai)——运营免费匿名 Zen 通道。
- [@earendil-works/pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai)——adapter 模式使用的线上协议层。
- [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) 与
  [dsh-market](https://github.com/dsh-market/dsh-market) 社区。

## 友链

<div align="center">

**[LinuxDo](https://linux.do)** —— 新的理想型社区

</div>

## 许可证

[MIT](./LICENSE) © 2026 ddldxiacan，基于 opencode2dsh © FishBottle7
