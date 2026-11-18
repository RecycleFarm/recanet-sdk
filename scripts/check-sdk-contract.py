#!/usr/bin/env python3
"""Check exhaustive SDK contract API coverage, signatures, local links and resource parity.

Requires a built Java JAR and the installed TypeScript compiler. This is an API/document
coverage check, not a Java/TypeScript behavioral conformance test. Never rewrites the JSON baseline or SDKs; --render-map
only regenerates the human-readable Markdown table.
"""
import json
import difflib
from pathlib import Path
import re
import subprocess
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def java_surface():
    pom = ET.parse(ROOT / 'sdks/java/build/publications/mavenJava/pom-default.xml').getroot()
    ns = {'m': 'http://maven.apache.org/POM/4.0.0'}
    name = pom.findtext('m:artifactId', namespaces=ns)
    version = pom.findtext('m:version', namespaces=ns)
    jar = ROOT / f'sdks/java/build/libs/{name}-{version}.jar'
    with zipfile.ZipFile(jar) as archive:
        classes = sorted(n[:-6].replace('/', '.') for n in archive.namelist() if n.endswith('.class'))
    output = subprocess.check_output(['javap', '-public', '-constants', '-classpath', str(jar), *classes], text=True)
    result = []
    owner = None
    for line in output.splitlines():
        if line.endswith(' {'):
            match = re.match(r'public .*?(?:class|interface) ([\w.$]+)', line)
            owner = match[1] if match else None
        elif owner and line.strip().startswith('public ') and line.strip().endswith(';'):
            result.append({'owner': owner, 'declaration': line.strip()})
        elif line == '}':
            owner = None
    return result


def typescript_surface():
    return json.loads(subprocess.check_output(['node', str(ROOT / 'scripts/contract-typescript-api.cjs')], text=True))


def validate_inventory(contract, actual_java, actual_ts):
    recorded_java = [{k: row[k] for k in ('owner', 'declaration')} for row in contract['java']]
    assert actual_java == recorded_java, 'Java API drift or missing overload: review api-map.json'
    expected_lines = json.dumps(contract['typescript'], ensure_ascii=False, indent=2).splitlines()
    actual_lines = json.dumps(actual_ts, ensure_ascii=False, indent=2).splitlines()
    assert actual_ts == contract['typescript'], 'TypeScript export/signature drift: review api-map.json\n' + '\n'.join(
        difflib.unified_diff(expected_lines, actual_lines, fromfile='reviewed', tofile='actual', n=2))
    ts_keys = {row['key'] for row in actual_ts}
    assert set(contract['typescriptCoverage']) == ts_keys, 'Unclassified TypeScript API'
    for row in contract['java']:
        assert row['status'] in {'mapped', 'missing', 'language', 'gap'}, row
        assert row['targets'] or row['status'] in {'missing', 'language'}, row
        assert set(row['targets']) <= ts_keys, ('Unknown TypeScript target', row)
        assert row['contract'] and row['note'], row
    for key, row in contract['typescriptCoverage'].items():
        assert row['kind'] in {'mapped', 'binding', 'surface-gap', 'behavior-gap'}, key
        assert row['contract'] and row['note'], key


