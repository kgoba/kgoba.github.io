/* SondeHub XDATA Parser Library
 *
 * Authors: Mark Jessop & Luke Prior
 */

// Pump Efficiency Correction Parameters for ECC-6A Ozone Sensor, with 3.0cm^3 volume.
// We are using these as a nominal correction value for pump efficiency vs pressure
// 
OIF411_Cef_Pressure =    [    0,     2,     3,      5,    10,    20,    30,    50,   100,   200,   300,   500, 1000, 1100];
OIF411_Cef = [ 1.171, 1.171, 1.131, 1.092, 1.055, 1.032, 1.022, 1.015, 1.011, 1.008, 1.006, 1.004,    1,    1];

function lerp(x, y, a){
    // Helper function for linear interpolation between two points
    return x * (1 - a) + y * a
}


function get_oif411_Cef(pressure){
    // Get the Pump efficiency correction value for a given pressure.

    // Off-scale use bottom-end value
    if (pressure <= OIF411_Cef_Pressure[0]){
        return OIF411_Cef[0];
    }
    
    // Off-scale top, use top-end value
    if (pressure >= OIF411_Cef_Pressure[OIF411_Cef_Pressure.length-1]){
        return OIF411_Cef[OIF411_Cef.length-1];
    }
    

    // Within the correction range, perform linear interpolation.
    for(i= 1; i<OIF411_Cef_Pressure.length; i++){
        if (pressure < OIF411_Cef_Pressure[i]) {
            return lerp(OIF411_Cef[i-1], OIF411_Cef[i],  ( (pressure-OIF411_Cef_Pressure[i-1]) / (OIF411_Cef_Pressure[i]-OIF411_Cef_Pressure[i-1])) );
        }
    }

    // Otherwise, bomb out and return 1.0
    return 1.0;
}

function parseOIF411(xdata, pressure){
    // Attempt to parse an XDATA string from an OIF411 Ozone Sounder
    // Returns an object with parameters to be added to the sondes telemetry.
    //
    // References: 
    // https://www.vaisala.com/sites/default/files/documents/Ozone%20Sounding%20with%20Vaisala%20Radiosonde%20RS41%20User%27s%20Guide%20M211486EN-C.pdf
    //
    // Sample data:      0501036402B958B07500   (length = 20 characters)
    // More sample data: 0501R20234850000006EI  (length = 21 characters)

    // Run some checks over the input
    if(xdata.length < 20){
        // Invalid OIF411 dataset
        return {};
    }

    if(xdata.substr(0,2) !== '05'){
        // Not an OIF411 (shouldn't get here)
        return {};
    }

    var _output = {};

    // Instrument number is common to all XDATA types.
    _output['oif411_instrument_number'] = parseInt(xdata.substr(2,2),16);


    if(xdata.length == 21){
        // ID Data (Table 19)
        // Serial number
        _output['oif411_serial'] = xdata.substr(4,8);

        // Diagnostics word. 
        _diagnostics_word = xdata.substr(12,4);
        if(_diagnostics_word == '0000'){
            _output['oif411_diagnostics'] = "All OK";
        }else if(_diagnostics_word == '0004'){
            _output['oif411_diagnostics'] = 'Ozone pump temperature below -5 °C.';
        }else if(_diagnostics_word == '0400'){
            _output['oif411_diagnostics'] = 'Ozone pump battery voltage (+VBatt) is not connected to OIF411';
        }else if (_diagnostics_word == '0404'){
            _output['oif411_diagnostics'] = 'Ozone pump temp low, and +VBatt not connected.';
        }else {
            _output['oif411_diagnostics'] = 'Unknown State: ' + _diagnostics_word;
        }

        // Version number
        _output['oif411_version'] = (parseInt(xdata.substr(16,4),16)/100).toFixed(2);
    } else if (xdata.length == 20){
        // Measurement Data (Table 18)
        // Ozone pump temperature - signed int16
        _ozone_pump_temp = parseInt(xdata.substr(4,4),16);
        if ((_ozone_pump_temp & 0x8000) > 0) {
            _ozone_pump_temp = _ozone_pump_temp - 0x10000;
        }
        _ozone_pump_temp = _ozone_pump_temp*0.01; // Degrees C (5 - 35)
        _output['oif411_ozone_pump_temp'] = Math.round(_ozone_pump_temp * 100) / 100; // 2 DP

        // Ozone Current
        _ozone_current_uA = parseInt(xdata.substr(8,5),16)*0.0001; // micro-Amps (0.05 - 30)
        _output['oif411_ozone_current_uA'] = Math.round(_ozone_current_uA * 10000) / 10000; // 4 DP

        // Battery Voltage
        _ozone_battery_v = parseInt(xdata.substr(13,2),16)*0.1; // Volts (14 - 19)
        _output['oif411_ozone_battery_v'] = Math.round(_ozone_battery_v * 10) / 10; // 1 DP

        // Ozone Pump Current
        _ozone_pump_curr_mA = parseInt(xdata.substr(15,3),16); // mA (30 - 110)
        _output['oif411_ozone_pump_curr_mA'] = Math.round(_ozone_pump_curr_mA * 10) / 10; // 1 DP

        // External Voltage
        _ext_voltage = parseInt(xdata.substr(18,2),16)*0.1; // Volts
        _output['oif411_ext_voltage'] = Math.round(_ext_voltage * 10) / 10; // 1 DP

        // Now attempt to calculate the O3 partial pressure

        // Calibration values
        Ibg = 0.0; // The BOM appear to use a Ozone background current value of 0 uA
        Cef = get_oif411_Cef(pressure); // Calculate the pump efficiency correction.
        FlowRate = 28.5; // Use a 'nominal' value for Flow Rate (seconds per 100mL).

        _O3_partial_pressure = (4.30851e-4)*(_output['oif411_ozone_current_uA'] - Ibg)*(_output['oif411_ozone_pump_temp']+273.15)*FlowRate*Cef; // mPa
        _output['oif411_O3_partial_pressure'] = Math.round(_O3_partial_pressure * 1000) / 1000; // 3 DP
    } 

    return _output
}

