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
