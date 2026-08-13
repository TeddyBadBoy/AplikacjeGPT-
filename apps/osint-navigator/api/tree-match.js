import proj4 from 'proj4';

const SERVICES=[
  {url:'https://wms2.um.warszawa.pl/geoserver/wfs/wfs',kind:'geoserver'},
  {url:'http://wms2.um.warszawa.pl/geoserver/wfs/wfs',kind:'geoserver'},
  {url:'https://wfs.um.warszawa.pl/serwis',kind:'legacy'}
];
const WGS84='EPSG:4326';
const PL2000_7='+proj=tmerc +lat_0=0 +lon_0=21 +k=0.999923 +x_0=7500000 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs';
proj4.defs('EPSG:2178',PL2000_7);

function hav(a,b){const R=6371000,rad=x=>x*Math.PI/180,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon),s=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(s));}
function safeNum(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function clean(v=''){return String(v).replace(/<!\[CDATA\[|\]\]>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();}
function firstProp(props,re){const k=Object.keys(props||{}).find(x=>re.test(x));return k?props[k]:null;}
function normalizeCandidate(properties,point,target,radius){const distance_m=hav(target,point);return {id:firstProp(properties,/^(id|objectid|fid|ident|nr|numer)|(_id)$/i),species:firstProp(properties,/(gatunek|species|nazwa.*gat|nazwa.*lac|nazwa.*pol)/i),circumference:firstProp(properties,/(obwod|obwód|circum)/i),height:firstProp(properties,/(wysok|height)/i),lat:point.lat,lon:point.lon,distance_m:+distance_m.toFixed(2),proximity_score:+Math.max(0,1-distance_m/Math.max(radius,1)).toFixed(3),source:'WARSZAWA_WFS_ZIELEN_DRZEWA',verified:false,properties};}

async function discover(){
  const attempts=[];
  for(const svc of SERVICES){
    try{
      const u=`${svc.url}?SERVICE=WFS&REQUEST=GetCapabilities&VERSION=1.1.0`;
      const r=await fetch(u,{headers:{'user-agent':'OSINT-Navigator/0.4'},redirect:'follow',signal:AbortSignal.timeout(5000)});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const xml=await r.text();
      const names=[...xml.matchAll(/<(?:\w+:)?Name>([^<]*ZIELEN_DRZEWA[^<]*)<\/(?:\w+:)?Name>/gi)].map(x=>clean(x[1]));
      if(!names.length)throw new Error('ZIELEN_DRZEWA not advertised');
      return {...svc,layer:names[0],attempts};
    }catch(e){attempts.push({url:svc.url,error:e.message});}
  }
  const err=new Error('No Warsaw WFS endpoint available');err.attempts=attempts;throw err;
}

async function fetchGeoJson(service,layer,lat,lon,radius){
  const [x,y]=proj4(WGS84,'EPSG:2178',[lon,lat]);
  const bbox=[x-radius,y-radius,x+radius,y+radius].join(',')+',EPSG:2178';
  const q=new URLSearchParams({SERVICE:'WFS',VERSION:'1.1.0',REQUEST:'GetFeature',TYPENAME:layer,SRSNAME:'EPSG:4326',BBOX:bbox,MAXFEATURES:'100',OUTPUTFORMAT:'application/json'});
  const r=await fetch(`${service.url}?${q}`,{headers:{'user-agent':'OSINT-Navigator/0.4','accept':'application/json'},redirect:'follow',signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw new Error(`GeoServer GetFeature HTTP ${r.status}`);
  const text=await r.text();
  if(/ExceptionReport|ServiceException/i.test(text))throw new Error(clean((text.match(/<(?:ows:)?ExceptionText[^>]*>([^<]+)/i)||[])[1]||'WFS exception'));
  const json=JSON.parse(text);
  const candidates=[];
  for(const f of json.features||[]){
    let c=f.geometry?.coordinates;if(!Array.isArray(c)||c.length<2)continue;
    let lon2=Number(c[0]),lat2=Number(c[1]);
    if(Math.abs(lon2)>180||Math.abs(lat2)>90){try{[lon2,lat2]=proj4('EPSG:2178',WGS84,[lon2,lat2]);}catch{continue;}}
    const point={lat:lat2,lon:lon2};if(Math.abs(point.lat)>90||Math.abs(point.lon)>180)continue;
    const row=normalizeCandidate(f.properties||{},point,{lat,lon},radius);if(row.distance_m<=radius*1.6)candidates.push(row);
  }
  return {candidates,center:{x,y},mode:'geojson'};
}

function parseProps(member){const props={},re=/<(?:[\w.-]+:)?([\w.-]+)(?:\s[^>]*)?>([^<>]{0,800})<\/(?:[\w.-]+:)?\1>/g;for(const m of member.matchAll(re)){const k=m[1];if(/^(pos|coordinates|lowerCorner|upperCorner)$/i.test(k))continue;const v=clean(m[2]);if(v)props[k]=v;}return props;}
function parsePoint(member,target){const raw=[];for(const m of member.matchAll(/<(?:gml:)?pos(?:\s[^>]*)?>([^<]+)<\/(?:gml:)?pos>/gi))raw.push(m[1]);for(const m of member.matchAll(/<(?:gml:)?coordinates(?:\s[^>]*)?>([^<]+)<\/(?:gml:)?coordinates>/gi))raw.push(m[1]);for(const txt of raw){const nums=(txt.match(/-?\d+(?:\.\d+)?/g)||[]).map(Number);if(nums.length<2)continue;const a=nums[0],b=nums[1];if(Math.abs(a)>1000||Math.abs(b)>1000){try{const[lon,lat]=proj4('EPSG:2178',WGS84,[a,b]);return{lat,lon};}catch{}}const p1={lat:a,lon:b},p2={lat:b,lon:a},valid=p=>Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;if(valid(p1)&&valid(p2))return hav(target,p1)<=hav(target,p2)?p1:p2;if(valid(p1))return p1;if(valid(p2))return p2;}return null;}
function featureMembers(xml){return xml.match(/<(?:gml:)?featureMember\b[\s\S]*?<\/(?:gml:)?featureMember>/gi)||xml.match(/<(?:wfs:)?member\b[\s\S]*?<\/(?:wfs:)?member>/gi)||[];}
async function fetchGml(service,layer,lat,lon,radius){const[x,y]=proj4(WGS84,'EPSG:2178',[lon,lat]),bbox=[x-radius,y-radius,x+radius,y+radius].join(',')+',EPSG:2178',q=new URLSearchParams({SERVICE:'WFS',VERSION:'1.1.0',REQUEST:'GetFeature',TYPENAME:layer,SRSNAME:'EPSG:2178',BBOX:bbox,MAXFEATURES:'100'}),r=await fetch(`${service.url}?${q}`,{headers:{'user-agent':'OSINT-Navigator/0.4'},redirect:'follow',signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error(`WFS GetFeature HTTP ${r.status}`);const xml=await r.text();if(/ExceptionReport|ServiceException/i.test(xml))throw new Error(clean((xml.match(/<(?:ows:)?ExceptionText[^>]*>([^<]+)/i)||[])[1]||'WFS exception'));const candidates=[];for(const member of featureMembers(xml)){const point=parsePoint(member,{lat,lon});if(!point)continue;const row=normalizeCandidate(parseProps(member),point,{lat,lon},radius);if(row.distance_m<=radius*1.6)candidates.push(row);}return{candidates,center:{x,y},mode:'gml'};}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});}
  const input=req.method==='GET'?req.query:(req.body||{}),lat=safeNum(input.lat),lon=safeNum(input.lon),radius=Math.max(5,Math.min(60,safeNum(input.radius_m)??25));
  if(lat===null||lon===null||Math.abs(lat)>90||Math.abs(lon)>180)return res.status(400).json({error:'Invalid lat/lon'});
  try{
    const service=await discover();
    let result;
    try{result=service.kind==='geoserver'?await fetchGeoJson(service,service.layer,lat,lon,radius):await fetchGml(service,service.layer,lat,lon,radius);}catch(first){if(service.kind==='geoserver')result=await fetchGml(service,service.layer,lat,lon,radius);else throw first;}
    result.candidates.sort((a,b)=>a.distance_m-b.distance_m);const best=result.candidates[0]||null;
    return res.status(200).json({status:best?'TREE_CANDIDATES_FOUND':'NO_TREE_IN_RADIUS',query:{lat,lon,radius_m:radius},source:{service:service.url,layer:service.layer,mode:result.mode},best,candidates:result.candidates.slice(0,12),verification:{verified:false,rule:'Proximity is not identity. Confirm trunk visually or with a current field photo.'},debug:{query_center_epsg2178:{x:+result.center.x.toFixed(3),y:+result.center.y.toFixed(3)},endpoint_attempts:service.attempts}});
  }catch(e){return res.status(502).json({status:'TREE_MATCH_FAILED',error:e.message,attempts:e.attempts||[],source:'Warsaw WFS'});}
}
