using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEditor;
using UnityEditor.SceneManagement;
using DriveYourSuperTexi.CityPrototype;
using Object=UnityEngine.Object;
namespace DriveYourSuperTexi.EditorTools
{
    public static class RealRoadMapInstaller
    {
        const string Folder="Assets/DriveYourSuperTexi/CityPrototype/RealRoadsBusan20261107";
        const string ScenePath="Assets/DriveYourSuperTexi/CityPrototype/Scenes/Busan_Haeundae_RealRoads.unity";
        const string Evidence="Verification/RealRoadMap20261107";
        [Serializable] public class Ring {public Vector3[] points;}
        [Serializable] public class Surface {public string name;public int layer;public Vector3[] vertices;public int[] triangles;public Ring[] outlines;}
        [Serializable] public class Building {public string osmWayId,name,heightSource;public float height;public Vector3[] points;public Ring[] rings;public int[] roofTriangles;}
        [Serializable] public class Ground {public int resolution;public float spacing;public float[] heights;public Color[] colors;}
        [Serializable] public class Spawn {public Vector3 position;public float yaw;}
        [Serializable] public class Package {public string region,rawSha256;public Vector3[] nodes;public CityRoadNetwork.Edge[] edges;public Surface[] surfaces;public Ground terrain;public Building[] buildings;public RealRoadMap.Stop[] stops;public Spawn spawn;}
        static Mesh Save(Mesh m,string name){m.name=name;AssetDatabase.CreateAsset(m,AssetDatabase.GenerateUniqueAssetPath(Folder+"/"+name+".asset"));return m;}
        static GameObject Geometry(string name,Mesh mesh,Transform parent,Material[] materials,bool collider)
        {var go=new GameObject(name,typeof(MeshFilter),typeof(MeshRenderer));go.transform.SetParent(parent,false);go.transform.position=Vector3.zero;go.layer=LayerMask.NameToLayer("TaxiRoad");go.GetComponent<MeshFilter>().sharedMesh=Save(mesh,name);go.GetComponent<MeshRenderer>().sharedMaterials=materials;if(collider)go.AddComponent<MeshCollider>().sharedMesh=mesh;return go;}
        static string Hash(byte[] bytes){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
        [MenuItem("Super Taxi/Import Busan Real Road Dataset")]
        public static string Install()
        {
            if(Application.isPlaying)throw new Exception("Stop Play before importing");
            Directory.CreateDirectory(Folder);Directory.CreateDirectory(Evidence);
            var current=UnityEngine.SceneManagement.SceneManager.GetActiveScene();
            var city=Object.FindFirstObjectByType<CityDistrictStreaming>();if(!city)throw new Exception("Open the existing city scene first");
            if(Object.FindFirstObjectByType<RealRoadMap>())return Verify();
            string json=File.ReadAllText(Folder+"/unity-map.json");var data=JsonUtility.FromJson<Package>(json);
            if(data.nodes.Length<1000||data.terrain.heights.Length!=301*301)throw new Exception("Dataset incomplete");
            EditorSceneManager.SaveScene(current);if(!File.Exists(Evidence+"/backup/V01_CityBlock.unity"))File.Copy(current.path,Evidence+"/backup/V01_CityBlock.unity");
            if(File.Exists(ScenePath))throw new Exception("Real road scene already exists; do not overwrite user edits");
            EditorSceneManager.SaveScene(current,ScenePath,true);EditorSceneManager.OpenScene(ScenePath);
            city=Object.FindFirstObjectByType<CityDistrictStreaming>();var archive=new GameObject("PreservedConceptIsland");archive.transform.SetParent(city.transform,false);
            foreach(Transform t in city.transform.Cast<Transform>().ToArray())if(t!=archive.transform)t.SetParent(archive.transform,true);archive.SetActive(false);
            if(city.GetComponent<CityNaturalTerrain>())city.GetComponent<CityNaturalTerrain>().enabled=false;
            if(city.GetComponent<IslandWater>())city.GetComponent<IslandWater>().enabled=false;
            if(city.GetComponent<CityGlassReflections>())city.GetComponent<CityGlassReflections>().enabled=false;
            var enemies=GameObject.Find("ArmoredEnemies");if(enemies)enemies.SetActive(false);
            var root=new GameObject("BusanHaeundaeRealRoads");root.transform.SetParent(city.transform,false);var info=root.AddComponent<RealRoadMap>();info.region=data.region;info.rawSha256=data.rawSha256;info.mapSha256=Hash(File.ReadAllBytes(Folder+"/unity-map.json"));info.sourceCommit=File.ReadAllText(Folder+"/source-commit.txt").Trim();
            var network=city.GetComponent<CityRoadNetwork>();network.nodes=data.nodes;network.edges=data.edges;network.Prepare();EditorUtility.SetDirty(network);
            foreach(var surface in data.surfaces)
            {var mesh=new Mesh{indexFormat=IndexFormat.UInt32,vertices=surface.vertices,triangles=surface.triangles};mesh.RecalculateNormals();mesh.RecalculateBounds();Geometry(surface.name,mesh,root.transform,new[]{city.palette[6]},true);}
            GroundMeshes(city,root.transform,data.terrain);
            Buildings(city,root.transform,data.buildings);
            Paint(city,root.transform,data);
            Water(city,root.transform);
            var tiles=new List<CityDistrictStreaming.Tile>();
            for(int x=-2;x<10;x++)for(int z=-2;z<10;z++){var tile=new GameObject("RealRoadSector_"+x+"_"+z);tile.transform.SetParent(root.transform,false);tile.transform.position=new Vector3(-875+x*250,0,-875+z*250);tiles.Add(new CityDistrictStreaming.Tile{root=tile.transform,index=new Vector2Int(x,z),buildings=Array.Empty<CityDistrictStreaming.Building>(),landmarks=Array.Empty<CityDistrictStreaming.Landmark>(),distantLandmarks=Array.Empty<Renderer>()});}
            city.tiles=tiles.ToArray();city.dropZones=Array.Empty<Transform>();
            Physics.SyncTransforms();
            info.stops=data.stops.Where(stop=>!Physics.CheckBox(stop.pavement+Vector3.up,new Vector3(.6f,.8f,.6f),Quaternion.identity,1<<LayerMask.NameToLayer("TaxiRoad"),QueryTriggerInteraction.Ignore)).ToArray();
            if(info.stops.Length<30)throw new Exception("Insufficient clear passenger stands");
            var recovery=new SerializedObject(city.player.GetComponent<CityRecovery>());recovery.FindProperty("worldHalfSize").floatValue=1650;recovery.FindProperty("minimumHeight").floatValue=-25;
            var anchors=recovery.FindProperty("roadAnchors");anchors.arraySize=data.edges.Length;
            for(int i=0;i<data.edges.Length;i++){var e=data.edges[i];var t=new GameObject("OSMRoadRecovery").transform;t.SetParent(root.transform,false);t.position=(data.nodes[e.a]+data.nodes[e.b])*.5f+Vector3.up*.7f;t.rotation=Quaternion.LookRotation(data.nodes[e.b]-data.nodes[e.a]);anchors.GetArrayElementAtIndex(i).objectReferenceValue=t;}
            recovery.ApplyModifiedPropertiesWithoutUndo();
            city.player.SetPositionAndRotation(data.spawn.position,Quaternion.Euler(0,data.spawn.yaw,0));var rb=city.player.GetComponent<Rigidbody>();rb.position=data.spawn.position;rb.rotation=Quaternion.Euler(0,data.spawn.yaw,0);rb.linearVelocity=rb.angularVelocity=Vector3.zero;
            var traffic=new SerializedObject(city.GetComponent<CityCivilianTraffic>());traffic.FindProperty("carCount").intValue=16;traffic.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(city);EditorUtility.SetDirty(info);EditorSceneManager.MarkSceneDirty(city.gameObject.scene);AssetDatabase.SaveAssets();EditorSceneManager.SaveScene(city.gameObject.scene);
            return Verify();
        }
        static void GroundMeshes(CityDistrictStreaming city,Transform root,Ground data)
        {
            for(int tx=0;tx<12;tx++)for(int tz=0;tz<12;tz++)
            {
                const int size=26;var v=new Vector3[size*size];var colors=new Color[v.Length];var ts=new List<int>();
                for(int z=0;z<size;z++)for(int x=0;x<size;x++){int gx=tx*25+x,gz=tz*25+z,id=z*size+x,source=gz*301+gx;v[id]=new Vector3(-1500+gx*10,data.heights[source],-1500+gz*10);colors[id]=data.colors[source];}
                for(int z=0;z<size-1;z++)for(int x=0;x<size-1;x++){int i=z*size+x;ts.AddRange(new[]{i,i+size,i+1,i+1,i+size,i+size+1});}
                var mesh=new Mesh{vertices=v,colors=colors,triangles=ts.ToArray()};mesh.RecalculateNormals();mesh.RecalculateBounds();Geometry("OSM_Ground_"+tx+"_"+tz,mesh,root,new[]{city.GetComponent<CityNaturalTerrain>().material},true);
            }
        }
        static void Buildings(CityDistrictStreaming city,Transform root,Building[] buildings)
        {
            foreach(var group in buildings.GroupBy(b=>new Vector2Int(Mathf.FloorToInt(b.points.Average(p=>p.x)/250),Mathf.FloorToInt(b.points.Average(p=>p.z)/250))))
            {
                var vertices=new List<Vector3>();var colors=new List<Color>();var triangles=new List<int>();
                foreach(var building in group)
                {
                    int offset=vertices.Count;var shade=Color.Lerp(new Color(.44f,.49f,.52f),new Color(.77f,.73f,.64f),(Mathf.Abs(building.osmWayId.GetHashCode())%10)/10f);
                    vertices.AddRange(building.points.Select(p=>new Vector3(p.x,building.height,p.z)));colors.AddRange(building.points.Select(_=>shade));
                    for(int i=0;i<building.roofTriangles.Length;i+=3){int a=offset+building.roofTriangles[i],b=offset+building.roofTriangles[i+1],c=offset+building.roofTriangles[i+2];if(Vector3.Cross(vertices[b]-vertices[a],vertices[c]-vertices[a]).y<0){int swap=b;b=c;c=swap;}triangles.AddRange(new[]{a,b,c});}
                    foreach(var ring in building.rings)for(int i=0;i<ring.points.Length;i++)
                    {var a=ring.points[i];var b=ring.points[(i+1)%ring.points.Length];int n=vertices.Count;vertices.AddRange(new[]{new Vector3(a.x,-.08f,a.z),new Vector3(a.x,building.height,a.z),new Vector3(b.x,building.height,b.z),new Vector3(b.x,-.08f,b.z)});colors.AddRange(new[]{shade,shade,shade,shade});triangles.AddRange(new[]{n,n+1,n+2,n,n+2,n+3});}
                }
                var mesh=new Mesh{indexFormat=IndexFormat.UInt32};mesh.SetVertices(vertices);mesh.SetColors(colors);mesh.SetTriangles(triangles,0);mesh.RecalculateNormals();mesh.RecalculateBounds();Geometry("OSM_Buildings_"+group.Key.x+"_"+group.Key.y,mesh,root,new[]{city.GetComponent<CityNaturalTerrain>().material},true);
            }
        }
        static void Paint(CityDistrictStreaming city,Transform root,Package data)
        {
            var paint=new CityMeshBatch(city.palette.Length);var degree=new int[data.nodes.Length];foreach(var e in data.edges){degree[e.a]++;degree[e.b]++;}
            void Line(Vector3 a,Vector3 b,float width,int material){if(Vector3.Distance(a,b)<.01f)return;paint.Box((a+b)*.5f,new Vector3(width,.016f,Vector3.Distance(a,b)),material,Quaternion.LookRotation(b-a));}
            foreach(var e in data.edges)
            {
                var a=data.nodes[e.a];var b=data.nodes[e.b];var delta=b-a;float len=delta.magnitude;if(len<8)continue;var forward=delta.normalized;var side=Vector3.Cross(Vector3.up,forward);
                for(float at=6;at<len-4;at+=12){if((degree[e.a]>2&&at<e.width+5)||(degree[e.b]>2&&len-at<e.width+5))continue;var p=a+forward*at+Vector3.up*(.11f+e.layer*.025f);if(!e.oneWay&&e.width>=6)Line(p,p+forward*Mathf.Min(4,len-at),.12f,8);}
                if(e.oneWay&&len>45)
                {var p=(a+b)*.5f+Vector3.up*(.115f+e.layer*.025f);Line(p-forward*2,p+forward*2,.18f,7);Line(p+forward*2,p+side*.9f,.16f,7);Line(p+forward*2,p-side*.9f,.16f,7);}
            }
            var go=paint.Create("OSM_LaneMarkings",root,city.palette);go.GetComponent<MeshFilter>().sharedMesh=Save(go.GetComponent<MeshFilter>().sharedMesh,go.name);
        }
        static void Water(CityDistrictStreaming city,Transform root)
        {
            var shader=Shader.Find("Universal Render Pipeline/Lit");var material=new Material(shader){name="BusanRiverSea",color=new Color(.035f,.25f,.32f)};material.SetFloat("_Smoothness",.8f);AssetDatabase.CreateAsset(material,AssetDatabase.GenerateUniqueAssetPath(Folder+"/BusanRiverSea.mat"));
            var mesh=new Mesh{vertices=new[]{new Vector3(-3500,-1.65f,-3500),new Vector3(-3500,-1.65f,3500),new Vector3(3500,-1.65f,3500),new Vector3(3500,-1.65f,-3500)},triangles=new[]{0,1,2,0,2,3}};mesh.RecalculateNormals();mesh.RecalculateBounds();Geometry("OSM_RiverAndSea",mesh,root,new[]{material},false);
        }
        public static string Verify()
        {
            var info=Object.FindFirstObjectByType<RealRoadMap>();var network=Object.FindFirstObjectByType<CityRoadNetwork>();var root=info.transform;int samples=0,covered=0;
            foreach(var col in root.GetComponentsInChildren<MeshCollider>().Where(c=>c.name.StartsWith("OSM_RoadLayer_")))
            {var v=col.sharedMesh.vertices;var ts=col.sharedMesh.triangles;int step=Mathf.Max(1,ts.Length/3/8000);for(int i=0;i<ts.Length;i+=3*step){var p=(v[ts[i]]+v[ts[i+1]]+v[ts[i+2]])/3;foreach(var h in Physics.RaycastAll(p+Vector3.up*.2f,Vector3.up,3.5f,1<<LayerMask.NameToLayer("TaxiRoad")))if(h.collider.name.StartsWith("OSM_Buildings")||h.collider.name.StartsWith("OSM_Ground"))covered++;samples++;}}
            string report="Road sample headroom checks: "+samples+"; obstructed samples: "+covered+".\nTaxi graph: "+network.nodes.Length+" nodes / "+network.edges.Length+" edges; one-way edges "+network.edges.Count(e=>e.oneWay)+".\nClear curated stops: "+info.stops.Length+".\nData SHA256: "+info.mapSha256+"\nSource repository commit: "+info.sourceCommit+"\n";
            File.WriteAllText(Evidence+"/unity-validation.txt",report);return report;
        }
    }
}
