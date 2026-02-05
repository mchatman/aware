#!/bin/bash
set -e

# Setup gog config symlink if persistent data exists
if [ -d "/data/gogcli" ]; then
    mkdir -p /root/.config
    ln -sf /data/gogcli /root/.config/gogcli
    echo "gog config linked to /data/gogcli"
fi

# Execute the main command
exec "$@"
