export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    if (request.method === 'OPTIONS') return new Response(null, {headers:cors});
    if (request.method !== 'POST') return json({ok:false,error:'method_not_allowed'},405,cors);
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return json({ok:false,error:'server_not_configured'},500,cors);

    let p;
    try { p = await request.json(); } catch { return json({ok:false,error:'bad_json'},400,cors); }
    const clean = v => String(v ?? '').replace(/[<>]/g,'').trim().slice(0,1200);
    const name=clean(p.name), phone=clean(p.phone);
    if (name.length < 2 || phone.replace(/\D/g,'').length < 10) return json({ok:false,error:'invalid_lead'},400,cors);

    const lines = [
      '🚗 НОВАЯ ЗАЯВКА С САЙТА',
      '',
      'Имя: '+name,
      'Телефон: '+phone,
      'Автомобиль: '+(clean(p.car)||'—'),
      'Город: '+(clean(p.city)||'—'),
      'Страна: '+(clean(p.country)||'—'),
      'Бюджет: '+(clean(p.budget)||'—'),
      'Связь: '+(clean(p.contact)||'—'),
      '',
      'Страница: '+(clean(p.page)||'—')
    ];

    const tg = await fetch('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/sendMessage', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text:lines.join('\n'),disable_web_page_preview:true})
    });
    const data = await tg.json();
    if (!tg.ok || !data.ok) return json({ok:false,error:'telegram_error',details:data.description||''},502,cors);
    return json({ok:true},200,cors);
  }
}
function json(body,status,headers){return new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}})}
