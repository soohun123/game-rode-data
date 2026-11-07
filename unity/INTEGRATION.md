# Unity integration

The importer targets this user's Unity 6.3 taxi project and its existing
`DriveYourSuperTexi.CityPrototype` game classes. It is not a standalone Unity project.

1. Copy `data/derived/unity-map.json` into
   `Assets/DriveYourSuperTexi/CityPrototype/RealRoadsBusan20261107/`.
2. Put the exact downloaded commit ID in `source-commit.txt` in the same folder.
3. Install `RealRoadMap.cs` in the game's runtime folder and
   `RealRoadMapInstaller.cs` in its editor folder.
4. Integrate directed edges (`oneWay`), street metadata, curated stops and real-map
   location naming with the game's road, passenger and civilian-traffic systems.
   Legacy scenes use `oneWay=false` by default.
5. With the existing city open and Play mode stopped, run
   `Super Taxi > Import Busan Real Road Dataset`.

The importer saves a separate `Busan_Haeundae_RealRoads.unity` scene. The original
concept island remains available in its original scene. Generated roads, building
footprints and river/coast terrain are based on the versioned JSON, not on runtime
HTTP requests. The runtime attribution opens the OSM copyright page.

Roads include approximate heights inferred from map layers. This is a playable
road-layout reconstruction, not surveyed photorealistic terrain or buildings.
