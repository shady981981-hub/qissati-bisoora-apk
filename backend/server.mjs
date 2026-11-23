import http from 'node:http';
import { randomUUID } from 'node:crypto';
const port = Number(process.env.PORT || 3000);
const limit = new Map();
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, X-Qissati-Access','Access-Control-Allow-Methods':'POST, OPTIONS'});res.end(JSON.stringify(data));}
http.createServer(async (req,res)=>{
  const pathname=new URL(req.url||'/', 'http://localhost').pathname;
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, X-Qissati-Access','Access-Control-Allow-Methods':'POST, OPTIONS'});return res.end();}
  if(pathname==='/health')return send(res,200,{ok:true,configured:!!process.env.OPENAI_API_KEY});
  if(!['/convert','/chat'].includes(pathname)||req.method!=='POST')return send(res,404,{error:'not found'});
  if(!process.env.OPENAI_API_KEY)return send(res,503,{error:'AI service not configured'});
  if(process.env.QISSATI_ACCESS_TOKEN && req.headers['x-qissati-access']!==process.env.QISSATI_ACCESS_TOKEN)return send(res,401,{error:'unauthorized'});
  const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').toString().split(',')[0];
  const now=Date.now();const hit=limit.get(ip)||{count:0,until:now+60000};
  if(now>hit.until){hit.count=0;hit.until=now+60000;}
  if(++hit.count>10)return send(res,429,{error:'rate limited'});
  limit.set(ip,hit);
  if(limit.size>10000)for(const [key,val] of limit){if(val.until<now)limit.delete(key);}
  let raw='';try{for await(const chunk of req){raw+=chunk;if(raw.length>16000)throw Error('too large');}
    const data=JSON.parse(raw);
    const isChat=pathname==='/chat';
    let input;
    let instructions;
    if(isChat){
      const messages=Array.isArray(data.messages)?data.messages.slice(-8).map(item=>({
        role:item?.role==='assistant'?'assistant':'user',
        content:typeof item?.content==='string'?item.content.trim().slice(0,1000):''
      })).filter(item=>item.content):[];
      const totalChars=messages.reduce((sum,item)=>sum+item.content.length,0);
      if(!messages.length||messages.length>8||messages[messages.length-1].role!=='user'||totalChars>6000)
        return send(res,400,{error:'invalid conversation'});
      input=messages;
      instructions='أنت صديق قصصي لطيف وآمن للأطفال من عمر 8 إلى 14 سنة. أجب بالعربية الفصحى السهلة، واضبط كل الكلمات بالتشكيل الكامل قدر الإمكان، مع جمل قصيرة واضحة. كن مشجعًا ومهذبًا، واسأل سؤالًا واحدًا ممتعًا يساعد الطفل على الخيال أو فهم القصة. لا تطلب الاسم الحقيقي أو العنوان أو المدرسة أو رقم الهاتف أو الصور أو أي معلومات شخصية. لا تقدّم محتوى مخيفًا أو جنسيًا أو عنيفًا، ولا تعليمات مؤذية أو نصائح طبية أو مالية. إذا ذكر الطفل خطرًا أو أذى أو سرًا يزعجه، فشجّعه على إخبار ولي أمره أو شخص بالغ موثوق فورًا. لا تدّعِ أنك إنسان أو أنك تحفظ المحادثة. أعد 2 إلى 4 جمل موجزة فقط.';
    }else{
      const text=typeof data.text==='string'?data.text.trim():'';
      if(text.length<5||text.length>5000)return send(res,400,{error:'invalid length'});
      input=text;
      instructions='أعد صياغة النص المنطوق بالعامية العربية إلى عربية فصحى سليمة، مع تشكيل كامل ودقيق للكلمات بحسب السياق. حافظ على الأحداث والأسماء والمعنى والضمائر. لا تختلق أحداثًا أو تحذف تفاصيل جوهرية. أعد النص المشكول فقط دون مقدمات.';
    }
    const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),25000);
    let upstream;
    try{upstream=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:ctrl.signal,headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',store:false,instructions,input,max_output_tokens:isChat?450:2500})});}finally{clearTimeout(timer);}
    if(!upstream.ok)return send(res,502,{error:'AI service unavailable',request_id:randomUUID()});
    const result=await upstream.json();const output=(result.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('').trim();
    if(!output)return send(res,502,{error:'empty result'});
    return send(res,200,isChat?{reply:output}:{fusha_text:output});
  }catch{return send(res,400,{error:'invalid request or timeout'});}
}).listen(port,'0.0.0.0');
