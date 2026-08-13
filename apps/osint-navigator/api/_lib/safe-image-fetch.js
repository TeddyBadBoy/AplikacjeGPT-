import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 2;
const TIMEOUT_MS = 10_000;

function ipv4ToInt(ip) { return ip.split('.').reduce((n, oct) => (n << 8) + Number(oct), 0) >>> 0; }
function inV4(ip, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}
export function isPublicIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) {
    const blocked = [
      ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
      ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],
      ['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],
      ['224.0.0.0',4],['240.0.0.0',4]
    ];
    return !blocked.some(([base,bits]) => inV4(ip,base,bits));
  }
  if (family === 6) {
    const x = ip.toLowerCase();
    if (x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('ff')) return false;
    if (/^fe[89ab]/.test(x)) return false;
    return true;
  }
  return false;
}
async function resolvePublic(hostname) {
  if (net.isIP(hostname)) {
    if (!isPublicIp(hostname)) throw new Error('Host resolves to a non-public IP');
    return {address:hostname,family:net.isIP(hostname)};
  }
  const records = await dns.lookup(hostname,{all:true,verbatim:true});
  if (!records.length) throw new Error('DNS returned no addresses');
  if (records.some(r => !isPublicIp(r.address))) throw new Error('Host resolves to a non-public IP');
  return records[0];
}
function sniffType(buf) {
  if (buf.length >= 3 && buf[0]===0xff && buf[1]===0xd8 && buf[2]===0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii',0,4)==='RIFF' && buf.toString('ascii',8,12)==='WEBP') return 'image/webp';
  if (buf.length >= 6 && ['GIF87a','GIF89a'].includes(buf.toString('ascii',0,6))) return 'image/gif';
  return null;
}
function requestOnce(url,resolved) {
  return new Promise((resolve,reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({
      protocol:url.protocol, hostname:url.hostname, port:url.port||undefined,
      path:`${url.pathname}${url.search}`, method:'GET', timeout:TIMEOUT_MS,
      lookup:(_host,opts,cb)=>{ if(opts?.all) cb(null,[{address:resolved.address,family:resolved.family}]); else cb(null,resolved.address,resolved.family); },
      headers:{'User-Agent':'OSINT-Navigator/0.3','Accept':'image/jpeg,image/png,image/webp,image/gif;q=0.8,*/*;q=0.1'}
    }, res => {
      const chunks=[]; let size=0;
      res.on('data',chunk=>{ size+=chunk.length; if(size>MAX_BYTES){req.destroy(new Error('Image exceeds 10 MB limit'));return;} chunks.push(chunk); });
      res.on('end',()=>resolve({status:res.statusCode||0,headers:res.headers,body:Buffer.concat(chunks)}));
    });
    req.on('timeout',()=>req.destroy(new Error('Image fetch timed out')));
    req.on('error',reject); req.end();
  });
}
export async function safeFetchImage(inputUrl) {
  let current = new URL(inputUrl);
  for(let redirects=0; redirects<=MAX_REDIRECTS; redirects++) {
    if(!['http:','https:'].includes(current.protocol)) throw new Error('Only http/https URLs are allowed');
    if(current.username||current.password) throw new Error('Credentials in URL are not allowed');
    const expectedPort = current.protocol==='https:' ? '443' : '80';
    if(current.port && current.port!==expectedPort) throw new Error('Non-standard ports are not allowed');
    const resolved=await resolvePublic(current.hostname);
    const response=await requestOnce(current,resolved);
    if(response.status>=300 && response.status<400 && response.headers.location){
      if(redirects===MAX_REDIRECTS) throw new Error('Too many redirects');
      current=new URL(response.headers.location,current); continue;
    }
    if(response.status<200||response.status>=300) throw new Error(`Image server returned HTTP ${response.status}`);
    const headerType=String(response.headers['content-type']||'').split(';')[0].trim().toLowerCase();
    const actualType=sniffType(response.body);
    if(!actualType) throw new Error('Response is not a supported image');
    if(headerType && headerType!==actualType) throw new Error(`Content-Type mismatch: ${headerType} vs ${actualType}`);
    return {buffer:response.body,contentType:actualType,finalUrl:current.toString(),resolvedIp:resolved.address};
  }
  throw new Error('Redirect handling failed');
}
