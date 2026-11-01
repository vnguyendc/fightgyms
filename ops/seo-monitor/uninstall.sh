#!/bin/sh
set -eu
label=com.vinh.fightgyms-seo-monitor
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$label.plist"
