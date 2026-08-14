import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
assert.ok(scripts.length>0,'index.html should contain an inline script');
for(const [i,script] of scripts.entries()){
  try{new Function(script);}catch(e){throw new Error(`index.html script #${i+1} syntax error: ${e.message}`);}
}
assert.match(html,/OSTATNIE 5 METRÓW/,'Last 5 M section should exist');
assert.match(html,/TRYB DOPASOWANIA \(GHOST\)/,'Ghost mode should exist');
assert.match(html,/MATCH\/MISMATCH\/NOT_VISIBLE|NOT_VISIBLE/,'tri-state verification should be surfaced');
console.log('index-syntax tests: OK');
