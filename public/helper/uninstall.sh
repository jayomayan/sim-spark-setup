#!/usr/bin/env bash
# Removes the Field Ops Console helper service and its files.
#   curl -fsSL https://your-console/helper/uninstall.sh | sudo bash
set -euo pipefail

SERVICE="${SERVICE:-field-ops-helper}"
PREFIX="${PREFIX:-/opt/field-ops-helper}"
RUN_USER="${RUN_USER:-fieldops}"
ENV_FILE="${ENV_FILE:-/etc/field-ops-helper.env}"
[ "$(id -u)" -eq 0 ] || { echo "run this with sudo" >&2; exit 1; }

systemctl disable --now "$SERVICE" 2>/dev/null || true
rm -f "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
rm -rf "$PREFIX" "$ENV_FILE"
id -u "$RUN_USER" >/dev/null 2>&1 && userdel "$RUN_USER" 2>/dev/null || true
echo "Removed the $SERVICE service, $PREFIX and $ENV_FILE."
echo "The helper key still lives in the console; reset it in Admin Settings if this machine is being retired."
