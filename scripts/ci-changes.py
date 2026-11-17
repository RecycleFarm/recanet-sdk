#!/usr/bin/env python3
"""Select SDK checks from event SHAs; unknown or unavailable history runs both."""
import argparse
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SHARED = ('.github/', 'scripts/', 'contracts/', 'tests/ci/', 'docs/security/')
SHARED_FILES = {'Makefile', '.gitignore', 'docs/migration/phase2-public-api-baseline.json'}


def affects(language, paths):
    return any(path.startswith(f'sdks/{language}/') or path.startswith(SHARED)
               or path in SHARED_FILES for path in paths)


def event_paths(event_name, event, diff):
    if event_name == 'workflow_dispatch':
        return None
    if event_name == 'pull_request':
        base = event.get('pull_request', {}).get('base', {}).get('sha')
    elif event_name == 'push':
        base = event.get('before')
    else:
        return None
    if not base or set(base) == {'0'}:
        return None
    try:
        return diff(base)
    except subprocess.CalledProcessError:
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--language', choices=('java', 'typescript'), required=True)
    args = parser.parse_args()
    event_file = os.environ.get('GITHUB_EVENT_PATH')
    event = json.loads(Path(event_file).read_text()) if event_file else {}
    paths = event_paths(os.environ.get('GITHUB_EVENT_NAME'), event, lambda base:
                        subprocess.check_output(['git', 'diff', '--name-only', '-z',
                                                 base, 'HEAD', '--'], cwd=ROOT).decode().split('\0'))
    changed = paths is None or affects(args.language, paths)
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as out:
            out.write(f'changed={str(changed).lower()}\n')
    print(f'{args.language}: checks {"required" if changed else "not needed for changed paths"}')


if __name__ == '__main__':
    main()
