import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { BackendWalletKeyPair, BackendWalletRegistration, BackendWalletCreateRequest, PrivyClient,
  PrivyClientConfig, PrivyTokenVerificationConfig, Duration, EvmTransactionQuery, Json, DmrvnConfig, DmrvnDeployment, DmrvnClient,
  DeclaredMethodology } from '../dist/index.js';
import { workflowFixture } from './helpers/dmrvn-workflow.mjs';

const pair=BackendWalletKeyPair.generate();
test('Java 키 객체·환경 로더·명시 로그 API를 제공하고 일반 생성은 비밀을 출력하지 않는다',()=>{
  const a=process.env.BACKEND_WALLET_PUBLIC_KEY,b=process.env.BACKEND_WALLET_PRIVATE_KEY,warn=console.warn,logs=[];
  console.warn=message=>logs.push(message);
  try {
    assert.ok(!inspect(pair).includes(pair.privateKey));
    assert.ok(!pair.toString().includes(pair.privateKey));assert.ok(!JSON.stringify(pair).includes(pair.privateKey));
    const generated=BackendWalletKeyPair.generate();assert.equal(logs.length,0);
    assert.equal(generated.registration().privateKey,generated.privateKey);
    process.env.BACKEND_WALLET_PUBLIC_KEY=pair.publicKey;process.env.BACKEND_WALLET_PRIVATE_KEY=pair.privateKey;
    assert.equal(BackendWalletRegistration.fromEnvironment().privateKey,pair.privateKey);
    delete process.env.BACKEND_WALLET_PRIVATE_KEY;assert.throws(()=>BackendWalletRegistration.fromEnvironment(),TypeError);
    const logged=BackendWalletKeyPair.generateAndLog();assert.deepEqual(logs,[`BACKEND_WALLET_PUBLIC_KEY=${logged.publicKey}`,`BACKEND_WALLET_PRIVATE_KEY=${logged.privateKey}`]);
  } finally {console.warn=warn;if(a===undefined)delete process.env.BACKEND_WALLET_PUBLIC_KEY;else process.env.BACKEND_WALLET_PUBLIC_KEY=a;if(b===undefined)delete process.env.BACKEND_WALLET_PRIVATE_KEY;else process.env.BACKEND_WALLET_PRIVATE_KEY=b;}
});
test('Privy 정규화 설정과 JWT 정책 getter는 정확한 기간·불변 with 연산·비밀 마스킹을 제공한다',()=>{
  const huge=Duration.ofMillis(9223372036854775807n);
  const config=new PrivyClientConfig('app','secret','https://api.privy.io',huge);
  assert.equal(config.requestTimeout().toMillis(),9223372036854775807n);
  const policy=PrivyTokenVerificationConfig.usingJwks('https://KEYS.example/path?x=1')
    .withClockSkew(Duration.ofNanos(1000001)).withJwksPolicy(Duration.ofMillis(1),huge,Duration.ofMillis(2));
  assert.equal(policy.clockSkew().nanoseconds,1000001n);assert.equal(policy.cacheTtl().toMillis(),huge.toMillis());
  const client=new PrivyClient(config.withTokenVerification(policy));
  assert.equal(client.config().appId(),'app');assert.equal(client.config().appSecret(),'secret');
  assert.equal(client.config().baseUri(),'https://api.privy.io');assert.equal(client.config().requestTimeout().toMillis(),huge.toMillis());
  assert.ok(!client.config().toString().includes('appSecret=secret'));assert.ok(!JSON.stringify(client.config()).includes('secret'));
  assert.throws(()=>policy.withClockSkew(Duration.ofNanos(60000000001n)),TypeError);
  assert.throws(()=>policy.withJwksPolicy(Duration.ofMillis(2147483648n),huge,Duration.ofMillis(1)),TypeError);
});
test('Java query 생성·withCursor와 request의 blank 정규화를 제공한다',()=>{
  const query=new EvmTransactionQuery(0n,null,20),next=query.withCursor('opaque');
  assert.equal(query.cursor,null);assert.equal(next.cursor,'opaque');assert.equal(next.fromBlock,query.fromBlock);
  assert.throws(()=>new EvmTransactionQuery(0n,null,0),TypeError);
  assert.deepEqual({...new BackendWalletCreateRequest('ethereum','  ','\t')},{chainType:'ethereum',displayName:null,externalId:null});
  assert.throws(()=>Json.copy([]),e=>e.code==='INVALID_INPUT');
});
test('deprecated Java 생성자 바인딩은 원래 direct 배포만 선택하고 다른 relay를 부수 효과 전에 거부한다',()=>{
  const d=DmrvnDeployment.historicalDirectTestnet();
  const config=new DmrvnConfig(d.chainId(),'https://node.invalid',d.contractAddress(),d.forwarderAddress(),d.runtimeCodeHash(),'5600','dmrvn','p/',101,1n,1);
  assert.equal(config.deployment.isProxy(),false);
  const f=workflowFixture();
  assert.doesNotThrow(()=>new DmrvnClient(f.config,f.rpc,f.operator,f.operator,f.storage,f.methodology));
  assert.throws(()=>new DmrvnClient(f.config,f.rpc,f.operator,{...f.operator,address:f.beneficiary},f.storage,f.methodology),e=>e.code==='INVALID_INPUT');
  assert.equal(f.calls.length,0);
});
test('공통 공개 진입점은 Java 내부 API/PET 전용 factory를 공개하지 않는다',async()=>{
  const sdk=await import('../dist/index.js');
  for(const name of['DmrvnCrypto','DmrvnAbi','DmrvnChain','DmrvnPreflight','MemoryOperationJournal','memberExternalId','DmrvnJson'])assert.equal(name in sdk,false,name);
  assert.equal('petV3' in DeclaredMethodology,false);
  assert.equal(typeof PrivyClient.prototype.listWalletsByAuthorizationKey,'function');
  assert.equal('listBackendWallets' in PrivyClient.prototype,false);
});

