import fs from 'node:fs';
import crypto from 'node:crypto';
const center={lat:35.165,lon:129.14},radius=6378137,half=1500;
const latitudeDelta=half/radius*180/Math.PI,longitudeDelta=latitudeDelta/Math.cos(center.lat*Math.PI/180);
const bbox={south:center.lat-latitudeDelta,west:center.lon-longitudeDelta,north:center.lat+latitudeDelta,east:center.lon+longitudeDelta};
const box=[bbox.south,bbox.west,bbox.north,bbox.east].join(',');
const query=`[out:json][timeout:120];(way["highway"](${box});way["building"](${box});way["natural"~"^(water|coastline)$"](${box});way["waterway"](${box});relation["natural"="water"](${box}););out body;>;out skel qt;`;
fs.mkdirSync('data/raw',{recursive:true});fs.writeFileSync('data/query.overpassql',query+'\n');
let result,endpoint;
for(const url of ['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter']){
 try{
  console.log('Fetching OSM extract from '+url);
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'SuperTaxiRoadData/1.0 (https://github.com/soohun123/game-rode-data)'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(150000)});
  if(!response.ok)throw Error('HTTP '+response.status);
  const text=await response.text();const parsed=JSON.parse(text);
  if(parsed.remark||!parsed.elements?.length)throw Error(parsed.remark||'Empty extract');
  result=text;endpoint=url;break;
 }catch(error){console.log('Endpoint unavailable: '+error.message);}
}
if(!result)throw Error('No complete OSM response was received');
fs.writeFileSync('data/raw/haeundae-suyeong.osm.json',result);
const manifest={name:'Busan Haeundae–Suyeong River',center,bbox,extentMeters:3000,units:'metres',axis:'Unity X east, Y up, Z north',projection:'Local equirectangular, WGS84 origin, radius 6378137m',retrievedAt:new Date().toISOString(),endpoint,source:'OpenStreetMap contributors',license:'ODbL-1.0',attribution:'© OpenStreetMap contributors',copyrightUrl:'https://www.openstreetmap.org/copyright',rawSha256:crypto.createHash('sha256').update(result).digest('hex')};
fs.writeFileSync('data/manifest.json',JSON.stringify(manifest,null,2)+'\n');
const raw=JSON.parse(result);console.log({elements:raw.elements.length,roads:raw.elements.filter(e=>e.type==='way'&&e.tags?.highway).length,buildings:raw.elements.filter(e=>e.type==='way'&&e.tags?.building).length,bytes:result.length,sha256:manifest.rawSha256});
