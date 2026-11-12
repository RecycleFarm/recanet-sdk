import { diagnosticOperation, diagnosticManagedAdapter } from './diagnostics.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAddress, uint } from './dmrvn-crypto.js';
import { DmrvnError } from './errors.js';
import type { GreenfieldHead, GreenfieldStorage } from './greenfield-storage.js';
import { isJavaBlank } from './member-identity.js';
import { copyState, requireState, stateString } from './internal/dmrvn-state.js';
import { dmrvnUri } from './internal/dmrvn-uri.js';
import { runGreenfieldWorker } from './internal/greenfield-worker.js';
import { decodeBase64 } from './internal/base64.js';

export interface NodeGreenfieldStorageOptions {
  readonly rpcUrl: string; readonly chainId: string; readonly address: string;
  readonly keyEnvironmentVariable: string; readonly feeGranter?: string | null;
  readonly timeoutMs?: number; readonly nodePath?: string; readonly workerPath?: string;
}

/** 공식 Greenfield SDK worker 경계. EVM/Privy 자격 증명을 자식 환경에 전달하지 않는다. */
export class NodeGreenfieldStorage implements GreenfieldStorage {
  readonly address: string;
  readonly chainId: string;
  #node: string; #worker: string; #rpc: string; #keyEnv: string; #granter: string; #timeout: number;
  constructor(options: NodeGreenfieldStorageOptions) {
    this.#node = resolve(options.nodePath ?? process.execPath);
    this.#worker = resolve(options.workerPath ?? fileURLToPath(new URL('../tools/greenfield/worker.cjs', import.meta.url)));
    this.#rpc = dmrvnUri(options.rpcUrl); this.chainId = uint(stateString(options.chainId), 64).toString();
    this.address = normalizeAddress(options.address); this.#keyEnv = stateString(options.keyEnvironmentVariable);
    this.#granter = options.feeGranter == null || options.feeGranter === '' ? '' : normalizeAddress(options.feeGranter);
    this.#timeout = options.timeoutMs === undefined ? 240000 : options.timeoutMs;
    requireState(Number.isInteger(this.#timeout) && this.#timeout > 0 && this.#timeout <= 2147483647, 'INVALID_INPUT');
    diagnosticManagedAdapter(this);
    Object.freeze(this);
  }
  async head(location: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<GreenfieldHead> {
    return diagnosticOperation('node-greenfield-storage.head', undefined, async () => {
      const value = await this.#invoke('head', location, null, null, signal);
      return { exists: value.exists === true, sealed: value.sealed === true };
    });
  }
  async create(location: Readonly<Record<string, unknown>>, bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
    return diagnosticOperation('node-greenfield-storage.create', undefined, async () => {
      return stateString((await this.#invoke('create', location, bytes, null, signal)).createTxHash);
    });
  }
  async upload(location: Readonly<Record<string, unknown>>, bytes: Uint8Array, hash: string, signal?: AbortSignal): Promise<void> {
    return diagnosticOperation('node-greenfield-storage.upload', undefined, async () => {
      await this.#invoke('upload', location, bytes, hash, signal);
    });
  }
  async read(location: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<Uint8Array> {
    return diagnosticOperation('node-greenfield-storage.read', undefined, async () => {
      const text = stateString((await this.#invoke('read', location, null, null, signal)).bytes);
      return decodeBase64(text);
    });
  }
  async matchesCreateTransaction(location: Readonly<Record<string, unknown>>, hash: string, signal?: AbortSignal): Promise<boolean> {
    return diagnosticOperation('node-greenfield-storage.matchesCreateTransaction', undefined, async () => {
      return (await this.#invoke('verifyCreate', location, null, hash, signal)).matches === true;
    });
  }
  #invoke(op: string, location: Readonly<Record<string, unknown>>, bytes: Uint8Array | null, hash: string | null,
    signal?: AbortSignal): Promise<Record<string, unknown>> {
    requireState(location.chainId === this.chainId, 'WRONG_CHAIN');
    const secret = process.env[this.#keyEnv];
    requireState(typeof secret === 'string' && !isJavaBlank(secret), 'STORAGE_ACCESS_DENIED');
    const request: Record<string, unknown> = {
      op, rpcUrl: this.#rpc, chainId: this.chainId, address: this.address,
      feeGranter: this.#granter, location: copyState(location), createTxHash: hash
    };
    if (bytes !== null) request.bytes = Buffer.from(bytes).toString('base64');
    return runGreenfieldWorker(this.#node, this.#worker, request, secret, this.#timeout, signal);
  }
}
