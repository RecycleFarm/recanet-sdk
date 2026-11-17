import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


changes = load('changes', 'scripts/ci-changes.py')
release = load('release', 'scripts/stage-release.py')


class ChangeSelection(unittest.TestCase):
    def test_sdk_changes_are_independent(self):
        for language, other in [('java', 'typescript'), ('typescript', 'java')]:
            with self.subTest(language=language):
                self.assertTrue(changes.affects(language, [f'sdks/{language}/src/file']))
                self.assertFalse(changes.affects(other, [f'sdks/{language}/src/file']))

    def test_shared_changes_run_both(self):
        for path in ['.github/workflows/java-ci.yml', 'scripts/stage-release.py',
                     'contracts/vector.json', 'tests/ci/test_workflow_rules.py',
                     'Makefile', '.gitignore', 'docs/security/compatibility-forks.json', 'docs/migration/phase2-public-api-baseline.json']:
            for language in ['java', 'typescript']:
                with self.subTest(path=path, language=language):
                    self.assertTrue(changes.affects(language, [path]))

    def test_docs_and_empty_diffs_do_not_run_sdk_builds(self):
        self.assertFalse(changes.affects('java', ['docs/release-guide.md', 'README.md']))
        self.assertFalse(changes.affects('typescript', []))

    def test_event_base_is_selected_and_git_failure_runs_all(self):
        self.assertEqual(changes.event_paths('pull_request', {'pull_request': {'base': {'sha': 'abc'}}},
                                            lambda base: [base]), ['abc'])
        self.assertEqual(changes.event_paths('push', {'before': 'def'}, lambda base: [base]), ['def'])
        def failure(base):
            raise subprocess.CalledProcessError(128, ['git'])
        self.assertIsNone(changes.event_paths('push', {'before': 'abc'}, failure))

    def test_manual_new_branch_and_unknown_events_run_all(self):
        for event, payload in [('workflow_dispatch', {}), ('push', {'before': '0' * 40}),
                               ('pull_request', {}), ('unknown', {})]:
            self.assertIsNone(changes.event_paths(event, payload, lambda base: []))


class ReleaseVersion(unittest.TestCase):
    def test_valid_semver_including_current_snapshot(self):
        for version in ['0.1.0', '0.1.0-rc.1', '1.2.3-rc.1', '1.2.3+build.5']:
            release.validate_version(version, version)

    def test_malformed_or_different_package_version_fails(self):
        for version in ['v1.0.0', '01.0.0', '1.0', '../x', '1.0.0-01', '1.0.0;echo x']:
            with self.subTest(version=version), self.assertRaises(ValueError):
                release.validate_version(version, version)
        with self.assertRaises(ValueError):
            release.validate_version('1.0.0', '0.1.0')

    def test_tag_language_and_version_cannot_be_overridden(self):
        self.assertEqual(release.requested_version('java', event_name='push', event={},
                         ref='refs/tags/java-v0.1.0-rc.1'), '0.1.0-rc.1')
        with self.assertRaises(ValueError):
            release.requested_version('java', event_name='push', event={},
                                      ref='refs/tags/typescript-v0.1.0')
        with self.assertRaises(ValueError):
            release.requested_version('java', '9.0.0', event_name='push', event={},
                                      ref='refs/tags/java-v0.1.0')

    def test_manual_input_is_required_and_bound(self):
        self.assertEqual(release.requested_version('typescript', event_name='workflow_dispatch',
                         event={'inputs': {'version': '0.1.0'}}), '0.1.0')
        with self.assertRaises(ValueError):
            release.requested_version('typescript', event_name='workflow_dispatch', event={})
        with self.assertRaises(ValueError):
            release.requested_version('java', '9.0.0', event_name='workflow_dispatch',
                                      event={'inputs': {'version': '0.1.0'}})

    def test_unexpected_actions_event_is_rejected(self):
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'true'}), self.assertRaises(ValueError):
            release.requested_version('java', '0.1.0', event_name='pull_request', event={})

    def test_non_main_commit_is_rejected_before_staging(self):
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'true'}), patch.object(
                release.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'git')):
            with self.assertRaises(subprocess.CalledProcessError):
                release.require_main_ancestor()


