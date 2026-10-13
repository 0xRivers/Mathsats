import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import worker from '../dist/server/index.js';
const page=fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
new vm.Script(page.match(/<script>([\s\S]*)<\/script>/)[1]);
const sqlite=new DatabaseSync(':memory:');
for(const file of ['0000_learning_scores.sql','0001_verified_rounds.sql'])sqlite.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));
const env={PARENT_EMAIL:'parent@example.com',DB:{prepare(sql){let args=[];const s=sqlite.prepare(sql);return{bind(...v){args=v;return this},async all(){return {results:s.all(...args)}},async first(){return s.get(...args)??null},async run(){s.run(...args);return{success:true}}}}}};
const origin='https://game.test';async function call(path,body=null,auth={}){const r=await worker.fetch(new Request(origin+path,{method:body===null?'GET':'POST',headers:{origin,'content-type':'application/json',...auth},body:body===null?undefined:JSON.stringify(body)}),env);return {status:r.status,data:await r.json()}}
assert.deepEqual((await call('/api/leaderboard')).data.players.map(x=>[x.games,x.points]),[[0,0],[0,0]]);
assert.equal((await call('/api/finish',{id:crypto.randomUUID(),player:'hugo',points:10,completed:10})).status,410);
assert.equal((await call('/api/round/start',{player:'hugo',cap:11,mode:'add'})).status,400);
const start=await call('/api/round/start',{player:'hugo',cap:10,mode:'mixed'});assert.equal(start.status,200);
let {roundId,question}=start.data;assert(!('answer' in question));
for(let i=0;i<10;i++){
 assert.equal(question.index,i);
 const expected={add:question.a+question.b,subtract:question.a-question.b,multiply:question.a*question.b,divide:question.a/question.b}[question.op];
 assert(Number.isInteger(expected)&&expected>=1&&expected<=10);
 const answer=i===1?999:expected;
 const data={roundId,questionId:question.id,answer};
 const result=await call('/api/round/answer',data);assert.equal(result.status,200);
 assert.equal(result.data.correct,i!==1);assert.equal(result.data.points,i-(i>1?0:0)+(i===0?1:0),false);
 const duplicate=await call('/api/round/answer',{...data,answer:999});
 assert.equal(duplicate.data.points,result.data.points);assert.equal(duplicate.data.correct,result.data.correct);
 if(i<9){const next=await call('/api/round/question',{roundId});assert.equal(next.status,200);question=next.data.question}
 else assert.equal(result.data.roundComplete,true);
}
const board=(await call('/api/leaderboard')).data.players;assert.equal(board.find(x=>x.player==='hugo').games,1);assert.equal(board.find(x=>x.player==='hugo').points,9);
assert.equal((await call('/api/round/question',{roundId})).status,409);
assert.equal((await call('/api/round/answer',{roundId,questionId:crypto.randomUUID(),answer:2})).status,404);
const other=(await call('/api/round/start',{player:'iggy',cap:10,mode:'add'})).data;
assert.equal((await call('/api/round/answer',{roundId:other.roundId,questionId:question.id,answer:1})).status,404);
const race=(await call('/api/round/start',{player:'iggy',cap:10,mode:'add'})).data;
const pair=await Promise.all([call('/api/round/answer',{roundId:race.roundId,questionId:race.question.id,answer:race.question.a+race.question.b}),call('/api/round/answer',{roundId:race.roundId,questionId:race.question.id,answer:999})]);
assert.equal(pair[0].data.points,pair[1].data.points);assert.equal(pair[0].data.correct,pair[1].data.correct);
sqlite.prepare('UPDATE quiz_questions SET expires_at=? WHERE id=?').run(Date.now()-1,other.question.id);
const expired=await call('/api/round/answer',{roundId:other.roundId,questionId:other.question.id,answer:other.question.a+other.question.b});assert.equal(expired.data.correct,false);assert.equal(expired.data.answer,other.question.a+other.question.b);
assert.equal((await call('/api/parent')).status,403);
assert.equal((await call('/api/parent','POST',{sats_per_point:1,daily_limit:100})).status,403);
const auth={'oai-authenticated-user-id':'parent-id','oai-authenticated-user-email':'parent@example.com'};
const parent=await call('/api/parent',null,auth);assert.equal(parent.status,200);assert.equal(parent.data.paymentsEnabled,false);
assert.equal((await call('/api/parent',{sats_per_point:1,daily_limit:100},auth)).status,200);
assert.equal((await call('/api/round/start',{player:'hugo',cap:10,mode:'add'},{origin:'https://bad.test'})).status,403);
console.log('Verified: server-issued questions, score totals, replay prevention, expiry, no browser finish, parent access, payments disabled, and client syntax.');
