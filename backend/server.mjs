import http from 'node:http';
import { randomUUID } from 'node:crypto';
const port = Number(process.env.PORT || 3000);
const limit = new Map();
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, X-Qissati-Access','Access-Control-Allow-Methods':'POST, OPTIONS'});res.end(JSON.stringify(data));}
http.createServer(async (req,res)=>{
  const pathname=new URL(req.url||'/', 'http://localhost').pathname;
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, X-Qissati-Access','Access-Control-Allow-Methods':'POST, OPTIONS'});return res.end();}
  if(pathname==='/health')return send(res,200,{ok:true,configured:!!process.env.OPENAI_API_KEY});
  if(pathname!=='/convert'||req.method!=='POST')return send(res,404,{error:'not found'});
  if(!process.env.OPENAI_API_KEY)return send(res,503,{error:'AI service not configured'});
  if(process.env.QISSATI_ACCESS_TOKEN && req.headers['x-qissati-access']!==process.env.QISSATI_ACCESS_TOKEN)return send(res,401,{error:'unauthorized'});
  const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').toString().split(',')[0];
  const now=Date.now();const hit=limit.get(ip)||{count:0,until:now+60000};
  if(now>hit.until){hit.count=0;hit.until=now+60000;}
  if(++hit.count>10)return send(res,429,{error:'rate limited'});
  limit.set(ip,hit);
  if(limit.size>10000)for(const [key,val] of limit){if(val.until<now)limit.delete(key);}
  let raw='';try{for await(const chunk of req){raw+=chunk;if(raw.length>16000)throw Error('too large');}
    const data=JSON.parse(raw);const input=typeof data.text==='string'?data.text.trim():'';
    if(input.length<5||input.length>5000)return send(res,400,{error:'invalid length'});
    const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),25000);
    let upstream;
    try{upstream=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:ctrl.signal,headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',store:false,instructions:'أعد صياغة النص المنطوق بالعامية العربية إلى عربية فصحى سليمة، مع تشكيل كامل ودقيق للكلمات بحسب السياق. حافظ على الأحداث والأسماء والمعنى والضمائر. لا تختلق أحداثًا أو تحذف تفاصيل جوهرية. أعد النص المشكول فقط دون مقدمات.',input,max_output_tokens:2500})});}finally{clearTimeout(timer);}
    if(!upstream.ok)return send(res,502,{error:'AI service unavailable',request_id:randomUUID()});
    const result=await upstream.json();const output=(result.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('').trim();
    if(!output)return send(res,502,{error:'empty result'});
    return send(res,200,{fusha_text:output});
  }catch{return send(res,400,{error:'invalid request or timeout'});}
}).listen(port,'0.0.0.0');
