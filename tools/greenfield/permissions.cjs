'use strict';
// Public, read-only permission checks. Does not load or need any private key.
const { Client, PermissionTypes } = require('@bnb-chain/greenfield-js-sdk');
const { ActionType } = require('@bnb-chain/greenfield-cosmos-types/greenfield/permission/common');
(async () => {
  const client = Client.create('https://gnfd-testnet-fullnode-tendermint-ap.bnbchain.org', '5600');
  const address = '0xf288EC9EcC516a7E4C6780b417f3a247fE20cC77';
  const result = { address, bucket: 'dmrvn', prefix: 'partners/101/' };
  try {
    result.network = (await client.basic.getNodeInfo()).defaultNodeInfo?.network;
    result.createObject = await client.bucket.getVerifyPermission('dmrvn', address, ActionType.ACTION_CREATE_OBJECT);
    result.getObjectBucketPolicy = await client.bucket.getVerifyPermission('dmrvn', address, ActionType.ACTION_GET_OBJECT);
    result.note = 'Bucket policy only; actual prefix/object upload/read and validator access still require verification';
  } catch (_) { result.error = 'STORAGE_PERMISSION_QUERY_FAILED'; }
  process.stdout.write(JSON.stringify(result)+'\n');
})();
