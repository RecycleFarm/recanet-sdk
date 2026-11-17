#!/usr/bin/env python3
"""Run the same offline cases against the actual Java SDK and the TS public SDK."""
import json
import hashlib
import platform
from collections import Counter
from pathlib import Path
import subprocess
import tempfile
import sys
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs


class FixtureServer(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_POST(self): self.respond()
    def do_GET(self): self.respond()
    def respond(self):
        server = self.server
        path = urlsplit(self.path)
        key = self.headers.get("privy-app-id", "")
        if path.path.startswith("/fixture/"):
            key = path.path.split("/")[2]
        vector = server.fixtures.get(key)
        if vector is None:
            self.send_error(404); return
        if vector["op"] == "publicRead":
            payload = self.path.encode("utf-8"); status = 200; headers = {}
        elif vector["op"] == "jwtJwks":
            server.traces.setdefault(key, []).append({"method":self.command,"path":path.path,"query":parse_qs(path.query),"body":None})
            if vector.get("redirect") and not path.path.endswith('/final'):
                payload=b'';status=302;headers={'Location':self.path+'/final'}
            else: payload = json.dumps(vector["jwks"]).encode(); status = 200; headers = {}
        else:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode() if length else ""
            body = json.loads(raw) if raw else None
            server.traces.setdefault(key, []).append({"method":self.command,"path":path.path,"query":parse_qs(path.query),"body":body})
            index = server.counts.get(key,0); server.counts[key] = index+1
            responses = vector["responses"]
            response = responses[min(index,len(responses)-1)]
            if isinstance(response,dict) and ("status" in response or "raw" in response):
                status=response.get("status",200); payload=response.get("raw",json.dumps(response.get("body",{}))).encode(); headers=response.get("headers",{})
            else: status=200; payload=json.dumps(response).encode(); headers={}
        self.send_response(status); self.send_header("Content-Type","application/json"); self.send_header("Content-Length",str(len(payload)))
        for key,value in headers.items(): self.send_header(key,value)
        self.end_headers(); self.wfile.write(payload)

ROOT = Path(__file__).resolve().parents[1]

def run():
    cp = subprocess.check_output(['./gradlew', '-q', '-I', str(ROOT/'tests/contracts/classpath.gradle'), 'contractClasspath', '--console=plain'],cwd=ROOT/'sdks/java',text=True).strip().splitlines()[-1]
    with tempfile.TemporaryDirectory(prefix='recanet-contract-') as temp:
        subprocess.run(['javac','-cp',cp,'-d',temp,str(ROOT/'tests/contracts/java/ContractOracle.java')],check=True)
        vectors=json.loads(subprocess.check_output(['node',str(ROOT/'tests/contracts/typescript/vectors.mjs')],text=True))
        server=ThreadingHTTPServer(('127.0.0.1',0),FixtureServer)
        server.fixtures={}; server.traces={}; server.counts={}
        thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
        origin=f'http://127.0.0.1:{server.server_port}'
        for index,vector in enumerate(vectors):
            if vector['op'] in ('privy','jwtJwks','publicRead'):
                key='app-'+str(index)
                vector['serverKey']=key;server.fixtures[key]=vector
                if vector['op']=='privy': vector['appId']=key;vector['endpoint']=origin
                else: vector['endpoint']=origin+'/fixture/'+key
        payload=''.join(json.dumps(v,ensure_ascii=True)+'\n' for v in vectors)
        env=os.environ.copy()
        keys=next(v['registration'] for v in vectors if v['op']=='privy')
        env.update(BACKEND_WALLET_PUBLIC_KEY=keys['publicKey'],BACKEND_WALLET_PRIVATE_KEY=keys['privateKey'])
        def execute(args):
            server.traces={};server.counts={}
            result=subprocess.run(args,input=payload,text=True,capture_output=True,check=True,timeout=90,env=env)
            outputs=[json.loads(line) for line in result.stdout.splitlines()]
            for vector,out in zip(vectors,outputs):
                if vector['op'] in ('privy','jwtJwks'):out['trace']+=server.traces.get(vector['serverKey'],[])
            return outputs
        try:
            java=execute(['java','-Xss1m','-cp',temp+':'+cp,'com.youngminkim.recanet.dmrvn.ContractOracle'])
            ts=execute(['node',str(ROOT/'tests/contracts/typescript/runner.mjs')])
        finally: server.shutdown();server.server_close()
        assert len(java)==len(ts)==len(vectors),'A runner skipped cases'
        failures=[]
        for vector,j,t in zip(vectors,java,ts):
            if j!=t:failures.append({'name':vector['name'],'input':vector,'java':j,'typescript':t})
        # Actual cross-runtime snapshots and mixed Java/Node processes share OS locks.
        shared=str(Path(temp)/'journal')
        java_command=['java','-Xss1m','-cp',temp+':'+cp,'com.youngminkim.recanet.dmrvn.ContractOracle']
        ts_command=['node',str(ROOT/'tests/contracts/typescript/runner.mjs')]
        def single(command,operation):
            out=subprocess.run(command,input=json.dumps(operation)+'\n',text=True,capture_output=True,check=True,timeout=30)
            return json.loads(out.stdout)
        record={'op':'journal','directory':shared,'key':'operation:shared','snapshot':{'operationId':'shared','claimId':'0x'+'ab'*32,'body':{'unicode':'한글','values':[1,None,True]}}}
        jw=single(java_command,record)
        nr=single(ts_command,{k:v for k,v in record.items() if k!='snapshot'})
        assert jw==nr and jw['ok'],'Java write/Node read snapshot mismatch'
        record['snapshot']['body']['values'].append('Node update')
        nw=single(ts_command,record)
        jr=single(java_command,{k:v for k,v in record.items() if k!='snapshot'})
        assert nw==jr and nw['ok'],'Node write/Java read snapshot mismatch'
        operation={'op':'journal','directory':shared,'key':'counter','increments':20}
        processes=[]
        for index in range(6):
            process=subprocess.Popen(java_command if index%2==0 else ts_command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            process.stdin.write(json.dumps(operation)+'\n');process.stdin.close();processes.append(process)
        for process in processes:
            assert process.wait(timeout=30)==0,process.stderr.read()
            assert json.loads(process.stdout.read())['ok'],'Mixed journal process failed'
        count=single(java_command,{'op':'journal','directory':shared,'key':'counter'})
        assert count['value']=={'count':120},count
        assert Path(shared).stat().st_mode & 0o777 == 0o700
        assert all(path.stat().st_mode & 0o777 == 0o600 for path in Path(shared).glob('*.json'))
        print('PASS Java↔Node journal snapshots, 120 mixed-process increments, 0700/0600 permissions')
        source_files=sorted([*(ROOT/'sdks/java/src').rglob('*'), *(ROOT/'sdks/typescript/src').rglob('*')])
        source_hash=hashlib.sha256()
        for source in source_files:
            if source.is_file():
                source_hash.update(source.relative_to(ROOT).as_posix().encode()+b'\0'+source.read_bytes()+b'\0')
        report={'schemaVersion':1,'referenceRevision':'06a9a560054b1154ce096839da3bfe9c6d7a67ff',
                'environment':{'system':platform.system(),'machine':platform.machine(),
                               'node':subprocess.check_output(['node','--version'],text=True).strip(),
                               'javaStackBytes':1048576,'java':subprocess.run(['java','-version'],capture_output=True,text=True,check=True).stderr.splitlines()[0]},
                'sdkSourceSha256':source_hash.hexdigest(),'operations':dict(sorted(Counter(v['op'] for v in vectors).items())),
                'journal':{'crossRuntimeSnapshots':True,'mixedProcesses':6,'increments':120,'directoryMode':'0700','fileMode':'0600'},
                'cases':len(vectors),'passed':len(vectors)-len(failures),'failed':len(failures),'failures':failures}
        report_dir=ROOT/'reports/contracts';report_dir.mkdir(parents=True,exist_ok=True)
        (report_dir/'parity.json').write_text(json.dumps(report,ensure_ascii=True,indent=2)+'\n')
        print(f"Common SDK contract: {report['passed']}/{report['cases']} equal; {report['failed']} differences")
        for failure in failures:print(failure['name']+': '+json.dumps({'java':failure['java'],'typescript':failure['typescript']},ensure_ascii=True)[:1800])
        if failures:sys.exit(1)
if __name__=='__main__':run()
