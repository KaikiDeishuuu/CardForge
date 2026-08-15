#!/usr/bin/env bash
#
# CardForge 服务器初始化。以 root 在**服务器上**运行，可重复执行。
#
#   sudo ./server-setup.sh <域名> "<部署公钥>"
#
# 本脚本按 game.farc.dev 实际部署的形态编写：复用宿主机**已有的 nginx**，
# 不安装任何新的 web 服务器，也不抢占 80/443。
#
# 它做这些事：建无 sudo 的 deploy 用户、建站点目录、装 rsync、写入本站的
# nginx 配置、用 certbot 签证书。它**不会**自动修改 SNI/stream 路由——
# 那一步风险最高，由脚本最后打印出来由人确认后手工执行。

set -euo pipefail

DOMAIN="${1:-}"
DEPLOY_PUBKEY="${2:-}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
SITE_ROOT="${SITE_ROOT:-/var/www/cardforge}"
TLS_PORT="${TLS_PORT:-8446}"
ACME_WEBROOT="${ACME_WEBROOT:-/var/www/letsencrypt}"

if [[ -z "$DOMAIN" || -z "$DEPLOY_PUBKEY" ]]; then
  echo "用法: sudo $0 <域名> \"<部署公钥>\"" >&2
  exit 64
fi
[[ $EUID -eq 0 ]] || { echo "需要 root：请用 sudo 运行。" >&2; exit 1; }
command -v nginx >/dev/null || { echo "未找到 nginx。本脚本复用已有 nginx，不会替你安装。" >&2; exit 1; }

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP=$(date +%Y%m%d%H%M%S)

echo "==> 0/5 备份 nginx 配置"
tar czf "/root/nginx-backup-$STAMP.tar.gz" /etc/nginx 2>/dev/null
echo "    /root/nginx-backup-$STAMP.tar.gz"

echo "==> 1/5 部署用户 $DEPLOY_USER"
id "$DEPLOY_USER" &>/dev/null \
  || adduser --system --group --shell /bin/bash --home "/home/$DEPLOY_USER" "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
auth="/home/$DEPLOY_USER/.ssh/authorized_keys"
touch "$auth"
# restrict 关掉端口转发/agent 转发/PTY/X11，只留 rsync 与切链接所需能力。
grep -qF "$DEPLOY_PUBKEY" "$auth" 2>/dev/null || printf 'restrict %s\n' "$DEPLOY_PUBKEY" >> "$auth"
chown "$DEPLOY_USER:$DEPLOY_USER" "$auth"; chmod 600 "$auth"

echo "==> 2/5 站点目录与 rsync"
command -v rsync >/dev/null || { apt-get update -qq; apt-get install -y -qq rsync; }
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SITE_ROOT" "$SITE_ROOT/releases"
if [[ ! -e "$SITE_ROOT/current" ]]; then
  install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SITE_ROOT/releases/bootstrap"
  echo '<!doctype html><meta charset="utf-8"><title>CardForge</title><p>等待首次部署。</p>' \
    > "$SITE_ROOT/releases/bootstrap/index.html"
  chown "$DEPLOY_USER:$DEPLOY_USER" "$SITE_ROOT/releases/bootstrap/index.html"
  ln -sfn releases/bootstrap "$SITE_ROOT/current.tmp"
  mv -Tf "$SITE_ROOT/current.tmp" "$SITE_ROOT/current"
  chown -h "$DEPLOY_USER:$DEPLOY_USER" "$SITE_ROOT/current"
fi

echo "==> 3/5 nginx :80 配置（ACME + 跳转）并签发证书"
install -d -m 755 -o www-data -g www-data "$ACME_WEBROOT"
sed "s|__DOMAIN__|$DOMAIN|g" "$script_dir/nginx/cardforge-http.conf" \
  | sed "s|game\.farc\.dev|$DOMAIN|g" > /etc/nginx/conf.d/cardforge-http.conf
nginx -t && systemctl reload nginx

if [[ ! -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
  certbot certonly --webroot -w "$ACME_WEBROOT" -d "$DOMAIN" \
    --non-interactive --agree-tos --register-unsafely-without-email
else
  echo "    证书已存在，跳过签发。"
fi

echo "==> 4/5 nginx TLS 配置（回环 $TLS_PORT）"
sed -e "s|game\.farc\.dev|$DOMAIN|g" -e "s|127\.0\.0\.1:8446|127.0.0.1:$TLS_PORT|g" \
  -e "s|/var/www/cardforge|$SITE_ROOT|g" \
  "$script_dir/nginx/cardforge-tls.conf" > /etc/nginx/conf.d/cardforge-tls.conf
nginx -t && systemctl reload nginx

echo "==> 5/5 完成"
cat <<SUMMARY

站点根目录 : $SITE_ROOT/current -> $(readlink "$SITE_ROOT/current")
部署用户   : $DEPLOY_USER（无 sudo）
TLS 后端   : 127.0.0.1:$TLS_PORT

【需要你手工确认的最后一步】
这台机器的 :443 由 nginx stream 按 SNI 分流（/etc/nginx/stream.d/*.conf），
其中 default 指向代理服务。脚本**刻意不自动改它**。请在 map 中新增一行、
并补一个 upstream，注意保持 default 原样：

    map \$ssl_preread_server_name \$sni_upstream {
        ...
        $DOMAIN       cardforge;      # <= 新增
        default       xray_reality;   # <= 保持不变
    }

    upstream cardforge {              # <= 新增
        server 127.0.0.1:$TLS_PORT;
    }

改完执行：nginx -t && systemctl reload nginx
验证每个 SNI 落到正确后端：
    for s in $DOMAIN <其他域名> unknown.example.com; do
      echo | openssl s_client -connect 127.0.0.1:443 -servername \$s 2>/dev/null \\
        | openssl x509 -noout -subject
    done

如果宿主机的 :443 是普通 nginx（没有 stream 分流），则把 cardforge-tls.conf
里的 listen 改成 443 ssl 即可，不需要这一步。
SUMMARY
