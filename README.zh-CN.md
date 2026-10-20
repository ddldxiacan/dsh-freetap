<div align="center">

# dsh-opencode-free

**在 DSH（DeepSeek Harness）里原生使用 OpenCode Zen 的免费匿名模型。**

无需 API Key。无需注册。无需额外进程。

[![npm](https://img.shields.io/npm/v/@dsh-opencode-free%2Fdsh-plugin)](https://www.npmjs.com/package/@dsh-opencode-free/dsh-plugin)
[![license](https://img.shields.io/npm/l/@dsh-opencode-free%2Fdsh-plugin)](https://github.com/ddldxiacan/dsh-opencode-free/blob/master/LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-blue)](https://github.com/ddldxiacan/dsh-opencode-free)

[English](README.md) | 简体中文

</div>

---

dsh-opencode-free 会向 DSH 注册一个原生的 `LlmAdapter`，直接流式对接
[OpenCode Zen](https://opencode.ai/zen) 的**匿名免费通道**——也就是
OpenCode 官方 CLI 无需登录即可使用的那批免费模型，它们会以 `dsh-opencode-free`
这个常规 provider 出现在你的 DSH 模型选择器里。

插件发出的请求与 OpenCode CLI 的流量完全同形（相同的 User-Agent、相同的
关联请求头），模型目录通过三级回退链保持新鲜。不用登录任何账号，也不用
自己部署任何东西。

> **从 `opencode2dsh` 升级？** 本项目已改名。插件现在以
> `@dsh-opencode-free/dsh-plugin` 发布，provider、设置条目与数据目录一并换成新名字。
> 已保存的 IP 池设置与旧的 `~/.opencode2dsh` 缓存在首次启动时会被自动复制一次，
> 详见[从 opencode2dsh 改名](#从-opencode2dsh-改名)。

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
**请按顺序做这三步**——如果跳过第 2 步先装，会以一种「看起来成功」的方式静默失败
（原因见下）。

**1. 确保 profile 已存在。** 任意一条 `dsh plugin` 命令都会初始化它：

```sh
dsh plugin --profile web list
```

**2. 在首次安装「之前」批准两个构建脚本。** 它们是 `@google/genai` 和
`protobufjs`，由 `@earendil-works/pi-ai` 传递引入；pnpm 默认拦截依赖的构建脚本。
把下面内容追加到 profile 的 `pnpm-workspace.yaml`
（`~/.dsh/profiles/web/pnpm-workspace.yaml`，Windows 下位于
`%USERPROFILE%\.dsh\profiles\web\`）：

```yaml
allowBuilds:
  '@google/genai': false
  protobufjs: false
```

写 `false` 表示仍然禁用这两个脚本——它记录的是 pnpm 等待的那个「决定」，这就够了。
（上游也是把这两个设为 `false`。）

**3. 安装：**

```sh
dsh plugin --profile web add https://github.com/ddldxiacan/dsh-opencode-free/releases/latest/download/dsh-opencode-free-dsh-plugin.tgz
```

链接不带版本号，适合**首次安装**。它不能用来更新：pnpm 会把你解析过的 URL 连同 tarball 的
完整性哈希一起固定在 `pnpm-lock.yaml` 里，URL 不变就被当成「已解析」，输出
「Lockfile is up to date, resolution step is skipped」——再执行一次装回来的还是旧版本。
更新要用带 tag 的地址（见[更新](#更新)）。

### 为什么必须先做第 2 步

跳过它的话，首次安装会以 `ERR_PNPM_IGNORED_BUILDS` 停下——但 pnpm 这时**已经**把依赖
写进了 profile 的 `package.json`。而 DSH 只在那次 pnpm 运行**退出码为 0 且该包是新依赖**
时，才把它注册为 profile 的 bundle。于是重试时它已不算「新依赖」，注册被跳过，运行以
**0** 退出：插件躺在 `node_modules` 里，却从未被加进 `dsh.profile.bundles`——它也就
永远不会加载，模型选择器里不会出现任何模型。而输出里没有任何信息提示这一点。

如果你已经踩了这个坑，用「先移除、再重装」恢复：

```sh
dsh plugin --profile web remove @dsh-opencode-free/dsh-plugin
dsh plugin --profile web add https://github.com/ddldxiacan/dsh-opencode-free/releases/latest/download/dsh-opencode-free-dsh-plugin.tgz
```

要确认插件真的注册上了，检查 profile 的 `package.json`：
`@dsh-opencode-free/dsh-plugin` 应出现在 `dsh.profile.bundles` 里，而不只是
`dependencies` 里。

### 其他安装方式

**在 Web 界面里安装**：**设置 → 插件 → 安装**，粘贴同一个 tarball 链接。Web 页会写入
同类的批准，并有自己的 bundle 选择流程；上面那套 CLI 步骤是此处经过实测的路径。

**直接从 GitHub 安装**（不经过 registry）：

```sh
dsh plugin --profile web add github:ddldxiacan/dsh-opencode-free
```

这条路径之所以可用，是因为仓库根本身就是那个可安装的插件：它带着 `dsh` 清单，
而构建产物已提交在 `packages/plugin/lib/` 下。git 安装无法执行构建——pnpm 会拦截
git 依赖的 prepare 脚本——所以把构建产物一并提交，才让这条路径成立。
需要稳定版本时建议锁定 tag：

```sh
dsh plugin --profile web add github:ddldxiacan/dsh-opencode-free#v0.4.0
```

**从 npm 安装**（已发布版本）：

```sh
dsh plugin --profile web add @dsh-opencode-free/dsh-plugin
```

**验证**：重启 `dsh web`，打开模型选择器，在 **dsh-opencode-free** 分组里选模型即可。

### 更新

按你当初安装的来源选一条，都是就地更新。

**Release tarball** —— 用带版本号的那个资产，不要用 `latest`：

```sh
# 把 0.4.2 换成你要升到的版本
dsh plugin --profile web add https://github.com/ddldxiacan/dsh-opencode-free/releases/download/v0.4.2/dsh-opencode-free-dsh-plugin-0.4.2.tgz
```

不带版本号的 `releases/latest/download/...` 地址**无法**更新已安装的版本：pnpm 早已把该
URL 连同完整性哈希固定进 `pnpm-lock.yaml`，同一个 URL 会被判为已解析
（「Lockfile is up to date, resolution step is skipped」），加 `--force`、`pnpm update`、
`pnpm install --force`、删掉 `node_modules` 重装都绕不过去——只有每次发布都不同的 URL
才会重新解析。如果你正卡在还没有带版本资产的旧版本上，做一次性迁移（先移除再装，或者
直接用带版本的地址，后者即使在旧版本上也能生效）：

```sh
dsh plugin --profile web remove @dsh-opencode-free/dsh-plugin
dsh plugin --profile web add https://github.com/ddldxiacan/dsh-opencode-free/releases/latest/download/dsh-opencode-free-dsh-plugin.tgz
```

**git 安装**：跟随 master（git 依赖每次都会重新解析）：

```sh
dsh plugin --profile web add github:ddldxiacan/dsh-opencode-free
```

**npm 安装**：

```sh
dsh plugin --profile web add @dsh-opencode-free/dsh-plugin@latest
```

然后重启 DSH。确认新版本是否生效：比对 profile 里
`node_modules/<包名>/package.json` 的版本，并查看健康快照
`~/.dsh-opencode-free/adapter-status.json`。

如果某次更新后插件装在 `node_modules` 里却始终不加载，那就是上文
`ERR_PNPM_IGNORED_BUILDS` 那个坑：先 `remove` 再 `add`，让它重新算作新依赖，
DSH 才会把它注册为 bundle。

需要 DSH（DeepSeek Harness）0.1.7 及以上、带 web profile（IP 池设置页依赖 0.1.7
的插件页契约）；Node.js ≥ 20（DSH 能跑就满足）；出站 HTTPS 需可达 `opencode.ai` 与 `models.dev`。

## 配置

默认配置开箱即用。需要覆盖时，编辑 profile 的 `cordis.patch.yml`。
其中 `name` 必须是你实际安装的那个包名：git 安装用 `dsh-opencode-free`，
tarball 或 npm 安装用 `@dsh-opencode-free/dsh-plugin`。

```yaml
- id: dsh-opencode-free
  name: dsh-opencode-free   # 或 '@dsh-opencode-free/dsh-plugin'
  config:
    mode: adapter        # adapter（默认）| sidecar
    providerId: dsh-opencode-free
    refreshSeconds: 300  # 目录刷新周期（秒）
```

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `mode` | `adapter` | `adapter`：原生 LlmAdapter 直连 Zen。`sidecar`：旧版本地 agent 模式，不随包发行——请从 `legacy/agent` 自行构建并通过 `agentPath` 指定。 |
| `providerId` | `dsh-opencode-free` | 在 DSH 中显示的 provider 名称。 |
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
~/.dsh-opencode-free/adapter-status.json
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
| 安装插件后 DSH 0.1.7/0.2 无法启动，报 `pending … settingsScope` | 更新插件到 0.3.5；DSH 0.2 的 IP 池设置在插件页的 dsh-opencode-free 条目里。 |
| 只有 3 个模型 | 启动时网络未就绪，重试会在约 1 分钟内补齐；看 `adapter-status.json` 里的 `lastError`。 |
| `lastError: "fetch failed"` 持续出现 | 出站 HTTPS 到 `opencode.ai` 被拦截；检查代理/VPN 规则。 |
| 对话中报限流错误（`429 … Endpoint is unavailable`） | 匿名通道按 IP 限额，免费模型竞争大。[#51](https://github.com/FishBottle7/opencode2dsh/issues/51) 修复后，插件的 provider 重试策略会静默扛过 429 突发（8 次重试、约 1s→20s 退避、每步最坏约 90s），不再直接抛给用户；仍被打满时可降低思考强度、换一个竞争较小的 `-free` 模型，或在插件设置页开启 IP 池（多出口轮换）。 |
| 思考耗尽输出预算，没有正文 | 插件 0.3.6 会在模型支持 Off 时关闭思考重试一次。已有任何正文或工具调用则不会重试。重试保持原输出上限，仍可能失败，两次请求的用量合并统计。不支持 Off 的模型（如 Muse）需要手动调整设置或更换模型。 |
| Muse 报 `REGION_BLOCKED` / "This model is not available in your country" | Zen 不向当前网络地区提供该模型。插件 0.3.5 保留上游解释；旧版会把这个 403 误报为 API 密钥无效。匿名通道不需要个人密钥，可使用当前地区可用的模型。 |
| 连接 `127.0.0.1:*` 报错 | 残留的 sidecar 路由遮蔽了 adapter；插件 ≥ 0.2.1 启动时会自动清理。 |
| 安装时报 `ERR_PNPM_IGNORED_BUILDS` | `pi-ai` 的传递依赖（`@google/genai`、`protobufjs`）带构建脚本，运行时并不需要。在插件市场里按提示选择允许/拒绝，或在 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds:` 下把这两项设为 `false`。 |

## 从 opencode2dsh 改名

本项目原名 **opencode2dsh**。改名已完成：npm 包、DSH provider id、设置条目与
数据目录全部改用新名字 `dsh-opencode-free`。

升级是自动的。更新后首次启动时，插件会从旧名字把状态复制过来，只复制一次，
且不删除任何东西：

| 状态 | 旧位置 | 新位置 |
| --- | --- | --- |
| 缓存、健康快照、sidecar token | `~/.opencode2dsh/` | `~/.dsh-opencode-free/` |
| 已保存的 IP 池设置 | `~/.dsh/settings.yaml` 的 `opencode2dsh:` 段 | `dsh-opencode-free:` 段 |

迁移**刻意不做**两件事：

- **绝不删除或移动旧状态。** 想回退旧版本仍然可用，迁移失败也可以在下次启动重试。
- **绝不覆盖你已在新名字下设置的值。** 只复制新段里缺失的键，已经配置过的一律以你的为准。

升级后模型选择器里显示为 **dsh-opencode-free**。**已保存的 IP 池设置会在第二次启动时生效**：
Loader 在组合每次启动时就会解析该条目的 volatile `ipPool` 值，所以那次启动期间复制的设置
要到下一次启动才被读到；缓存与健康文件则立即生效。如果某次切换发生在本改名之前，
DSH 的**设置 → 插件**里可能还留着一个 `opencode2dsh` 条目，手动移除即可
（sidecar 安装遗留的 `opencode2dsh` 孤儿 provider 路由会在启动时自动清理）。

如果你宁可重新开始而不迁移，在升级前删掉 `~/.opencode2dsh/` 与
`~/.dsh/settings.yaml` 里的 `opencode2dsh:` 段即可，插件会以默认值启动。

## 安全性

- 不涉及任何机密：匿名通道的 Key 就是字面量 `public`；插件不存储任何东西，也没有任何遥测。
- 安装产物仅限 `lib/`；不执行任何依赖的构建脚本。
- 所有请求均从你的机器直连 `opencode.ai` / `models.dev`。

## 开发

```sh
git clone https://github.com/ddldxiacan/dsh-opencode-free.git
cd dsh-opencode-free/packages/plugin
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
