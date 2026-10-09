const proposalCountries = {'Корея':'korea','Китай':'china','Япония':'japan'};
const proposalManagers = ['alexey','ivan','nadezhda'];

// Private, durable storage. IDs are unguessable; records are immutable.
export class ProposalStore {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    const url = new URL(request.url);
    if(request.method==='GET') {
      const record=await this.ctx.storage.get('kp:'+url.pathname.slice(1));
      return record?json(record):json({ok:false},404);
    }
    if(request.method!=='POST')return json({ok:false},405);
    const {record,ip}=await request.json();
    return this.ctx.blockConcurrencyWhile(async()=>{
      const hour=Math.floor(Date.now()/3600000),day=Math.floor(Date.now()/86400000);
      const quota=await this.ctx.storage.get('quota')||{day,total:0,ips:{}};
      if(quota.day!==day){quota.day=day;quota.total=0;quota.ips={};}
      const prior=quota.ips[ip],count=prior&&prior.hour===hour?prior.count:0;
      if(count>=30||quota.total>=500)return json({ok:false,message:'Слишком много сохранений. Попробуйте позже.'},429);
      quota.ips[ip]={hour,count:count+1};quota.total++;
      const bytes=crypto.getRandomValues(new Uint8Array(16));
      const id=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      await this.ctx.storage.put({'quota':quota,['kp:'+id]:record});
      return json({ok:true,id});
    });
  }
}

async function createProposal(request,env){
  if(request.method!=='POST')return json({ok:false},405);
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return json({ok:false},403);
  if(!env.PROPOSALS)return json({ok:false,message:'Сохранение КП ещё не настроено.'},503);
  const text=await request.text();if(text.length>10000)return json({ok:false},413);
  let body;try{body=JSON.parse(text);}catch(_){return json({ok:false},400);}
  if(!body||typeof body!=='object')return json({ok:false},400);
  if(body.pin!==String(env.PROPOSAL_MANAGER_PIN||'8888'))return json({ok:false,message:'Неверный PIN менеджера.'},403);
  if(!Object.hasOwn(proposalCountries,body.country)||!body.fields||typeof body.fields!=='object')return json({ok:false},400);
  const fields={view:'client'};
  for(const key of ['m','y','t','mi','e','d','u','p','mgr'])fields[key]=clean(body.fields[key],key==='u'?2000:250);
  const price=Number(fields.p.replace(/[^\d.,]/g,'').replace(',','.'));
  if(!fields.m||!Number.isFinite(price)||price<=0||!proposalManagers.includes(fields.mgr))return json({ok:false,message:'Заполните модель, стоимость и менеджера.'},400);
  if(fields.u){try{const u=new URL(fields.u);if(!['https:','http:'].includes(u.protocol)||!u.hostname.includes('.'))throw Error();fields.u=u.href;}catch(_){return json({ok:false,message:'Проверьте ссылку на автомобиль.'},400);}}
  fields.p=String(price);
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip));
  const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const store=env.PROPOSALS.get(env.PROPOSALS.idFromName('proposals'));
  return store.fetch('https://store/',{method:'POST',body:JSON.stringify({record:{country:body.country,fields,createdAt:new Date().toISOString()},ip:hash})});
}

