## pbh-qbt-helper

这是一个可以在使用 [PeerBanHelper](https://github.com/PBH-BTN/PeerBanHelper) 时加强 [qBittorrent](https://www.qbittorrent.org) 安全性的工具。

## 为什么要使用它？

PeerBanHelper 需要访问下载器的 API 才能正常工作。如果 PeerBanHelper 发生漏洞或执行恶意脚本，下载器就有可能被滥用，从而导致下载器和运行下载器的主机处于危险之中。

## 它如何保证安全？

pbh-qbt-helper 充当一个中间件，PeerBanHelper 发送请求到 pbh-qbt-helper，pbh-qbt-helper 只会放行处于白名单的请求，拦截非白名单的请求。

> pbh-qbt-helper 仅能阻止下载器不被滥用，并不能阻止 PeerBanHelper 不被滥用，如果 PeerBanHelper 存在漏洞，则依然有可能被用于 DDoS 攻击或其他攻击手段，建议使用容器运行 PeerBanHelper，并使用防火墙和容器资源限制加强安全性。

## 如何使用？

这个工具使用 JavaScript 运行时 [Bun](https://bun.sh) 编写，可以支持几乎所有操作系统，但这里不会提供所有系统的使用方法。

如果你使用的是 Linux，并使用 systemd 管理一切，以下是使用方法：

0. 下载并安装 [Bun](https://bun.sh) 到系统。
1. 克隆仓库并运行 `bun run build-bin` 构建可执行文件，或者运行 `bun run build` 构建脚本。
2. 运行 `install -D -m 0755 -T dist/pbh-qbt-helper /usr/local/bin/pbh-qbt-helper` 安装可执行文件或脚本。
3. 运行 `install -D -m 0644 -T misc/pbh-qbt-helper.service /etc/systemd/system/pbh-qbt-helper.service` 安装服务文件。
4. 编辑服务文件 `/etc/systemd/system/pbh-qbt-helper.service` 并添加环境变量配置项（见下文）。
5. 重新加载 systemd 并启动 `pbh-qbt-helper.service`：`systemctl daemon-reload && systemctl enable --now pbh-qbt-helper.service`
6. 修改 PeerBanHelper 的下载器配置，将地址指向 pbh-qbt-helper 的地址。

## 环境变量配置项

**`HTTP_PORT`**: 监听的 HTTP 端口，默认为 19830。

**`QBT_ENDPOINT`**: qBittorrent 的 WebUI 地址，默认为 `http://127.0.0.1:8080`。

**`QBT_CGROUP_LEVEL`**: qBittorrent 的 cgroup v2 层级，用于配合 nftables 使用，默认为 2。

**`QBT_PEER_PORT`**: qBittorrent 的入站端口，用于配合 nftables 使用，默认为 6881。

**`USE_NFTABLES`**: 是否使用 nftables 封禁 IP，默认为 `no`。

## 使用 nftables 封禁 IP

如果你运行 qBittorrent 的操作系统是 Linux，推荐使用 nftables 封禁 IP，可以减轻下载器压力，使用前确保系统上存在 `nft` 命令。

如果要使用 nftables，请将 `USE_NFTABLES` 设置为 `yes`，同时将 `QBT_PEER_PORT` 设置为 qBittorrent 的入站端口。

还需要将 qBittorrent 的 cgroup v2 标识符添加到特定的 nftables set，你可以执行 `systemctl edit pbh-qbt-helper.service` 追加以下配置项让 systemd 自动添加。

```ini
# 仅支持系统级服务，不支持用户级服务。
[Service]
NFTSet=cgroup:inet:pbh_qbt_helper:qbt_services
```

最后，重启 `pbh-qbt-helper.service` 和 `qbittorrent-nox.service`。
