#!/bin/sh
set -eu
source_dir=/home/codex/senvia-ai/gateway
install -d -m 755 /opt/senvia-task-ai
install -d -m 700 /etc/senvia-task-ai
if test -f /opt/senvia-task-ai/server.mjs; then cp /opt/senvia-task-ai/server.mjs /opt/senvia-task-ai/server.mjs.backup-$(date +%s); fi
install -m 644 "$source_dir/server.mjs" /opt/senvia-task-ai/server.mjs
install -m 644 "$source_dir/senvia-task-ai.service" /etc/systemd/system/senvia-task-ai.service
if ! test -f /etc/senvia-task-ai/environment; then
  umask 077
  printf 'SENVIA_AI_GATEWAY_KEY=%s\n' "$(openssl rand -hex 32)" > /etc/senvia-task-ai/environment
fi
chmod 600 /etc/senvia-task-ai/environment
conf=$(readlink -f /etc/nginx/sites-enabled/mcp-senvia)
backup="$conf.senvia-ai-backup-$(date +%s)"
cp "$conf" "$backup"
node --input-type=module - "$conf" <<'NODE'
import fs from 'node:fs';
const file = process.argv[2]; const current = fs.readFileSync(file, 'utf8');
if (current.includes('location ^~ /senvia-tasks/')) process.exit(0);
const marker = 'server_name mcp.senvia.pt;';
if (!current.includes(marker)) throw new Error('Expected HTTPS host not found');
const location = `
    location ^~ /senvia-tasks/ {
        client_max_body_size 8k;
        client_body_timeout 10s;
        access_log off;
        proxy_pass http://127.0.0.1:11435;
        proxy_connect_timeout 3s;
        proxy_read_timeout 100s;
        proxy_send_timeout 10s;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
    }
`;
fs.writeFileSync(file, current.replace(marker, marker + location));
NODE
if ! nginx -t; then cp "$backup" "$conf"; exit 1; fi
systemctl daemon-reload
systemctl enable senvia-task-ai
systemctl restart senvia-task-ai
systemctl reload nginx
systemctl is-active senvia-task-ai nginx ollama
