const crypto=require('node:crypto');
const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
const response=(status,body)=>({statusCode:status,headers,body:JSON.stringify(body)});
const redis=async(command,args)=>{const r=await fetch(process.env.UPSTASH_REDIS_REST_URL,{method:'POST',headers:{Authorization:'Bearer '+process.env.UPSTASH_REDIS_REST_TOKEN,'Content-Type':'application/json'},body:JSON.stringify([command,...args])});if(!r.ok){console.error('Upstash',r.status);throw Error('Stockage indisponible ('+r.status+')');}return (await r.json()).result;};
const key=(channel,contact)=>'comfortium:otp:'+crypto.createHash('sha256').update(channel+':'+contact).digest('hex');
const hash=(code,contact)=>crypto.createHmac('sha256',process.env.OTP_SECRET).update(contact+':'+code).digest('hex');
exports.handler=async(event)=>{if(event.httpMethod!=='POST')return response(405,{error:'Méthode non permise'});try{
if(!process.env.UPSTASH_REDIS_REST_URL||!process.env.UPSTASH_REDIS_REST_TOKEN||!process.env.OTP_SECRET)return response(503,{error:'Vérification non configurée'});
const {channel,email,phone}=JSON.parse(event.body||'{}');if(!['email','sms'].includes(channel))return response(400,{error:'Méthode invalide'});
const digits=String(phone||'').replace(/\D/g,'');const contact=channel==='email'?String(email||'').trim().toLowerCase():(digits.length===10?'1'+digits:digits);
if(channel==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)||channel==='sms'&&!/^1[2-9]\d{9}$/.test(contact))return response(400,{error:'Contact invalide'});
const ip=String((event.headers||{})['x-nf-client-connection-ip']||(event.headers||{})['x-forwarded-for']||'inconnu').split(',')[0].trim();const ipThrottle=key('rate-ip',ip);const ipCount=Number(await redis('INCR',[ipThrottle]));if(ipCount===1)await redis('EXPIRE',[ipThrottle,3600]);if(ipCount>10)return response(429,{error:'Limite atteinte, réessayez plus tard'});
const throttle=key('rate',contact);const count=Number(await redis('INCR',[throttle]));if(count===1)await redis('EXPIRE',[throttle,3600]);if(count>5)return response(429,{error:'Limite atteinte, réessayez plus tard'});
const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');const otpKey=key(channel,contact);
await redis('SET',[otpKey,JSON.stringify({hash:hash(code,contact),attempts:0}),'EX',600]);
if(channel==='email'){
if(!process.env.RESEND_API_KEY||!process.env.VERIFICATION_FROM_EMAIL)return response(503,{error:'Service courriel non configuré'});
const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.VERIFICATION_FROM_EMAIL,to:[contact],subject:'Comfortium — code de vérification',text:'Votre code Comfortium est '+code+'. Il expire dans 10 minutes. Ne le partagez pas.'})});if(!r.ok){const t=await r.text().catch(()=>'');console.error('Resend',r.status,t.slice(0,300));throw Error('Envoi courriel échoué ('+r.status+')');}
}else{
if(!process.env.TWILIO_ACCOUNT_SID||!process.env.TWILIO_AUTH_TOKEN||!process.env.TWILIO_FROM_NUMBER)return response(503,{error:'Service SMS non configuré'});
const params=new URLSearchParams({To:'+'+contact,From:process.env.TWILIO_FROM_NUMBER,Body:'Comfortium : votre code est '+code+'. Expire dans 10 minutes.'});
const r=await fetch('https://api.twilio.com/2010-04-01/Accounts/'+process.env.TWILIO_ACCOUNT_SID+'/Messages.json',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(process.env.TWILIO_ACCOUNT_SID+':'+process.env.TWILIO_AUTH_TOKEN).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:params});if(!r.ok){const t=await r.text().catch(()=>'');console.error('Twilio',r.status,t.slice(0,300));throw Error('Envoi SMS échoué ('+r.status+')');}
}return response(200,{sent:true});}catch(e){console.error(e);return response(500,{error:'Impossible d’envoyer le code'});}};
