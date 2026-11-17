package com.youngminkim.recanet.dmrvn;

import com.youngminkim.recanet.*;
import com.fasterxml.jackson.databind.*;
import java.io.*;
import java.math.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.util.*;

/** Offline reference runner against the actual Java SDK, including its dependency parsers. */
public final class ContractOracle {
  static final ObjectMapper M = new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
  static Map<String,Object> input;
  static List<Object> trace;
  static String s(String key) { return (String)input.get(key); }
  static long n(String key) { return new BigInteger(String.valueOf(input.get(key))).longValueExact(); }
  @SuppressWarnings("unchecked") static Map<String,Object> map(Object x) { return (Map<String,Object>) x; }
  static Map<String,Object> obj(Object... x) { var m = new LinkedHashMap<String,Object>(); for(int i=0;i<x.length;i+=2)m.put((String)x[i],x[i+1]);return m; }
  static String family(Throwable e) {
    if(e instanceof DmrvnException)return "dmrvn";
    if(e instanceof TransactionQueryException)return "transaction";
    if(e instanceof PrivyAuthenticationException)return "authentication";
    if(e instanceof PrivyApiException)return "privy";
    if(e instanceof IllegalStateException)return "state";
    if(e instanceof IllegalArgumentException || e instanceof NullPointerException || e instanceof ArithmeticException)return "argument";
    return "runtime";
  }
  static Object code(Throwable e) {
    if(e instanceof DmrvnException v)return v.code().name();
    if(e instanceof TransactionQueryException v)return v.code().name();
    if(e instanceof PrivyAuthenticationException v)return v.code().name();
    if(e instanceof PrivyApiException v)return v.code().name();
    return null;
  }
  static Object transactionValue(Object raw) {
    if(raw==null)return null;
    var value=map(M.convertValue(raw,Object.class));
    for(String key:List.of("chainId","valueWei","nonce","gasLimit","gasPriceWei","maxFeePerGasWei","maxPriorityFeePerGasWei","blockNumber","confirmations","fromBlock","toBlock"))
      if(value.get(key) instanceof Number)value.put(key,value.get(key).toString());
    if(value.get("status") instanceof Map<?,?>)value.put("status",transactionValue(value.get("status")));
    if(value.get("transactions") instanceof List<?> list)value.put("transactions",list.stream().map(ContractOracle::transactionValue).toList());
    return value;
  }
  static final class Replay {
    int index=0;
    Object call(String kind,Object... args) {
      var values=new ArrayList<Object>();
      for(Object arg:args) values.add(arg instanceof byte[] bytes?obj("bytes",Base64.getEncoder().encodeToString(bytes)):arg);
      trace.add(obj("kind",kind,"args",M.convertValue(values,Object.class)));
      var events=(List<?>)input.get("events");
      if(index>=events.size())throw new IllegalStateException("Unexpected adapter");
      var event=map(events.get(index++));
      if(!kind.equals(event.get("kind")))throw new IllegalStateException("Unexpected adapter");
      if(event.containsKey("error"))throw new DmrvnException(DmrvnException.Code.valueOf((String)event.get("error")),Boolean.TRUE.equals(event.get("definitelyNotBroadcast")),Boolean.TRUE.equals(event.get("definitelyRejected")));
      Object result=event.get("result");
      if(result instanceof Map<?,?> bytes && bytes.containsKey("bytes"))return Base64.getDecoder().decode((String)bytes.get("bytes"));
      return result;
    }
    DmrvnConfig config() {
      var c=map(input.get("config"));
      return DmrvnConfig.fromDeployment(DmrvnDeployment.fromManifest(map(c.get("deployment"))),java.net.URI.create((String)c.get("rpcUrl")),
        (String)c.get("greenfieldChainId"),(String)c.get("bucketName"),(String)c.get("objectPrefix"),((Number)c.get("partnerId")).longValue(),
        new BigInteger((String)c.get("maxRelayCostWei")),((Number)c.get("confirmations")).intValue());
    }
    EvmRpc rpc(){return (method,params)->call("rpc",method,params);}
  }
  static Object value() throws Exception {
    return switch(s("op")) {
      case "workflow" -> {
        var replay=new Replay();var config=replay.config();
        EvmSigner signer=new EvmSigner(){
          public String address(){return s("operator");}
          public String signMessage(String message){return (String)replay.call("signMessage",message);}
          public String signTypedData(Map<String,Object> data){return (String)replay.call("signTypedData",data);}
          public String sendTransaction(long chain,Map<String,Object> tx,String key){return (String)replay.call("sendTransaction",chain,tx,key);}
        };
        GreenfieldStorage storage=new GreenfieldStorage(){
          public String address(){return s("storageAddress");}public String chainId(){return config.greenfieldChainId();}
          public Head head(Map<String,Object> l){var h=map(replay.call("storage.head",l));return new Head(Boolean.TRUE.equals(h.get("exists")),Boolean.TRUE.equals(h.get("sealed")));}
          public String create(Map<String,Object> l,byte[] b){return (String)replay.call("storage.create",l,b);}
          public void upload(Map<String,Object> l,byte[] b,String hash){replay.call("storage.upload",l,b,hash);}
          public byte[] read(Map<String,Object> l){return (byte[])replay.call("storage.read",l);}
          public boolean matchesCreateTransaction(Map<String,Object> l,String hash){return Boolean.TRUE.equals(replay.call("storage.matchesCreateTransaction",l,hash));}
        };
        var methodology=new DeclaredMethodology(s("manifest").getBytes(StandardCharsets.UTF_8),Base64.getDecoder().decode(s("wasm")),s("hash"),(a,b,c,d)->Boolean.TRUE.equals(input.get("registryActive")),(int)n("schema"));
        var journal=new MemoryOperationJournal();
        if(input.get("seed") instanceof Map<?,?>)for(var entry:map(input.get("seed")).entrySet())journal.store(entry.getKey(),map(entry.getValue()));
        var sdk=new DmrvnClient(config,replay.rpc(),signer,storage,methodology,journal);var results=new ArrayList<Object>();
        for(Object raw:(List<?>)input.get("actions")) {
          var step=map(raw);var args=(List<?>)step.get("args");Object result;
          try {
            result=switch((String)step.get("method")) {
              case "preflight"->sdk.preflight();
              case "prepareEvidence"->sdk.prepareEvidence((String)args.get(0),(String)args.get(1),(String)args.get(2),(String)args.get(3),map(args.get(4)));
              case "approveClaim"->sdk.approveClaim((String)args.get(0));
              case "prepareSponsored"->sdk.prepareSponsored((String)args.get(0),(String)args.get(1));
              case "prepareSelfPaid"->sdk.prepareSelfPaid((String)args.get(0));
              case "recordSponsoredSignature"->sdk.recordSponsoredSignature((String)args.get(0),map(args.get(1)),(String)args.get(2));
              case "submitSponsored"->sdk.submitSponsored((String)args.get(0),map(args.get(1)),(String)args.get(2));
              case "resolveSubmission"->sdk.resolveSubmission((String)args.get(0),(String)args.get(1));
              case "operation"->sdk.operation((String)args.get(0));
              default->throw new IllegalArgumentException();
            };
            results.add(obj("ok",true,"value",result));
          }catch(Throwable error){results.add(obj("ok",false,"family",family(error),"code",code(error)));}
        }
        yield results;
      }
      case "reader" -> {
        var replay=new Replay();var reader=new DmrvnReader(replay.config(),replay.rpc(),
          location->(byte[])replay.call("report.read",location),hash->map(replay.call("report.resolve",hash)));
        var args=(List<?>)input.get("args");
        yield reader.readResult((String)args.get(0),args.get(1)==null?null:((Number)args.get(1)).longValue(),(String)args.get(2),Boolean.TRUE.equals(args.get(3)),(String)args.get(4));
      }
      case "numberJson" -> {
        Object value;
        if(Boolean.TRUE.equals(input.get("single")))value=Float.intBitsToFloat(Integer.parseUnsignedInt(s("bits"),16));
        else value=Double.longBitsToDouble(Long.parseUnsignedLong(s("bits"),16));
        yield obj("canonical",Json.canonical(value),"hash",Json.hash(value));
      }
      case "numberWire" -> {
        var node=M.createObjectNode();
        if(Boolean.TRUE.equals(input.get("single")))node.put("number",Float.intBitsToFloat(Integer.parseUnsignedInt(s("bits"),16)));
        else node.put("number",Double.longBitsToDouble(Long.parseUnsignedLong(s("bits"),16)));
        yield obj("canonical",new io.privy.api.util.JsonCanonicalizer().serialize(node),"wire",M.writeValueAsString(node));
      }
      case "float" -> Float.toString(Float.intBitsToFloat(Integer.parseUnsignedInt(s("bits"),16)));
      case "double" -> Double.toString(Double.longBitsToDouble(Long.parseUnsignedLong(s("bits"),16)));
      case "json" -> {
        Object parsed=Json.parse(s("text").getBytes(StandardCharsets.UTF_8));
        yield obj("canonical",Json.canonical(parsed),"hash",Json.hash(parsed));
      }
      case "jwksUri" -> PrivyTokenVerificationConfig.usingJwks(java.net.URI.create(s("uri"))).clockSkew().toNanos()+"";
      case "privyOrigin" -> {
        var config=new PrivyClientConfig("app","secret",java.net.URI.create(s("uri")),Duration.ofSeconds(30));
        yield config.baseUri().toString();
      }
      case "uri" -> {
        java.net.URI uri;
        try { uri=java.net.URI.create(s("uri")); }
        catch (IllegalArgumentException e) { throw new DmrvnException(DmrvnException.Code.INVALID_INPUT); }
        DmrvnConfig.checkUri(uri);
        yield uri.toString();
      }
      case "duration" -> {
        var d = Duration.ofSeconds(n("seconds"), n("nanos"));
        yield obj("milliseconds",d.toMillis()+"", "negative",d.isNegative(),"seconds",d.getSeconds()+"","nanos",d.getNano());
      }
      case "activity" -> {
        var request = new ActivityRequest(s("userId"),s("sourceEventId"),map(input.get("inputs")),s("claimId"),s("objectName"),s("gas"),
          Duration.ofNanos(n("timeoutNs")), Duration.ofNanos(n("pollNs")));
        yield obj("userId",request.userId(),"sourceEventId",request.sourceEventId(),"inputs",request.inputs(),"claimId",request.claimId(),
          "objectName",request.objectName(),"gas",request.gas(),"timeoutNs",request.confirmationTimeout().toNanos()+"","pollNs",request.pollInterval().toNanos()+"");
      }
      case "deployment" -> DmrvnDeployment.fromManifest(map(input.get("manifest"))).snapshot();
      case "methodology" -> {
        byte[] wasm = Base64.getDecoder().decode(s("wasm"));
        byte[] manifest = s("manifest").getBytes(StandardCharsets.UTF_8);
        var declared = new DeclaredMethodology(manifest,wasm,s("hash"),(a,b,c,d)->true,(int)n("schema"));
        yield declared.evidenceBody(n("partner"),s("beneficiary"),s("event"),map(input.get("inputs")));
      }
      case "protocol" -> {
        String method=s("method");
        yield switch(method) {
          case "domain" -> DmrvnProtocol.domain(n("chain"),s("address"),Boolean.TRUE.equals(input.get("forwarder")));
          case "ownerHash" -> DmrvnProtocol.ownerHash(s("address"));
          case "structHash" -> DmrvnProtocol.structHash(s("type"),map(input.get("message")));
          case "digest" -> DmrvnProtocol.digest(s("type"),map(input.get("domain")),map(input.get("message")));
          case "recover" -> DmrvnProtocol.recover(s("digest"),s("signature"));
          default -> throw new IllegalArgumentException();
        };
      }
      case "errors" -> {
        var error = new DmrvnException(DmrvnException.Code.valueOf(s("code")));
        yield obj("code",error.code().name(),"retryable",error.retryable(),"action",error.action(),"definitelyNotBroadcast",error.definitelyNotBroadcast(),"definitelyRejected",error.definitelyRejected());
      }
      case "query" -> {
        var query = new EvmTransactionQuery(n("from"),input.get("to")==null?null:n("to"),(int)n("limit"),s("cursor"));
        yield obj("from",query.fromBlock()+"","to",query.toBlock()==null?null:query.toBlock()+"","limit",query.limit(),"cursor",query.cursor());
      }
      case "walletRequest" -> {
        var request = new BackendWalletCreateRequest(s("chainType"),s("displayName"),s("externalId"));
        yield obj("chainType",request.chainType(),"displayName",request.displayName(),"externalId",request.externalId());
      }
      case "asset" -> {
        var rpc = new ScriptRpc(); var assets = new AssetClient(rpc);
        if("balance".equals(s("method"))) yield assets.getBalance(s("address")).toString();
        EvmSigner signer = new EvmSigner() {
          public String address(){return s("address");}
          public String signMessage(String m){throw new IllegalStateException();}
          public String signTypedData(Map<String,Object> m){throw new IllegalStateException();}
          public String sendTransaction(long c,Map<String,Object> tx,String key){trace.add(obj("send",c+"","transaction",tx,"key",key));
            if(Boolean.TRUE.equals(input.get("sendFails")))throw new IllegalStateException(); return s("hash");}
        };
        yield assets.transfer(signer,s("recipient"),new BigInteger(s("amount")),s("key"));
      }
      case "transaction" -> {
        var client = new EvmTransactionClient(n("chain"),new ScriptRpc());
        if("detail".equals(s("method")))yield transactionValue(client.getTransaction(s("hash")).orElse(null));
        if("pages".equals(s("method"))) {
          var results=new ArrayList<Object>();
          for(Object raw:(List<?>)input.get("queries")){
            var q=map(raw);
            try {
              var query=new EvmTransactionQuery(((Number)q.get("fromBlock")).longValue(),
                q.get("toBlock")==null?null:((Number)q.get("toBlock")).longValue(),
                ((Number)q.get("limit")).intValue(),(String)q.get("cursor"));
              results.add(obj("ok",true,"value",transactionValue(client.listTransactions(s("address"),query))));
            }
            catch(Throwable error){results.add(obj("ok",false,"family",family(error),"code",code(error)));}
          }
          yield results;
        }
        if("status".equals(s("method"))) {
          var status=client.getTransactionStatus(s("hash"));
          yield obj("chain",status.chainId()+"","hash",status.transactionHash(),"state",status.state().name(),"block",status.blockNumber()==null?null:status.blockNumber()+"","confirmations",status.confirmations()+"");
        }
        throw new IllegalArgumentException();
      }
      case "privy" -> {
        var client=new PrivyClient(new PrivyClientConfig(s("appId"),"test-secret",java.net.URI.create(s("endpoint")),Duration.ofSeconds(30)));
        var keys=map(input.get("registration"));var registration=new BackendWalletRegistration((String)keys.get("publicKey"),(String)keys.get("privateKey"));
        var members=new UserWalletClient(client,registration,"service");
        yield switch(s("method")) {
          case "verify"->{client.verifyAppCredentials();yield null;}
          case "register"->client.registerBackendWallet(registration,new BackendWalletCreateRequest("ethereum"));
          case "list"->client.listWalletsByAuthorizationKey(registration.publicKey());
          case "owned"->client.isBackendWallet(s("walletId"),registration);
          case "find"->members.findWallet("member").orElse(null);
          case "signerMissing"->members.signerFor("member");
          case "create","createConflict"->members.getOrCreateWallet("member");
          case "ensure"->client.ensureBackendWallet(new BackendWalletCreateRequest("ethereum"));
          default->throw new IllegalArgumentException();
        };
      }
      case "jwtJwks" -> {
        var verifier=new PrivyTokenVerifier(s("appId"),PrivyTokenVerificationConfig.usingJwks(java.net.URI.create(s("endpoint"))));
        var user=verifier.verifyAccessToken(s("token"));
        yield obj("appId",user.appId(),"userId",user.userId(),"sessionId",user.sessionId(),"issuedAtMs",user.issuedAt().toEpochMilli()+"","expiresAtMs",user.expiresAt().toEpochMilli()+"");
      }
      case "jwt" -> {
        var verifier=new PrivyTokenVerifier(s("appId"),PrivyTokenVerificationConfig.usingPublicKey(s("pem")));
        var user=Boolean.TRUE.equals(input.get("header"))?verifier.authenticateAuthorizationHeader(s("token")):verifier.verifyAccessToken(s("token"));
        yield obj("appId",user.appId(),"userId",user.userId(),"sessionId",user.sessionId(),"issuedAtMs",user.issuedAt().toEpochMilli()+"","expiresAtMs",user.expiresAt().toEpochMilli()+"");
      }
      case "journal" -> {
        var journal=new FileOperationJournal(Path.of(s("directory"))); String key=s("key");
        if(input.containsKey("snapshot"))journal.withLock(key,()->{journal.store(key,map(input.get("snapshot")));return null;});
        if(input.containsKey("increments"))for(int i=0;i<(int)n("increments");i++)journal.withLock(key,()->{var state=journal.load(key);long count=state==null?0:((Number)state.get("count")).longValue();journal.store(key,obj("count",count+1));return null;});
        yield journal.load(key);
      }
      case "publicRead" -> {
        var reader=new GreenfieldPublicReader(java.net.URI.create(s("endpoint")),s("chain"));
        yield Base64.getEncoder().encodeToString(reader.read(map(input.get("location"))));
      }
      default -> throw new IllegalArgumentException("Unknown operation");
    };
  }
  static final class ScriptRpc implements EvmRpc {
    int index=0;
    public Object call(String method,List<Object> params) {
      trace.add(obj("method",method,"params",params));
      var script=(List<?>)input.get("rpc");
      if(index>=script.size())throw new IllegalStateException("Unexpected RPC");
      var item=map(script.get(index++));
      if(!method.equals(item.get("method")))throw new IllegalStateException("RPC order");
      if(item.containsKey("error"))throw new DmrvnException(DmrvnException.Code.valueOf((String)item.get("error")));
      return item.get("result");
    }
  }
  public static void main(String[] args) throws Exception {
    var reader=new BufferedReader(new InputStreamReader(System.in,StandardCharsets.UTF_8));
    String line;
    while((line=reader.readLine())!=null) {
      input=map(M.readValue(line,Object.class));trace=new ArrayList<>();Map<String,Object> out;
      try {out=obj("ok",true,"value",value(),"trace",trace);}
      catch(Throwable error){out=obj("ok",false,"family",family(error),"code",code(error),"trace",trace);
        if(error instanceof PrivyApiException e){out.put("statusCode",e.statusCode());out.put("retryAfterMs",e.retryAfter().map(d->d.toMillis()+"").orElse(null));}
      }
      System.out.println(M.writeValueAsString(out));System.out.flush();
    }
  }
}
