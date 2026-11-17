#!/usr/bin/env python3
"""Fail closed on known dependency advisories and changed reviewed compatibility forks."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def npm_audit(folder):
    process = subprocess.run(['npm', 'audit', '--json', '--registry=https://registry.npmjs.org'],
                             cwd=folder, text=True, capture_output=True, timeout=180)
    data = json.loads(process.stdout)
    if 'error' in data or 'metadata' not in data:
        raise ValueError('npm advisory lookup failed')
    counts = data['metadata']['vulnerabilities']
    if counts['total'] != 0:
        raise ValueError(f'Unresolved npm advisories: {counts}')
    return {'counts': counts, 'advisories': []}


def osv(component):
    name = component['group'] + ':' + component['name']
    payload = {'package': {'ecosystem': 'Maven', 'name': name}, 'version': component['version']}
    findings = []
    while True:
        request = urllib.request.Request('https://api.osv.dev/v1/query', data=json.dumps(payload).encode(),
                                         headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.load(response)
        if 'error' in data:
            raise ValueError('OSV lookup failed')
        findings.extend(v['id'] for v in data.get('vulns', []) if not v.get('withdrawn'))
        if not data.get('next_page_token'):
            break
        payload['page_token'] = data['next_page_token']
    return {**component, 'advisories': findings}


def verify_forks(worker):
    review = json.loads((ROOT / 'docs/security/compatibility-forks.json').read_text())
    for relative, digest in review['sha256'].items():
        path = worker / 'vendor' / relative
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError(f'Reviewed compatibility fork changed: {relative}')
    actual = {p.relative_to(worker / 'vendor').as_posix() for p in (worker / 'vendor').rglob('*')
              if p.is_file() and p.name != 'README.md' and 'node_modules' not in p.relative_to(worker / 'vendor').parts}
    if actual != set(review['sha256']):
        raise ValueError('Unexpected or missing fork runtime files')
    return review['patched_advisories']


def check(language):
    sdk = ROOT / 'sdks' / language
    worker = sdk / 'tools/greenfield'
    patched = verify_forks(worker)
    worker_audit = npm_audit(worker)
    if language == 'java':
        subprocess.run(['./gradlew', '-I', '../../scripts/runtime-security.init.gradle',
                        'writeRuntimeSecurityInventory', '--console=plain'], cwd=sdk, check=True)
        components = json.loads((sdk / 'build/reports/security/runtime-components.json').read_text())
        bc = [p for p in components if p['group'] == 'org.bouncycastle' and p['name'].startswith('bcprov-')]
        if len(bc) != 1 or bc[0]['name'] != 'bcprov-jdk15to18' or bc[0]['version'] != '1.85':
            raise ValueError('Bouncy Castle provider is duplicated or not the approved version')
        with ThreadPoolExecutor(max_workers=4) as pool:
            runtime = list(pool.map(osv, components))
        if any(p['advisories'] for p in runtime):
            raise ValueError('Unresolved Java runtime advisories: ' + json.dumps(runtime))
        main_audit = {'components': runtime, 'advisory_count': 0}
    else:
        main_audit = npm_audit(sdk)
    report = {'schemaVersion': 1, 'language': language, 'status': 'passed',
              'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'main': main_audit, 'greenfield': worker_audit,
              'locallyPatchedAdvisories': patched,
              'note': 'Registry scans cannot identify local fork fixes; reviewed file hashes and independent regression tests are required.'}
    path = ROOT / 'reports/security' / f'{language}.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2) + '\n')
    print(f'{language}: no unresolved registry advisories; reviewed local fork integrity verified')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--language', required=True, choices=('java', 'typescript'))
    check(parser.parse_args().language)
