import requests
import os, sys, datetime
import math, json

K1 = 9.80665 * 0.0289644 / 8.3144598 # gM/R
RHO0 = 1.22500
API_URL = 'https://api.v2.sondehub.org'
MY_LAT = 56.65
MY_LON = 24.12

def density_alt(h):
    if h < 11000:
        h_b, rho_b, T_b, L_b = 0, 1.22500, 288.15, -0.0065
    elif h < 20000:
        h_b, rho_b, T_b, L_b = 11000, 0.36391, 216.65, 0.0
    else:
        h_b, rho_b, T_b, L_b = 20000, 0.08803, 216.65, 0.001

    if L_b == 0:
        k = math.exp(-K1 * (h - h_b) / T_b)
    else:
        k = (T_b / (T_b + L_b * (h - h_b)))**(1 + K1 / L_b)

    return rho_b * k


def avg_and_std(data):
    avg = sum(data) / len(data)
    x2_avg = sum([x*x for x in data]) / len(data)
    std = math.sqrt(x2_avg - avg * avg)
    return avg, std


def request_cached(item_id, cache_dir, on_miss, decoder, encoder):
    path = os.path.join(cache_dir, f'{item_id}.raw')
    if os.path.exists(path):
        with open(path, 'r') as file:
            content = decoder(file.read())
    else:
        content = on_miss(item_id)
        if not os.path.exists(cache_dir):
            os.makedirs(cache_dir)
        with open(path, 'w') as file:
            file.write(encoder(content))
    return content


def download_sonde_data(sonde_id):
    print(f'Downloading data for sonde {sonde_id}', file=sys.stderr)
    # url = f'{api_url}/sondes/telemetry?serial={sonde_id}'
    # Fetch data from the S3 archive
    url = f'{API_URL}/sonde/{sonde_id}'
    response = requests.get(url) # Make a GET request
    data = response.json()
    return data # data[sonde_id]


def find_sondes(lat, lon, radius, timespan):
    # https://api.v2.sondehub.org/sondes?lat=56.65&lon=24.12&distance=160000&last=2420000
    url = f'{API_URL}/sondes?lat={lat}&lon={lon}&distance={radius}&last={timespan}'
    response = requests.get(url) # Make a GET request
    data = response.json()
    return list(data.keys())


def parse_altitude_data(data):
    format = '%Y-%m-%dT%H:%M:%S.%fZ'
    time_data = list([datetime.datetime.strptime(x['datetime'], format).replace(tzinfo=datetime.timezone.utc) for x in data])
    alt_data = [x['alt'] for x in data]

    return time_data, alt_data


def analyse_sonde(sonde_id):
    raw_data = request_cached(sonde_id, 'cache', download_sonde_data, json.loads, json.dumps)
    time_data, alt_data = parse_altitude_data(raw_data)

    time_order = sorted(enumerate(time_data), key=lambda x: x[1])
    start_time = min(time_data)

    # filter time and altitude data
    time_filt, alt_filt = list(), list()
    last_time = None
    for (index, abs_time) in time_order:
        alt = alt_data[index]
        time = (abs_time - start_time).total_seconds()
        if last_time == None or time - last_time > 0.5:
            time_filt.append(time)
            alt_filt.append(alt)
            last_time = time

    v_vert_filt = list()
    num_points = len(time_filt)
    for index in range(num_points):
        if index == 0:
            v_vert = (alt_filt[index + 1] - alt_filt[index]) / (time_filt[index + 1] - time_filt[index])
        elif index + 1 == num_points:
            v_vert = (alt_filt[index] - alt_filt[index - 1]) / (time_filt[index] - time_filt[index - 1])
        else:
            v_vert1 = (alt_filt[index] - alt_filt[index - 1]) / (time_filt[index] - time_filt[index - 1])
            v_vert2 = (alt_filt[index + 1] - alt_filt[index]) / (time_filt[index + 1] - time_filt[index])
            v_vert = (v_vert1 + v_vert2) / 2
        v_vert_filt.append(v_vert)

    STATE_IDLE, STATE_ASCENT, STATE_DESCENT, STATE_LANDED = range(4)
    state_dict = dict(zip(range(4), ['IDLE', 'ASCENT', 'DESCENT', 'LANDED']))
    state = STATE_IDLE
    # for (time, alt, v_vert) in zip(time_filt, alt_filt, v_vert_filt):
    v_ascent = list()
    v_descent = list()
    burst_alt = None
    for index in range(num_points):
        (time, alt, v_vert) = time_filt[index], alt_filt[index], v_vert_filt[index]
        if state == STATE_IDLE:
            num_match = 0
            for i in range(4):
                if index + i + 1 < num_points and v_vert_filt[index + i] > 0:
                    num_match += 1
            if v_vert_filt[index] > 0 and num_match >= 3:
                state = STATE_ASCENT
                v_vert0 = v_vert
        elif state == STATE_ASCENT:
            num_match = 0
            for i in range(4):
                if index + i + 1 < num_points and v_vert_filt[index + i] < 0:
                    num_match += 1
            if v_vert_filt[index] < 0 and num_match >= 3:
                state = STATE_DESCENT
                v_vert0 = v_vert
                burst_alt = alt
        elif state == STATE_DESCENT:
            num_match = 0
            for i in range(4):
                if index + i + 1 < num_points and v_vert_filt[index + i] > -0.5:
                    num_match += 1
            if v_vert_filt[index] > -0.5 and num_match >= 3:
                state = STATE_LANDED
                v_vert0 = v_vert

        rho = density_alt(alt)
        if state == STATE_DESCENT:
            v_vert0 = v_vert * math.sqrt(rho / RHO0)
            v_descent.append(v_vert0)
        else:
            v_vert0 = v_vert
            if state == STATE_ASCENT:
                v_ascent.append(v_vert0)
        # print(f'{time:.1f} | {alt:.1f} | {v_vert:.2f} | {rho:.2f} | {v_vert0:.1f} | {state_dict[state]}')

    return (v_ascent, v_descent, burst_alt)


