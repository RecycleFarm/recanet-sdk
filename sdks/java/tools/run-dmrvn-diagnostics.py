#!/usr/bin/env python3
"""Explicit local .env loader for read-only diagnostics. Never prints credentials."""
import os
import pathlib
import re
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[1]
def load_env(path):
    result = {}
    lines = iter(path.read_text().splitlines())
    for line in lines:
        match = re.match(r'^([A-Z][A-Z0-9_]*)=(.*)$', line)
        if not match:
            continue
        name, value = match.groups()
        if value.startswith(('"', "'")):
            quote = value[0]
            value = value[1:]
            while not value.endswith(quote):
                value += '\n' + next(lines)
            value = value[:-1]
        result[name] = value
    return result

if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'chain'
    if mode not in ('chain', 'wallet', 'read', 'sign'):
        raise SystemExit('Choose chain, wallet, read, or sign (no transactions)')
    env = os.environ.copy()
    # Only Privy credentials are needed for wallet discovery. No blockchain private key is loaded.
    if mode in ('wallet', 'sign'):
        values = load_env(root / '.env')
        for name in ('PRIVY_APP_ID','PRIVY_APP_SECRET','BACKEND_WALLET_PUBLIC_KEY','BACKEND_WALLET_PRIVATE_KEY'):
            if name in values:
                env[name] = values[name]
    raise SystemExit(subprocess.call(['./gradlew','dmrvnDiagnostics','--offline',f'-PdmrvnMode={mode}'],cwd=root,env=env))
