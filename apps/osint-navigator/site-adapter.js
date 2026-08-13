(()=>{
  const API='https://osint-navigator-engine.vercel.app/api/run';
  let controller=null;
  let generation=0;
  let inputKey='';
  let runningKey='';

  function emit(name,detail){window.dispatchEvent(new CustomEvent(name,{detail}));}
  function keyFor({url,file}={}){
    const clean=typeof url==='string'?url.trim():'';
    if(clean) return `url:${clean}`;
    if(file) return `file:${file.name||'upload'}:${file.size||0}:${file.lastModified||0}`;
    return '';
  }
  function clearVisibleState(reason='new-input'){
    sessionStorage.removeItem('osint.currentRun');
    sessionStorage.removeItem('osint.currentInput');
    emit('osint:reset',{generation,reason});
  }
  function abortPrevious(reason='superseded'){
    if(controller){try{controller.abort(reason);}catch{}}
    controller=null;
    runningKey='';
  }
  function inputChanged(input={}){
    const next=keyFor(input);
    if(!next||next===inputKey) return {changed:false,generation};
    generation+=1;
    inputKey=next;
    abortPrevious('input-changed');
    clearVisibleState('input-changed');
    return {changed:true,generation};
  }
  function blobToDataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error||new Error('File read failed'));r.readAsDataURL(blob);});}
  async function fileToDataUrl(file){
    if(!file||!/^image\/(jpeg|png|webp)$/i.test(file.type||'')) throw new Error('Obsługiwane: JPG, PNG, WEBP.');
    if(file.size>12*1024*1024) throw new Error('Zdjęcie przekracza 12 MB.');
    if(file.size<=2.5*1024*1024) return blobToDataUrl(file);
    try{
      const bmp=await createImageBitmap(file);
      const max=1600,scale=Math.min(1,max/Math.max(bmp.width,bmp.height));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bmp.width*scale));canvas.height=Math.max(1,Math.round(bmp.height*scale));
      canvas.getContext('2d',{alpha:false}).drawImage(bmp,0,0,canvas.width,canvas.height);bmp.close?.();
      let blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',0.82));
      if(blob?.size>3.2*1024*1024) blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',0.68));
      if(!blob||blob.size>3.5*1024*1024) throw new Error('Nie udało się zmniejszyć zdjęcia do limitu API.');
      return blobToDataUrl(blob);
    }catch(e){if(file.size<=3.2*1024*1024)return blobToDataUrl(file);throw e;}
  }

  async function analyze({url,file}={}){
    const cleanUrl=typeof url==='string'?url.trim():'';
    if(Boolean(cleanUrl)===Boolean(file)) throw new Error('Podaj dokładnie jeden nowy link albo jedno nowe zdjęcie.');
    const nextKey=keyFor({url:cleanUrl,file});

    // Reset only when the INPUT really changed. Do not reset a second time on submit.
    if(nextKey!==inputKey){
      generation+=1;
      inputKey=nextKey;
      abortPrevious('new-run-input');
      clearVisibleState('new-run-input');
    }else{
      // Same input may be retried; abort only an older request for the same input.
      abortPrevious('retry-same-input');
    }

    const runGeneration=generation;
    const runKey=nextKey;
    controller=new AbortController();
    runningKey=runKey;
    const localController=controller;

    const body=cleanUrl?{url:cleanUrl}:{image_data:await fileToDataUrl(file)};
    // If input changed during expensive image conversion, do not send a stale request.
    if(runGeneration!==generation||runKey!==inputKey) return {ignored:true,reason:'stale-before-send'};

    sessionStorage.setItem('osint.currentInput',JSON.stringify({kind:cleanUrl?'url':'file',value:cleanUrl||file?.name||'upload'}));
    emit('osint:loading',{generation:runGeneration,input:body.url||file?.name||'upload'});

    try{
      const r=await fetch(API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:localController.signal,cache:'no-store'});
      const j=await r.json();
      if(runGeneration!==generation||runKey!==inputKey||runningKey!==runKey) return {ignored:true,reason:'stale-response'};
      if(!r.ok) throw new Error(j.error||'Analiza nie powiodła się');
      sessionStorage.setItem('osint.currentRun',JSON.stringify(j));
      emit('osint:result',j);
      return j;
    }catch(e){
      if(e?.name==='AbortError'||localController.signal.aborted){
        // Superseded analyses are normal control flow, never a user-visible failure.
        return {ignored:true,reason:'aborted-superseded'};
      }
      if(runGeneration===generation&&runKey===inputKey) emit('osint:error',{message:e.message||String(e),generation:runGeneration});
      throw e;
    }finally{
      if(controller===localController) controller=null;
      if(runningKey===runKey) runningKey='';
    }
  }

  function current(){try{return JSON.parse(sessionStorage.getItem('osint.currentRun')||'null');}catch{return null;}}
  function cancel(){generation+=1;abortPrevious('manual-cancel');clearVisibleState('manual-cancel');}

  window.OSINTNavigatorFreshRun={analyze,current,cancel,inputChanged,api:API};
})();
