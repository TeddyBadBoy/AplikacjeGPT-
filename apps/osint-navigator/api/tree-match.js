import proj4 from 'proj4';

const WFS = 'https://wfs.um.warszawa.pl/serwis';
const WGS84 = 'EPSG:4326';
const PL2000_7 = '+proj=tmerc +lat_0=0 +lon_0=21 +k=0.999923 +x_0=7500000 +y_0=0 +ellps=GRS80 +units=m +no_defs +type=crs';
proj4.defs('EPSG:2178', PL2000_7);

function hav(a,b){
  const R=6371000, rad=x=>x*Math.PI/180;
  const dLat=rad(b.lat-a.lat), dLon=rad(b.lon-a.lon);
  const s=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}

function safeNum(v){ const n=Number(v); return Number.isFinite(n)?n:null; }
function clean(v=''){ return v.replace(/<!\[CDATA\[|\]\]>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim(); }

function parseProps(member){
  const props={};
  const re=/<(?:[\w.-]+:)?([\w.-]+)(?:\s[^>]*)?>([^<>]{0,800})<\/(?:[\w.-]+:)?\1>/g;
  for(const m of member.matchAll(re)){
    const k=m[1];
    if(/^(pos|coordinates|lowerCorner|upperCorner)$/i.test(k)) continue;
    const v=clean(m[2]); if(v) props[k]=v;
  }
  return props;
}

function parsePoint(member,target){
  const raw=[];
  for(const m of member.matchAll(/<(?:gml:)?pos(?:\s[^>]*)?>([^<]+)<\/(?:gml:)?pos>/gi)) raw.push(m[1]);
  for(const m of member.matchAll(/<(?:gml:)?coordinates(?:\s[^>]*)?>([^<]+)<\/(?:gml:)?coordinates>/gi)) raw.push(m[1]);
  for(const txt of raw){
    const nums=(txt.match(/-?\d+(?:\.\d+)?/g)||[]).map(Number);
    if(nums.length<2) continue;
    const a=nums[0], b=nums[1];
    if(Math.abs(a)>1000 || Math.abs(b)>1000){
      try{
        const [lon,lat]=proj4('EPSG:2178',WGS84,[a,b]);
        if(Math.abs(lat)<=90&&Math.abs(lon)<=180) return {lat,lon,crs:'EPSG:2178'};
      }catch{}
    }
    const p1={lat:a,lon:b}, p2={lat:b,lon:a};
    const valid=p=>Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;
    if(valid(p1)&&valid(p2)) return hav(target,p1)<=hav(target,p2)?{...p1,crs:'EPSG:4326'}:{...p2,crs:'EPSG:4326'};
    if(valid(p1)) return {...p1,crs:'EPSG:4326'};
    if(valid(p2)) return {...p2,crs:'EPSG:4326'};
  }
  return null;
}

function featureMembers(xml){
  return xml.match(/<(?:gml:)?featureMember\b[\s\S]*?<\/(?:gml:)?featureMember>/gi)
    || xml.match(/<(?:wfs:)?member\b[\s\S]*?<\/(?:wfs:)?member>/gi)
    || [];
}

function firstProp(props,re){ const k=Object.keys(props).find(x=>re.test(x)); return k?props[k]:null; }

async function getLayerName(){
  const u=`${WFS}?SERVICE=WFS&REQUEST=GetCapabilities&VERSION=1.1.0`;
  const r=await fetch(u,{headers:{'user-agent':'OSINT-Navigator/0.4'},signal:AbortSignal.timeout(8000)});
  if(!r.ok) throw new Error(`WFS GetCapabilities HTTP ${r.status}`);
  const xml=await r.text();
  const names=[...xml.matchAll(/<(?:\w+:)?Name>([^<]*ZIELEN_DRZEWA[^<]*)<\/(?:\w+:)?Name>/gi)].map(x=>clean(x[1]));
  return names[0]||'ns92528565:ZIELEN_DRZEWA';
}

async function fetchTrees(layer,lat,lon,radius){
  const [x,y]=proj4(WGS84,'EPSG:2178',[lon,lat]);
  const bbox=[x-radius,y-radius,x+radius,y+radius].join(',')+',EPSG:2178';
  const q=new URLSearchParams({
    SERVICE:'WFS', VERSION:'1.1.0', REQUEST:'GetFeature', TYPENAME:layer,
    SRSNAME:'EPSG:2178', BBOX:bbox, MAXFEATURES:'100'
  });
  const r=await fetch(`${WFS}?${q}`,{headers:{'user-agent':'OSINT-Navigator/0.4'},signal:AbortSignal.timeout(10000)});
  if(!r.ok) throw new Error(`WFS GetFeature HTTP ${r.status}`);
  const xml=await r.text();
  if(/ExceptionReport|ServiceException/i.test(xml)) throw new Error(clean((xml.match(/<(?:ows:)?ExceptionText[^>]*>([^<]+)/i)||[])[1]||'WFS exception'));
  return {xml,bbox2178:{x,y,bbox}};
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!['GET','POST'].includes(req.method)){ res.setHeader('Allow','GET, POST'); return res.status(405).json({error:'Method not allowed'}); }
  try{
    const input=req.method==='GET'?req.query:(req.body||{});
    const lat=safeNum(input.lat), lon=safeNum(input.lon);
    const radius=Math.max(5,Math.min(60,safeNum(input.radius_m)??25));
    if(lat===null||lon===null||Math.abs(lat)>90||Math.abs(lon)>180) return res.status(400).json({error:'Invalid lat/lon'});
    const target={lat,lon};
    const layer=await getLayerName();
    const {xml,bbox2178}=await fetchTrees(layer,lat,lon,radius);
    const candidates=[];
    for(const member of featureMembers(xml)){
      const point=parsePoint(member,target); if(!point) continue;
      const properties=parseProps(member);
      const distance_m=hav(target,point);
      if(distance_m>radius*1.6) continue;
      const id=firstProp(properties,/^(id|objectid|fid|ident|nr|numer)|(_id)$/i);
      const species=firstProp(properties,/(gatunek|species|nazwa.*gat|nazwa.*lac|nazwa.*pol)/i);
      const circumference=firstProp(properties,/(obwod|obwód|circum)/i);
      const height=firstProp(properties,/(wysok|height)/i);
      candidates.push({
        id, species, circumference, height,
        lat:point.lat, lon:point.lon,
        distance_m:+distance_m.toFixed(2),
        proximity_score:+Math.max(0,1-distance_m/Math.max(radius,1)).toFixed(3),
        source:'WARSZAWA_WFS_ZIELEN_DRZEWA', verified:false,
        properties
      });
    }
    candidates.sort((a,b)=>a.distance_m-b.distance_m);
    const best=candidates[0]||null;
    return res.status(200).json({
      status:best?'TREE_CANDIDATES_FOUND':'NO_TREE_IN_RADIUS',
      query:{lat,lon,radius_m:radius},
      source:{service:WFS,layer,crs:'EPSG:2178'},
      best,
      candidates:candidates.slice(0,12),
      verification:{verified:false,rule:'Proximity is not identity. Confirm trunk visually or with a current field photo.'},
      debug:{query_center_epsg2178:{x:+bbox2178.x.toFixed(3),y:+bbox2178.y.toFixed(3)}}
    });
  }catch(e){
    return res.status(502).json({status:'TREE_MATCH_FAILED',error:e.message,source:'Warsaw WFS'});
  }
}