test('ensureBackendWallet은 Java의 환경·첫 지갑 선택·명시 bootstrap 로그 순서를 따른다',async()=>{
  const a=process.env.BACKEND_WALLET_PUBLIC_KEY,b=process.env.BACKEND_WALLET_PRIVATE_KEY,warn=console.warn,generate=BackendWalletKeyPair.generateAndLog;
  const logs=[],calls=[];console.warn=message=>logs.push(message);
  try{
    const wallet={id:'first',address:'0x'+'11'.repeat(20),chain_type:'solana'};
    let existing=true;
    const client=new PrivyClient({appId:'app',appSecret:'secret',fetch:async(url,init)=>{
      calls.push({path:new URL(url).pathname,method:init.method,body:init.body?JSON.parse(init.body):null});
      if(url.includes('/users'))return Response.json({data:[]});
      if(init.method==='GET')return Response.json({data:existing?[wallet]:[]});
      return Response.json({...wallet,chain_type:'ethereum'});
    }});
    process.env.BACKEND_WALLET_PUBLIC_KEY=pair.publicKey;process.env.BACKEND_WALLET_PRIVATE_KEY=pair.privateKey;
    assert.equal((await client.ensureBackendWallet(new BackendWalletCreateRequest('ethereum'))).chainType,'solana');
    assert.deepEqual(calls.map(x=>x.method),['GET','GET']);assert.equal(logs.length,0);
    calls.length=0;existing=false;
    await client.ensureBackendWallet(new BackendWalletCreateRequest('ethereum'));
    assert.deepEqual(calls.map(x=>x.method),['GET','GET','POST']);
    assert.equal(calls[2].body.owner.public_key,pair.publicKey);assert.ok(!JSON.stringify(calls).includes(pair.privateKey));
    delete process.env.BACKEND_WALLET_PRIVATE_KEY;calls.length=0;
    BackendWalletKeyPair.generateAndLog=()=>{console.warn('generated test key');return pair;};
    await client.ensureBackendWallet(new BackendWalletCreateRequest('ethereum'));
    assert.deepEqual(calls.map(x=>x.method),['GET','POST']);assert.deepEqual(logs,['generated test key']);
    client.exportWalletPrivateKey=async()=> 'explicit-test-export';
    assert.equal(await client.exportWalletPrivateKeyAndLog('first',pair.registration()),'explicit-test-export');
    assert.equal(logs[1],'BACKEND_BLOCKCHAIN_WALLET_PRIVATE_KEY=explicit-test-export');
  } finally {console.warn=warn;BackendWalletKeyPair.generateAndLog=generate;if(a===undefined)delete process.env.BACKEND_WALLET_PUBLIC_KEY;else process.env.BACKEND_WALLET_PUBLIC_KEY=a;if(b===undefined)delete process.env.BACKEND_WALLET_PRIVATE_KEY;else process.env.BACKEND_WALLET_PRIVATE_KEY=b;}
});
