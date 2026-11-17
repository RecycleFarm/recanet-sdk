#!/usr/bin/env python3
"""Compare built Java public declarations and TypeScript declarations to source baselines."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def fingerprint(java_jar, typescript_dist):
    with zipfile.ZipFile(java_jar) as archive:
        classes = sorted(name[:-6].replace('/', '.') for name in archive.namelist()
                         if name.endswith('.class') and name != 'module-info.class')
    if not classes:
        raise SystemExit('Java JAR has no class files; run make build first')
    declarations = subprocess.check_output(
        ['javap', '-public', '-constants', '-classpath', str(java_jar), *classes], text=True)
    types = sorted(typescript_dist.rglob('*.d.ts'))
    if not types:
        raise SystemExit('TypeScript declarations are missing; run make build first')
    return {
        'java': {'class_count': len(classes), 'classes': classes,
                 'public_declarations_sha256': hashlib.sha256(declarations.encode()).hexdigest()},
        'typescript': {path.relative_to(typescript_dist).as_posix():
                       hashlib.sha256(path.read_bytes()).hexdigest() for path in types},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java-jar', type=Path,
                        default=ROOT / 'sdks/java/build/libs/RecanetJava-0.1.0-SNAPSHOT.jar')
    parser.add_argument('--typescript-dist', type=Path, default=ROOT / 'sdks/typescript/dist')
    args = parser.parse_args()
    baseline = json.loads((ROOT / 'docs/migration/phase2-public-api-baseline.json').read_text())
    actual = fingerprint(args.java_jar, args.typescript_dist)
    if actual != baseline['fingerprints']:
        raise SystemExit('Public API/declarations differ from the original SDK baseline')
    print(f'Java public declarations unchanged ({actual["java"]["class_count"]} class entries).')
    print(f'TypeScript declarations unchanged ({len(actual["typescript"])} files).')


if __name__ == '__main__':
    main()