def render_api_map(contract):
    java, ts = contract['java'], contract['typescript']
    used = {target for row in java for target in row['targets']}
    lines = ['# 전체 공개 API 대응표', '',
             '공통 동작은 [Contract](recanet-sdk-contract.md), 상세 인자·반환·오류는 [API 명세](api-reference.md), 현재 불일치는 [차이 목록](gaps.md)을 따른다. 이 표는 `api-map.json`에서 생성했다. mapped는 공개 API 연결을 뜻하며 동작 준수 판정이 아니다.', '',
             f'Java 공개 선언 {len(java)}개(생성자·overload·상수·record accessor·enum 보조 포함), TypeScript 공개 시그니처 {len(ts)}개를 추적한다. Java Object/Throwable 상속 API와 비공개 최상위 타입은 공통 업무 API에서 제외한다.', '']
    for owner in dict.fromkeys(row['owner'] for row in java):
        lines += ['## ' + owner.rsplit('.', 1)[-1], '',
                  '| Java 정확한 선언 | TypeScript 대응 | 분류 | 계약 |', '| --- | --- | --- | --- |']
        for row in java:
            if row['owner'] != owner:
                continue
            declaration = re.sub(r'(?:com\.youngminkim\.recanet\.(?:dmrvn\.)?|java\.(?:net\.http|util\.function|lang|util|math|net|time|nio\.file)\.)', '', row['declaration'])
            targets = ', '.join('`' + target + '`' for target in row['targets']) or '없음'
            lines.append(f"| `{declaration}` | {targets} | {row['status']} | [규칙]({row['contract']}) |")
        lines.append('')
    lines += ['## Java 대응 없이 공개된 TypeScript API', '',
              '타입 정의와 인자 options도 포함한다. 각 key의 정확한 시그니처·소스와 설명은 api-map.json의 typescript/typescriptCoverage에 있다.', '',
              '| TypeScript 공개 key | 분류 | 계약 |', '| --- | --- | --- |']
    for key, row in contract['typescriptCoverage'].items():
        if key not in used:
            lines.append(f"| `{key}` | {row['kind']} | [규칙]({row['contract']}) |")
    return '\n'.join(lines) + '\n'


def check(render=False):
    contract = json.loads((ROOT / 'contracts/api-map.json').read_text())
    actual_java = java_surface()
    actual_ts = typescript_surface()
    evidence_dir = ROOT / 'reports/contracts'
    evidence_dir.mkdir(parents=True, exist_ok=True)
    (evidence_dir / 'typescript-api.actual.json').write_text(json.dumps(actual_ts, ensure_ascii=False, indent=2) + '\n')
    validate_inventory(contract, actual_java, actual_ts)
    ts_keys = {row['key'] for row in actual_ts}
    rendered = render_api_map(contract)
    map_path = ROOT / 'contracts/api-map.md'
    if render:
        map_path.write_text(rendered)
    assert map_path.read_text() == rendered, 'Human API map is stale; run with --render-map after review'
    for document in (ROOT / 'contracts').glob('*.md'):
        for link in re.findall(r'\]\(([^)]+)\)', document.read_text()):
            if '://' in link or link.startswith('#'):
                continue
            target, _, anchor = link.partition('#')
            destination = (document.parent / target).resolve()
            assert destination.exists(), (document, link)
            if anchor and destination.suffix == '.md':
                assert f'id="{anchor}"' in destination.read_text() or anchor in {
                    re.sub(r'[^\w\- ]', '', line.lstrip('#').strip()).lower().replace(' ', '-')
                    for line in destination.read_text().splitlines() if line.startswith('#')
                }, (document, link)
    for row in [*contract['java'], *contract['typescriptCoverage'].values()]:
        file, anchor = row['contract'].split('#')
        assert f'id="{anchor}"' in (ROOT / 'contracts' / file).read_text(), row['contract']
    resources = ['deployment-testnet.json', 'deployment-direct-v7-testnet.json',
                 'dmrvn-claim-v7.json', 'dmrvn-forwarder.json', 'proxy-admin.json']
    for name in resources:
        assert (ROOT / 'sdks/java/src/main/resources/dmrvn' / name).read_bytes() == (
            ROOT / 'sdks/typescript/src/resources/dmrvn' / name).read_bytes(), name
    print(f'PASS contract coverage: {len(actual_java)} Java declarations, '
          f'{len(actual_ts)} TypeScript signatures, {len(ts_keys)} classified TypeScript symbols/members; '
          'links and 5 shared resources match. Behavior parity is not established by this check.')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--render-map', action='store_true', help='Render Markdown from the reviewed JSON; never changes JSON baseline')
    check(render=parser.parse_args().render_map)
