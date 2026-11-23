export default {
  async fetch(request, env) {
    const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'};
    if(request.method === 'OPTIONS') return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
    if(new URL(request.url).pathname !== '/convert' || request.method !== 'POST') return new Response(JSON.stringify({error:'not found'}),{status:404,headers});
    if(!env.OPENAI_API_KEY) return new Response(JSON.stringify({error:'service not configured'}),{status:503,headers});
    let data;
    try { data = await request.json(); } catch { return new Response(JSON.stringify({error:'invalid JSON'}),{status:400,headers}); }
    const input = typeof data?.text === 'string' ? data.text.trim() : '';
    if(input.length < 5 || input.length > 5000) return new Response(JSON.stringify({error:'text must be 5-5000 characters'}),{status:400,headers});
    const upstream = await fetch('https://api.openai.com/v1/responses',{
      method:'POST',headers:{'Authorization':'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        model:env.OPENAI_MODEL || 'gpt-4.1-mini',
        store:false,
        instructions:'حوّل الكلام العامي العربي إلى عربية فصحى سليمة مشكولة تشكيلًا دقيقًا مع الحفاظ على معنى الطفل وأسماء الشخصيات والأحداث. لا تضف وقائع أو معلومات جديدة. أعد النص المحوّل فقط دون شرح. إن كان الكلام فصيحًا، صحّحه وشكّله.',
        input:input,max_output_tokens:2500
      })
    });
    if(!upstream.ok) return new Response(JSON.stringify({error:'conversion unavailable'}),{status:502,headers});
    const result = await upstream.json();
    const output = (result.output || []).flatMap(x => x.content || []).filter(x=>x.type==='output_text').map(x=>x.text).join('').trim();
    if(!output) return new Response(JSON.stringify({error:'empty conversion'}),{status:502,headers});
    return new Response(JSON.stringify({fusha_text:output}),{status:200,headers});
  }
};
