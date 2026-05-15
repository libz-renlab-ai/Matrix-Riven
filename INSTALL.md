# Matrix-Riven 客户端安装（给 AI agent 跑的版本）

> **如果你是 AI agent（Claude Code / Cursor / Codex / …），直接按下面 "Setup Flow" 走。**
> 每一步都给了**唯一的命令**和**唯一的成功判据**——验证不过就走对应的 Troubleshooting 分支，不要自由发挥。
>
> **如果你是人**，结果一样：跟着 Setup Flow 跑，10 分钟之内会看到日志出现在 [http://192.168.22.88:8933](http://192.168.22.88:8933) 看板上。

---

## 0. Preconditions

仅在公司内网部署使用。开装前请确认：

| 检查 | 命令 | 成功判据 |
|---|---|---|
| Node ≥ 22.5.0 | `node --version` | 输出 `v22.5.x` 或更高 |
| pnpm ≥ 9 | `pnpm --version` | 输出 `9.x` / `10.x` / `11.x` 任意一个 |
| git 可用 | `git --version` | 任意 `git version 2.x` |
| 能连公司 collector | `curl -sS --noproxy '*' -o /dev/null -w "%{http_code}\n" http://192.168.22.88:8933/` | `200` |
| Windows 上有 git-bash 或 WSL | `bash --version` | 任意 `GNU bash, version ...` |

任意一项失败 → 报告给用户，**不要**继续。

> **collector 检查拿到 `502` + 响应头有 `Proxy-Connection`**：你的机器走了 HTTP 代理（Clash / 公司代理 / VPN），代理打不通内网。固定加 `--noproxy '*'`（上表已加），或先 `unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY` 再试。同理之后跑 `bin-uploader` 时，**uploader 也走系统代理**——确认 `NO_PROXY=192.168.22.0/24,localhost` 已设到 shell / 系统环境变量里，否则上传会被代理拦下。

---

## 1. Setup Flow — 三步装完

### Step 1. 拿代码 + 构建

```bash
git clone https://github.com/libz-renlab-ai/Matrix-Riven.git
cd Matrix-Riven
pnpm install
pnpm -r build
```

**成功判据：** 最后一条命令的输出里有 `Build success` 字样，且以下 5 个文件存在：

```bash
ls packages/uploader-client/dist/bin-*.cjs
# 期望看到 5 个文件：
#   bin-digital-twin-tap.cjs
#   bin-digital-twin.cjs
#   bin-session-start.cjs
#   bin-uploader.cjs
#   bin-user-prompt-submit.cjs
```

如果少了任意一个 → 跑 `pnpm -r build` 重来一次；再不行看 Troubleshooting §A。

### Step 2. 跑 installer

```bash
node scripts/install-client.mjs
```

这一条命令做完以下所有事：

1. 把 5 个 `.cjs` bin 从 `dist/` 拷到 `~/.riven/digital-twin/`（稳定路径，不依赖 worktree）
2. 在 `~/.claude/settings.json` 里加 3 个 hook（`Stop` / `SessionStart` / `UserPromptSubmit`）
   - 已有 settings.json 先备份成 `settings.json.riven-backup-<timestamp>`
   - 用 `_rivenTag` 识别幂等更新——重跑这一步不会产生重复 entry
   - 自动识别并替换老的 TeamBrain `_teamagentTag` entry
   - 其他无关字段（theme / enabledPlugins / advisorModel / …）一字不动
3. 跑一次 dry-run 探针（`RIVEN_UPLOADER_DRYRUN=1`）确认打包没有 `MODULE_NOT_FOUND`

**成功判据：** 最后一行打印 `done.`，且打印了 4 条 `next steps:`。

如果中途某行打印 `FATAL: ...` → 看 Troubleshooting §B。

> 先看会发生什么再下手？跑 `node scripts/install-client.mjs --dry-run`，不写文件，只打印计划。
> 想反悔？跑 `node scripts/install-client.mjs --uninstall`，会移除 hook 条目 + 删 staged bins（保留 `~/.riven/digital-twin/queue/` 队列和配置不动）。

### Step 3. 验证日志真能上传

**不需要重启 Claude Code**——下面这两条命令用 CLI 直接走完整链路：

```bash
# 3a. 造一份假 transcript 入队（不需要 login，第一次会自动建 config）
node ~/.riven/digital-twin/bin-digital-twin.cjs inject-mock

# 3b. 立刻触发守护进程把队列推到服务端
node ~/.riven/digital-twin/bin-uploader.cjs
```

> Windows git-bash 上 `~` 可能不展开——如果第一条命令报 "Cannot find module"，把 `~` 换成 `$USERPROFILE`（或在 PowerShell 里换成 `$env:USERPROFILE`）。

**成功判据**（同时满足三条）：

1. `inject-mock` 输出最后一行形如 `digital-twin: injected mock transcript (session=01XXXXX) -> .../queue/pending/01XXXXX.payload`
2. `bin-uploader.cjs` exit code 是 `0`
3. 抓服务端看自己的 user_id 是否出现：

```bash
curl -sS http://192.168.22.88:8933/api/users
```

输出的 JSON `users` 数组里能找到你自己的 user_id（默认是 `<git config user.email>` 或 `<unix-user>@<hostname>` 兜底）→ **安装成功**。

之后每次你在 Claude Code 里结束一个会话，Stop hook 都会自动 tap + spawn 守护进程上传，无需手动再做任何事。

---

## 2. Troubleshooting

### §A. 构建失败

- 错误含 `Cannot find module` → `pnpm install` 没跑完，重跑一次。
- 错误含 `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` → 看上面具体哪个包失败，单独 `pnpm --filter <pkg> build`。
- Windows 上 `tsup` 报权限错误 → 关掉杀软对 `node_modules` 的实时扫描，或换 admin 终端重跑。

### §B. installer 报 FATAL

- `MODULE_NOT_FOUND` in probe → 八成是 `pnpm -r build` 没跑全，回 Step 1。
- `cannot parse .../settings.json` → 你的 `~/.claude/settings.json` 不是合法 JSON。备份后修复，再重跑。**不要**让 installer 强行覆盖一个无法解析的 settings 文件。
- `missing .../bin-xxx.cjs` → 同上，回 Step 1。

### §C. 验证不通过

1. 看本地有没有失败痕迹：

```bash
cat ~/.riven/digital-twin/uploader.log 2>/dev/null | tail -30
ls ~/.riven/digital-twin/queue/dead-letter/ 2>/dev/null
```

`uploader.log` 里如果有 `auth failed` → 服务端开了 token gate，问运维要 token，然后：

```bash
node ~/.riven/digital-twin/bin-digital-twin.cjs login <real-token>
```

`dead-letter/` 里有文件 → 那条 entry 已经被 daemon 标记为 24h 都没传上，看 metadata 的 `first_failed_at` 字段，多半是 endpoint 配错或网络断了。

2. 看自己 config 长什么样：

```bash
cat ~/.riven/digital-twin.json
```

`uploader.endpoint` 应该是 `http://192.168.22.88:8933`。不对的话直接编辑文件改正。

3. 看自己的 user_id 是什么：

```bash
node ~/.riven/digital-twin/bin-digital-twin.cjs status
```

`user_id` 字段就是你在看板上的标识。

---

## 3. 卸载

```bash
node scripts/install-client.mjs --uninstall
```

会：
- 从 `~/.claude/settings.json` 删除 3 个带 `_rivenTag` 的 hook 条目（同时清理老 `_teamagentTag` 条目）
- 删除 `~/.riven/digital-twin/` 下的 5 个 `.cjs` bin

不会：
- 删 `~/.riven/digital-twin/queue/` 队列（有未上传的数据）
- 删 `~/.riven/digital-twin.json` 配置
- 删服务端已经上传的数据

完整清掉本地痕迹：

```bash
rm -rf ~/.riven
```

---

## 4. 测试时的常见坑（给 agent 看）

如果你（agent）想在一个隔离的临时 `$HOME` 里跑这个 installer 做端到端测试，注意：

- Windows 上 Node 的 `os.homedir()` 读 `USERPROFILE`，所以你会想 `USERPROFILE=$SMOKE_HOME node ...` 来隔离。**但是** git 的全局配置也读自 `USERPROFILE/.gitconfig`——如果 `$SMOKE_HOME/.gitconfig` 不存在，`getUserId()` 会 fallback 到 `<os-user>@<hostname>` 而不是用户真实的 git email。
- 修复：测试前先 `cp "$USERPROFILE/.gitconfig" "$SMOKE_HOME/.gitconfig"`，复用真实 git 身份。
- 这只是测试隔离的产物，**真实用户安装时不会出现**——他们的 `USERPROFILE` 就是自己的，git config 一切正常。

---

## 5. 已知非自动化项

为防止 agent 误判，列一下当前版本**不会自动处理**的事：

- **重启 Claude Code 让 hook 生效** —— installer 写完 settings.json 后，Claude Code 不会热加载；新开的 Claude Code session 才会读到新 hook。Step 3 的 inject-mock 验证不依赖这个（它通过 CLI 直接调底层函数），但**正常的 Stop hook 触发**需要重启 Claude Code。
- **企业认证 token** —— 当前 server 没开 `RIVEN_AUTH_TOKEN`，默认 config 用 `team-shared` 这个 sentinel token 直接通过。如果将来 server 开了 token gate，要手动跑一次 `bin-digital-twin.cjs login <real-token>`。
- **跨用户共享配置** —— 一台机器一个用户。多用户共用一台机器的，每个用户自己跑一次这个 installer。
