import fs from 'node:fs';
fs.rmSync('dist',{recursive:true,force:true});fs.mkdirSync('dist/server',{recursive:true});fs.mkdirSync('dist/.openai',{recursive:true});
const worker=fs.readFileSync('worker/index.js','utf8');const html=fs.readFileSync('web/index.html','utf8');const parent=fs.readFileSync('web/parent.html','utf8');
fs.writeFileSync('dist/server/index.js','const GAME_HTML='+JSON.stringify(html)+';\nconst PARENT_HTML='+JSON.stringify(parent)+';\n'+worker);
if(fs.existsSync('.openai/hosting.json'))fs.copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');fs.cpSync('drizzle','dist/.openai/drizzle',{recursive:true});
console.log('Built game, parent page, Worker and score migrations.');
