import crypto from 'node:crypto';
import {safeFetchImage} from './_lib/safe-image-fetch.js';

export const config={maxDuration:60};
const PRIMARY_MODEL=process.env.GEMINI_VISION_MODEL||'gemini-3.6-flash';
const ESCALATION_MODEL=process.env.GEMINI_ESCALATION_MODEL||'gemini-3.1-pro-preview';
const MAX_INLINE=3*1024*1024;

function send(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
  res.end(JSON.stringify(body));
}
function parseDataUrl(input){
  const m=String(input||'').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if(!m) throw new Error('Unsupported inline image. Use JPEG, PNG or WEBP.');
  const buffer=Buffer.from(m[2].replace(/\s/g,''),'base64');
  if(!buffer.length||buffer.length>MAX_INLINE) throw new Error('Inline image must be between 1 byte and 3 MB.');
  return {buffer,contentType:m[1].toLowerCase()};
}
async function loadImage(input){
  const value=String(input||'').trim();
  if(value.startsWith('data:')) return parseDataUrl(value);
  if(/^https?:\/\//i.test(value)){
    const fetched=await safeFetchImage(value);
    return {buffer:fetched.buffer,contentType:fetched.contentType};
  }
  throw new Error('Image must be a data URL or http/https URL.');
}
function outputText(payload){
  if(typeof payload?.output_text==='string') return payload.output_text;
  if(typeof payload?.outputText==='string') return payload.outputText;
  return (payload?.output||[]).flatMap(x=>x.content||[]).map(x=>x.text||'').join('');
}

const bboxSchema={
  type:'object',
  properties:{
    x1:{type:['number','null'],minimum:0,maximum:1},
    y1:{type:['number','null'],minimum:0,maximum:1},
    x2:{type:['number','null'],minimum:0,maximum:1},
    y2:{type:['number','null'],minimum:0,maximum:1}
  },
  required:['x1','y1','x2','y2']
};

const responseSchema={
  type:'object',
  properties:{
    verdict:{type:'string',enum:['MATCH_HIGH','MATCH_POSSIBLE','NO_MATCH','INSUFFICIENT']},
    samePlace:{type:'boolean'},
    confidence:{type:'integer',minimum:0,maximum:100},
    targetVisible:{type:'boolean'},
    target:{
      type:'object',
      properties:{
        x:{type:['number','null'],minimum:0,maximum:1},
        y:{type:['number','null'],minimum:0,maximum:1},
        label:{type:'string'},
        kind:{type:'string',enum:['POLE_BASE','TREE_BASE','BUILDING_POINT','PATH_POINT','OTHER']},
        anchorType:{type:'string',enum:['GROUND_CONTACT_POINT','OBJECT_CENTER','SURFACE_POINT','OTHER']},
        surface:{type:'string',enum:['GRASS','SOIL','CURB','PAVEMENT','ASPHALT','OTHER','UNKNOWN']},
        touchesObject:{type:'boolean'},
        groundContactPoint:{type:'boolean'},
        markerOnAdjacentFlatSurface:{type:'boolean'},
        occludedByVegetation:{type:'boolean'},
        evidence:{type:'string'},
        state:{type:'string',enum:['MATCH','MISMATCH','NOT_VISIBLE']},
        confidence:{type:'integer',minimum:0,maximum:100}
      },
      required:['x','y','label','kind','anchorType','surface','touchesObject','groundContactPoint','markerOnAdjacentFlatSurface','occludedByVegetation','evidence','state','confidence']
    },
    landmarks:{
      type:'array',
      items:{
        type:'object',
        properties:{
          label:{type:'string'},
          category:{type:'string',enum:['ARCHITECTURE','PATH','FIXED_OBJECT','VEGETATION','OTHER']},
          stable:{type:'boolean'},
          state:{type:'string',enum:['MATCH','MISMATCH','NOT_VISIBLE']},
          confidence:{type:'integer',minimum:0,maximum:100},
          referenceBox:bboxSchema,
          currentBox:bboxSchema,
          relation:{type:'string'}
        },
        required:['label','category','stable','state','confidence','referenceBox','currentBox','relation']
      }
    },
    spatialRelations:{
      type:'object',
      properties:{
        state:{type:'string',enum:['MATCH','MISMATCH','NOT_VISIBLE']},
        confidence:{type:'integer',minimum:0,maximum:100},
        notes:{type:'string'}
      },
      required:['state','confidence','notes']
    },
    scores:{
      type:'object',
      properties:{
        architecture:{type:'integer',minimum:0,maximum:100},
        entrancePath:{type:'integer',minimum:0,maximum:100},
        vegetation:{type:'integer',minimum:0,maximum:100},
        fixedObjects:{type:'integer',minimum:0,maximum:100},
        viewpoint:{type:'integer',minimum:0,maximum:100}
      },
      required:['architecture','entrancePath','vegetation','fixedObjects','viewpoint']
    },
    stableLandmarks:{type:'array',items:{type:'string'}},
    conflicts:{type:'array',items:{type:'string'}},
    hint:{type:'string'},
    needsEscalation:{type:'boolean'}
  },
  required:['verdict','samePlace','confidence','targetVisible','target','landmarks','spatialRelations','scores','stableLandmarks','conflicts','hint','needsEscalation']
};