function parseCOBALD(xdata) {
    // Attempt to parse an XDATA string from a COBALD Compact Optical Backscatter Aerosol Detector
    // Returns an object with parameters to be added to the sondes telemetry.
    //
    // References: 
    // https://hobbydocbox.com/Radio/83430839-Cobald-operating-instructions-imet-configuration.html
    //
    // Sample data:      190213fffe005fcf00359943912cca   (length = 30 characters)

    // Run some checks over the input
    if(xdata.length != 30){
        // Invalid COBALD dataset
        return {};
    }

    if(xdata.substr(0,2) !== '19'){
        // Not a COBALD (shouldn't get here)
        return {};
    }

    var _output = {};

    // Instrument number is common to all XDATA types.
    _output['cobald_instrument_number'] = parseInt(xdata.substr(2,2),16);

    // Sonde number
    _output['cobald_sonde_number'] = parseInt(xdata.substr(4,3),16);

    // Internal temperature
    _internal_temperature = parseInt(xdata.substr(7,3),16);
    if ((_internal_temperature  & 0x800) > 0) {
        _internal_temperature  = _internal_temperature  - 0x1000;
    }
    _internal_temperature = _internal_temperature/8; // Degrees C (-40 - 50)
    _output['cobald_internal_temperature'] = Math.round(_internal_temperature * 100) / 100; // 2 DP

    // Blue backscatter
    _blue_backscatter = parseInt(xdata.substr(10,6),16);
    if ((_blue_backscatter  & 0x800000) > 0) {
        _blue_backscatter  = _blue_backscatter  - 0x1000000;
    }
    _output['cobald_blue_backscatter'] = _blue_backscatter; // (0 - 1000000)
    
    // Red backckatter
    _red_backscatter = parseInt(xdata.substr(16,6),16);
    if ((_red_backscatter  & 0x800000) > 0) {
        _red_backscatter  = _red_backscatter  - 0x1000000;
    }
    _output['cobald_red_backscatter'] = _red_backscatter; // (0 - 1000000)

    // Blue monitor
    _blue_monitor = parseInt(xdata.substr(22,4),16);
    if ((_blue_monitor  & 0x8000) > 0) {
        _blue_monitor  = _blue_monitor  - 0x10000;
    }
    _output['cobald_blue_monitor'] = _blue_monitor; // (-32768 - 32767)
    
    // Red monitor
    _red_monitor = parseInt(xdata.substr(26,4),16);
    if ((_red_monitor  & 0x8000) > 0) {
        _red_monitor  = _red_monitor  - 0x10000;
    }
    _output['cobald_red_monitor'] = _red_monitor; // (-32768 - 32767)

    return _output
}