async function viewProposal(request,env){
  if(!['GET','HEAD'].includes(request.method))return json({ok:false},405);
  const id=new URL(request.url).pathname.slice('/offer/'.length);
  if(!/^[A-Za-z0-9_-]{22}$/.test(id)||!env.PROPOSALS)return new Response('Предложение не найдено',{status:404});
  const store=env.PROPOSALS.get(env.PROPOSALS.idFromName('proposals'));
  const response=await store.fetch('https://store/'+id);
  if(!response.ok)return new Response('Предложение не найдено',{status:404,headers:{'X-Robots-Tag':'noindex, nofollow'}});
  const record=await response.json();
  const assetUrl=new URL('/'+proposalCountries[record.country]+'-kp.html',request.url);
  const asset=await env.ASSETS.fetch(new Request(assetUrl));
  if(!asset.ok)return asset;
  const query=JSON.stringify(new URLSearchParams(record.fields).toString()).replace(/</g,'\\u003c');
  const title='КП: '+record.fields.m+' — АВТО В РФ';
  const safeTitle=escapeHtml(title).replace(/"/g,'&quot;');
  const description=escapeHtml(record.country+' · Стоимость под ключ: '+new Intl.NumberFormat('ru-RU').format(Number(record.fields.p))+' ₽').replace(/"/g,'&quot;');
  let html=await asset.text();
  html=html.replace('<head>','<head><script>window.PROPOSAL_QUERY='+query+';</script><meta property="og:title" content="'+safeTitle+'"><meta property="og:description" content="'+description+'"><meta property="og:type" content="website">');
  html=html.replace(/<title>.*?<\/title>/, '<title>'+safeTitle+'</title>');
  const headers=new Headers(asset.headers);headers.delete('etag');headers.delete('content-length');headers.set('content-type','text/html; charset=UTF-8');headers.set('cache-control','no-store');headers.set('X-Robots-Tag','noindex, nofollow');
  return new Response(request.method==='HEAD'?null:html,{headers});
}


function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function clean(value, max = 500) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function encarId(value){
  try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||!(u.hostname==='encar.com'||u.hostname.endsWith('.encar.com')))return null;const match=u.pathname.match(/\/(?:detail|vehicle|cars)\/(\d{6,12})(?:\/|$)/);const id=(match&&match[1])||u.searchParams.get('carid')||u.searchParams.get('carId')||u.searchParams.get('id');return /^\d{6,12}$/.test(id||'')?id:null;}catch(_){return null;}
}
function encarCar(payload){
  const car=payload?.data?.vehicle||payload?.vehicle||payload?.data||payload;
  if(!car||typeof car!=='object')return null;
  const category=car.category||{},spec=car.spec||car.specification||{};
  const value=(...xs)=>{for(const x of xs)if(typeof x==='string'||typeof x==='number'){const text=String(x).trim();if(text)return text.slice(0,250);}return '';};
  const make=value(category.manufacturerEnglishName,category.manufacturerName,car.manufacturerName,car.manufacturer);
  const model=value(category.modelEnglishName,category.modelName,car.modelName,car.model);
  const name=value(car.vehicleName,car.title,[make,model].filter(Boolean).join(' '));
  const trim=value(category.gradeEnglishName,category.gradeName,category.gradeDetailName,car.trim);
  const year=value(category.year,category.formYear,spec.year,car.year);
  const mileage=value(spec.mileage,car.mileage);
  const fuels={'가솔린':'Бензин','디젤':'Дизель','전기':'Электро','가솔린+전기':'Бензин / электро','LPG(일반인 구입)':'LPG'};
  const transmissions={'오토':'Автомат','자동':'Автомат','수동':'Механика'};
  const fuel=value(spec.fuelName,spec.fuelTypeName,car.fuelName);
  const transmission=value(spec.transmissionName,spec.transmissionTypeName,car.transmissionName);
  const displacement=value(spec.displacement,car.displacement);
  const engine=[displacement?displacement+' см³':'',fuels[fuel]||fuel,transmissions[transmission]||transmission].filter(Boolean).join(' · ');
  const photos=Array.isArray(car.photos)?car.photos:Array.isArray(car.images)?car.images:[];
  let photo=value(photos[0]?.path,photos[0]?.url,photos[0]);
  if(photo.startsWith('/carpicture'))photo='https://ci.encar.com'+photo;
  if(photo.startsWith('//'))photo='https:'+photo;
  try{const u=new URL(photo);if(u.protocol!=='https:'||!(u.hostname==='encar.com'||u.hostname.endsWith('.encar.com')))photo='';}catch(_){photo='';}
  if(!name)return null;
  return {model:name,trim,year:year.match(/^(?:19|20)\d{2}/)?.[0]||year,mileage:mileage?mileage+' км':'',engine,photo};
}
async function importEncar(request){
  if(request.method!=='GET')return json({ok:false,message:'Метод не поддерживается.'},405);
  const url=new URL(request.url),source=url.searchParams.get('url')||'';
  const id=encarId(source);
  if(!id)return json({ok:false,message:'Укажите ссылку на конкретное объявление Encar.'},400);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch('https://api.encar.com/v1/readside/vehicle/'+id+'?include=MANAGE,SPEC,CONDITION,ADVERTISEMENT',{signal:controller.signal,redirect:'manual',headers:{'accept':'application/json'}});
    if(!response.ok||!(response.headers.get('content-type')||'').includes('json'))return json({ok:false,message:'Encar сейчас не отдаёт данные автоматически. Откройте объявление и заполните характеристики и ссылку на фото вручную.'},502);
    const data=encarCar(await response.json());
    if(!data)return json({ok:false,message:'Encar не вернул характеристики этого объявления. Заполните поля вручную.'},502);
    return json({ok:true,car:data});
  }catch(error){return json({ok:false,message:error.name==='AbortError'?'Encar не ответил за 10 секунд. Попробуйте ещё раз или заполните поля вручную.':'Не удалось получить данные Encar. Заполните поля вручную.'},502);}
  finally{clearTimeout(timer);}
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if(url.pathname === "/api/proposals")return createProposal(request,env);
    if(url.pathname.startsWith("/offer/"))return viewProposal(request,env);


    if(url.pathname==="/api/lead/status"&&request.method==="GET")return json({ready:!!(env.TELEGRAM_BOT_TOKEN&&env.TELEGRAM_CHAT_ID)});

    if (url.pathname === "/api/encar") return importEncar(request);

    if (url.pathname === "/api/lead") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      }

      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
        return json({ ok: false, error: "TELEGRAM_NOT_CONFIGURED" }, 503);
      }

      let payload;
      try {
        const type = request.headers.get("content-type") || "";
        if (!type.includes("application/json")) {
          return json({ ok: false, error: "JSON_REQUIRED" }, 415);
        }
        payload = await request.json();
      } catch {
        return json({ ok: false, error: "BAD_JSON" }, 400);
      }

      const name = clean(payload.name, 100);
      const phone = clean(payload.phone, 50);
      const phoneDigits = phone.replace(/\D/g, "");

      if (name.length < 2 || phoneDigits.length < 10) {
        return json({ ok: false, error: "INVALID_CONTACT" }, 400);
      }

      const car = clean(payload.car, 180) || "—";
      const carUrl = clean(payload.carUrl, 800) || "—";
      const comment = clean(payload.comment, 700) || "—";
      const city = clean(payload.city, 100) || "—";
      const country = clean(payload.country, 100) || "—";
      const budget = clean(payload.budget, 100) || "—";
      const contact = clean(payload.contact, 50) || "—";
      const page = clean(payload.page, 500) || "—";

      const review=new URL(({Корея:"korea-kp.html",Китай:"china-kp.html",Япония:"japan-kp.html"})[country]||"korea-kp.html",url.origin);review.searchParams.set("request","1");if(car!=="—")review.searchParams.set("m",car);if(carUrl!=="—")review.searchParams.set("u",carUrl);
      const text =
        "<b>🚗 Новая заявка с сайта «АВТО В РФ»</b>\n\n" +
        "<b>Имя:</b> " + escapeHtml(name) + "\n" +
        "<b>Телефон:</b> " + escapeHtml(phone) + "\n" +
        "<b>Автомобиль:</b> " + escapeHtml(car) + "\n" +
        "<b>Ссылка:</b> " + escapeHtml(carUrl) + "\n" +
        "<b>Комментарий:</b> " + escapeHtml(comment) + "\n" +
        "<b>Город:</b> " + escapeHtml(city) + "\n" +
        "<b>Страна:</b> " + escapeHtml(country) + "\n" +
        "<b>Бюджет:</b> " + escapeHtml(budget) + "\n" +
        "<b>Удобная связь:</b> " + escapeHtml(contact) + "\n\n" +
        "<b>Страница:</b> " + escapeHtml(page)+"\n<b>Открыть для расчёта:</b> "+escapeHtml(review.href);

      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
      let tgRes;try{tgRes = await fetch(
        "https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage",
        {
          method: "POST",
          signal:controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: env.TELEGRAM_CHAT_ID,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true
          })
        }
      );

      }catch(_){return json({ok:false,error:"TELEGRAM_UNAVAILABLE"},502);}finally{clearTimeout(timer);}
      let tgData = {};
      try { tgData = await tgRes.json(); } catch {}

      if (!tgRes.ok || tgData.ok !== true) {
        console.log("Telegram send failed:", JSON.stringify(tgData));
        return json({ ok: false, error: "TELEGRAM_SEND_FAILED" }, 502);
      }

      return json({ ok: true });
    }

    return env.ASSETS.fetch(request);
  }
};



