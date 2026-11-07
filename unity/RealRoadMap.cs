using System;
using UnityEngine;
namespace DriveYourSuperTexi.CityPrototype
{
    [DefaultExecutionOrder(-250)]
    public sealed class RealRoadMap:MonoBehaviour
    {
        [Serializable] public struct Stop {public Vector3 road,pavement;public string label,osmWayId;}
        public string region="부산 해운대·수영강",repository="https://github.com/soohun123/game-rode-data",sourceCommit,rawSha256,mapSha256;
        public Stop[] stops=Array.Empty<Stop>();
        public bool[] water=Array.Empty<bool>();
        public static RealRoadMap Instance {get;private set;}
        void OnEnable(){Instance=this;}
        void OnDisable(){if(Instance==this)Instance=null;}
        public static bool WaterAt(float x,float z)
        {if(!Instance||Instance.water.Length!=301*301)return false;if(Mathf.Abs(x)>1500||Mathf.Abs(z)>1500)return true;int gx=Mathf.Clamp(Mathf.RoundToInt((x+1500)/10),0,300),gz=Mathf.Clamp(Mathf.RoundToInt((z+1500)/10),0,300);return Instance.water[gz*301+gx];}
        public static string LocationName(Vector3 p)
        {if(!Instance)return null;foreach(var s in Instance.stops){var delta=s.road-p;delta.y=0;if(delta.sqrMagnitude<25*25)return s.label;}return Instance.region;}
        void OnGUI()
        {
            var previous=GUI.color;GUI.color=new Color(1,1,1,.9f);
            if(GUI.Button(new Rect(Mathf.Max(0,Screen.width-285),8,277,24),"© OpenStreetMap contributors · ODbL"))Application.OpenURL("https://www.openstreetmap.org/copyright");
            GUI.color=previous;
        }
    }
}
