#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
python3 - "$root" <<'PY'
import pathlib, plistlib, subprocess, sys
root = pathlib.Path(sys.argv[1])
home = pathlib.Path.home()
label = 'com.vinh.fightgyms-seo-monitor'
target = home / 'Library/LaunchAgents' / (label + '.plist')
logs = home / 'Library/Logs/fightgyms'
target.parent.mkdir(parents=True, exist_ok=True)
logs.mkdir(parents=True, exist_ok=True)
with target.open('wb') as f:
    plistlib.dump({'Label': label, 'ProgramArguments': ['/bin/sh', str(root / 'ops/seo-monitor/run.sh')],
                  'StartCalendarInterval': {'Weekday': 1, 'Hour': 8, 'Minute': 10},
                  'StandardOutPath': str(logs / 'seo-monitor.log'), 'StandardErrorPath': str(logs / 'seo-monitor.err'),
                  'WorkingDirectory': str(root),
                  'EnvironmentVariables': {'FIGHTGYMS_PYTHON': sys.executable}}, f)
import os
subprocess.run(['launchctl', 'bootout', f'gui/{os.getuid()}/{label}'], capture_output=True)
subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(target)], check=True)
print(target)
PY
