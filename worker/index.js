const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'same-origin','x-frame-options':'SAMEORIGIN'};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const skills=['add','subtract','multiply','divide'];
const levels=[10,20,50,100];
const ROUND_MS=60*60*1000,QUESTION_MS=10*60*1000;
function json(value,status=200){return new Response(JSON.stringify(value),{status,headers:{...headers,'content-type':'application/json'}})}
function html(value,status=200){return new Response(value,{status,headers:{...headers,'content-type':'text/html;charset=utf-8'}})}
function parentAllowed(request,env){const email=request.headers.get('oai-authenticated-user-email');return !!email&&!!env.PARENT_EMAIL&&email.toLowerCase()===env.PARENT_EMAIL.toLowerCase()&&!!request.headers.get('oai-authenticated-user-id')}
async function leaderboard(db){const rows=await db.prepare('SELECT player, COUNT(*) AS games, COALESCE(SUM(points),0) AS points FROM quiz_results GROUP BY player').all();return ['hugo','iggy'].map(player=>{const row=rows.results.find(r=>r.player===player);return {player,name:player==='hugo'?'Hugo':'Iggy',games:row?.games??0,points:row?.points??0}}).sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name))}
function choose(low,high){const range=high-low+1;const max=0x100000000-(0x100000000%range);const data=new Uint32Array(1);do{crypto.getRandomValues(data)}while(data[0]>=max);return low+(data[0]%range)}
function makeProblem(limit,kind){let a,b,answer;if(kind==='add'){answer=choose(2,limit);a=choose(1,answer-1);b=answer-a}else if(kind==='subtract'){a=choose(2,limit);b=choose(1,a-1);answer=a-b}else{const pairs=[];for(let x=1;x<=Math.min(10,limit);x++)for(let y=1;y<=Math.min(10,limit);y++)if(x*y<=limit)pairs.push([x,y]);const [x,y]=pairs[choose(0,pairs.length-1)];if(kind==='multiply'){a=x;b=y;answer=x*y}else{a=x*y;b=x;answer=y}}return {a,b,answer,op:kind}}
function publicQuestion(row){return {id:row.id,index:row.idx,a:row.a,b:row.b,op:row.op,expiresAt:row.expires_at}}
async function issueQuestion(db,round){const previous=await db.prepare('SELECT * FROM quiz_questions WHERE round_id=? ORDER BY idx DESC LIMIT 1').bind(round.id).first();if(previous&&!previous.answered_at)return publicQuestion(previous);
const index=previous?previous.idx+1:0;if(index>=10)return null;
const kind=round.mode==='mixed'?skills[index%4]:round.mode;
let problem,key;do{problem=makeProblem(round.cap,kind);key=kind+':'+problem.a+':'+problem.b}while(previous&&key===previous.op+':'+previous.a+':'+previous.b);
const now=Date.now(),id=crypto.randomUUID();
await db.prepare('INSERT OR IGNORE INTO quiz_questions (id,round_id,idx,a,b,op,expected,expires_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,round.id,index,problem.a,problem.b,kind,problem.answer,Math.min(now+QUESTION_MS,round.expires_at)).run();
const issued=await db.prepare('SELECT * FROM quiz_questions WHERE round_id=? AND idx=?').bind(round.id,index).first();return publicQuestion(issued)}
async function body(request){if(Number(request.headers.get('content-length')||0)>2048)throw new RangeError('Request too large.');const text=await request.text();if(text.length>2048)throw new RangeError('Request too large.');return JSON.parse(text)}
export default {async fetch(request,env){try{const url=new URL(request.url),path=url.pathname;
if(request.method==='POST'&&request.headers.get('origin')!==url.origin)return json({error:'Request origin not allowed.'},403);
if(path==='/')return html(GAME_HTML);
if(path==='/parent'){
if(!request.headers.get('oai-authenticated-user-id'))return html('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Parent sign-in</title><body style="font-family:system-ui;padding:32px;max-width:600px;margin:auto"><h1>Parent setup</h1><p>Sign in with the parent’s ChatGPT account to continue.</p><a href="/signin-with-chatgpt?return_to=%2Fparent" target="_top">Sign in with ChatGPT</a></body></html>');
if(!parentAllowed(request,env))return html('<h1>Parent access only</h1><p>This account cannot open the parent settings.</p>',403);return html(PARENT_HTML)}
if(path==='/api/leaderboard'&&request.method==='GET')return json({players:await leaderboard(env.DB)});
if(path==='/api/finish'&&request.method==='POST')return json({error:'Browser-supplied scores are no longer accepted.'},410);
if(path==='/api/round/start'&&request.method==='POST'){
const data=await body(request);if(!['hugo','iggy'].includes(data.player)||!levels.includes(data.cap)||![...skills,'mixed'].includes(data.mode))return json({error:'Invalid round settings.'},400);
const id=crypto.randomUUID(),now=Date.now();await env.DB.prepare('INSERT INTO quiz_rounds (id,player,cap,mode,created_at,expires_at) VALUES (?,?,?,?,?,?)').bind(id,data.player,data.cap,data.mode,now,now+ROUND_MS).run();const question=await issueQuestion(env.DB,{id,cap:data.cap,mode:data.mode,expires_at:now+ROUND_MS});return json({roundId:id,question})}
if(path==='/api/round/question'&&request.method==='POST'){
const data=await body(request);if(!UUID.test(data.roundId??''))return json({error:'Invalid round.'},400);
const round=await env.DB.prepare('SELECT * FROM quiz_rounds WHERE id=?').bind(data.roundId).first();if(!round)return json({error:'Round not found.'},404);
if(Date.now()>round.expires_at)return json({error:'This round expired. Start another quest.'},409);
const question=await issueQuestion(env.DB,round);if(!question)return json({error:'Round already complete.'},409);return json({roundId:round.id,question})}
if(path==='/api/round/answer'&&request.method==='POST'){
const data=await body(request);if(!UUID.test(data.roundId??'')||!UUID.test(data.questionId??'')||!(data.answer===null||Number.isInteger(data.answer)&&data.answer>=0&&data.answer<=999))return json({error:'Invalid answer.'},400);
const round=await env.DB.prepare('SELECT * FROM quiz_rounds WHERE id=?').bind(data.roundId).first();if(!round)return json({error:'Round not found.'},404);
const now=Date.now();
// The condition is the one-shot scoring gate. Racing/replayed submissions cannot change the recorded answer.
const updated=await env.DB.prepare('UPDATE quiz_questions SET submitted=?,is_correct=CASE WHEN ? IS NOT NULL AND ?=expected AND expires_at>=? AND ?>=? THEN 1 ELSE 0 END,answered_at=? WHERE id=? AND round_id=? AND answered_at IS NULL RETURNING *').bind(data.answer,data.answer,data.answer,now,round.expires_at,now,now,data.questionId,round.id).first();
const q=updated??await env.DB.prepare('SELECT * FROM quiz_questions WHERE id=? AND round_id=?').bind(data.questionId,round.id).first();if(!q)return json({error:'Question not found.'},404);
const count=await env.DB.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(is_correct),0) AS points FROM quiz_questions WHERE round_id=? AND answered_at IS NOT NULL').bind(round.id).first();
if(count.total===10)await env.DB.prepare('INSERT OR IGNORE INTO quiz_results (id,player,points,created_at) SELECT id,player,?,? FROM quiz_rounds WHERE id=?').bind(count.points,now,round.id).run();
return json({correct:!!q.is_correct,answer:q.expected,index:q.idx,points:count.points,completed:count.total,roundComplete:count.total===10,players:count.total===10?await leaderboard(env.DB):undefined})}
if(path==='/api/parent'){
if(!parentAllowed(request,env))return json({error:'Parent sign-in required.'},403);
if(request.method==='GET'){const settings=await env.DB.prepare('SELECT sats_per_point,daily_limit FROM parent_settings WHERE id=1').first();return json({settings:settings??{sats_per_point:0,daily_limit:0},paymentsEnabled:false,players:await leaderboard(env.DB)})}
if(request.method==='POST'){const data=await body(request);if(!Number.isInteger(data.sats_per_point)||data.sats_per_point<0||data.sats_per_point>1000||!Number.isInteger(data.daily_limit)||data.daily_limit<0||data.daily_limit>100000)return json({error:'Enter whole numbers within the shown limits.'},400);
await env.DB.prepare('INSERT INTO parent_settings (id,sats_per_point,daily_limit) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET sats_per_point=excluded.sats_per_point,daily_limit=excluded.daily_limit').bind(data.sats_per_point,data.daily_limit).run();return json({saved:true,paymentsEnabled:false})}}
return json({error:'Not found.'},404)
}catch(error){if(error instanceof RangeError)return json({error:error.message},413);if(error instanceof SyntaxError)return json({error:'Invalid JSON.'},400);console.error('Learning game request failed',error?.message);return json({error:'Unable to load or save right now. Please try again.'},503)}}};
