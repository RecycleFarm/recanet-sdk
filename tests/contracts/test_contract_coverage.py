"""Regression checks that incomplete API contracts cannot pass the coverage gate."""
import copy
import json
from pathlib import Path
import runpy
import unittest

ROOT = Path(__file__).resolve().parents[2]
VALIDATE = runpy.run_path(str(ROOT / 'scripts/check-sdk-contract.py'))['validate_inventory']
BASELINE = json.loads((ROOT / 'contracts/api-map.json').read_text())
JAVA = [{key: row[key] for key in ('owner', 'declaration')} for row in BASELINE['java']]
TS = BASELINE['typescript']


class ContractCoverageTest(unittest.TestCase):
    def test_complete_inventory(self):
        VALIDATE(BASELINE, JAVA, TS)

    def test_removed_java_overload_is_rejected(self):
        contract = copy.deepcopy(BASELINE)
        row = next(r for r in contract['java'] if r['member'] == 'submitActivity')
        contract['java'].remove(row)
        with self.assertRaisesRegex(AssertionError, 'missing overload'):
            VALIDATE(contract, JAVA, TS)

    def test_new_typescript_export_without_contract_is_rejected(self):
        contract = copy.deepcopy(BASELINE)
        actual = [*TS, {'key': 'NewPublicFeature', 'signature': '(): void', 'source': 'new.ts'}]
        contract['typescript'] = actual
        with self.assertRaisesRegex(AssertionError, 'Unclassified TypeScript API'):
            VALIDATE(contract, JAVA, actual)

    def test_nonexistent_typescript_method_cannot_be_mapped(self):
        contract = copy.deepcopy(BASELINE)
        contract['java'][0]['targets'] = ['AssetClient.nonexistent']
        with self.assertRaisesRegex(AssertionError, 'Unknown TypeScript target'):
            VALIDATE(contract, JAVA, TS)

    def test_signature_or_optional_property_change_is_rejected(self):
        actual = copy.deepcopy(TS)
        prop = next(row for row in actual if row.get('optional'))
        prop['optional'] = False
        with self.assertRaisesRegex(AssertionError, 'signature drift'):
            VALIDATE(BASELINE, JAVA, actual)


if __name__ == '__main__':
    unittest.main()
