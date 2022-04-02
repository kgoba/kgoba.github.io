const mapCenter = [24.00, 57.00];

function inRange(point) {
  // return ol.sphere.getDistance(mapCenter, point) < 1000000;
  return (Math.abs(point[0] - mapCenter[0]) < 20) && (Math.abs(point[1] - mapCenter[1]) < 12);
}

const defaultMap = new ol.layer.Tile({
  source: new ol.source.OSM()
});
const topoMap = new ol.layer.Tile({
  source: new ol.source.OSM({
    url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
  })
});
const satMap = new ol.layer.Tile({
  source: new ol.source.XYZ({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19
  })
});

const map = new ol.Map({
  target: 'map',
  layers: [
    defaultMap,
    // topoMap,
    // satMap,
  ],
  view: new ol.View({
    center: ol.proj.fromLonLat(mapCenter),
    zoom: 6,
    minZoom: 0,
    maxZoom: 16
  })
});

const styles = {
  'listener': new ol.style.Style({
    image: new ol.style.Circle({
      radius: 6,
      fill: new ol.style.Fill({color: 'green'}),
      stroke: new ol.style.Stroke({
        color: 'gray',
        width: 1,
      }),
    }),
  }),
  'launchSite': new ol.style.Style({
    image: new ol.style.Circle({
      radius: 7,
      // fill: new ol.style.Fill({color: 'black'}),
      stroke: new ol.style.Stroke({
        color: 'black',
        width: 3,
      }),
    }),
  }),
  'sonde': new ol.style.Style({
    image: new ol.style.Circle({
      radius: 6,
      fill: new ol.style.Fill({color: 'gray'}),
      stroke: new ol.style.Stroke({
        color: 'black',
        width: 1,
      }),
    }),
  }),
  'liveSonde': new ol.style.Style({
    image: new ol.style.Circle({
      radius: 6,
      fill: new ol.style.Fill({color: 'red'}),
      stroke: new ol.style.Stroke({
        color: 'gray',
        width: 1,
      }),
    }),
  }),
  'route': new ol.style.Style({
    stroke: new ol.style.Stroke({
      width: 4,
      // color: [250, 180, 50, 0.8],
      color: 'red',
    }),
  }),
};

fetch('https://api.v2.sondehub.org/listeners/telemetry').then(function (response) {
  response.json().then(function (result) {
    var markerList = [];

    for (const key in result) {
      const subkey = Object.keys(result[key])[0];
      const entry = result[key][subkey];
      const callsign = entry['uploader_callsign'];
      if ('uploader_position' in entry) {
        const lat = entry['uploader_position'][0];
        const lon = entry['uploader_position'][1];
        if (inRange([lon, lat])) {
          markerList.push(new ol.Feature({
            type: 'listener',
            geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat])),
          }));
        }
      }
    }
    console.log('Loaded ' + markerList.length + ' listeners');

    const vectorLayer = new ol.layer.Vector({
      source: new ol.source.Vector({
        // features: [marker],
        features: markerList,
      }),
      style: function (feature) {
        return styles[feature.get('type')];
      },
    });

    // map.addLayer(vectorLayer);
  })
});

fetch('https://api.v2.sondehub.org/sites').then(function (response) {
  response.json().then(function (result) {
    var markerList = [];

    for (const key in result) {
      const entry = result[key];
      if ('position' in entry) {
        const lat = entry['position'][1];
        const lon = entry['position'][0];
        if (inRange([lon, lat])) {
          markerList.push(new ol.Feature({
            type: 'launchSite',
            geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat])),
          }));
        }
      }
    }
    console.log('Loaded ' + markerList.length + ' sites');

    const vectorLayer = new ol.layer.Vector({
      source: new ol.source.Vector({
        // features: [marker],
        features: markerList,
      }),
      style: function (feature) {
        return styles[feature.get('type')];
      },
    });

    map.addLayer(vectorLayer);
  })
});

var sondeList = {};
var vectorSource = new ol.source.Vector({});

map.addLayer(new ol.layer.Vector({
    source: vectorSource,
    style: function (feature) {
      return styles[feature.get('type')];
    },
  })
);

