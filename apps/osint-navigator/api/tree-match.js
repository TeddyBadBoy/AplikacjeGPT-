import proj4 from 'proj4';

const ARCGIS='https://services.arcgis.com/VU1dOESuQS3Z8oTW/ArcGIS/rest/services/Drzewa_do_piel%C4%99gnacji_2023_zewn%C4%99trzna/FeatureServer/12/query';
const WFS_SERVICES=[
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
function normalizeCandidate(properties,point,target,radius,source){const distance_m=hav(target,point);return {id:firstProp(properties,/^(id|objectid|fid|ident|nr|numer)|(_id)$/i),species:firstProp(properties,/(gatunek|species|nazwa.*gat|nazwa.*lac|nazwa.*pol|rodzaj)/i),circumference:firstProp(properties,/(obwod|obwód|circum|pierśnic|piersnic)/i),height:firstProp(properties,/(wysok|height)/i),lat:point.lat,lon:point.lon,distance_m:+distance_m.toFixed(2),proximity_score:+Math.max(0,1-distance_m/Math.max(radius,1)).toFixed(3),source,verified:false,properties};}

async function fetchArcGis(lat,lon,radius){
  const q=new URLSearchParams({where:'1=1',geometry:`${lon},${lat}`,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',distance:String(radius),units:'esriSRUnit_Meter',outFields:'*',returnGeometry:'true',outSR:'4326',f:'json'});
  const r=await fetch(`${ARCGIS}?${q}`,{headers:{'user-agent':'OSINT-Navigator/0.4','accept':'application/json'},signal:AbortSignal.timeout(7000)});
  if(!r.ok)throw new Error(`ArcGIS HTTP ${r.status}`);
  const j=await r.json();if(j.error)throw new Error(`ArcGIS ${j.error.code||''}: ${j.error.message||'query error'}`);
  const candidates=[];
  for(const f of j.features||[]){const x=Number(f.geometry?.x),y=Number(f.geometry?.y);if(!Number.isFinite(x)||!Number.isFinite(y))continue;const point={lat:y,lon:x};const row=normalizeCandidate(f.attributes||{},point,{lat,lon},radius,'ARCGIS_MOKOTOW_2019');if(row.distance_m<=radius*1.6)candidates.push(row);}
  candidates.sort((a,b)=>a.distance_m-b.distance_m);
  return {candidates,fields:j.fields||[]};
}

async function discoverWfs(){const attempts=[];for(const svc of WFS_SERVICES){try{const r=await fetch(`${svc.url}?SERVICE=WFS&REQUEST=GetCapabilities&VERSION=1.1.0`,{headers:{'user-agent':'OSINT-Navigator/0.4'},redirect:'follow',signal:AbortSignal.timeout(3500)});if(!r.ok)throw new Error(`HTTP ${r.status}`);const xml=await r.text(),names=[...xml.matchAll(/<(?:\w+:)?Name>([^<]*ZIELEN_DRZEWA[^<]*)<\/(?:\w+:)?Name>/gi)].map(x=>clean(x[1]));if(!names.length)throw new Error('ZIELEN_DRZEWA not advertised');return{...svc,layer:names[0],attempts};}catch(e){attempts.push({url:svc.url,error:e.message});}}const err=new Error('No Warsaw WFS endpoint available');err.attempts=attempts;throw err;}
function parseProps(member){const props={},re=/<(?:[\w.-]+:)?([\w.-]+)(?:\s[^>]*)?>([^<>]{0,800})<\/(?:[\w.-]+:)?\1>/g;for(const m of member.matchAll(re)){const k=m[1];if(/^(pos|coordinates|lowerCorner|upperCorner)$/i.test(k))continue;const v=clean(m[2]);if(v)props[k]=v;}return props;}
function parsePoint(member,target){const raw=[];for(const m of member.matchAll(/<(?:gml:)?pos(?:\s[^>]*)?>([^<]+)<\/(?:gml:)?pos>/gi))raw.push(m[1]);for(const txt of raw){const nums=(txt.match(/-?\d+(?:\.\d+)?/g)||[]).map(Number);if(nums.length<2)continue;const a=nums[0],b=nums[1];if(Math.abs(a)>1000||Math.abs(b)>1000){try{const[lon,lat]=proj4('EPSG:2178',WGS84,[a,b]);return{lat,lon};}catch{}}const p1={lat:a,lon:b},p2={lat:b,lon:a},valid=p=>Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;if(valid(p1)&&valid(p2))return hav(target,p1)<=hav(target,p2)?p1:p2;if(valid(p1))return p1;if(valid(p2))return p2;}return null;}
async function fetchWfs(service,layer,lat,lon,radius){const[x,y]=proj4(WGS84,'EPSG:2178',[lon,lat]),bbox=[x-radius,y-radius,x+radius,y+radius].join(',')+',EPSG:2178',q=new URLSearchParams({SERVICE:'WFS',VERSION:'1.1.0',REQUEST:'GetFeature',TYPENAME:layer,SRSNAME:'EPSG:2178',BBOX:bbox,MAXFEATURES:'100'}),r=await fetch(`${service.url}?${q}`,{headers:{'user-agent':'OSINT-Navigator/0.4'},signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error(`WFS HTTP ${r.status}`);const xml=await r.text();const members=xml.match(/<(?:gml:)?featureMember\b[\s\S]*?<\/(?:gml:)?featureMember>/gi)||[];const candidates=[];for(const member of members){const point=parsePoint(member,{lat,lon});if(!point)continue;const row=normalizeCandidate(parseProps(member),point,{lat,lon},radius,'WARSZAWA_WFS_ZIELEN_DRZEWA');if(row.distance_m<=radius*1.6)candidates.push(row);}candidates.sort((a,b)=>a.distance_m-b.distance_m);return{candidates};}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});}
  const input=req.method==='GET'?req.query:(req.body||{}),lat=safeNum(input.lat),lon=safeNum(input.lon),radius=Math.max(5,Math.min(80,safeNum(input.radius_m)??25));
  if(lat===null||lon===null||Math.abs(lat)>90||Math.abs(lon)>180)return res.status(400).json({error:'Invalid lat/lon'});
  const diagnostics=[];
  try{
    const a=await fetchArcGis(lat,lon,radius);diagnostics.push({source:'ARCGIS_MOKOTOW_2019',ok:true,count:a.candidates.length});
    if(a.candidates.length){const best=a.candidates[0];return res.status(200).json({status:'TREE_CANDIDATES_FOUND',query:{lat,lon,radius_m:radius},source:{type:'ArcGIS REST',layer:'Mokotow_2019',dataset:'Drzewa do pielęgnacji 2023'},best,candidates:a.candidates.slice(0,12),verification:{verified:false,rule:'Nearest mapped tree is a candidate; confirm visually in field.'},diagnostics});}
    return res.status(200).json({status:'NO_TREE_IN_ARCGIS_LAYER',query:{lat,lon,radius_m:radius},source:{type:'ArcGIS REST',layer:'Mokotow_2019',dataset:'Drzewa do pielęgnacji 2023'},best:null,candidates:[],verification:{verified:false,rule:'This layer is not guaranteed to contain every tree.'},diagnostics});
  }catch(e){diagnostics.push({source:'ARCGIS_MOKOTOW_2019',ok:false,error:e.message});}
  try{const svc=await discoverWfs(),w=await fetchWfs(svc,svc.layer,lat,lon,radius);diagnostics.push({source:'WARSZAWA_WFS',ok:true,count:w.candidates.length});const best=w.candidates[0]||null;return res.status(200).json({status:best?'TREE_CANDIDATES_FOUND':'NO_TREE_IN_RADIUS',query:{lat,lon,radius_m:radius},source:{type:'Warsaw WFS',service:svc.url,layer:svc.layer},best,candidates:w.candidates.slice(0,12),verification:{verified:false,rule:'Nearest mapped tree is a candidate; confirm visually in field.'},diagnostics});}catch(e){diagnostics.push({source:'WARSZAWA_WFS',ok:false,error:e.message,attempts:e.attempts||[]});return res.status(502).json({status:'TREE_MATCH_FAILED',error:'All tree data sources failed',diagnostics});}
}
