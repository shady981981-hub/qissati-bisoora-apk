import http from 'node:http';
import { randomUUID } from 'node:crypto';
const port = Number(process.env.PORT || 3000);
const limit = new Map();
const studioLimit = new Map();
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, X-Qissati-Access','Access-Control-Allow-Methods':'POST, OPTIONS'});res.end(JSON.stringify(data));}

async function readLimited(req,maxBytes){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw new Error('body_too_large');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
http.createServer(async (req,res)=>{
  const pathname=new URL(req.url||'/', 'http://localhost').pathname;
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, X-Qissati-Access','Access-Control-Allow-Methods':'POST, OPTIONS'});return res.end();}
  if(pathname==='/health')return send(res,200,{ok:true,configured:!!process.env.OPENAI_API_KEY,studioConfigured:!!(process.env.CLOUDFLARE_ACCOUNT_ID&&process.env.CLOUDFLARE_API_TOKEN)});
  if(pathname==='/studio/generate'){
    if(req.method!=='POST')return send(res,405,{code:'method_not_allowed'});
    if(!process.env.CLOUDFLARE_ACCOUNT_ID||!process.env.CLOUDFLARE_API_TOKEN)return send(res,503,{code:'ai_provider_not_configured'});
    const studioOrigin=process.env.QISSATI_STUDIO_ORIGIN||'https://qissati-bisoora-web.buzzygerbil33.chatgpt.site';
    // Android's packaged WebView sends the opaque `null` origin for file:///android_asset pages.
    if(!new Set([studioOrigin,'null']).has(req.headers.origin))return send(res,403,{code:'studio_origin_not_allowed'});
    if(process.env.QISSATI_ACCESS_TOKEN && req.headers['x-qissati-access']!==process.env.QISSATI_ACCESS_TOKEN)return send(res,401,{code:'unauthorized'});
    const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').toString().split(',').pop().trim();
    const now=Date.now();let hit=studioLimit.get(ip)||{count:0,until:now+10*60*1000};
    if(now>hit.until){hit={count:0,until:now+10*60*1000};}
    if(++hit.count>3)return send(res,429,{code:'studio_rate_limited'});
    studioLimit.set(ip,hit);
    if(studioLimit.size>10000)for(const [key,val] of studioLimit){if(val.until<now)studioLimit.delete(key);}
    const contentType=String(req.headers['content-type']||'');
    if(!contentType.toLowerCase().startsWith('multipart/form-data;'))return send(res,400,{code:'multipart_required'});
    let form;
    try{
      const raw=await readLimited(req,8*1024*1024);
      form=await new Request('http://localhost/studio/generate',{method:'POST',headers:{'content-type':contentType},body:raw}).formData();
    }catch(error){return send(res,error?.message==='body_too_large'?413:400,{code:error?.message==='body_too_large'?'image_too_large':'invalid_request'});}
    const image=form.get('image');
    const mode=String(form.get('mode')||'');
    const profession=String(form.get('profession')||'');
    const style=String(form.get('style')||'cinematic');
    const guardian=form.get('guardianConsent')==='yes';
    const privacy=form.get('privacyNotice')==='yes';
    const jobs={doctor:'طبيب',engineer:'مهندس',teacher:'معلم',programmer:'مبرمج',scientist:'عالِم',astronaut:'رائد فضاء',pilot:'طيار',artist:'فنان',architect:'مهندس معماري',nurse:'ممرض',farmer:'مزارع',chef:'طاهٍ',robotics:'متخصص روبوتات',athlete:'رياضي',vet:'طبيب بيطري'};
    const styles={cinematic:'أسلوب فيلم رسوم متحركة ثلاثي الأبعاد، ألوان سينمائية دافئة وتفاصيل لطيفة',clay:'شخصية ثلاثية الأبعاد من الطين اللامع',storybook:'رسوم قصصية ثلاثية الأبعاد ناعمة ومضيئة'};
    if(!image||typeof image.arrayBuffer!=='function'||image.size<1||image.size>6*1024*1024||!['image/jpeg','image/png','image/webp'].includes(image.type))return send(res,400,{code:'invalid_image'});
    if(!guardian||!privacy)return send(res,400,{code:'guardian_consent_required'});
    if(!Object.prototype.hasOwnProperty.call(jobs,profession)||!Object.prototype.hasOwnProperty.call(styles,style)||!['3d','10','20','30'].includes(mode))return send(res,400,{code:'invalid_studio_options'});
    let prompt;
    if(mode==='3d'){
      prompt='Create one polished, child-safe 3D animated portrait based on the reference photo. Preserve the same person’s recognizable face, current age, skin tone, hair and general appearance. Show them confidently working as a '+jobs[profession]+' in an imaginative, warm, age-appropriate professional setting. Visual style: '+styles[style]+'. This is an illustrated career dream, not a factual claim. No text, names, logos, uniforms with real organizations, or additional people. Keep the composition focused on the same person.';
    }else{
      const years=Number(mode);
      prompt='Create a respectful, age-appropriate imagined portrait of the same person in the reference photo about '+years+' years in the future, naturally older by approximately '+years+' years, working as a '+jobs[profession]+'. Preserve recognizable identity and facial traits while showing plausible natural aging. Use a warm, hopeful 3D animated-film style and a suitable professional setting. This is an imaginative possibility, not a prediction or guarantee. No text, names, logos, uniforms with real organizations, or additional people.';
    }
    const cfAccount=String(process.env.CLOUDFLARE_ACCOUNT_ID).trim();
    if(!/^[a-f0-9]{32}$/i.test(cfAccount))return send(res,503,{code:'ai_provider_not_configured'});
    const upstreamForm=new FormData();
    upstreamForm.append('prompt',prompt);
    upstreamForm.append('input_image_0',new Blob([await image.arrayBuffer()],{type:image.type}),image.name||'student-photo.jpg');
    upstreamForm.append('width','1024');
    upstreamForm.append('height','1024');
    upstreamForm.append('guidance','7');
    const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),90000);
    let upstream;
    try{
      upstream=await fetch('https://api.cloudflare.com/client/v4/accounts/'+cfAccount+'/ai/run/@cf/black-forest-labs/flux-2-klein-4b',{method:'POST',signal:ctrl.signal,headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},body:upstreamForm});
    }catch(error){
      clearTimeout(timer);
      return send(res,error?.name==='AbortError'?504:502,{code:error?.name==='AbortError'?'image_timeout':'image_service_unreachable'});
    }finally{clearTimeout(timer);}
    const providerPayload=await upstream.json().catch(()=>({}));
    if(!upstream.ok||providerPayload?.success===false){
      const providerError=Array.isArray(providerPayload?.errors)?providerPayload.errors[0]:null;
      const providerCode=String(providerError?.code||providerError?.message||'unknown').slice(0,120);
      const requestId=String(upstream.headers.get('cf-ray')||randomUUID()).slice(0,100);
      console.error(JSON.stringify({event:'studio_image_request_failed',status:upstream.status,provider_code:providerCode,request_id:requestId}));
      if(upstream.status===401||upstream.status===403)return send(res,503,{code:'ai_provider_auth_error',request_id:requestId});
      if(upstream.status===429)return send(res,503,{code:'ai_provider_rate_limited',request_id:requestId});
      if(upstream.status===404)return send(res,503,{code:'ai_model_unavailable',request_id:requestId});
      if(upstream.status===413)return send(res,413,{code:'image_too_large',request_id:requestId});
      return send(res,502,{code:'image_generation_failed',request_id:requestId});
    }
    const encoded=providerPayload?.result?.image;
    if(typeof encoded!=='string'||!encoded)return send(res,502,{code:'empty_image_result'});
    return send(res,200,{image_base64:encoded.replace(/^data:image\\/png;base64,/i,''),mime_type:'image/png',mode,profession});
  }
  if(!['/convert','/chat'].includes(pathname)||req.method!=='POST')return send(res,404,{error:'not found'});
  if(!process.env.OPENAI_API_KEY)return send(res,503,{code:'service_not_configured'});
  if(process.env.QISSATI_ACCESS_TOKEN && req.headers['x-qissati-access']!==process.env.QISSATI_ACCESS_TOKEN)return send(res,401,{error:'unauthorized'});
  const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').toString().split(',').pop().trim();
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
        role:item?.role==='assistant'?'assistant':item?.role==='user'?'user':null,
        content:typeof item?.content==='string'?item.content.trim().slice(0,1000):''
      })).filter(item=>item.role&&item.content):[];
      const totalChars=messages.reduce((sum,item)=>sum+item.content.length,0);
      if(!messages.length||messages.length>8||messages[messages.length-1].role!=='user'||totalChars>4000)
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
    try{
      upstream=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:ctrl.signal,headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',store:false,instructions,input,max_output_tokens:isChat?450:2500})});
    }catch(error){
      clearTimeout(timer);
      return send(res,error?.name==='AbortError'?504:502,{code:error?.name==='AbortError'?'upstream_timeout':'upstream_unreachable'});
    }finally{clearTimeout(timer);}
    if(!upstream.ok){
      const providerBody=await upstream.json().catch(()=>({}));
      const rawCode=String(providerBody?.error?.code||providerBody?.error?.type||'');
      const allowedCodes=new Set(['insufficient_quota','rate_limit_exceeded','model_not_found','invalid_api_key','billing_hard_limit_reached','project_not_found','permission_denied']);
      const providerCode=allowedCodes.has(rawCode)?rawCode:'unknown';
      const requestId=String(upstream.headers.get('x-request-id')||randomUUID()).slice(0,100);
      console.error(JSON.stringify({event:'openai_request_failed',status:upstream.status,code:providerCode,request_id:requestId}));
      if(upstream.status===401)return send(res,503,{code:'api_key_invalid',request_id:requestId});
      if(upstream.status===429)return send(res,503,{code:providerCode==='insufficient_quota'||providerCode==='billing_hard_limit_reached'?'api_usage_limit':'api_rate_limited',request_id:requestId});
      if(upstream.status===403)return send(res,503,{code:'api_permission',request_id:requestId});
      if(providerCode==='model_not_found')return send(res,503,{code:'api_model_unavailable',request_id:requestId});
      return send(res,502,{code:'upstream_failure',request_id:requestId});
    }
    const result=await upstream.json();const output=(result.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('').trim();
    if(!output)return send(res,502,{code:'empty_result'});
    return send(res,200,isChat?{reply:output}:{fusha_text:output});
  }catch{return send(res,400,{code:'invalid_request'});}
}).listen(port,'0.0.0.0');

