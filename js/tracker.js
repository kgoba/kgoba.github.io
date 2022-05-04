function fetchListeners(addListener) {
  fetch('https://api.v2.sondehub.org/listeners/telemetry')
    .then(response => response.json())
    .then(function (result) {
      let numAdded = 0;
      for (const key in result) {
        const subkey = Object.keys(result[key])[0];
        const entry = result[key][subkey];
        const callsign = entry['uploader_callsign'];
        if ('uploader_position' in entry) {
          const loc = { lat: entry['uploader_position'][0], lon: entry['uploader_position'][1] };
          if (inRange(loc)) {
            addListener(callsign, loc);
            numAdded++;
          }
        }
      }
      console.log('Added ' + numAdded + ' listeners')
    });
}

function fetchSites(addSite) {
  fetch('https://api.v2.sondehub.org/sites').then(function (response) {
    response.json().then(function (result) {
      let numAdded = 0;
      for (const key in result) {
        const entry = result[key];
        if ('position' in entry) {
          const loc = { lat: entry['position'][1], lon: entry['position'][0] };
          const name = entry['station_name'];
          if (inRange(loc)) {
            addSite(name, loc);
            numAdded++;
          }
        }
      }
      console.log('Added ' + numAdded + ' sites');
    })
  });
}

function fetchSondes(ui, mapRadiusKm) {
  let sondeList = {};

  fetch('https://api.v2.sondehub.org/sondes?lat=57.00&lon=24.00&last=86400&distance=' + (1000*mapRadiusKm)).then(function (response) {
    response.json().then(function (result) {

      var sondeListSize = 0;
      for (const key in result) {
        const entry = result[key];
        const loc = { lat: entry['lat'], lon: entry['lon'] };
        if (inRange(loc)) {
          const serial = entry['serial'];
          const frameID = entry['frame'];
          const data = { serial: serial, frame: frameID, loc: loc };
          let marker = ui.addSonde(data);
          sondeList[key] = { marker: marker, data: data };
          sondeListSize++;
        }
      }
      console.log('Loaded ' + sondeListSize + ' sondes');

      for (const key in sondeList) {
        fetch('https://api.v2.sondehub.org/sonde/' + key).then(function (response) {
          response.json().then(function (result) {
            let polyline = [];
            for (let index = 0; index < result.length; index++) {
              const entry = result[index];
              const point = { lat: entry['lat'], lon: entry['lon'] };
              if (index % 5 == 0)
                polyline.push(point);
            }
            console.log('Loaded ' + polyline.length + ' path points for sonde ' + key);

            let path = ui.addPath(polyline);
            sondeList[key].path = path;
          })
        });
        setTimeout(function(){}, 500);
      }

      startLiveTracker(sondeList, ui);
    })
  });
}

function decodeFrame(sondeList, frame, ui) {
  if ('serial' in frame) {
    const sondeID = frame.serial;
    const loc = { lat: frame.lat, lon: frame.lon, alt: frame.alt };
    const frameID = frame.frame;
    if (sondeList.hasOwnProperty(sondeID)) {
      if (frameID > sondeList[sondeID].data.frame) {
        console.log('Live: Update to sonde ' + sondeID + ' alt: ' + loc.alt);
        try {
          sondeList[sondeID].data.frame = frameID;
          sondeList[sondeID].data.loc = loc;
          sondeList[sondeID].data.vel_v = frame.vel_v;
          sondeList[sondeID].data.vel_h = frame.vel_h;
          let marker = sondeList[sondeID].marker;
          let path = sondeList[sondeID].path;
          ui.updateSonde(marker, sondeList[sondeID].data);
          ui.updatePath(path, loc);
          // marker.getGeometry().setCoordinates(ol.proj.fromLonLat([lon, lat]));
          // // marker.type = 'liveSonde';
          // marker.setStyle(styles['liveSonde']);
          // if (sondeList[sondeID].hasOwnProperty('path')) {
          //   let path = sondeList[sondeID]['path'];
          //   path.getGeometry().appendCoordinate(ol.proj.fromLonLat([lon, lat]));
          // }
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
      if (inRange(loc)) {
        console.log('Live: Found new sonde ' + sondeID + ' in range');
        // let marker = new ol.Feature({
        //   type: 'sonde',
        //   geometry: new ol.geom.Point(ol.proj.fromLonLat([lon, lat])),
        // });
        // let polyline = [ol.proj.fromLonLat([lon, lat])];
        // let path = new ol.Feature({
        //     type: 'route',
        //     geometry: new ol.geom.LineString(polyline),
        //   });
        const data = { serial: sondeID, frame: frameID, loc: loc, vel_v: frame.vel_v, vel_h: frame.vel_h };
        let marker = ui.addSonde(data);
        let path = ui.addPath([loc]);
        sondeList[sondeID] = { marker: marker, path: path, data: data };
        // markerSource.addFeature(marker);
        // markerSource.addFeature(path);
      }
    }
  }
}

function startLiveTracker(sondeList, ui) {
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
      decodeFrame(sondeList, frame, ui);
    } else {
      for (let i = 0; i < frame.length; i++) {
        decodeFrame(sondeList, frame[i], ui);
      }
    }
  }
}
