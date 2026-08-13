import proj4 from 'proj4';

const ARCGIS='https://services.arcgis.com/VU1dOESuQS3Z8oTW/ArcGIS/rest/services/Drzewa_do_piel%C4%99gnacji_2023_zewn%C4%99trzna/FeatureServer/12/query';
const FALLING_FRUIT='https://fallingfruit.org/api/0.3';
const FALLING_FRUIT_KEY='AKDJGHSD';
const WARSAW_IMPORT='Drzewa w Warszawie';
const WFS_SERVICES=[
  {url:'https://wms2.um.warszawa.pl/geoserver/wfs/wfs'},
  {url:'http://wms2.um.warszawa.pl/geoserver/wfs/wfs'},
  {url:'https://wfs.um.warszawa.pl/serwis'}
];
const WGS84='EPSG:4326';
const PL2000_7='+proj=tmerc +lat_0=0 +lon_0=21 +k=0.999923 +x_0=7500000 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs';
proj4.defs('EPSG:2178',PL2000_7);

function rad(x){return x*Math.PI/180;}
function deg(x){return x*180/Math.PI;}
function hav(a,b){const R=6371000,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon),s=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(s));}
function bearing(a,b){const y=Math.sin(rad(b.lon-a.lon))*Math.cos(rad(b.lat));const x=Math.cos(rad(a.lat))*Math.sin(rad(b.lat))-Math.sin(rad(a.lat))*Math.cos(rad(b.lat))*Math.cos(rad(b.lon-a.lon));return(deg(Math.atan2(y,x))+360)%360;}
function compass(b){return ['N','NE','E','SE','S','SW','W','NW'][Math.round(b/45)%8];}
function safeNum(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function clean(v=''){return String(v).replace(/<!\[CDATA\[|\]\]>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();}
function firstProp(props,re){const k=Object.keys(props||{}).find(x=>re.test(x));return k?props[k]:null;}
function navFields(target,point){const b=bearing(target,point);return{bearing_deg:+b.toFixed(1),bearing_compass:compass(b)};}
function normalizeCandidate(properties,point,target,radius,source,extra={}){const distance_m=hav(target,point);return {id:firstProp(properties,/^(id|objectid|fid|ident|nr|numer)|(_id)$/i),species:firstProp(properties,/(gatunek|species|nazwa.*gat|nazwa.*lac|nazwa.*pol|rodzaj)/i),circumference:firstProp(properties,/(obwod|obwód|circum|pierśnic|piersnic)/i),height:firstProp(properties,/(wysok|height)/i),lat:point.lat,lon:point.lon,distance_m:+distance_m.toFixed(2),...navFields(target,point),proximity_score:+Math.max(0,1-distance_m/Math.max(radius,1)).toFixed(3),source,verified:false,...extra,properties};}

async function fetchArcGis(lat,lon,radius){
  const q=new URLSearchParams({where:'1=1',geometry:`${lon},${lat}`,geometryType:'esriGeometryPoint',inSR:'4326',spatialRel:'esriSpatialRelIntersects',distance:String(radius),units:'esriSRUnit_Meter',outFields:'*',returnGeometry:'true',outSR:'4326',f:'json'});
  const r=await fetch(`${ARCGIS}?${q}`,{headers:{'user-agent':'OSINT-Navigator/0.4.4','accept':'application/json'},signal:AbortSignal.timeout(7000)});
  if(!r.ok)throw new Error(`ArcGIS HTTP ${r.status}`);
  const j=await r.json();if(j.error)throw new Error(`ArcGIS ${j.error.code||''}: ${j.error.message||'query error'}`);
  const candidates=[];
  for(const f of j.features||[]){const x=Number(f.geometry?.x),y=Number(f.geometry?.y);if(!Number.isFinite(x)||!Number.isFinite(y))continue;const row=normalizeCandidate(f.attributes||{},{lat:y,lon:x},{lat,lon},radius,'ARCGIS_MOKOTOW_2019');if(row.distance_m<=radius)candidates.push(row);}
  candidates.sort((a,b)=>a.distance_m-b.distance_m);return candidates;
}

async function fetchFallingFruit(lat,lon,radius){
  const searchRadius=Math.max(radius,100);
  const latD=searchRadius/111320;
  const lonD=searchRadius/(111320*Math.max(0.2,Math.cos(lat*Math.PI/180)));
  const bounds=`${lat-latD},${lon-lonD}|${lat+latD},${lon+lonD}`;
  const q=new URLSearchParams({api_key:FALLING_FRUIT_KEY,bounds,center:`${lat},${lon}`,muni:'true',limit:'40'});
  const r=await fetch(`${FALLING_FRUIT}/locations?${q}`,{headers:{'user-agent':'OSINT-Navigator/0.4.4','accept':'application/json'},signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw new Error(`Falling Fruit locations HTTP ${r.status}`);
  const list=await r.json();if(!Array.isArray(list))throw new Error('Falling Fruit returned non-array locations');
  const nearby=list.filter(x=>Number.isFinite(Number(x.lat))&&Number.isFinite(Number(x.lng))).slice(0,24);
  const details=await Promise.all(nearby.map(async item=>{
    try{const d=await fetch(`${FALLING_FRUIT}/locations/${item.id}?api_key=${FALLING_FRUIT_KEY}&embed=import`,{headers:{'user-agent':'OSINT-Navigator/0.4.4','accept':'application/json'},signal:AbortSignal.timeout(4500)});if(!d.ok)return null;return{item,detail:await d.json()};}catch{return null;}
  }));
  const all=[];
  for(const row of details){
    if(!row)continue;
    const {item,detail}=row;
    if(detail?.muni!==true||detail?.import?.name!==WARSAW_IMPORT)continue;
    const point={lat:Number(item.lat),lon:Number(item.lng)};
    const distance_m=Number.isFinite(Number(item.distance))?Number(item.distance):hav({lat,lon},point);
    const b=bearing({lat,lon},point);
    all.push({
      id:item.id,
      species:Array.isArray(item.type_names)?item.type_names.join(', '):null,
      lat:point.lat,lon:point.lon,distance_m:+distance_m.toFixed(2),
      bearing_deg:+b.toFixed(1),bearing_compass:compass(b),
      proximity_score:+Math.max(0,1-distance_m/Math.max(searchRadius,1)).toFixed(3),
      source:'FALLING_FRUIT_WARSAW_2016',source_age:'imported 2016-04-19; stale fallback',verified:false,municipal_inventory:true,
      import:{id:detail.import.id,name:detail.import.name,created_at:detail.import.created_at,location_count:detail.import.location_count},
      detail:{address:detail?.address||null,city:detail?.city||null,unverified:detail?.unverified??null,type_ids:item.type_ids||[]}
    });
  }
  all.sort((a,b)=>a.distance_m-b.distance_m);
  return {within:all.filter(x=>x.distance_m<=radius),all,bounds,raw_count:list.length};
}

async function discoverWfs(){const attempts=[];for(const svc of WFS_SERVICES){try{const r=await fetch(`${svc.url}?SERVICE=WFS&REQUEST=GetCapabilities&VERSION=1.1.0`,{headers:{'user-agent':'OSINT-Navigator/0.4.4'},redirect:'follow',signal:AbortSignal.timeout(3000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);const xml=await r.text(),names=[...xml.matchAll(/<(?:\w+:)?Name>([^<]*ZIELEN_DRZEWA[^<]*)<\/(?:\w+:)?Name>/gi)].map(x=>clean(x[1]));if(!names.length)throw new Error('ZIELEN_DRZEWA not advertised');return{...svc,layer:names[0],attempts};}catch(e){attempts.push({url:svc.url,error:e.message});}}const err=new Error('No Warsaw WFS endpoint available');err.attempts=attempts;throw err;}
function parseProps(member){const props={},re=/<(?:[\w.-]+:)?([\w.-]+)(?:\s[^>]*)?>([^<>]{0,800})<\/(?:[\w.-]+:)?\1>/g;for(const m of member.matchAll(re)){const k=m[1];if(/^(pos|coordinates|lowerCorner|upperCorner)$/i.test(k))continue;const v=clean(m[2]);if(v)props[k]=v;}return props;}
function parsePoint(member,target){const raw=[];for(const m of member.matchAll(/<(?:gml:)?pos(?:\s[^>]*)?>([^<]+)<\/(?:gml:)?pos>/gi))raw.push(m[1]);for(const txt of raw){const nums=(txt.match(/-?\d+(?:\.\d+)?/g)||[]).map(Number);if(nums.length<2)continue;const a=nums[0],b=nums[1];if(Math.abs(a)>1000||Math.abs(b)>1000){try{const[lon,lat]=proj4('EPSG:2178',WGS84,[a,b]);return{lat,lon};}catch{}}const p1={lat:a,lon:b},p2={lat:b,lon:a},valid=p=>Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;if(valid(p1)&&valid(p2))return hav(target,p1)<=hav(target,p2)?p1:p2;if(valid(p1))return p1;if(valid(p2))return p2;}return null;}
async function fetchWfs(service,layer,lat,lon,radius){const[x,y]=proj4(WGS84,'EPSG:2178',[lon,lat]),bbox=[x-radius,y-radius,x+radius,y+radius].join(',')+',EPSG:2178',q=new URLSearchParams({SERVICE:'WFS',VERSION:'1.1.0',REQUEST:'GetFeature',TYPENAME:layer,SRSNAME:'EPSG:2178',BBOX:bbox,MAXFEATURES:'100'}),r=await fetch(`${service.url}?${q}`,{headers:{'user-agent':'OSINT-Navigator/0.4.4'},signal:AbortSignal.timeout(4500)});if(!r.ok)throw new Error(`WFS HTTP ${r.status}`);const xml=await r.text();const members=xml.match(/<(?:gml:)?featureMember\b[\s\S]*?<\/(?:gml:)?featureMember>/gi)||[];const candidates=[];for(const member of members){const point=parsePoint(member,{lat,lon});if(!point)continue;const row=normalizeCandidate(parseProps(member),point,{lat,lon},radius,'WARSZAWA_WFS_ZIELEN_DRZEWA');if(row.distance_m<=radius)candidates.push(row);}candidates.sort((a,b)=>a.distance_m-b.distance_m);return candidates;}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});}
  const input=req.method==='GET'?req.query:(req.body||{}),lat=safeNum(input.lat),lon=safeNum(input.lon),radius=Math.max(5,Math.min(80,safeNum(input.radius_m)??25));
  if(lat===null||lon===null||Math.abs(lat)>90||Math.abs(lon)>180)return res.status(400).json({error:'Invalid lat/lon'});
  const diagnostics=[];
  try{const a=await fetchArcGis(lat,lon,radius);diagnostics.push({source:'ARCGIS_MOKOTOW_2019',ok:true,count:a.length});if(a.length)return res.status(200).json({status:'TREE_CANDIDATES_FOUND',query:{lat,lon,radius_m:radius},source:{type:'ArcGIS REST',layer:'Mokotow_2019',dataset:'Drzewa do pielęgnacji 2023'},best:a[0],candidates:a.slice(0,12),nearest_outside:null,verification:{verified:false,rule:'Nearest mapped tree is a candidate; confirm visually in field.'},diagnostics});}catch(e){diagnostics.push({source:'ARCGIS_MOKOTOW_2019',ok:false,error:e.message});}
  try{
    const ff=await fetchFallingFruit(lat,lon,radius);diagnostics.push({source:'FALLING_FRUIT_WARSAW_2016',ok:true,count_within:ff.within.length,count_tree_records:ff.all.length,raw_count:ff.raw_count});
    if(ff.within.length)return res.status(200).json({status:'TREE_CANDIDATES_FOUND_STALE',query:{lat,lon,radius_m:radius},source:{type:'Falling Fruit API',dataset:WARSAW_IMPORT,imported:'2016-04-19',freshness:'STALE_FALLBACK'},best:ff.within[0],candidates:ff.within.slice(0,12),nearest_outside:ff.all.find(x=>x.distance_m>radius)||null,verification:{verified:false,rule:'Historical municipal inventory. Use only to nominate a trunk, then confirm visually.'},diagnostics});
    if(ff.all.length)return res.status(200).json({status:'NO_TREE_WITHIN_RADIUS',query:{lat,lon,radius_m:radius},source:{type:'Falling Fruit API',dataset:WARSAW_IMPORT,imported:'2016-04-19',freshness:'STALE_FALLBACK'},best:null,candidates:[],nearest_outside:ff.all[0],verification:{verified:false,rule:'No mapped tree is inside requested radius. nearest_outside is informational only.'},diagnostics});
  }catch(e){diagnostics.push({source:'FALLING_FRUIT_WARSAW_2016',ok:false,error:e.message});}
  try{const svc=await discoverWfs(),w=await fetchWfs(svc,svc.layer,lat,lon,radius);diagnostics.push({source:'WARSZAWA_WFS',ok:true,count:w.length});const best=w[0]||null;return res.status(200).json({status:best?'TREE_CANDIDATES_FOUND':'NO_TREE_IN_RADIUS',query:{lat,lon,radius_m:radius},source:{type:'Warsaw WFS',service:svc.url,layer:svc.layer},best,candidates:w.slice(0,12),nearest_outside:null,verification:{verified:false,rule:'Nearest mapped tree is a candidate; confirm visually in field.'},diagnostics});}catch(e){diagnostics.push({source:'WARSZAWA_WFS',ok:false,error:e.message,attempts:e.attempts||[]});return res.status(200).json({status:'NO_USABLE_TREE_CANDIDATE',query:{lat,lon,radius_m:radius},best:null,candidates:[],nearest_outside:null,verification:{verified:false},diagnostics});}
}