function getPCFHdate(code) {
    // months reference list
    var PCFHmonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    // Get year from first character
    var year = parseInt(code.charAt(0),16);
    year = year + 2016;

    // Get month from second character
    var month = parseInt(code.charAt(1),16);
    month = PCFHmonths[month-1];

    // Generate string
    _part_date = month + " " + year;
    return _part_date;
}

function parsePCFH(xdata) {
    // Attempt to parse an XDATA string from a Peltier Cooled Frost point Hygrometer (PCFH)
    // Returns an object with parameters to be added to the sondes telemetry.
    //
    // References: 
    // Peltier Cooled Frost point Hygrometer (PCFH) Telemetry Interface PDF
    //
    // Sample data:      3c0101434a062c5cd4a5747b81486c93   (length = 32 characters)        
    //                   3c0103456076175ec5fc9df9b1         (length = 26 characters) 
    //                   3c0104a427104e203a9861a8ab6a65     (length = 30 characters) 
    //                   3c010000011b062221                 (length = 18 characters) 

    // Run some checks over the input
    if(xdata.length > 32){
        // Invalid PCFH dataset
        return {};
    }

    if(xdata.substr(0,2) !== '3C'){
        // Not a PCFH (shouldn't get here)
        return {};
    }

    var _output = {};

    // Instrument number is common to all XDATA types.
    _output['pcfh_instrument_number'] = parseInt(xdata.substr(2,2),16);

    // Packet ID
    var packetID = xdata.substr(4,2);

    // Packet type
    if (packetID == "00") { // Individual instrument identification (10 s)
        // Serial number
        _output["pcfh_serial_number"] = parseInt(xdata.substr(6,4));

        // Temperature PCB date
        _output["pcfh_temperature_pcb_date"] = getPCFHdate(xdata.substr(10,2));

        // Main PCB date
        _output["pcfh_main_pcb_date"] = getPCFHdate(xdata.substr(12,2));

        // Controller FW date
        _output["pcfh_controller_fw_date"] = getPCFHdate(xdata.substr(14,2));

        // FPGA FW date
        _output["pcfh_fpga_fw_date"] = getPCFHdate(xdata.substr(16,2));
    } else if (packetID == "01" || packetID == "02") { // Regular one second data, sub-sensor 1/2
        // Frost point mirror temperature
        _frost_point_mirror_temperature = parseInt(xdata.substr(8,3),16);
        _frost_point_mirror_temperature = (_frost_point_mirror_temperature*0.05) - 125;
        _output['pcfh_frost_point_mirror_temperature_' + packetID] = Math.round(_frost_point_mirror_temperature * 100) / 100; // 2 DP

        // Peltier hot side temperature
        _peltier_hot_side_temperature = parseInt(xdata.substr(11,3),16);
        _peltier_hot_side_temperature = (_peltier_hot_side_temperature*0.05) - 125;
        _output['pcfh_peltier_hot_side_temperature_' + packetID] = Math.round(_peltier_hot_side_temperature * 100) / 100; // 2 DP

        // Air temperature
        _air_temperature = parseInt(xdata.substr(14,3),16);
        _air_temperature = (_air_temperature*0.05) - 125;
        _output['pcfh_air_temperature_' + packetID] = Math.round(_air_temperature * 100) / 100; // 2 DP

        // Anticipated frost point mirror temperature
        _anticipated_frost_point_mirror_temperature = parseInt(xdata.substr(17,3),16);
        _anticipated_frost_point_mirror_temperature = (_anticipated_frost_point_mirror_temperature*0.05) - 125;
        _output['pcfh_anticipated_frost_point_mirror_temperature_' + packetID] = Math.round(_anticipated_frost_point_mirror_temperature * 100) / 100; // 2 DP

        // Frost point mirror reflectance
        _frost_point_mirror_reflectance = parseInt(xdata.substr(20,4),16);
        _frost_point_mirror_reflectance = _frost_point_mirror_reflectance/32768;
        _output['pcfh_frost_point_mirror_reflectance_' + packetID] = Math.round(_frost_point_mirror_reflectance * 1000) / 1000; // 3 DP

        // Reference surface reflectance
        _reference_surface_reflectance = parseInt(xdata.substr(24,4),16);
        _reference_surface_reflectance = _reference_surface_reflectance/32768;
        _output['pcfh_reference_surface_reflectance_' + packetID] = Math.round(_reference_surface_reflectance * 1000) / 1000; // 3 DP

        // Reference surface heating current
        _reference_surface_heating_current = parseInt(xdata.substr(28,2),16);
        _reference_surface_heating_current = _reference_surface_heating_current/2.56;
        _output['pcfh_reference_surface_heating_current_' + packetID] = Math.round(_reference_surface_heating_current * 100) / 100; // 2 DP

        // Peltier current
        _peltier_current = parseInt(xdata.substr(30,2),16);
        if ((_peltier_current  & 0x80) > 0) {
            _peltier_current  = _peltier_current  - 0x100;
        }
        _peltier_current = _peltier_current/64;
        _output['pcfh_peltier_current_' + packetID] = Math.round(_peltier_current * 1000) / 1000; // 3 DP
    } else if (packetID == "03") { // Regular five second data
        // Heat sink temperature 1
        _heat_sink_temperature = parseInt(xdata.substr(8,3),16);
        _heat_sink_temperature = (_heat_sink_temperature*0.05) - 125;
        _output['pcfh_heat_sink_temperature_01'] = Math.round(_heat_sink_temperature * 100) / 100; // 2 DP

        // Reference surface temperature 1
        _reference_surface_temperature = parseInt(xdata.substr(11,3),16);
        _reference_surface_temperature = (_reference_surface_temperature*0.05) - 125;
        _output['pcfh_reference_surface_temperature_01'] = Math.round(_reference_surface_temperature * 100) / 100; // 2 DP

        // Heat sink temperature 2
        _heat_sink_temperature = parseInt(xdata.substr(14,3),16);
        _heat_sink_temperature = (_heat_sink_temperature*0.05) - 125;
        _output['pcfh_heat_sink_temperature_02'] = Math.round(_heat_sink_temperature * 100) / 100; // 2 DP

        // Reference surface temperature 2
        _reference_surface_temperature = parseInt(xdata.substr(17,3),16);
        _reference_surface_temperature = (_reference_surface_temperature*0.05) - 125;
        _output['pcfh_reference_surface_temperature_02'] = Math.round(_reference_surface_temperature * 100) / 100; // 2 DP

        // Thermocouple reference temperature
        _thermocouple_reference_temperature = parseInt(xdata.substr(20,3),16);
        _thermocouple_reference_temperature = (_thermocouple_reference_temperature*0.05) - 125;
        _output['pcfh_thermocouple_reference_temperature'] = Math.round(_thermocouple_reference_temperature * 100) / 100; // 2 DP

        // Reserved temperature
        _reserved_temperature = parseInt(xdata.substr(23,3),16);
        _reserved_temperature = (_reserved_temperature*0.05) - 125;
        _output['pcfh_reserved_temperature'] = Math.round(_reserved_temperature * 100) / 100; // 2 DP
    } else if (packetID == "04") { // Instrument status (10 s)
        // Clean frost point mirror reflectance 1
        _clean_frost_point_mirror_reflectance = parseInt(xdata.substr(8,4),16);
        _clean_frost_point_mirror_reflectance = _clean_frost_point_mirror_reflectance*0.001;
        _output['pcfh_clean_frost_point_mirror_reflectance_01'] = Math.round(_clean_frost_point_mirror_reflectance * 1000) / 1000; // 3 DP

        // Clean reference surface reflectance 1
        _clean_reference_surface_reflectance = parseInt(xdata.substr(12,4),16);
        _clean_reference_surface_reflectance = _clean_reference_surface_reflectance*0.001;
        _output['pcfh_clean_reference_surface_reflectance_01'] = Math.round(_clean_reference_surface_reflectance * 1000) / 1000; // 3 DP

        // Clean frost point mirror reflectance 2
        _clean_frost_point_mirror_reflectance = parseInt(xdata.substr(16,4),16);
        _clean_frost_point_mirror_reflectance = _clean_frost_point_mirror_reflectance*0.001;
        _output['pcfh_clean_frost_point_mirror_reflectance_02'] = Math.round(_clean_frost_point_mirror_reflectance * 1000) / 1000; // 3 DP

        // Clean reference surface reflectance 2
        _clean_reference_surface_reflectance = parseInt(xdata.substr(20,4),16);
        _clean_reference_surface_reflectance = _clean_reference_surface_reflectance*0.001;
        _output['pcfh_clean_reference_surface_reflectance_02'] = Math.round(_clean_reference_surface_reflectance * 1000) / 1000; // 3 DP

        // 6V Analog supply battery voltage
        _6v_analog_supply_battery_voltage = parseInt(xdata.substr(24,2),16);
        _6v_analog_supply_battery_voltage = (_6v_analog_supply_battery_voltage*0.02) + 2.5;
        _output['pcfh_6v_analog_supply_battery_voltage'] = Math.round(_6v_analog_supply_battery_voltage * 100) / 100; // 2 DP

        // 4.5V Logic supply battery voltage
        _45v_logic_supply_battery_voltage = parseInt(xdata.substr(26,2),16);
        _45v_logic_supply_battery_voltage = (_45v_logic_supply_battery_voltage*0.02) + 2.5;
        _output['pcfh_45v_logic_supply_battery_voltage'] = Math.round(_45v_logic_supply_battery_voltage * 100) / 100; // 2 DP

        // 4.5V Peltier and heater supply battery voltage
        _45v_peltier_and_heater_supply_battery_voltage = parseInt(xdata.substr(28,2),16);
        _45v_peltier_and_heater_supply_battery_voltage = (_45v_peltier_and_heater_supply_battery_voltage*0.02) + 2.5;
        _output['pcfh_45v_peltier_and_heater_supply_battery_voltage'] = Math.round(_45v_peltier_and_heater_supply_battery_voltage * 100) / 100; // 2 DP
    }

    return _output
}

