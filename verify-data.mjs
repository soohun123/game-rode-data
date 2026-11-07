import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const map=JSON.parse(fs.readFileSync('data/derived/unity-map.json','utf8'));
const manifest=JSON.parse(fs.readFileSync('data/manifest.json','utf8'));
const raw=JSON.parse(fs.readFileSync('data/raw/haeundae-suyeong.osm.json','utf8'));
assert.equal(crypto.createHash('sha256').update(fs.readFileSync('data/raw/haeundae-suyeong.osm.json')).digest('hex'),manifest.rawSha256);
const source=new Map(raw.elements.filter(e=>e.type==='node').map(e=>[String(e.id),e]));
let maxCoordinateError=0;
for(const n of map.nodes){assert(Number.isFinite(n.x+n.y+n.z));assert(Math.abs(n.x)<=1500.001&&Math.abs(n.z)<=1500.001);if(n.osmNodeId){const p=source.get(n.osmNodeId);assert(p);const x=(p.lon-manifest.center.lon)*Math.PI/180*6378137*Math.cos(manifest.center.lat*Math.PI/180),z=(p.lat-manifest.center.lat)*Math.PI/180*6378137;maxCoordinateError=Math.max(maxCoordinateError,Math.hypot(n.x-x,n.z-z));}}
assert(maxCoordinateError<1e-6);
const forward=map.nodes.map(()=>[]),reverse=map.nodes.map(()=>[]);let maxGrade=0;
for(const e of map.edges){assert(e.a!==e.b&&e.a>=0&&e.b<map.nodes.length);const a=map.nodes[e.a],b=map.nodes[e.b];maxGrade=Math.max(maxGrade,Math.abs(a.y-b.y)/Math.hypot(a.x-b.x,a.z-b.z));forward[e.a].push(e.b);reverse[e.b].push(e.a);if(!e.oneWay){forward[e.b].push(e.a);reverse[e.a].push(e.b);}}
function reachable(graph){let seen=new Set([0]),queue=[0];for(let i=0;i<queue.length;i++)for(const j of graph[queue[i]])if(!seen.has(j)){seen.add(j);queue.push(j);}return seen.size;}
assert.equal(reachable(forward),map.nodes.length);assert.equal(reachable(reverse),map.nodes.length);assert(maxGrade<=.086);
let triangles=0;for(const mesh of map.surfaces){assert.equal(mesh.triangles.length%3,0);for(const i of mesh.triangles)assert(i>=0&&i<mesh.vertices.length);for(const p of mesh.vertices)assert(Number.isFinite(p.x+p.y+p.z));triangles+=mesh.triangles.length/3;}
assert(map.stops.length>=20);assert(map.buildings.length>=500);assert(map.edges.some(e=>e.oneWay));
const report={status:'PASS',rawSha256:manifest.rawSha256,exactPlanCoordinateSamples:map.nodes.filter(n=>n.osmNodeId).length,maxCoordinateErrorMeters:maxCoordinateError,directedReachableNodes:map.nodes.length,reverseReachableNodes:map.nodes.length,oneWayEdges:map.edges.filter(e=>e.oneWay).length,maximumSyntheticGrade:maxGrade,validatedSurfaceTriangles:triangles,stops:map.stops.length,notes:'Source planar coordinates and OSM node identity retained. Rendered roads include disconnected clipped exits; the taxi graph uses only the largest strongly connected component.'};
fs.writeFileSync('data/derived/validation.json',JSON.stringify(report,null,2)+'\n');console.log(report);
