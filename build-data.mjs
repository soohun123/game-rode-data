import fs from 'node:fs';
import crypto from 'node:crypto';
import Clipper from 'clipper-lib';
import earcut from 'earcut';
const manifest=JSON.parse(fs.readFileSync('data/manifest.json','utf8'));
const raw=JSON.parse(fs.readFileSync('data/raw/haeundae-suyeong.osm.json','utf8'));
const R=6378137,rad=Math.PI/180,S=1000;
const project=(lat,lon)=>({x:(lon-manifest.center.lon)*rad*R*Math.cos(manifest.center.lat*rad),z:(lat-manifest.center.lat)*rad*R});
const inverse=p=>[manifest.center.lon+p.x/(rad*R*Math.cos(manifest.center.lat*rad)),manifest.center.lat+p.z/(rad*R)];
const sourceNodes=new Map(raw.elements.filter(e=>e.type==='node').map(e=>[e.id,{...project(e.lat,e.lon),id:e.id}]));
const ways=raw.elements.filter(e=>e.type==='way');
const drivable=new Set(['motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','unclassified','residential','living_street','service']);
const points=w=>w.nodes.map(id=>sourceNodes.get(id)).filter(Boolean);
function clipSegment(a,b){let t0=0,t1=1,dx=b.x-a.x,dz=b.z-a.z;for(const [p,q] of [[-dx,a.x+1500],[dx,1500-a.x],[-dz,a.z+1500],[dz,1500-a.z]]){if(Math.abs(p)<1e-10){if(q<0)return null;continue;}let t=q/p;if(p<0)t0=Math.max(t0,t);else t1=Math.min(t1,t);if(t0>t1)return null;}return [t0,t1].map((t,i)=>({x:a.x+t*dx,z:a.z+t*dz,key:t<1e-9?'n'+a.id:t>1-1e-9?'n'+b.id:'cut:'+a.id+':'+b.id+':'+i}));}
let roadWays=[],excluded=[];
for(const w of ways.filter(w=>w.tags?.highway)){
 const t=w.tags;
 if(!drivable.has(t.highway)||['no','private'].includes(t.motor_vehicle||t.vehicle||t.access)||t.area==='yes'){excluded.push({osmWayId:w.id,highway:t.highway,reason:'not public motor-vehicle road'});continue;}
 let seq=points(w);if(t.oneway==='-1')seq=seq.reverse();
 let oneWay=['yes','1','true','-1'].includes(t.oneway)||(!t.oneway&&(t.junction==='roundabout'||t.highway==='motorway'));
 const laneCount=Number.parseFloat(t.lanes),tagWidth=Number.parseFloat(t.width);
 const fallback={motorway:12,trunk:12,primary:14,secondary:12,tertiary:9,residential:6,service:4,living_street:5,unclassified:6}[t.highway]||5;
 const width=Math.max(4,Math.min(32,Number.isFinite(tagWidth)?tagWidth:Number.isFinite(laneCount)?laneCount*3.1+1:oneWay?Math.max(4,fallback*.55):fallback));
 let layer=Number.parseInt(t.layer||'0',10)||0;if(t.bridge&&t.bridge!=='no'&&layer===0)layer=1;if(t.tunnel&&t.tunnel!=='no'&&layer===0)layer=-1;
 roadWays.push({id:w.id,name:t['name:ko']||t.name||({secondary:'간선도로',residential:'주택가 도로',service:'진입도로'}[t.highway]||t.highway),tags:t,oneWay,width,layer,points:seq});
}
let incidence=new Map();
for(const w of roadWays)for(const p of w.points){const key='n'+p.id;if(!incidence.has(key))incidence.set(key,[]);incidence.get(key).push(w.layer);}
function nodeHeight(key,layer){let levels=incidence.get(key);return levels?(levels.includes(0)?0:Math.min(...levels.map(l=>l*6))):layer*6;}
let allNodes=[],allEdges=[],nodeIndex=new Map(),segments=[];
function getNode(p,layer){if(nodeIndex.has(p.key))return nodeIndex.get(p.key);let i=allNodes.length;allNodes.push({x:p.x,y:nodeHeight(p.key,layer),z:p.z,osmNodeId:p.key.startsWith('n')?p.key.slice(1):'',key:p.key});nodeIndex.set(p.key,i);return i;}
for(const way of roadWays)for(let i=1;i<way.points.length;i++){
 let pair=clipSegment(way.points[i-1],way.points[i]);if(!pair||Math.hypot(pair[0].x-pair[1].x,pair[0].z-pair[1].z)<.05)continue;
 let a=getNode(pair[0],way.layer),b=getNode(pair[1],way.layer);const edge={a,b,width:way.width,oneWay:way.oneWay,osmWayId:String(way.id),name:way.name,layer:way.layer};allEdges.push(edge);segments.push({...edge,a:allNodes[a],b:allNodes[b]});
}
// Give unsurveyed bridge/tunnel heights gradual approaches; plan positions stay
// exactly on the OSM centerline. Heights are explicitly synthetic, not DEM data.
const connections=allNodes.map(()=>[]);allEdges.forEach(e=>{connections[e.a].push(e);connections[e.b].push(e);});
for(let pass=0;pass<40;pass++)for(const e of allEdges){const a=allNodes[e.a],b=allNodes[e.b],limit=Math.hypot(a.x-b.x,a.z-b.z)*.085;if(Math.abs(a.y-b.y)>limit){if(Math.abs(a.y)>Math.abs(b.y))a.y=b.y+Math.sign(a.y-b.y)*limit;else b.y=a.y+Math.sign(b.y-a.y)*limit;}}
let directed=allNodes.map(()=>[]),reverse=allNodes.map(()=>[]);
for(const e of allEdges){directed[e.a].push(e.b);reverse[e.b].push(e.a);if(!e.oneWay){directed[e.b].push(e.a);reverse[e.a].push(e.b);}}
// Largest strongly connected component is used for fares and traffic. Every
// drivable way, including clipped exits, remains in the visual/reference data.
let visited=new Set(),order=[];
function visit(i){visited.add(i);for(const j of directed[i])if(!visited.has(j))visit(j);order.push(i);}
for(let i=0;i<allNodes.length;i++)if(!visited.has(i))visit(i);
visited.clear();let components=[];
function component(i,list){visited.add(i);list.push(i);for(const j of reverse[i])if(!visited.has(j))component(j,list);}
for(const i of order.reverse())if(!visited.has(i)){let list=[];component(i,list);components.push(list);}
components.sort((a,b)=>b.length-a.length);let kept=new Set(components[0]),ids=[...kept].sort((a,b)=>a-b),remap=new Map(ids.map((id,i)=>[id,i]));
const nodes=ids.map(i=>allNodes[i]),edges=allEdges.filter(e=>kept.has(e.a)&&kept.has(e.b)).map(e=>({...e,a:remap.get(e.a),b:remap.get(e.b)}));
console.log('Road topology',{ways:roadWays.length,nodes:allNodes.length,edges:allEdges.length,gameplayNodes:nodes.length,gameplayEdges:edges.length});
const toClip=p=>({X:Math.round(p.x*S),Y:Math.round(p.z*S)}),fromClip=p=>({x:p.X/S,z:p.Y/S});
function union(input){const clipper=new Clipper.Clipper();clipper.AddPaths(input,Clipper.PolyType.ptSubject,true);const tree=new Clipper.PolyTree();clipper.Execute(Clipper.ClipType.ctUnion,tree,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);return tree;}
let roadPolygons=new Map();
for(const e of segments){if(!roadPolygons.has(e.layer))roadPolygons.set(e.layer,[]);let offset=new Clipper.ClipperOffset(2,150),out=[];offset.AddPath([toClip(e.a),toClip(e.b)],Clipper.JoinType.jtRound,Clipper.EndType.etOpenRound);offset.Execute(out,e.width*S/2);roadPolygons.get(e.layer).push(...out);}
let spatial=new Map();for(const e of segments)for(let x=Math.floor((Math.min(e.a.x,e.b.x)-35)/100);x<=Math.floor((Math.max(e.a.x,e.b.x)+35)/100);x++)for(let z=Math.floor((Math.min(e.a.z,e.b.z)-35)/100);z<=Math.floor((Math.max(e.a.z,e.b.z)+35)/100);z++){let k=x+':'+z;if(!spatial.has(k))spatial.set(k,[]);spatial.get(k).push(e);}
function near(x,z,layer=null){let distance=Infinity,result=null,t=0;for(const e of spatial.get(Math.floor(x/100)+':'+Math.floor(z/100))||[]){if(layer!==null&&e.layer!==layer)continue;let dx=e.b.x-e.a.x,dz=e.b.z-e.a.z,u=Math.max(0,Math.min(1,((x-e.a.x)*dx+(z-e.a.z)*dz)/(dx*dx+dz*dz))),d=Math.hypot(x-e.a.x-dx*u,z-e.a.z-dz*u);if(d<distance){distance=d;result=e;t=u;}}return {distance,edge:result,t};}
function height(x,z,layer){let n=near(x,z,layer);return n.edge?n.edge.a.y+(n.edge.b.y-n.edge.a.y)*n.t+.08+layer*.025:.08;}
function meshTree(tree,layer){let flat=[],triangles=[],outlines=[];function walk(n){for(const child of n.Childs()){if(!child.IsHole()){let coords=[],holes=[];for(const ring of [child.Contour(),...child.Childs().filter(h=>h.IsHole()).map(h=>h.Contour())]){if(coords.length)holes.push(coords.length/2);let line=ring.map(fromClip);outlines.push({points:line.map(p=>({...p,y:height(p.x,p.z,layer)}))});coords.push(...line.flatMap(p=>[p.x,p.z]));}let base=flat.length/2;flat.push(...coords);triangles.push(...earcut(coords,holes).map(i=>i+base));}walk(child);}}walk(tree);
let pending=[];for(let i=0;i<triangles.length;i+=3)pending.push(triangles.slice(i,i+3));triangles=[];let cache=new Map();function midpoint(a,b){let key=Math.min(a,b)+':'+Math.max(a,b);if(cache.has(key))return cache.get(key);let i=flat.length/2;flat.push((flat[a*2]+flat[b*2])/2,(flat[a*2+1]+flat[b*2+1])/2);cache.set(key,i);return i;}
while(pending.length){let t=pending.pop(),d=t.map((a,k)=>{let b=t[(k+1)%3];return (flat[a*2]-flat[b*2])**2+(flat[a*2+1]-flat[b*2+1])**2;}),max=Math.max(...d);if(max<=100){triangles.push(...t);continue;}let i=d.indexOf(max),a=t[i],b=t[(i+1)%3],c=t[(i+2)%3],m=midpoint(a,b);pending.push([a,m,c],[m,b,c]);}
let vertices=Array.from({length:flat.length/2},(_,i)=>({x:flat[i*2],y:height(flat[i*2],flat[i*2+1],layer),z:flat[i*2+1]}));for(let i=0;i<triangles.length;i+=3){let a=vertices[triangles[i]],b=vertices[triangles[i+1]],c=vertices[triangles[i+2]];if((b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z)<0)[triangles[i+1],triangles[i+2]]=[triangles[i+2],triangles[i+1]];}
return {name:'OSM_RoadLayer_'+layer,layer,vertices,triangles,outlines};}
let surfaces=[];for(const [layer,polys] of roadPolygons){console.log('Union road level',layer,polys.length);surfaces.push(meshTree(union(polys),layer));}
let water=[];const coast=[];
for(const way of ways){if(way.tags?.natural==='coastline'){let p=points(way);for(let i=1;i<p.length;i++)coast.push({a:p[i-1],b:p[i]});}if((way.tags?.natural==='water'||way.tags?.waterway==='riverbank')&&way.nodes[0]===way.nodes.at(-1))water.push({points:points(way)});}
function inPoly(p,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){let a=poly[i],b=poly[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside;}return inside;}
function seaDistance(x,z){let distance=Infinity,signed=9999;for(const e of coast){let dx=e.b.x-e.a.x,dz=e.b.z-e.a.z,t=Math.max(0,Math.min(1,((x-e.a.x)*dx+(z-e.a.z)*dz)/(dx*dx+dz*dz))),d=Math.hypot(x-e.a.x-dx*t,z-e.a.z-dz*t);if(d<distance){distance=d;signed=(dx*(z-e.a.z)-dz*(x-e.a.x))>=0?d:-d;}}return signed;}
let terrain={resolution:300,spacing:10,heights:[],colors:[]};
for(let z=0;z<=300;z++)for(let x=0;x<=300;x++){let wx=-1500+x*10,wz=-1500+z*10,d=seaDistance(wx,wz),wet=water.some(w=>inPoly({x:wx,z:wz},w.points));let h=wet?-4:d<0?Math.max(-8,d*.15-1.8):Math.min(-.03,-1.8+d*.14);for(const e of spatial.get(Math.floor(wx/100)+':'+Math.floor(wz/100))||[]){let dx=e.b.x-e.a.x,dz=e.b.z-e.a.z,t=Math.max(0,Math.min(1,((wx-e.a.x)*dx+(wz-e.a.z)*dz)/(dx*dx+dz*dz))),d=Math.hypot(wx-e.a.x-dx*t,wz-e.a.z-dz*t),y=e.a.y+(e.b.y-e.a.y)*t;if(y<-.01&&d<e.width/2+16)h=Math.min(h,y-1.4);}terrain.heights.push(h);let sand=!wet&&d>=0&&d<28,noise=(Math.sin(wx*.045)*Math.cos(wz*.04)+1)*.5;const color=wet||d<0?[.32,.34,.28]:sand?[.68,.60,.41]:[.24+noise*.08,.34+noise*.07,.15+noise*.05];terrain.colors.push({r:color[0],g:color[1],b:color[2],a:1});}
// Retain source footprints. No invented buildings are inserted into empty lots.
let buildings=[],clippedBuildingFootprints=0;
const roadClearanceOffset=new Clipper.ClipperOffset(2,100),groundPaths=[];
roadClearanceOffset.AddPaths(surfaces.flatMap(s=>s.outlines.map(r=>r.points.map(toClip))),Clipper.JoinType.jtRound,Clipper.EndType.etClosedPolygon);
roadClearanceOffset.Execute(groundPaths,.5*S);
for(const way of ways.filter(w=>w.tags?.building&&w.nodes[0]===w.nodes.at(-1))){let p=points(way).slice(0,-1);if(p.length<3||!p.some(v=>v.x>=-1500&&v.x<=1500&&v.z>=-1500&&v.z<=1500))continue;const center=p.reduce((a,v)=>({x:a.x+v.x/p.length,z:a.z+v.z/p.length}),{x:0,z:0});if(center.x<-1500||center.x>1500||center.z<-1500||center.z>1500)continue;let tagged=Number.parseFloat(way.tags.height),levels=Number.parseFloat(way.tags['building:levels']),height=Number.isFinite(tagged)?tagged:Number.isFinite(levels)?levels*3.2:['apartments','commercial','office'].includes(way.tags.building)?24:9;
 let subject=p.map(toClip);if(!Clipper.Clipper.Orientation(subject))subject.reverse();let c=new Clipper.Clipper(),tree=new Clipper.PolyTree();c.AddPath(subject,Clipper.PolyType.ptSubject,true);c.AddPaths(groundPaths,Clipper.PolyType.ptClip,true);c.Execute(Clipper.ClipType.ctDifference,tree,Clipper.PolyFillType.pftNonZero,Clipper.PolyFillType.pftNonZero);
 let area=0;function walk(n){for(const child of n.Childs()){if(!child.IsHole()){let outer=child.Contour();area+=Math.abs(Clipper.Clipper.Area(outer));if(Math.abs(Clipper.Clipper.Area(outer))<10*S*S)continue;let rings=[outer,...child.Childs().filter(h=>h.IsHole()).map(h=>h.Contour())].map(r=>r.map(fromClip));let flat=[],holes=[];for(const ring of rings){if(flat.length)holes.push(flat.length/2);flat.push(...ring.flatMap(v=>[v.x,v.z]));}buildings.push({osmWayId:String(way.id),name:way.tags.name||'',height:Math.max(3,Math.min(180,height)),heightSource:Number.isFinite(tagged)?'OSM height':Number.isFinite(levels)?'OSM building:levels x 3.2m':'game estimate',points:rings.flat().map(v=>({x:v.x,y:0,z:v.z})),rings:rings.map(r=>({points:r.map(v=>({x:v.x,y:0,z:v.z}))})),roofTriangles:earcut(flat,holes)});}walk(child);}}walk(tree);if(Math.abs(area-Math.abs(Clipper.Clipper.Area(subject)))>S*S)clippedBuildingFootprints++;
}
const degree=nodes.map(()=>0);edges.forEach(e=>{degree[e.a]++;degree[e.b]++;});
let stops=[];
for(const e of edges){let a=nodes[e.a],b=nodes[e.b],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz);if(len<35||e.layer!==0||e.width>22)continue;let x=(a.x+b.x)/2,z=(a.z+b.z)/2;if(stops.some(s=>Math.hypot(s.road.x-x,s.road.z-z)<110))continue;if(seaDistance(x,z)<20||water.some(w=>inPoly({x,z},w.points)))continue;let side={x:dz/len,z:-dx/len},sign=1;let pavement={x:x+side.x*(e.width/2+2),y:.08,z:z+side.z*(e.width/2+2)};if(buildings.some(b=>inPoly(pavement,b.points)))continue;stops.push({road:{x:x+side.x*(e.width/2-1),y:.16,z:z+side.z*(e.width/2-1)},pavement,label:e.name+' 택시승강장',osmWayId:e.osmWayId});}
const spawnEdge=edges.filter(e=>e.layer===0&&e.width>=7&&Math.hypot(nodes[e.a].x,nodes[e.a].z)<650).sort((a,b)=>Math.hypot(nodes[a.a].x,nodes[a.a].z)-Math.hypot(nodes[b.a].x,nodes[b.a].z))[0]||edges[0];
const a=nodes[spawnEdge.a],b=nodes[spawnEdge.b],len=Math.hypot(b.x-a.x,b.z-a.z),spawn={position:{x:(a.x+b.x)/2+(b.z-a.z)/len*Math.min(3,spawnEdge.width*.23),y:(a.y+b.y)/2+.5,z:(a.z+b.z)/2-(b.x-a.x)/len*Math.min(3,spawnEdge.width*.23)},yaw:Math.atan2(b.x-a.x,b.z-a.z)/rad};
fs.mkdirSync('data/derived',{recursive:true});
const map={region:'부산 해운대·수영강',rawSha256:manifest.rawSha256,nodes,edges,surfaces,terrain,water,buildings,stops,spawn,sourceNodes:allNodes.length,sourceEdges:allEdges.length,excluded,notes:['Plan coordinates reproduce OSM, at one Unity unit per metre.','Road widths without width/lanes tags are estimated.','Vertical road separation is estimated from bridge/tunnel/layer, not survey elevation.','Building heights without tags are game estimates.','Turn-restriction relations are not included; one-way directions are retained.','Only largest strongly connected driving graph is used for fares; all public drivable roads remain visible.']};
fs.writeFileSync('data/derived/unity-map.json',JSON.stringify(map));
fs.writeFileSync('data/roads.geojson',JSON.stringify({type:'FeatureCollection',features:roadWays.map(w=>({type:'Feature',id:w.id,properties:{osmWayId:String(w.id),name:w.name,oneway:w.oneWay,widthMeters:w.width,widthSource:w.tags.width?'OSM width':w.tags.lanes?'OSM lanes estimate':'road class estimate',layer:w.layer,highway:w.tags.highway,tags:w.tags},geometry:{type:'LineString',coordinates:w.points.map(inverse)}}))},null,2));
const stats={roadWays:roadWays.length,excludedNonDrivingWays:excluded.length,sourceNodes:allNodes.length,sourceEdges:allEdges.length,gameplayNodes:nodes.length,gameplayEdges:edges.length,oneWayEdges:edges.filter(e=>e.oneWay).length,surfaceTriangles:surfaces.reduce((n,s)=>n+s.triangles.length/3,0),buildings:buildings.length,stops:stops.length,layers:[...roadPolygons.keys()],components:components.map(c=>c.length),rawSha256:manifest.rawSha256,mapSha256:crypto.createHash('sha256').update(fs.readFileSync('data/derived/unity-map.json')).digest('hex')};
fs.writeFileSync('data/derived/statistics.json',JSON.stringify(stats,null,2)+'\n');
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1550 -1550 3100 3100"><rect x="-1550" y="-1550" width="3100" height="3100" fill="#4d6651"/><g transform="scale(1,-1)">`;
for(const w of water)svg+=`<polygon points="${w.points.map(p=>p.x+','+p.z).join(' ')}" fill="#167285"/>`;
for(const b of buildings)svg+=`<polygon points="${b.points.map(p=>p.x+','+p.z).join(' ')}" fill="#a8a995"/>`;
for(const e of segments)svg+=`<path d="M${e.a.x},${e.a.z}L${e.b.x},${e.b.z}" stroke="${e.layer>0?'#489bb1':e.layer<0?'#977aaf':'#242c34'}" stroke-width="${e.width}" stroke-linecap="round"/>`;
svg+='</g><rect x="-1550" y="1390" width="3100" height="160" fill="#101c29"/><text x="-1480" y="1480" fill="white" font-size="46">Busan Haeundae–Suyeong · 3km × 3km · © OpenStreetMap contributors</text></svg>';fs.writeFileSync('preview.svg',svg);
console.log(stats);