function countStrongStableMatches(result){
  return (result?.landmarks||[]).filter(x=>x?.stable===true&&x?.state==='MATCH'&&Number(x?.confidence)>=65).length;
}
function hasHardStableMismatch(result){
  return (result?.landmarks||[]).some(x=>x?.stable===true&&x?.state==='MISMATCH'&&Number(x?.confidence)>=80);
}
function isPoleBaseTarget(result){
  const t=result?.target||{};
  return t.kind==='POLE_BASE'||/(podstawa|zakotwiczenie|styk).*słup|słup.*(podstawa|zakotwiczenie|styk)|pole.*(base|ground contact)/i.test(String(t.label||''));
}
function evaluateTargetAnchor(result){
  const t=result?.target||{};
  const poleBase=isPoleBaseTarget(result);
  if(!poleBase)return {required:false,valid:true,reason:null};
  const valid=Boolean(
    t.anchorType==='GROUND_CONTACT_POINT'&&
    t.groundContactPoint===true&&
    t.touchesObject===true&&
    t.markerOnAdjacentFlatSurface!==true
  );
  let reason=null;
  if(t.markerOnAdjacentFlatSurface===true)reason='Marker leży na płaskiej powierzchni obok słupa, nie w punkcie styku z podłożem.';
  else if(t.anchorType!=='GROUND_CONTACT_POINT'||t.groundContactPoint!==true)reason='Nie potwierdzono dolnego punktu styku słupa z podłożem.';
  else if(t.touchesObject!==true)reason='Marker nie styka się z wykrytym słupem.';
  return {required:true,valid,reason};
}
function enforceTargetAnchor(result){
  const anchor=evaluateTargetAnchor(result);
  if(!anchor.required||anchor.valid)return result;
  const target={...(result?.target||{})};
  if(target.markerOnAdjacentFlatSurface===true){
    target.state='MISMATCH';
    target.confidence=Math.min(Number(target.confidence)||0,40);
  }else if(target.state==='MATCH'){
    target.state='NOT_VISIBLE';
    target.confidence=Math.min(Number(target.confidence)||0,59);
  }
  const conflicts=[...(result?.conflicts||[])];
  if(anchor.reason&&!conflicts.includes(anchor.reason))conflicts.push(anchor.reason);
  return {...result,target,conflicts,needsEscalation:true};
}
export function evaluateVerification(result){
  const targetMatched=result?.target?.state==='MATCH'&&Number(result?.target?.confidence)>=70;
  const relationsMatched=result?.spatialRelations?.state==='MATCH'&&Number(result?.spatialRelations?.confidence)>=65;
  const stableMatches=countStrongStableMatches(result);
  const hardMismatch=hasHardStableMismatch(result);
  const targetAnchor=evaluateTargetAnchor(result);
  return {
    verified:Boolean(result?.samePlace&&Number(result?.confidence)>=85&&targetMatched&&stableMatches>=2&&relationsMatched&&!hardMismatch&&targetAnchor.valid),
    targetMatched,
    targetAnchorValid:targetAnchor.valid,
    targetAnchorRequired:targetAnchor.required,
    targetAnchorReason:targetAnchor.reason,
    relationsMatched,
    stableMatches,
    hardMismatch
  };
}

