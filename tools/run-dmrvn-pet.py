#!/usr/bin/env python3
"""Explicit PET testnet runner. Existing local storage key is used only by the Greenfield adapter."""
import os
import pathlib
import runpy
import shutil
import subprocess
import sys
root=pathlib.Path(__file__).resolve().parents[1]
action=sys.argv[1] if len(sys.argv)>1 else 'read'
if action not in ('evidence','sponsored','self-paid','submit','resolve','read'):
    raise SystemExit('Unknown action')
values=runpy.run_path(str(root/'tools/run-dmrvn-diagnostics.py'))['load_env'](root/'.env')
env=os.environ.copy()
for name in ('PRIVY_APP_ID','PRIVY_APP_SECRET','BACKEND_WALLET_PUBLIC_KEY','BACKEND_WALLET_PRIVATE_KEY','GREENFIELD_FEE_GRANTER'):
    if name in values:
        env[name]=values[name]
# Explicit storage configuration: this already-provisioned local key is NOT used for EVM signing.
# No Privy export request or fallback signer exists in this runner.
if action!='read':
    env['GREENFIELD_STORAGE_PRIVATE_KEY']=values['BACKEND_BLOCKCHAIN_WALLET_PRIVATE_KEY']
env.setdefault('GREENFIELD_FEE_GRANTER','0x812EA1e3fb2EFA004AE1308ed27EcEd0b05Cae66')
env.setdefault('DMRVN_NODE_PATH',shutil.which('node') or '')
env.setdefault('DMRVN_APPROVER_WALLET_ID','y2hl7bcafkz4aapnw36dykav')
env.setdefault('DMRVN_BENEFICIARY','0xeA9ecC2F4D32E075e961Afffd522bbf88BBA40a9')
raise SystemExit(subprocess.call(['./gradlew','dmrvnPet','--offline',f'-PdmrvnAction={action}'],cwd=root,env=env))
