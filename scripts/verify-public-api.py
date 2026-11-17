#!/usr/bin/env python3
"""Compare built Java public declarations and TypeScript declarations to source baselines."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def fingerprint(java_jar, typescript_dist, language="all"):
    result = {}
    if language in ("all", "java"):
        result["java"] = java_fingerprint(java_jar)
    if language in ("all", "typescript"):
        result["typescript"] = typescript_fingerprint(typescript_dist)
    return result


def java_fingerprint(java_jar):
    with zipfile.ZipFile(java_jar) as archive:
        classes = sorted(name[:-6].replace('/', '.') for name in archive.namelist()
                         if name.endswith('.class') and name != 'module-info.class')
    if not classes:
        raise SystemExit('Java JAR has no class files; run make build first')
    declarations = subprocess.check_output(
        ['javap', '-public', '-constants', '-classpath', str(java_jar), *classes], text=True)
    return {'class_count': len(classes), 'classes': classes,
            'public_declarations_sha256': hashlib.sha256(declarations.encode()).hexdigest()}


def typescript_fingerprint(typescript_dist):
    types = sorted(typescript_dist.rglob('*.d.ts'))
    if not types:
        raise SystemExit('TypeScript declarations are missing; run make build first')
    return {path.relative_to(typescript_dist).as_posix():
            hashlib.sha256(path.read_bytes()).hexdigest() for path in types}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java-jar', type=Path,
                        default=ROOT / 'sdks/java/build/libs/RecanetJava-0.1.0-SNAPSHOT.jar')
    parser.add_argument('--typescript-dist', type=Path, default=ROOT / 'sdks/typescript/dist')
    parser.add_argument("--language", choices=("all", "java", "typescript"), default="all")
    args = parser.parse_args()
    baseline = json.loads((ROOT / 'docs/migration/phase2-public-api-baseline.json').read_text())
    actual = fingerprint(args.java_jar, args.typescript_dist, args.language)
    if actual != {language: baseline['fingerprints'][language] for language in actual}:
        raise SystemExit('Public API/declarations differ from the original SDK baseline')
    if "java" in actual:
        print(f'Java public declarations unchanged ({actual["java"]["class_count"]} class entries).')
    if "typescript" in actual:
        print(f'TypeScript declarations unchanged ({len(actual["typescript"])} files).')


if __name__ == '__main__':
    main()
