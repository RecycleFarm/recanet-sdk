#!/usr/bin/env python3
"""Create internal release candidates and checksums. This script never publishes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tarfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SEMVER = re.compile(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)'
                    r'(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)'
                    r'(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?'
                    r'(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?')


def validate_version(expected, actual):
    if not SEMVER.fullmatch(expected):
        raise ValueError('Version must be an exact SemVer string without a v prefix')
    if expected != actual:
        raise ValueError(f'Requested version {expected!r} differs from package version {actual!r}')


def requested_version(language, explicit=None, event_name=None, event=None, ref=None):
    event_name = event_name or os.environ.get('GITHUB_EVENT_NAME')
    ref = ref or os.environ.get('GITHUB_REF', '')
    if event is None:
        event_path = os.environ.get('GITHUB_EVENT_PATH')
        event = json.loads(Path(event_path).read_text()) if event_path else {}
    if event_name == 'push':
        prefix = f'refs/tags/{language}-v'
        if not ref.startswith(prefix):
            raise ValueError('Release push must be a language-specific version tag')
        result = ref[len(prefix):]
        if explicit is not None and explicit != result:
            raise ValueError('CLI version cannot override the tag')
        return result
    if event_name == 'workflow_dispatch':
        result = event.get('inputs', {}).get('version')
        if not result or (explicit is not None and explicit != result):
            raise ValueError('Manual workflow version is missing or inconsistent')
        return result
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        raise ValueError('Only version tags and manual workflows may stage a release')
    if explicit is None:
        raise ValueError('Local staging requires --version')
    return explicit


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def require_main_ancestor():
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        subprocess.run(['git', 'merge-base', '--is-ancestor', 'HEAD', 'origin/main'],
                       cwd=ROOT, check=True)


def java_metadata(sdk):
    pom = sdk / 'build/publications/mavenJava/pom-default.xml'
    document = ET.parse(pom).getroot()
    ns = {'m': 'http://maven.apache.org/POM/4.0.0'}
    return pom, {key: document.findtext(f'm:{key}', namespaces=ns)
                 for key in ('groupId', 'artifactId', 'version')}


def verify_npm_tarball(path, name, version):
    with tarfile.open(path, 'r:gz') as archive:
        member = archive.extractfile('package/package.json')
        if member is None:
            raise ValueError('Packed package manifest is missing')
        package = json.load(member)
        if package.get('name') != name or package.get('version') != version:
            raise ValueError('Packed package metadata differs from the release version')
        required = {'package/dist/index.js', 'package/dist/index.d.ts',
                    'package/dist/native/posix-lock.node', 'package/native/posix-lock.c'}
        if not required.issubset(set(archive.getnames())):
            raise ValueError('Packed package is missing its runtime, types, or native files')


def stage(language, version, output):
    require_main_ancestor()
    sdk = ROOT / 'sdks' / language
    if language == 'java':
        pom, package = java_metadata(sdk)
    else:
        package = json.loads((sdk / 'package.json').read_text())
    validate_version(version, package['version'])
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        # Expected build outputs are ignored by Git; tracked inputs must remain unchanged.
        subprocess.run(['git', 'diff', '--exit-code', 'HEAD', '--'], cwd=ROOT, check=True)
    destination = output / language / version
    destination.mkdir(parents=True, exist_ok=False)
    if language == 'java':
        group, artifact = package['groupId'], package['artifactId']
        layout = destination / 'maven' / group.replace('.', '/') / artifact / version
        layout.mkdir(parents=True)
        for classifier in ('', '-sources', '-javadoc'):
            filename = f'{artifact}-{version}{classifier}.jar'
            shutil.copyfile(sdk / 'build/libs' / filename, layout / filename)
        shutil.copyfile(pom, layout / f'{artifact}-{version}.pom')
        module = sdk / 'build/publications/mavenJava/module.json'
        metadata = json.loads(module.read_text())
        if metadata['component']['version'] != version:
            raise ValueError('Gradle module metadata has a different version')
        shutil.copyfile(module, layout / f'{artifact}-{version}.module')
        blockers = ['Publication intentionally disabled in Phase 3']
        if not re.fullmatch(r'[a-z0-9-]+', artifact):
            blockers.append('Maven artifactId must be lowercase before GitHub Packages publication')
    else:
        result = subprocess.check_output(['npm', 'pack', '--json', '--pack-destination',
                                          str(destination.resolve())], cwd=sdk, text=True)
        packed = json.loads(result)
        if len(packed) != 1:
            raise ValueError('Expected exactly one npm tarball')
        tarball = destination / packed[0]['filename']
        verify_npm_tarball(tarball, package['name'], version)
        package = {key: package.get(key) for key in ('name', 'version', 'private', 'engines', 'exports')}
        blockers = ['Publication intentionally disabled in Phase 3',
                    'Native tarball is specific to the recorded build OS/architecture']
        if package.get('private'):
            blockers.append('package.json is private; publication requires a separate approved change')
        if not package['name'].startswith('@recyclefarm/'):
            blockers.append('GitHub npm package scope/name has not been finalized')
    manifest = {
        'schemaVersion': 1, 'language': language, 'version': version,
        'sourceCommit': git('rev-parse', 'HEAD'), 'sourceRef': os.environ.get('GITHUB_REF'),
        'repository': os.environ.get('GITHUB_REPOSITORY', 'RecycleFarm/recanet-sdk'),
        'workflow': os.environ.get('GITHUB_WORKFLOW'), 'runId': os.environ.get('GITHUB_RUN_ID'),
        'runAttempt': os.environ.get('GITHUB_RUN_ATTEMPT'),
        'buildPlatform': {'os': platform.system(), 'architecture': platform.machine(),
                          'node': subprocess.check_output(['node', '--version'], text=True).strip()},
        'package': package, 'published': False, 'publishReady': False, 'blockers': blockers,
    }
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    checksums = []
    for path in sorted(destination.rglob('*')):
        if path.is_file():
            checksums.append(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  '
                             f'{path.relative_to(destination).as_posix()}')
    (destination / 'SHA256SUMS').write_text('\n'.join(checksums) + '\n')
    print(f'Internal candidate staged at {destination}; publication disabled')
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--language', choices=('java', 'typescript'), required=True)
    parser.add_argument('--version')
    parser.add_argument('--output', type=Path, default=ROOT / 'staging')
    args = parser.parse_args()
    stage(args.language, requested_version(args.language, args.version), args.output)


if __name__ == '__main__':
    main()