function calculateFLASHBWaterVapour(S, B, P, T) {
    // This code is incomplete as I don't have reference values
    var K1 = 0;
    var K2 = 0;
    var U = 0;

    var F = S - B + K2*(S-B)

    if (P < 36) {
        U = K1*F*0.956*(1+((0.00781*(T+273.16))/P));
    } else if (36 <= 36 < 300) {
        U = K1*F*(1 + 0.00031*P)
    }

    return U;
}

function parseFLASHB(xdata, pressure, temperature) {
    // Attempt to parse an XDATA string from a Fluorescent Lyman-Alpha Stratospheric Hygrometer for Balloon (FLASH-B)
    // Returns an object with parameters to be added to the sondes telemetry.
    //
    //
    // Sample data:      3D0204E20001407D00E4205DC24406B1012   (length = 35 characters)

    // Run some checks over the input
    if(xdata.length != 35){
        // Invalid FLASH-B dataset
        return {};
    }

    if(xdata.substr(0,2) !== '3D'){
        // Not a FLASH-B (shouldn't get here)
        return {};
    }

    var _output = {};

    // Instrument number is common to all XDATA types.
    _output['flashb_instrument_number'] = parseInt(xdata.substr(2,2),16);

    _photomultiplier_counts = parseInt(xdata.substr(5,4),16);

    _photomultiplier_background_counts = parseInt(xdata.substr(9,4),16);
    _output['flashb_photomultiplier_background_counts'] = _photomultiplier_background_counts

    //_photomultiplier_counts = calculateFLASHBWaterVapour(_photomultiplier_counts, _photomultiplier_background_counts, pressure, temperature);
    _output['flashb_photomultiplier_counts'] = _photomultiplier_counts;

    _photomultiplier_temperature = parseInt(xdata.substr(13,4),16);
    _photomultiplier_temperature = (-21.103*Math.log((_photomultiplier_temperature*0.0183)/(2.49856 - (_photomultiplier_temperature*0.00061)))) + 97.106; // Degrees C
    _output['flashb_photomultiplier_temperature'] = Math.round(_photomultiplier_temperature * 100) / 100; // 2 DP

    _battery_voltage = parseInt(xdata.substr(17,4),16);
    _battery_voltage = _battery_voltage*0.005185; // V
    _output['flashb_battery_voltage'] = Math.round(_battery_voltage * 100) / 100; // 2 DP

    _yuv_current = parseInt(xdata.substr(21,4),16);
    _yuv_current = _yuv_current*0.0101688;  // mA
    _output['flashb_yuv_current'] = Math.round(_yuv_current * 100) / 100; // 2 DP

    _pmt_voltage = parseInt(xdata.substr(25,4),16);
    _pmt_voltage = _pmt_voltage*0.36966; // V
    _output['flashb_pmt_voltage'] = Math.round(_pmt_voltage * 10) / 10; // 1 DP

    _firmware_version = parseInt(xdata.substr(29,2),16);
    _firmware_version = _firmware_version*0.1;
    _output['flashb_firmware_version'] = Math.round(_firmware_version * 10) / 10; // 1 DP

    _output['flashb_production_year'] = parseInt(xdata.substr(31,2),16);

    _output['flashb_hardware_version'] = parseInt(xdata.substr(33,2),16);

    return _output
}