class JavaStaging(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.sdk = self.root / 'sdks/java'
        (self.sdk / 'build/libs').mkdir(parents=True)
        self.metadata = self.sdk / 'build/publications/mavenJava'
        self.metadata.mkdir(parents=True)
        (self.metadata / 'pom-default.xml').write_text('''<project xmlns="http://maven.apache.org/POM/4.0.0">
            <groupId>com.example</groupId><artifactId>recanet-java</artifactId>
            <version>0.1.0-rc.1</version></project>''')
        (self.metadata / 'module.json').write_text(json.dumps({'component': {'group': 'com.example', 'module': 'recanet-java', 'version': '0.1.0-rc.1'}}))
        for suffix in ['', '-javadoc']:
            (self.sdk / 'build/libs' / f'recanet-java-0.1.0-rc.1{suffix}.jar').write_bytes(b'fixture')
        worker = self.sdk / 'tools/greenfield'
        worker.mkdir(parents=True)
        for name in ['worker.cjs', 'package.json', 'package-lock.json']:
            (worker / name).write_text('{}')
        reports = self.root / 'reports/security'; reports.mkdir(parents=True)
        (reports / 'java.json').write_text(json.dumps({'status': 'passed', 'sourceCommit': 'a' * 40, 'locallyPatchedAdvisories': []}))
        self.patches = [patch.object(release, 'ROOT', self.root),
                        patch.object(release, 'git', return_value='a' * 40),
                        patch.object(release.subprocess, 'check_output', return_value='v22.23.5\n'),
                        patch.dict(os.environ, {'GITHUB_ACTIONS': 'false'})]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def test_complete_maven_layout_and_checksummed_manifest(self):
        result = release.stage('java', '0.1.0-rc.1', self.root / 'out')
        manifest = json.loads((result / 'manifest.json').read_text())
        self.assertFalse(manifest['published'])
        self.assertFalse(manifest['publishReady'])
        self.assertFalse(list(result.rglob('*-sources.jar')))
        self.assertTrue((result / 'greenfield-worker-linux-x64.tar.gz').exists())
        sums = (result / 'SHA256SUMS').read_text().splitlines()
        self.assertEqual(len(sums), 6)  # 2 JARs, POM, module, worker bundle, manifest
        for entry in sums:
            digest, path = entry.split('  ')
            self.assertEqual(digest, hashlib.sha256((result / path).read_bytes()).hexdigest())

    def test_version_mismatch_does_not_create_output(self):
        with self.assertRaises(ValueError):
            release.stage('java', '1.0.0', self.root / 'out')
        self.assertFalse((self.root / 'out').exists())

    def test_incomplete_or_mismatched_metadata_is_rejected(self):
        (self.metadata / 'module.json').write_text(json.dumps({'component': {'version': '9.0.0'}}))
        with self.assertRaises(ValueError):
            release.stage('java', '0.1.0-rc.1', self.root / 'out')

    def test_worker_bundle_excludes_generated_modules(self):
        cache = self.sdk / 'tools/greenfield/vendor/elliptic/node_modules/example'
        cache.mkdir(parents=True); (cache / 'index.js').write_text('fixture')
        result = release.stage('java', '0.1.0-rc.1', self.root / 'out')
        with tarfile.open(result / 'greenfield-worker-linux-x64.tar.gz') as archive:
            self.assertFalse(any('/node_modules/' in name for name in archive.getnames()))

    def test_existing_candidate_is_not_overwritten(self):
        release.stage('java', '0.1.0-rc.1', self.root / 'out')
        with self.assertRaises(FileExistsError):
            release.stage('java', '0.1.0-rc.1', self.root / 'out')


    def test_stale_security_proof_blocks_candidate(self):
        (self.root / 'reports/security/java.json').write_text(json.dumps({'status': 'passed', 'sourceCommit': 'b' * 40}))
        with self.assertRaises(ValueError):
            release.stage('java', '0.1.0-rc.1', self.root / 'out')

    def test_sources_variant_is_rejected(self):
        (self.metadata / 'module.json').write_text(json.dumps({'component': {'group': 'com.example', 'module': 'recanet-java', 'version': '0.1.0-rc.1'}, 'variants': [{'attributes': {'org.gradle.docstype': 'sources'}}]}))
        with self.assertRaises(ValueError):
            release.stage('java', '0.1.0-rc.1', self.root / 'out')


class NpmTarball(unittest.TestCase):
    def pack(self, directory, version='0.1.0', include_native=True):
        path = Path(directory) / 'fixture.tgz'
        with tarfile.open(path, 'w:gz') as archive:
            entries = {'package/package.json': json.dumps({'name': '@recyclefarm/recanet-sdk', 'version': version, 'os': ['linux'], 'cpu': ['x64']}).encode(),
                       'package/dist/index.js': b'export {};', 'package/dist/index.d.ts': b'export {};',
                       'package/native/posix-lock.c': b'/* fixture */'}
            if include_native:
                entries['package/dist/native/posix-lock.node'] = b'\x7fELF\x02\x01' + b'\x00' * 12 + b'\x3e\x00'
            for name, data in entries.items():
                item = tarfile.TarInfo(name); item.size = len(data)
                archive.addfile(item, io.BytesIO(data))
        return path

    def test_pack_requires_matching_metadata_and_native_files(self):
        with tempfile.TemporaryDirectory() as directory:
            release.verify_npm_tarball(self.pack(directory), '@recyclefarm/recanet-sdk', '0.1.0')
            with self.assertRaises(ValueError):
                release.verify_npm_tarball(self.pack(directory, version='9.0.0'), '@recyclefarm/recanet-sdk', '0.1.0')
            with self.assertRaises(ValueError):
                release.verify_npm_tarball(self.pack(directory, include_native=False), '@recyclefarm/recanet-sdk', '0.1.0')


if __name__ == '__main__':
    unittest.main()