fetch('https://api.v2.sondehub.org/sondes?lat=57.00&lon=24.00&distance=1600000&last=21600').then(function (response) {
  response.json().then(function (result) {

    for (const key in result) {
      const entry = result[key];
      const lat = entry['lat'];
      const lon = entry['lon'];
      if (inRange([lon, lat])) {
        const frameID = entry['frame'];
        console.log(`${key}: ${lat} ${lon}`);
        var marker = new ol.Feature({
          type: 'sonde',
          geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat])),
        });
        vectorSource.addFeature(marker);
        sondeList[key] = { 'marker' : marker, 'frame': frameID };
      }
    }
    console.log('Loaded ' + sondeList.size + ' sondes');

    for (const key in sondeList) {
      fetch('https://api.v2.sondehub.org/sonde/' + key).then(function (response) {
        response.json().then(function (result) {
          var polyline = [];
          for (var index = 0; index < result.length; index++) {
            const entry = result[index];
            const lat = entry['lat'];
            const lon = entry['lon'];
            if (index % 5 == 0)
              polyline.push(ol.proj.fromLonLat([lon, lat]));
          }
          console.log('Loaded ' + polyline.length + ' path points for sonde ' + key);

          var path = new ol.Feature({
            type: 'route',
            geometry: new ol.geom.LineString(polyline),
          });
          vectorSource.addFeature(path);
          sondeList[key].path = path;
        })
      });
      setTimeout(function(){}, 500);
    }
  })
});

function updateSonde(frame) {
  if ('serial' in frame) {
    const sondeID = frame['serial'];
    const lat = frame['lat'];
    const lon = frame['lon'];
    const alt = frame['alt'];
    const frameID = frame['frame'];
    if (sondeList.hasOwnProperty(sondeID)) {
      if (frameID > sondeList[sondeID]['frame']) {
        console.log('Live: Update to sonde ' + sondeID + ' alt: ' + alt);
        try {
          sondeList[sondeID]['frame'] = frameID;
          var marker = sondeList[sondeID]['marker'];
          marker.getGeometry().setCoordinates(ol.proj.fromLonLat([lon, lat]));
          // marker.type = 'liveSonde';
          marker.setStyle(styles['liveSonde']);
          if (sondeList[sondeID].hasOwnProperty('path')) {
            var path = sondeList[sondeID]['path'];
            path.getGeometry().appendCoordinate(ol.proj.fromLonLat([lon, lat]));
          }
        }
        catch (error) {
          console.log('Error while updating sonde data: ' + error);
        }
      }
      else {
        // console.log('Live: Update to sonde ' + sondeID + ' (discarded)');
      }
    }
    else {
      if (inRange([lon, lat])) {
        console.log('Live: Found new sonde ' + sondeID + ' in range');
        var marker = new ol.Feature({
          type: 'sonde',
          geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat])),
        });
        var polyline = [ol.proj.fromLonLat([lon, lat])];
        var path = new ol.Feature({
            type: 'route',
            geometry: new ol.geom.LineString(polyline),
          });
        sondeList[sondeID] = { 'marker': marker, 'frame': frameID, 'path': path };
        vectorSource.addFeature(marker);
        vectorSource.addFeature(path);
      }
    }
  }
}

var livedata_url = "wss://ws-reader.v2.sondehub.org/";
var clientID = "SondeHub-Tracker-" + Math.floor(Math.random() * 10000000000);
var client = new Paho.MQTT.Client(livedata_url, clientID);

client.connect({onSuccess:onConnect, reconnect:true});

// called when the client connects
function onConnect() {
  client.onMessageArrived = onMessageArrived;
  client.onConnectionLost = onConnectionLost;
  // Once a connection has been made, make a subscription
  console.log("Live data WebSocket connected!");
  client.subscribe("batch");
  // client.subscribe("sondes/" + sondeID);
}

function onConnectionLost(errorCode, errorMessage) {
  console.log(errorMessage);
}

// called when a message arrives
function onMessageArrived(message) {
  const frame = JSON.parse(message.payloadString.toString());
  if (frame.length == null) {
    updateSonde(frame);
  } else {
    for (var i = 0; i < frame.length; i++) {
      updateSonde(frame[i]);
    }
  }
}