function basePrompt({target_marker,target,last_position,telemetry}){
  return `Jesteś modułem wizualnej nawigacji terenowej „OSTATNIE 5 METRÓW”.\n\nOBRAZ 1 = zdjęcie REFERENCYJNE miejsca.\nOBRAZ 2 = zdjęcie wykonane TERAZ przez użytkownika.\n\nCEL: ustal, czy oba obrazy pokazują ten sam fizyczny punkt lub bezpośrednie otoczenie w skali około 5 metrów oraz czy konkretny Target Object ze zdjęcia referencyjnego odpowiada obiektowi w aktualnym kadrze.\n\nNAJWAŻNIEJSZA ZASADA: BRAK WIDOCZNOŚCI NIE JEST NIEZGODNOŚCIĄ. Każdy landmark ma stan MATCH, MISMATCH albo NOT_VISIBLE. Jeżeli budynek jest częściowo zasłonięty krzewami/drzewami, szukaj fragmentów elewacji, krawędzi, dachów, okien i geometrii tła. Nie ustawiaj architecture=0 tylko dlatego, że budynek jest częściowo zasłonięty. MISMATCH oznacza rzeczywistą sprzeczność geometryczną lub cechową.\n\nPRIORYTET DOWODÓW: 1) architektura i geometria budynków, 2) chodniki/ścieżki/krawężniki i ich przebieg, 3) konkretne stałe obiekty (słupy, latarnie, ogrodzenia), 4) relacje przestrzenne między nimi, 5) roślinność wyłącznie jako dowód pomocniczy. Sam fakt istnienia „jakiegoś słupa” albo „krzewów” NIE wystarcza. Rozróżniaj wiele podobnych słupów.\n\nTARGET MARKER na OBRAZIE 1 (znormalizowane 0..1): ${JSON.stringify(target_marker||null)}. Jeżeli marker istnieje, traktuj obiekt pod tym punktem jako Target Object. Jeśli markeru brak, wybierz najbardziej specyficzny trwały anchor, ale nie podnoś przez to confidence.\n\nSPECJALNA REGUŁA DLA PODSTAWY SŁUPA / POLE BASE:\n- Jeśli target na obrazie referencyjnym wskazuje podstawę pionowego metalowego słupa, ustaw target.kind=POLE_BASE i target.anchorType=GROUND_CONTACT_POINT.\n- Targetem NIE jest cały słup ani obszar obok niego. Targetem jest WYŁĄCZNIE dolny punkt styku osi słupa z ziemią/trawą/krawężnikiem/podłożem.\n- Najpierw wykryj krawędzie pionowego słupa, wyznacz jego oś i śledź ją w dół aż do punktu zakotwiczenia. target.x ma leżeć na osi lub bezpośrednio przy osi słupa, a target.y na jego najniższym punkcie styku z podłożem.\n- NIE stawiaj markera na pustym asfalcie, jezdni, chodniku ani innej płaskiej powierzchni obok słupa. Jeśli proponowany marker leży obok obiektu, ustaw markerOnAdjacentFlatSurface=true.\n- Jeśli słup rzeczywiście jest osadzony w asfalcie, surface=ASPHALT jest dozwolone TYLKO gdy marker jednocześnie dotyka słupa i jest jego rzeczywistym ground contact point. Sam asfalt obok słupa nie jest targetem.\n- Jeśli dół słupa jest częściowo zasłonięty trawą, możesz ekstrapolować pionową oś do styku z ziemią tylko wtedy, gdy kontynuacja jest jednoznaczna. Ustaw occludedByVegetation=true i opisz dowód w evidence.\n- Jeśli punkt zakotwiczenia nie jest wystarczająco widoczny ani jednoznacznie wyznaczalny, zwróć target.state=NOT_VISIBLE, targetVisible=false i x/y=null. NIE zgaduj.\n- Dla POLE_BASE wynik MATCH wymaga równocześnie: anchorType=GROUND_CONTACT_POINT, groundContactPoint=true, touchesObject=true oraz markerOnAdjacentFlatSurface=false.\n\nDla każdego ważnego landmarku zwróć bounding box na OBRAZIE 1 i OBRAZIE 2 w skali 0..1. Gdy niewidoczny: wszystkie współrzędne boxa = null. Pole relation ma opisywać konkretną relację, np. „słup przed zakrętem ścieżki, budynek za krzewami po lewej”.\n\nZignoruj ludzi, twarze, tablice rejestracyjne, pojazdy, pogodę, porę dnia, światło i cienie. Roślinność może się zmieniać sezonowo.\n\nGPS i telemetria NIE mogą podnosić confidence wizualnego. Są tylko diagnostyką: target GPS=${JSON.stringify(target||null)}, last_position=${JSON.stringify(last_position||null)}, telemetry=${JSON.stringify(telemetry||null)}. Nie licz metrów ani bearing.\n\nCONFIDENCE: 85+ tylko gdy Target Object pasuje, co najmniej dwa niezależne trwałe landmarki pasują oraz zgadzają się ich relacje przestrzenne. 60-84 = możliwe miejsce, wymaga kolejnego zdjęcia/drugiej opinii. Poniżej 60 = nie zgaduj. hint po polsku, maks. 12 słów, konkretna instrukcja zmiany kadru.\n\nJeżeli widzisz prawdziwą sprzeczność w trwałej architekturze lub geometrii, wypisz ją w conflicts i obniż confidence.`;
}

