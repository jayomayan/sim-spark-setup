#!/usr/bin/env bash
# Field Ops Console — one-command helper install for Linux.
# Generated in Admin Settings. Paste it on the machine that can reach your routers.
#
#   curl -fsSL https://your-console/helper/install.sh \
#     | sudo bash -s -- --console https://your-console --code <one-time code>
#
# Options:
#   --console URL       console address (required, https)
#   --code CODE         one-time install code (required)
#   --prefix DIR        install folder (default /opt/field-ops-helper)
#   --service NAME      systemd service name (default field-ops-helper)
#   --user NAME         service account (default fieldops)
#   --skip-deps         don't install npm/browser dependencies (offline installs)
set -euo pipefail

CONSOLE_URL="" CODE="" PREFIX="/opt/field-ops-helper" SERVICE="field-ops-helper"
RUN_USER="fieldops" ENV_FILE="/etc/field-ops-helper.env" SKIP_DEPS=0

die() { echo "helper install: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --console) CONSOLE_URL="${2:-}"; shift 2 ;;
    --code) CODE="${2:-}"; shift 2 ;;
    --prefix) PREFIX="${2:-}"; shift 2 ;;
    --service) SERVICE="${2:-}"; shift 2 ;;
    --user) RUN_USER="${2:-}"; shift 2 ;;
    --skip-deps) SKIP_DEPS=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "unknown option $1" ;;
  esac
done

[ -n "$CONSOLE_URL" ] || die "--console is required"
[ -n "$CODE" ] || die "--code is required"
CONSOLE_URL="${CONSOLE_URL%/}"
case "$CONSOLE_URL" in https://*) ;; *) die "the console address must be https://" ;; esac
[ "$(id -u)" -eq 0 ] || die "run this with sudo"

as_user() {
  if command -v runuser >/dev/null 2>&1; then runuser -u "$RUN_USER" -- "$@"
  else su -s /bin/sh "$RUN_USER" -c "$(printf '%q ' "$@")"; fi
}

echo "→ system packages"
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq || true
  apt-get install -y -qq curl ca-certificates snmp iputils-ping || true
fi

node_too_old() {
  ! command -v node >/dev/null 2>&1 ||
  [ "$(node -p 'parseInt(process.versions.node,10)')" -lt 18 ]
}
if node_too_old; then
  echo "→ Node.js 18+ is missing; installing it"
  if command -v apt-get >/dev/null 2>&1; then
    apt-get install -y -qq nodejs npm || true
    if node_too_old; then
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1 || true
      apt-get install -y -qq nodejs || true
    fi
  fi
fi
node_too_old && die "Node.js 18 or newer is required and could not be installed automatically"

echo "→ service account $RUN_USER"
id -u "$RUN_USER" >/dev/null 2>&1 || useradd --system --home "$PREFIX" --shell /usr/sbin/nologin "$RUN_USER"

echo "→ downloading helper from $CONSOLE_URL"
mkdir -p "$PREFIX"
for f in field-ops-helper.mjs router-ssh.mjs package.json README.md; do
  curl -fsSL "$CONSOLE_URL/helper/$f" -o "$PREFIX/$f" || die "could not download $f"
done
chown -R "$RUN_USER:$RUN_USER" "$PREFIX"

echo "→ exchanging the install code for the helper key"
TOKEN="$(curl -fsS -X POST "$CONSOLE_URL/api/public/helper/enroll" \
  -H 'Content-Type: application/json' \
  -d "{\"code\":\"$CODE\"}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s).token;if(t)process.stdout.write(t)}catch{}})')" \
  || true
[ -n "$TOKEN" ] || die "the install code was rejected — generate a new one in Admin Settings"

umask 077
cat > "$ENV_FILE" <<EOF
CONSOLE_URL=$CONSOLE_URL
AGENT_TOKEN=$TOKEN
PLAYWRIGHT_BROWSERS_PATH=$PREFIX/browsers
EOF
chown root:root "$ENV_FILE"; chmod 600 "$ENV_FILE"


if [ "$SKIP_DEPS" -eq 0 ]; then
  echo "→ helper dependencies (this takes a few minutes the first time)"
  as_user npm install --prefix "$PREFIX" --no-audit --no-fund || die "npm install failed"
  npx --prefix "$PREFIX" playwright install-deps chromium >/dev/null 2>&1 || true
  as_user env PLAYWRIGHT_BROWSERS_PATH="$PREFIX/browsers" \
    npx --prefix "$PREFIX" playwright install chromium || die "could not install the screenshot browser"
fi

echo "→ starting the $SERVICE service"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Field Ops Console network helper
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$PREFIX
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $PREFIX/field-ops-helper.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE"
sleep 3
systemctl --no-pager --lines=15 status "$SERVICE" || true
echo
echo "Done. The helper key is saved in $ENV_FILE (visible to root only)."
echo "The status light in Admin Settings turns green within about 15 seconds."
echo "Future releases are downloaded by the helper itself — nothing to reinstall."
