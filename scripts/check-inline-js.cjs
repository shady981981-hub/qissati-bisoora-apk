const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html','utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
if(!scripts.length) throw Error('No inline JavaScript found in index.html');
let checked = 0;
for(const match of scripts){
  if(!match[1].trim()) continue;
  new vm.Script(match[1],{filename:'index.html:inline-script-'+(++checked)});
}
if(!html.includes('function arabicReadingAudit(')) throw Error('Arabic reading audit missing');
if(!html.includes('function nativeSpeechFinished(')) throw Error('Native speech completion handler missing');
if(!html.includes('function checkStoryBeforeSaving(')) throw Error('Story quality gate missing');
console.log('Validated '+checked+' inline JavaScript blocks and quality gates.');