def analyse_and_report_sonde(sonde_id):
    print(f'Analysing sonde {sonde_id}', file=sys.stderr)
    v_ascent, v_descent, burst_alt = analyse_sonde(sonde_id)

    if len(v_ascent) < 5:
        print('Ascent rate: not enough samples!')
        v_ascent_avg = None
    else:
        v_ascent_avg = sum(v_ascent) / len(v_ascent)
        v2_ascent_avg = sum([x*x for x in v_ascent]) / len(v_ascent)
        v_ascent_std = math.sqrt(v2_ascent_avg - v_ascent_avg * v_ascent_avg)
        print(f'Ascent rate: {v_ascent_avg:.1f} m/s, std {v_ascent_std:.1f} m/s, {len(v_ascent)} samples')

    if len(v_descent) < 5:
        print('Descent rate: not enough samples!')
        v_descent_avg = None
    else:
        v_descent_avg = sum(v_descent) / len(v_descent)
        v2_descent_avg = sum([x*x for x in v_descent]) / len(v_descent)
        v_descent_std = math.sqrt(v2_descent_avg - v_descent_avg * v_descent_avg)
        print(f'Descent rate: {v_descent_avg:.1f} m/s, std {v_descent_std:.1f} m/s, {len(v_descent)} samples')

    if burst_alt == None:
        print(f'Burst altitude: --- m')
    else:
        print(f'Burst altitude: {burst_alt:.0f} m')

    return (v_ascent_avg, v_descent_avg, burst_alt)


if len(sys.argv) >= 2:
    sonde_id = sys.argv[1]
    analyse_and_report_sonde(sonde_id)
else:
    print('Checking recent sonde data...', file=sys.stderr)
    v_ascent, v_descent, burst_alt = list(), list(), list()
    for sonde_id in find_sondes(MY_LAT, MY_LON, 150*1000, 3*28*24*3600):
        if not sonde_id.startswith('T1') and not sonde_id.startswith('T3'):
        # if not sonde_id.startswith('T'):
            continue
        #print(f'Sonde {sonde_id}', file=sys.stderr)
        #download_sonde_data(sonde_id)
        #request_cached(sonde_id, 'cache', download_sonde_data, json.loads, json.dumps)
        # v_ascent_t, v_descent_t, burst_alt_t = analyse_and_report_sonde(sonde_id)
        v_ascent_t, v_descent_t, burst_alt_t = analyse_sonde(sonde_id)

        if len(v_ascent_t) > 5:
            v_ascent_t, _ = avg_and_std(v_ascent_t)
            v_ascent.append(v_ascent_t)
        else:
            v_ascent_t = None

        if len(v_descent_t) > 5:
            v_descent_t, _ = avg_and_std(v_descent_t)
            v_descent.append(v_descent_t)
        else:
            v_descent_t = None

        if burst_alt_t != None:
            burst_alt.append(burst_alt_t)

        print(f'{sonde_id} {v_ascent_t} {v_descent_t} {burst_alt_t}', file=sys.stderr)

    v_ascent_avg, v_ascent_std = avg_and_std(v_ascent)
    v_descent_avg, v_descent_std = avg_and_std(v_descent)
    burst_alt_avg, burst_alt_std = avg_and_std(burst_alt)

    print(f'Average ascent rate: {v_ascent_avg:.1f} m/s, std {v_ascent_std:.1f} m/s, {len(v_ascent)} samples')
    print(f'Average descent rate: {v_descent_avg:.1f} m/s, std {v_descent_std:.1f} m/s, {len(v_descent)} samples')
    print(f'Average burst altitude: {burst_alt_avg:.1f} m, std {burst_alt_std:.1f} m, {len(burst_alt)} samples')
