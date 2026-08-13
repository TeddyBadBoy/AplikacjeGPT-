(()=>{
  const API='https://osint-navigator-engine.vercel.app/api/run';
  let controller=null;
  let generation=0;

  function emit(name,detail){window.dispatchEvent(new CustomEvent(name,{detail}));}
  function resetCurrent(){
    generation+=1;
    if(controller) controller.abort();
    controller=new AbortController();
    sessionStorage.removeItem('osint.currentRun');
    sessionStorage.removeItem('osint.currentInput');
    emit('osint:reset',{generation});
    return {generation,controller};
  }
  function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error('File read failed'));r.readAsDataURL(file);});}

  async function analyze({url,file}={}){
    const ctx=resetCurrent();
    const cleanUrl=typeof url==='string'?url.trim():'';
    if(Boolean(cleanUrl)===Boolean(file)) throw new Error('Podaj dokładnie jeden nowy link albo jedno nowe zdjęcie.');
    const body=cleanUrl?{url:cleanUrl}:{image_data:await fileToDataUrl(file)};
    sessionStorage.setItem('osint.currentInput',JSON.stringify({kind:cleanUrl?'url':'file',value:cleanUrl||file?.name||'upload'}));
    emit('osint:loading',{generation:ctx.generation,input:body.url||file?.name||'upload'});
    const r=await fetch(API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:ctx.controller.signal,cache:'no-store'});
    const j=await r.json();
    if(ctx.generation!==generation) return {ignored:true,reason:'stale-response'};
    if(!r.ok) throw new Error(j.error||'Analiza nie powiodła się');
    sessionStorage.setItem('osint.currentRun',JSON.stringify(j));
    emit('osint:result',j);
    return j;
  }

  function current(){try{return JSON.parse(sessionStorage.getItem('osint.currentRun')||'null');}catch{return null;}}
  function cancel(){resetCurrent();}

  window.OSINTNavigatorFreshRun={analyze,current,cancel,reset:resetCurrent,api:API};
})();
