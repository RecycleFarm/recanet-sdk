#!/usr/bin/env python3
"""Create internal release candidates and checksums. This script never publishes."""
import argparse
import gzip
import struct
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
        for name_in_archive in archive.getnames():
            if name_in_archive.startswith('package/docs/') or name_in_archive.endswith('.map'):
                raise ValueError('Internal documentation or source map is in npm candidate')
            if name_in_archive.endswith('.md') and name_in_archive != 'package/README.md':
                raise ValueError('Unapproved documentation is in npm candidate')
        if package.get('os') != ['linux'] or package.get('cpu') != ['x64']:
            raise ValueError('PoC package must restrict installation to Linux x64')
        if 'package/dist/native/posix-lock.node' not in archive.getnames():
            raise ValueError('Native module is missing')
        native = archive.extractfile('package/dist/native/posix-lock.node')
        header = native.read(20) if native else b''
        if len(header) != 20 or header[:6] != b'\x7fELF\x02\x01' or struct.unpack('<H', header[18:20])[0] != 62:
            raise ValueError('Native module is not a Linux x64 ELF binary')
        required = {'package/dist/index.js' , 'package/dist/index.d.ts',
                    'package/dist/native/posix-lock.node', 'package/native/posix-lock.c'}
        if not required.issubset(set(archive.getnames())):
            raise ValueError('Packed package is missing its runtime, types, or native files')


def security_evidence(language):
    path = ROOT / 'reports/security' / f'{language}.json'
    report = json.loads(path.read_text())
    if report.get('status') != 'passed' or report.get('sourceCommit') != git('rev-parse', 'HEAD'):
        raise ValueError('Security evidence is missing, failed, or from another source revision')
    return {'status': 'passed', 'reportSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'unresolvedRegistryAdvisories': 0, 'locallyPatchedAdvisories': report['locallyPatchedAdvisories']}


def bundle_java_worker(sdk, destination):
    worker = sdk / 'tools/greenfield'
    paths = [worker / x for x in ('worker.cjs', 'package.json', 'package-lock.json')]
    paths += sorted(p for p in (worker / 'vendor').rglob('*') if p.is_file() and p.name != 'README.md')
    with (destination / 'greenfield-worker-linux-x64.tar.gz').open('wb') as output:
        with gzip.GzipFile(fileobj=output, mode='wb', mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w') as archive:
                for path in paths:
                    info = archive.gettarinfo(str(path), arcname='greenfield/' + path.relative_to(worker).as_posix())
                    info.mtime = 0; info.uid = 0; info.gid = 0; info.uname = ''; info.gname = ''
                    with path.open('rb') as content:
                        archive.addfile(info, content)


def stage(language, version, output):
    require_main_ancestor()
    sdk = ROOT / 'sdks' / language
    if language == 'java':
        pom, package = java_metadata(sdk)
    else:
        package = json.loads((sdk / 'package.json').read_text())
    validate_version(version, package['version'])
    security = security_evidence(language)
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        # Expected build outputs are ignored by Git; tracked inputs must remain unchanged.
        subprocess.run(['git', 'diff', '--exit-code', 'HEAD', '--'], cwd=ROOT, check=True)
    destination = output / language / version
    destination.mkdir(parents=True, exist_ok=False)
    if language == 'java':
        group, artifact = package['groupId'], package['artifactId']
        layout = destination / 'maven' / group.replace('.', '/') / artifact / version
        layout.mkdir(parents=True)
        for classifier in ('', '-javadoc'):
            filename = f'{artifact}-{version}{classifier}.jar'
            shutil.copyfile(sdk / 'build/libs' / filename, layout / filename)
        shutil.copyfile(pom, layout / f'{artifact}-{version}.pom')
        module = sdk / 'build/publications/mavenJava/module.json'
        metadata = json.loads(module.read_text())
        if any(metadata['component'].get(k) != v for k, v in {'group': group, 'module': artifact, 'version': version}.items()):
            raise ValueError('Gradle module metadata has different coordinates')
        for variant in metadata.get('variants', []):
            if variant.get('attributes', {}).get('org.gradle.docstype') == 'sources':
                raise ValueError('Source JAR variant must not be included')
            for file in variant.get('files', []):
                if Path(file['url']).name != file['url']:
                    raise ValueError('Gradle module URL must be a local artifact filename')
                path = layout / file['url']
                if not path.is_file() or path.name.endswith('-sources.jar'):
                    raise ValueError('Gradle module file reference is missing or forbidden')
                if file.get('sha256') and hashlib.sha256(path.read_bytes()).hexdigest() != file['sha256']:
                    raise ValueError('Gradle module checksum differs from packaged JAR')
        shutil.copyfile(module, layout / f'{artifact}-{version}.module')
        bundle_java_worker(sdk, destination)
        blockers = ['Actual publication has not been approved']
        if not re.fullmatch(r'[a-z0-9-]+', artifact):
            raise ValueError('Maven artifactId must be lowercase')
    else:
        result = subprocess.check_output(['npm', 'pack', '--json', '--pack-destination',
                                          str(destination.resolve())], cwd=sdk, text=True)
        packed = json.loads(result)
        if len(packed) != 1:
            raise ValueError('Expected exactly one npm tarball')
        tarball = destination / packed[0]['filename']
        verify_npm_tarball(tarball, package['name'], version)
        package = {key: package.get(key) for key in ('name', 'version', 'private', 'engines', 'exports')}
        blockers = ['Actual publication has not been approved',
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
        'package': package, 'security': security, 'pocPlatforms': ['linux-x64'], 'sourceJarIncluded': False, 'internalDocumentationIncluded': False, 'sourceMapsIncluded': False, 'published': False, 'publishReady': False, 'blockers': blockers,
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