async function callGemini({model,prompt,reference,current,prior=null}){
  const fullPrompt=prior?`${prompt}\n\nTo jest DRUGA OPINIA. Wynik pierwszego modelu: ${JSON.stringify(prior)}. Oceń obrazy samodzielnie. Nie kopiuj confidence pierwszego modelu. Jeśli pierwszy model pomylił NOT_VISIBLE z MISMATCH albo umieścił punkt POLE_BASE na płaskiej powierzchni obok słupa, popraw to.`:prompt;
  const apiResponse=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{
    method:'POST',
    headers:{'x-goog-api-key':process.env.GEMINI_API_KEY,'content-type':'application/json'},
    body:JSON.stringify({
      model,
      input:[
        {type:'text',text:fullPrompt},
        {type:'image',mime_type:reference.contentType,data:reference.buffer.toString('base64')},
        {type:'image',mime_type:current.contentType,data:current.buffer.toString('base64')}
      ],
      response_format:{type:'text',mime_type:'application/json',schema:responseSchema}
    })
  });
  const raw=await apiResponse.json();
  if(!apiResponse.ok)throw new Error(`${model} failed: HTTP ${apiResponse.status}${raw?.error?.message?` · ${raw.error.message}`:''}`);
  const text=outputText(raw);
  if(!text)throw new Error(`${model} returned no structured text`);
  return JSON.parse(text);
}

function shouldEscalate(primary){
  const c=Number(primary?.confidence)||0;
  const anchor=evaluateTargetAnchor(primary);
  return Boolean(primary?.needsEscalation||(c>=60&&c<85)||hasHardStableMismatch(primary)||(primary?.conflicts||[]).length>0||!anchor.valid);
}

export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{error:'Method not allowed'});}
  if(!process.env.GEMINI_API_KEY)return send(res,503,{error:'GEMINI_API_KEY missing. Configure the secret server-side.'});
  const {reference_image,current_image,target,last_position,target_marker,telemetry}=req.body||{};
  if(!reference_image||!current_image)return send(res,400,{error:'reference_image and current_image are required'});
  const run_id=crypto.randomUUID();
  try{
    const [reference,current]=await Promise.all([loadImage(reference_image),loadImage(current_image)]);
    const prompt=basePrompt({target_marker,target,last_position,telemetry});
    let primary=await callGemini({model:PRIMARY_MODEL,prompt,reference,current});
    primary=enforceTargetAnchor(primary);
    const primaryGate=evaluateVerification(primary);

    let secondary=null;
    let escalationError=null;
    if(shouldEscalate(primary)){
      try{
        secondary=await callGemini({model:ESCALATION_MODEL,prompt,reference,current,prior:primary});
        secondary=enforceTargetAnchor(secondary);
      }catch(e){escalationError=e.message;}
    }

    let result=secondary||primary;
    let gate=evaluateVerification(result);
    let modelAgreement=true;
    if(secondary){
      modelAgreement=Boolean(primary.samePlace===secondary.samePlace);
      if(!modelAgreement){
        result={...secondary,verdict:'INSUFFICIENT',samePlace:false,confidence:Math.min(Number(primary.confidence)||0,Number(secondary.confidence)||0,59),needsEscalation:true,conflicts:[...(secondary.conflicts||[]),'Modele 3.6 Flash i 3.1 Pro nie zgadzają się co do miejsca.']};
        gate=evaluateVerification(result);
      }
    }

    const verified=Boolean(gate.verified&&modelAgreement);
    const verdict=verified?'MATCH_HIGH':result.verdict==='MATCH_HIGH'?'MATCH_POSSIBLE':result.verdict;
    return send(res,200,{
      run_id,
      model:secondary?`${PRIMARY_MODEL} + ${ESCALATION_MODEL}`:PRIMARY_MODEL,
      primary_model:PRIMARY_MODEL,
      escalation_model:secondary?ESCALATION_MODEL:null,
      escalated:Boolean(secondary),
      escalation_error:escalationError,
      model_agreement:modelAgreement,
      verified,
      verification_gate:gate,
      ...result,
      verdict,
      primary_result:secondary?primary:undefined,
      primary_gate:secondary?primaryGate:undefined
    });
  }catch(e){return send(res,500,{run_id,error:e.message});}
}