function parseSKYDEW(xdata) {
    // Attempt to parse an XDATA string from a Peltier-based chilled-mirror hygrometer SKYDEW
    // Returns an object with parameters to be added to the sondes telemetry.
    //
    // References: 
    // Peltier-based chilled-mirror hygrometer “SKYDEW” XDATA protocol (draft)
    //
    // Sample data:      3F0144A75446416100160ECAFFFF6EC8000006   (length = 38 characters)

    // Run some checks over the input
    if(xdata.length != 38){
        // Invalid SKYDEW dataset
        return {};
    }

    if(xdata.substr(0,2) !== '3F'){
        // Not a SKYDEW (shouldn't get here)
        return {};
    }

    var _output = {};

    // Instrument number is common to all XDATA types.
    _output['skydew_instrument_number'] = parseInt(xdata.substr(2,2),16);

    // Mirror temperature value
    // This requires the four coefficients to actually get a value
    _output['skydew_mirror_temperature_value'] = parseInt(xdata.substr(4,4),16);

    // Scattered light level
    _scattered_light_value = parseInt(xdata.substr(8,4),16);
    _scattered_light_value = _scattered_light_value*0.0000625 // V
    _output['skydew_scattered_light'] = Math.round(_scattered_light_value * 10000) / 10000; // 4 DP

    // Reference resistance
    // Used to calculate mirror temperature
    _reference_resistance = parseInt(xdata.substr(12,4),16);

    // Offset value
    // Used to calculate mirror temperature
    _offset_value = parseInt(xdata.substr(16,4),16);

    // Peltier current
    _peltier_current_value = parseInt(xdata.substr(20,4),16);
    _peltier_current_value = (_peltier_current_value*0.00040649414 - 1.5)*2; // A
    _output['skydew_peltier_current'] = Math.round(_peltier_current_value * 10000) / 10000; // 4 DP

    // Heatsink temperature
    _heatsink_temperature = parseInt(xdata.substr(24,2),16);
    _heatsink_temperature = (Math.pow((((Math.log(((_heatsink_temperature/8192)*141.9)/(3.3-(_heatsink_temperature/8192)*3.3)/6))/3390)+1)/273.16, -1) -276.16); // Degrees C
    _output['skydew_heatsink_temperature'] = Math.round(_heatsink_temperature * 100) / 100; // 2 DP

    // Circuit board temperature
    _circuit_board_temperature = parseInt(xdata.substr(26,2),16);
    _circuit_board_temperature = (Math.pow((((Math.log(((_circuit_board_temperature/8192)*39.6)/(3.3-(_circuit_board_temperature/8192)*3.3)/6))/3390)+1)/273.16, -1) -276.16); // Degrees C
    _output['skydew_circuit_board_temperature'] = Math.round(_circuit_board_temperature * 100) / 100; // 2 DP

    // Battery
    _output['skydew_battery'] = parseInt(xdata.substr(28,2),16);

    // PID
    _output['skydew_pid'] = parseInt(xdata.substr(30,2),16);

    // Parameter
    var parameter = parseInt(xdata.substr(32,4),16);

    // Coefficent type
    var parameterType = parseInt(xdata.substr(36,2),16);

    // Parameter Type
    switch(parameterType) {
        case 0:
            _output['skydew_serial_number'] = parameter;
        case 1:
            _output['skydew_coefficient_b'] = parameter;
        case 2:
            _output['skydew_coefficient_c'] = parameter;
        case 3:
            _output['skydew_coefficient_d'] = parameter;
        case 4:
            _output['skydew_coefficient_e'] = parameter;
        case 5:
            _output['skydew_firmware_version'] = parameter;
    }

    return _output
}

