# CardForge 部署

CardForge 是纯静态 SPA（React + Vite，无后端、无数据库，存档只在浏览器 localStorage）。
部署就是把构建产物 `dist/` 放到服务器上由 nginx 托管，没有进程需要常驻或重启。

生产站点：<https://game.farc.dev>

## 线上拓扑

站点跑在一台**已有其他服务**的机器上，`:443` 由 nginx 的 `stream` 模块按 SNI 分流，
各站点的 TLS 终结在各自的回环端口。CardForge 是其中一路：

```text
Cloudflare（橙云代理）
  └─ 45.129.8.205
       ├─ :80   nginx http  → ACME 校验 + 301 跳 https
       └─ :443  nginx stream 按 SNI 分流 (/etc/nginx/stream.d/reality-stream.conf)
                  ├─ jenny.wulab.tech → 127.0.0.1:8444
                  ├─ sec.hikki.baby   → 127.0.0.1:8445
                  ├─ game.farc.dev    → 127.0.0.1:8446   ← CardForge
                  └─ default          → 127.0.0.1:8443   （代理服务，勿动）
```

**改动 `stream.d/reality-stream.conf` 时务必保持 `default` 那一行不变**——它承载的是
本机的代理出口，改错会让机器失去该通道。任何改动前先备份，改完用 `nginx -t` 验证，
并逐个 SNI 确认落点（见下方「验证」）。

站点文件采用 release + 符号链接：

```text
/var/www/cardforge/
  releases/<commit sha>/    每次部署一份，保留最近 5 个
  current -> releases/...   nginx 的 root 指向它
```

## 发布链路

```text
push 到 main
  └─ CI「quality」：lint → typecheck → 单测 → 构建 → 平衡基线 → 浏览器测试
       └─ 上传 dist 产物
            └─ CI「deploy」（仅 main 的 push，且 quality 全绿）
                 ├─ rsync 到 releases/<sha>/
                 ├─ mv -T 原子切换 current
                 ├─ 只保留最近 5 个 release
                 └─ 在源站校验 current 指向本次 sha 且返回 200
```

冒烟校验走 SSH 在**源站**做，不经 Cloudflare：CDN 对 GitHub Actions 的机房 IP
返回 403，那检查的是风控策略而非本次发布。源站校验同时断言 `current` 确实
指向本次 commit，也不受 CDN 缓存影响。

部署的是 **quality job 构建并测过的那一份产物**，deploy job 不重新构建——上线的字节
与通过测试的字节是同一份。`current` 的切换是单个 `mv -T`（一次 rename 系统调用），
用户不会在切换途中看到半份站点。

## GitHub Secrets

| Secret | 值 |
| --- | --- |
| `DEPLOY_SSH_KEY` | 部署私钥全文（本机 `~/.ssh/cardforge_deploy`） |
| `DEPLOY_HOST` | `45.129.8.205` |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_PORT` | `29637` |
| `DEPLOY_PATH` | `/var/www/cardforge` |
| `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan -p 29637 45.129.8.205` 的输出 |
| `DEPLOY_SITE_URL` | `https://game.farc.dev` |

`DEPLOY_KNOWN_HOSTS` 用于固定服务器主机密钥；没有它就只能关掉 `StrictHostKeyChecking`，
那等于把每次部署暴露给中间人。**服务器重装或换机后必须重新生成**，否则部署会以主机
密钥不匹配失败——这是预期行为，不要用关校验来绕过。

## 服务器初始化

`deploy/server-setup.sh` 复用宿主机已有的 nginx，不安装任何新 web 服务器、不抢占
80/443。它建 `deploy` 用户（无 sudo）、建站点目录、写入本站 nginx 配置、签发证书，
并**打印**需要人工确认的 SNI 路由改动——那一步刻意不自动执行。

```bash
sudo ./server-setup.sh game.farc.dev "<部署公钥>"
```

`deploy/nginx/` 下的两个配置是线上实际生效的副本。

## 回滚

把 `current` 指回上一个 release 即可，无需重新构建或 reload nginx：

```bash
cd /var/www/cardforge
ls -1t releases/
ln -sfn releases/<目标 sha> current.tmp && mv -Tf current.tmp current
```

回滚是瞬时的。要让 main 也回到该版本，再 `git revert` 走正常流水线。

## 验证

SNI 分流是否都落到正确后端（每次改 stream 配置后都应跑一次）：

```bash
for s in game.farc.dev jenny.wulab.tech sec.hikki.baby unknown.example.com; do
  printf '%-22s -> ' "$s"
  echo | openssl s_client -connect 127.0.0.1:443 -servername "$s" 2>/dev/null \
    | openssl x509 -noout -subject
done
```

前三个应各自返回对应域名的证书；最后一个应返回代理服务的伪装证书（说明 `default`
路由完好）。

## 排查

| 现象 | 原因与处理 |
| --- | --- |
| `Host key verification failed` | `DEPLOY_KNOWN_HOSTS` 与实际主机密钥不符。重新 `ssh-keyscan` 更新 secret。 |
| `Permission denied (publickey)` | 公钥没进 `deploy` 的 `authorized_keys`，或 `~/.ssh` 权限不对（须 700/600）。 |
| 站点仍是旧版本 | 看 `readlink /var/www/cardforge/current`；Cloudflare 可能缓存了 `index.html`，可在 CF 后台清缓存。 |
| 证书签发/续期失败 | Cloudflare 橙云下 HTTP-01 依赖 `:80` 可达。确认 `/.well-known/acme-challenge/` 未被「Always Use HTTPS」拦截。 |
| 某个域名 TLS 握手拿到错误证书 | SNI map 缺条目或 upstream 端口写错，回退到了 `default`。 |
| 页面白屏、控制台报 chunk 加载失败 | 用户停留在旧 HTML 而其引用的 chunk 已被清理。刷新即可；`index.html` 设了 `no-cache` 正是为压缩这个窗口。 |

## Cloudflare 注意事项

- 域名开着**橙云代理**，回源是 45.129.8.205。SSL 模式需为 Full 或 Full (strict)，
  Flexible 会与 `:80` 的 301 形成重定向循环。
- **建议关闭该主机名的 Rocket Loader。** 它会把 `<script type="module">` 改写成
  `type="<随机串>-module"` 并注入内联脚本。目前实测四款游戏的动态 chunk 仍能正常
  加载，但这是对 ES 模块的侵入式改写，对已经过 Vite 优化的产物没有收益，属于随时
  可能咬人的隐患。
- 站点 CSP 的 `style-src` 带 `'unsafe-inline'`：本站用 `style={{ "--game-accent": ... }}`
  传 CSS 自定义属性做主题色，去掉会让大厅配色与牌面布局失效。`script-src` 保持 `'self'`。

## 安全边界

- 部署私钥无 passphrase（CI 必须非交互），因此它只对应无 sudo、只能写 `/var/www/cardforge`
  的 `deploy` 用户，且在 `authorized_keys` 中以 `restrict` 收紧（关闭端口转发、agent
  转发、PTY、X11）。已验证该账号无法写 `/etc/nginx`。
- 仓库为 public，但 deploy job 只在 `push` 到 `main` 时运行；fork 发起的 PR 拿不到 secrets。
- 轮换密钥：本机生成新键 → 把新公钥加进服务器 `authorized_keys` → 更新 `DEPLOY_SSH_KEY`
  → 确认一次部署成功后再删掉旧公钥行。
