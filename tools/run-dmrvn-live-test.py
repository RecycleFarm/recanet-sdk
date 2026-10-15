#!/usr/bin/env python3
"""Explicit live PET JUnit run. Test-only beneficiary signs locally; Relay uses Privy."""
import os
import pathlib
import runpy
import shutil
import subprocess

root = pathlib.Path(__file__).resolve().parents[1]
values = runpy.run_path(str(root / 'tools/run-dmrvn-diagnostics.py'))['load_env'](root / '.env')
env = os.environ.copy()
for name in ('PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'BACKEND_WALLET_PUBLIC_KEY', 'BACKEND_WALLET_PRIVATE_KEY', 'GREENFIELD_FEE_GRANTER'):
    if name in values:
        env[name] = values[name]
env['GREENFIELD_STORAGE_PRIVATE_KEY'] = values['BACKEND_BLOCKCHAIN_WALLET_PRIVATE_KEY']
env['DMRVN_LIVE_TEST'] = '1'
env.setdefault('GREENFIELD_FEE_GRANTER', '0x812EA1e3fb2EFA004AE1308ed27EcEd0b05Cae66')
env.setdefault('DMRVN_NODE_PATH', shutil.which('node') or '')
env.setdefault('DMRVN_APPROVER_WALLET_ID', 'y2hl7bcafkz4aapnw36dykav')
raise SystemExit(subprocess.call(['./gradlew', 'dmrvnPetLiveTest', '--offline', '--console=plain'], cwd=root, env=env))