function parseXDATA(data, pressure, temperature){
    // Accept an XDATA string, or multiple XDATA entries, delimited by '#'
    // Attempt to parse each one, and return an object
    // Test datasets:
    // "0501034F02C978A06300"
    // "0501R20234850000006EI"
    // "0501034F02CA08B06700#800261FCA6F80012F6F40A75"
    // "800262358C080012FE6C0A70#0501035902BA08908400"
    // "0501092C000000000000#190214f0df03e82e03660048d73683#0803DC5EF086C244078601A5#3F04475A4B0D415900160D510C270200465900"

    // Split apart any contatenated xdata.
    if(data.includes('#')){
        data_split = data.split('#');
    } else {
        data_split = [data];
    }

    _output = {"xdata_instrument": []};
    _instruments = [];
    for(xdata_i = 0; xdata_i < data_split.length; xdata_i++){
        _current_xdata = data_split[xdata_i];

        _current_xdata = String(_current_xdata).toUpperCase();

        // Get Instrument ID
        // https://gml.noaa.gov/aftp/user/jordan/XDATA%20Instrument%20ID%20Allocation.pdf
        // https://www.gruan.org/gruan/editor/documents/gruan/GRUAN-TN-11_GruanToolRs92_v1.0_2020-10-01.pdf
        _instrument = _current_xdata.substr(0,2);

        if (_instrument === '01') {
            // V7
            // 0102 time=1001 cnt=0 rpm=0
            // 0102 time=1001 cnt=7 rpm=419
            if (!_instruments.includes("V7")) _instruments.push('V7');
        } else if (_instrument === '05'){
            // OIF411
            _xdata_temp = parseOIF411(_current_xdata, pressure);
            _output = Object.assign(_output,_xdata_temp);
            if (!_instruments.includes("OIF411")) _instruments.push('OIF411');
        } else if (_instrument === '08'){
            // CFH
            // 0803B922067F1D0707CD0144
            // 0803ABD602800F7907D9015D
            // 08038AB16A7FBF4908E50161
            // https://www.en-sci.com/cryogenic-frost-point-hygrometer/
            if (!_instruments.includes("CFH")) _instruments.push('CFH');
        } else if (_instrument === '10'){
            // FPH
            if (!_instruments.includes("FPH")) _instruments.push('FPH');
        } else if (_instrument === '19'){
            // COBALD
            _xdata_temp = parseCOBALD(_current_xdata);
            _output = Object.assign(_output,_xdata_temp);
            if (!_instruments.includes("COBALD")) _instruments.push('COBALD');
        } else if (_instrument === '28'){
            // SLW
            if (!_instruments.includes("SLW")) _instruments.push('SLW');
        } else if (_instrument === '38'){
            // POPS
            if (!_instruments.includes("POPS")) _instruments.push('POPS');
        } else if (_instrument === '39'){
            // OPC
            if (!_instruments.includes("OPC")) _instruments.push('OPC');
        } else if (_instrument === '3C'){
            // PCFH
            _xdata_temp = parsePCFH(_current_xdata);
            _output = Object.assign(_output,_xdata_temp);
            if (!_instruments.includes("PCFH")) _instruments.push('PCFH');
        } else if (_instrument === '3D'){
            // FLASH-B
            _xdata_temp = parseFLASHB(_current_xdata, pressure, temperature);
            _output = Object.assign(_output,_xdata_temp);
            if (!_instruments.includes("FLASH-B")) _instruments.push('FLASH-B');
        } else if (_instrument === '3E'){
            // TRAPS
            if (!_instruments.includes("TRAPS")) _instruments.push('TRAPS');
        } else if (_instrument === '3F'){
            // SKYDEW
            _xdata_temp = parseSKYDEW(_current_xdata);
            _output = Object.assign(_output,_xdata_temp);
            if (!_instruments.includes("SKYDEW")) _instruments.push('SKYDEW');
        } else if (_instrument === '41'){
            // CICANUM
            if (!_instruments.includes("CICANUM")) _instruments.push('CICANUM');
        } else if (_instrument === '45'){
            // POPS
            if (!_instruments.includes("POPS")) _instruments.push('POPS');
        } else if (_instrument === '80'){
            // Unknown!
            //console.log("Saw unknown XDATA instrument 0x80.")
        }else {
            // Unknown!

        }
    }

    if (_instruments.length > 0) _output["xdata_instrument"] = _instruments;

    return _output

}
