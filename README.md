## pbh-qbt-helper

这是一个用于在使用 PeerBanHelper 时增强 qBittorrent 安全性的工具。

## 为什么要使用它？

PeerBanHelper 需要访问下载器的 API 才能正常工作。如果 PeerBanHelper 发生漏洞或执行恶意脚本，下载器就有可能被滥用，从而导致下载器和运行下载器的主机处于危险之中。

## 它如何保证安全？

pbh-qbt-helper 充当一个中间件，PBH 发送请求到 PQH，PQH 只会放行处于白名单的请求，拦截非白名单的请求。

## 如何使用？

这个工具使用 JavaScript 运行时 Bun 编写，可以支持几乎所有操作系统，但是我不会提供所有系统的使用教程。

如果你使用的是 Linux，并且使用 systemd 管理一切，以下是基于 systemd 系统的使用方法：

1. 克隆本仓库并执行 `bun run build` 编译脚本。
2. 将编译好的脚本 `dist/pbh-qbt-helper` 移动至 `/usr/local/bin/pbh-qbt-helper`，不要忘了添加执行权限。
3. 复制 service 文件 `misc/pbh-qbt-helper.service` 到 `/etc/systemd/system/pbh-qbt-helper.service`
4. 编辑 service 文件并添加配置项环境变量（见下文）。
5. 启动 `pbh-qbt-helper.service`

## 配置项

**`HTTP_PORT`**: 监听的 HTTP 端口，默认为 19830。

**`QBT_ENDPOINT`**: qBittorrent 的 WebUI 地址，默认为 `http://127.0.0.1:8080`。

**`QBT_CGROUP_LEVEL`**: qBittorrent 的 cgroup v2 层级，用于配合 nftables 使用，默认为 2。

**`QBT_PEER_PORT`**: qBittorrent 的入站端口，用于配合 nftables 使用，默认为 6881。

**`USE_NFTABLES`**: 是否使用 nftables 封禁 IP，默认为 `no`。

## 使用 nftables 封禁 IP

如果你运行 qBittorrent 的操作系统是 Linux，推荐使用 nftables 封禁 IP，可以减轻下载器压力。

如果要使用 nftables，请将 `USE_NFTABLES` 设置为 `yes`，同时将 `QBT_PEER_PORT` 设置为 qBittorrent 的入站端口。

以及将 qBittorrent 的 cgroup v2 标识符添加到制定的 nftables set，你可以执行 `systemctl edit pbh-qbt-helper.service` 追加以下配置项让 systemd 自动添加。

```ini
# 仅支持系统级服务，不支持用户级服务。
[Service]
NFTSet=cgroup:inet:pbh_qbt_helper:qbt_services
```

最后，重启 `pbh-qbt-helper.service` 和 `qbittorrent-nox.service`。
