function fetchListeners(addListener) {
  fetch('https://api.v2.sondehub.org/listeners/telemetry').then(function (response) {
    response.json().then(function (result) {
      let numAdded = 0;
      for (const key in result) {
        const subkey = Object.keys(result[key])[0];
        const entry = result[key][subkey];
        const callsign = entry['uploader_callsign'];
        if ('uploader_position' in entry) {
          const lat = entry['uploader_position'][0];
          const lon = entry['uploader_position'][1];
          if (inRange([lon, lat])) {
            addListener(callsign, lon, lat);
            numAdded++;
          }
        }
      }
      console.log('Added ' + numAdded + ' listeners')
    })
  });
}

function fetchSites(addSite) {
  fetch('https://api.v2.sondehub.org/sites').then(function (response) {
    response.json().then(function (result) {
      let numAdded = 0;
      for (const key in result) {
        const entry = result[key];
        if ('position' in entry) {
          const lat = entry['position'][1];
          const lon = entry['position'][0];
          const name = entry['station_name'];
          if (inRange([lon, lat])) {
            addSite(name, lon, lat);
            numAdded++;
          }
        }
      }
      console.log('Added ' + numAdded + ' sites');
    })
  });
}

function fetchSondes() {
  let sondeList = {};
  let markerSource = new ol.source.Vector({});

  map.addLayer(new ol.layer.Vector({
      source: markerSource,
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
          let marker = new ol.Feature({
            type: 'sonde',
            geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat])),
          });
          markerSource.addFeature(marker);
          sondeList[key] = { 'marker' : marker, 'frame': frameID };
        }
      }
      console.log('Loaded ' + sondeList.size + ' sondes');

      for (const key in sondeList) {
        fetch('https://api.v2.sondehub.org/sonde/' + key).then(function (response) {
          response.json().then(function (result) {
            let polyline = [];
            for (let index = 0; index < result.length; index++) {
              const entry = result[index];
              const lat = entry['lat'];
              const lon = entry['lon'];
              if (index % 5 == 0)
                polyline.push(ol.proj.fromLonLat([lon, lat]));
            }
            console.log('Loaded ' + polyline.length + ' path points for sonde ' + key);

            let path = new ol.Feature({
              type: 'route',
              geometry: new ol.geom.LineString(polyline),
            });
            markerSource.addFeature(path);
            sondeList[key].path = path;
          })
        });
        setTimeout(function(){}, 500);
      }
    })
  });
}

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
          let marker = sondeList[sondeID]['marker'];
          marker.getGeometry().setCoordinates(ol.proj.fromLonLat([lon, lat]));
          // marker.type = 'liveSonde';
          marker.setStyle(styles['liveSonde']);
          if (sondeList[sondeID].hasOwnProperty('path')) {
            let path = sondeList[sondeID]['path'];
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
        let marker = new ol.Feature({
          type: 'sonde',
          geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat])),
        });
        let polyline = [ol.proj.fromLonLat([lon, lat])];
        let path = new ol.Feature({
            type: 'route',
            geometry: new ol.geom.LineString(polyline),
          });
        sondeList[sondeID] = { 'marker': marker, 'frame': frameID, 'path': path };
        markerSource.addFeature(marker);
        markerSource.addFeature(path);
      }
    }
  }
}

function startLiveTracker() {
  const livedata_url = "wss://ws-reader.v2.sondehub.org/";
  const clientID = "SondeHub-Tracker-" + Math.floor(Math.random() * 10000000000);
  let client = new Paho.MQTT.Client(livedata_url, clientID);

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
      for (let i = 0; i < frame.length; i++) {
        updateSonde(frame[i]);
      }
    }
  }
}