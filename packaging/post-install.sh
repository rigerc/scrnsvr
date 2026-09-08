#!/bin/sh
set -eu
unit_source=/opt/Scrnsvr/resources/systemd/scrnsvr.service
if [ -f "$unit_source" ]; then
  install -Dm644 "$unit_source" /usr/lib/systemd/user/scrnsvr.service
fi
echo "Scrnsvr installed. To start its idle daemon:"
echo "  systemctl --user daemon-reload"
echo "  systemctl --user enable --now scrnsvr.service"
echo "The service is user-scoped and can be disabled with systemctl --user disable --now scrnsvr.service."
