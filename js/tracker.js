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
      let sondeListSize = 0;
      for (const key in result) {
        const entry = result[key];
        const loc = { lat: entry['lat'], lon: entry['lon'] };
        if (inRange(loc)) {
          let marker = ui.addSonde(entry);
          sondeList[key] = { marker: marker, data: entry };

          // Launch a regular updater
          setInterval(function() {
            ui.updateSonde(sondeList[key].marker, sondeList[key].data);
          }, 1000);

          // Fetch prediction data after small random time
          const timeoutMillis = 200 + Math.floor(Math.random() * 800);
          setTimeout(function() {
            getPrediction(key, sondeList, ui);
          }, timeoutMillis);

          sondeListSize++;
        }
      }
      console.log('Loaded ' + sondeListSize + ' sondes');

      for (const key in sondeList) {
        // Schedule downloading of archived flight data after some random time not to annoy the server
        const timeoutMillis = 500 + Math.floor(Math.random() * 1500);
        setTimeout(function() {
          fetch('https://api.v2.sondehub.org/sonde/' + key).then(function (response) {
            response.json().then(function (result) {
              let polyline = [];
              for (let index = 0; index < result.length; index++) {
                // To save some memory, add only every fifth point of the path
                if (index % 5 == 0) {
                  const entry = result[index];
                  const point = { lat: entry['lat'], lon: entry['lon'] };
                  polyline.push(point);
                }
              }
              console.log('Loaded ' + polyline.length + ' path points for sonde ' + key);

              let path = ui.addPath(polyline, 'archived');
              sondeList[key].path = path;
            })
          })}, timeoutMillis);
      }

      startLiveTracker(sondeList, ui);
    })
  });
}

function decodeFrame(sondeList, data, ui) {
  if ('serial' in data) {
    const sondeID = data.serial;
    const loc = { lat: data.lat, lon: data.lon, alt: data.alt };

    // Check if sonde exists in our list
    if (sondeList.hasOwnProperty(sondeID)) {
      // Check if the newly received frame has a larger frame number than the current one
      if (data.frame > sondeList[sondeID].data.frame) {
        // console.log('Live: Update to sonde ' + sondeID + ' alt: ' + loc.alt);
        try {
          sondeList[sondeID].data = data;
          let marker = sondeList[sondeID].marker;
          ui.updateSonde(marker, data);
          ui.extendPath(sondeList[sondeID].path, loc);
        }
        catch (error) {
          console.log('Error while updating sonde data: ' + error);
        }
      }
      else {
        // console.log('Live: Update to sonde ' + sondeID + ' (discarded)');
      }

      // Check the age of last prediction and update if necessary
      if (sondeList[sondeID].lastPredictTime != null) {
        const predictAge = (Date.now() - sondeList[sondeID].lastPredictTime) / 1000;
        if (predictAge > 60) {
          getPrediction(sondeID, sondeList, ui);
        }
      }
      else {
        getPrediction(sondeID, sondeList, ui);
      }
    }
    else {
      // A new sonde is found (not on our list)
      if (inRange(loc)) {
        console.log('Live: Found new sonde ' + sondeID + ' in range');
        let marker = ui.addSonde(data);
        let path = ui.addPath([loc], 'live');
        sondeList[sondeID] = { marker: marker, path: path, data: data };
        // Launch a regular updater
        setInterval(function() {
          ui.updateSonde(sondeList[sondeID].marker, sondeList[sondeID].data);
        }, 1000);

        // Request prediction
        getPrediction(sondeID, sondeList, ui);
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

function getPrediction(sondeID, sondeList, ui)
{
  // Add timestamp so we know later how old the prediction is
  sondeList[sondeID].lastPredictTime = Date.now();
  console.log('Checking prediction for ' + sondeID);

  fetch('https://api.v2.sondehub.org/predictions?vehicles=' + sondeID).then(function (response) {
    response.json().then(function (result) {
      if (result.length > 0) {
        const pathData = JSON.parse(result[0].data);
        let polyline = [];
        for (let index = 0; index < pathData.length; index++) {
          const entry = pathData[index];
          polyline.push({lat: entry['lat'], lon: entry['lon']});
        }
        // console.log('Adding ' + polyline.length + ' predicted path points for sonde ' + sondeID);

        if (sondeList[sondeID].predictedPath == null) {
          let path = ui.addPath(polyline, 'predict');
          sondeList[sondeID].predictedPath = path;
        }
        else {
          let path = sondeList[sondeID].predictedPath;
          ui.updatePath(path, polyline);
        }
      }
    })
  });
}
