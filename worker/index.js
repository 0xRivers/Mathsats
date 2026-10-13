const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin','x-frame-options':'SAMEORIGIN'};
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{...headers,'content-type':'application/json'}})}
function html(value,status=200){return new Response(value,{status,headers:{...headers,'content-type':'text/html;charset=utf-8'}})}
function parentAllowed(request,env){const email=request.headers.get('oai-authenticated-user-email');return !!email&&!!env.PARENT_EMAIL&&email.toLowerCase()===env.PARENT_EMAIL.toLowerCase()&&!!request.headers.get('oai-authenticated-user-id')}
async function leaderboard(db){const rows=await db.prepare('SELECT player, COUNT(*) AS games, COALESCE(SUM(points),0) AS points FROM quiz_results GROUP BY player').all();return ['hugo','iggy'].map(player=>{const row=rows.results.find(r=>r.player===player);return {player,name:player==='hugo'?'Hugo':'Iggy',games:row?.games??0,points:row?.points??0}}).sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name))}
export default {async fetch(request,env){try{const url=new URL(request.url),path=url.pathname;
if(request.method==='POST'&&request.headers.get('origin')!==url.origin)return json({error:'Request origin not allowed.'},403);
if(path==='/')return html(GAME_HTML);
if(path==='/parent'){
if(!request.headers.get('oai-authenticated-user-id'))return html('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Parent sign-in</title><body style="font-family:system-ui;padding:32px;max-width:600px;margin:auto"><h1>Parent setup</h1><p>Sign in with the parent’s ChatGPT account to continue.</p><a href="/signin-with-chatgpt?return_to=%2Fparent" target="_top">Sign in with ChatGPT</a></body></html>');
if(!parentAllowed(request,env))return html('<h1>Parent access only</h1><p>This account cannot open the parent settings.</p>',403);return html(PARENT_HTML)}
if(path==='/api/leaderboard'&&request.method==='GET')return json({players:await leaderboard(env.DB)});
if(path==='/api/finish'&&request.method==='POST'){
if(Number(request.headers.get('content-length')||0)>1024)return json({error:'Request too large.'},413);
const data=await request.json();if(!/^[a-f0-9-]{36}$/i.test(data.id??'')||!['hugo','iggy'].includes(data.player)||!Number.isInteger(data.points)||data.points<0||data.points>10||data.completed!==10)return json({error:'Invalid completed quiz.'},400);
await env.DB.prepare('INSERT OR IGNORE INTO quiz_results (id,player,points,created_at) VALUES (?,?,?,?)').bind(data.id,data.player,data.points,Date.now()).run();
return json({players:await leaderboard(env.DB)})}
if(path==='/api/parent'){
if(!parentAllowed(request,env))return json({error:'Parent sign-in required.'},403);
if(request.method==='GET'){const settings=await env.DB.prepare('SELECT sats_per_point,daily_limit FROM parent_settings WHERE id=1').first();return json({settings:settings??{sats_per_point:0,daily_limit:0},paymentsEnabled:false,players:await leaderboard(env.DB)})}
if(request.method==='POST'){const data=await request.json();if(!Number.isInteger(data.sats_per_point)||data.sats_per_point<0||data.sats_per_point>1000||!Number.isInteger(data.daily_limit)||data.daily_limit<0||data.daily_limit>100000)return json({error:'Enter whole numbers within the shown limits.'},400);
await env.DB.prepare('INSERT INTO parent_settings (id,sats_per_point,daily_limit) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET sats_per_point=excluded.sats_per_point,daily_limit=excluded.daily_limit').bind(data.sats_per_point,data.daily_limit).run();return json({saved:true,paymentsEnabled:false})}}
return json({error:'Not found.'},404)
}catch(error){console.error('Learning game request failed',error?.message);return json({error:'Unable to load or save right now. Please try again.'},503)}}};
