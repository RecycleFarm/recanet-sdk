#!/usr/bin/env python3
"""Check the immutable Phase 2 import baseline without changing Git state."""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True).strip()


def main():
    manifest = json.loads((ROOT / 'docs/migration/phase2-source-manifest.json').read_text())
    for language, source in manifest['sources'].items():
        prefix = source['prefix']
        actual = git('rev-parse', f'{manifest["integration_commit"]}:{prefix}')
        if actual != source['tree']:
            raise SystemExit(f'{language}: committed SDK tree differs from original baseline')
        for original, preserved in source['preserved_refs'].items():
            if git('rev-parse', preserved) != source['refs'][original]:
                raise SystemExit(f'{language}: original ref was not preserved: {preserved}')
        git('merge-base', '--is-ancestor', source['head'], 'HEAD')
        git('merge-base', '--is-ancestor', manifest['integration_commit'], 'HEAD')
        print(f'{language}: original refs, ancestry, and frozen import tree preserved '
              f'({source["tracked_file_count"]} files)')
    print('Frozen Phase 2 import snapshot and ancestry verified; current SDK evolution is allowed.')


if __name__ == '__main__':
    main()
