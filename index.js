var http = require('http');
var fs = require('fs');
let configInterval = null

// Create server
var server = http.createServer(function (req, res) {
    fs.readFile('./index.html', 'utf-8', function (error, content) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(content);
    });
});

// Connect Socket.io
var io = require('socket.io').listen(server);

// Add listener and respond
var client = undefined;
io.sockets.on('connection', function (socket) {
    console.log('Client connected');
    // socket.emit('message', { content: 'Welcome !' })
    client = socket;
});

// Connect to metawear
var ref = require('ref');
var MetaWear = require('metawear');
// MetaWear.discoverByAddress('E5:2F:38:57:A5:EE', function (device) {
MetaWear.discover(function (device) {
    console.log('device found', device)
    device.on('disconnect', function () {
        console.log('we got disconnected! :( ');
    });

    device.connectAndSetUp(function (error) {
        if (error) console.log(error)
        // Calibrate Device
        configInterval = setInterval(() => {
            readCalibration(device)
        }, 1000)
        setupDevice(device)
    });

    function readCalibration(device) {
        const { board } = device;
        const signal = MetaWear.mbl_mw_sensor_fusion_calibration_state_data_signal(board);
        MetaWear.mbl_mw_datasignal_subscribe(signal, ref.NULL, (context, dataPtr) => {
            var data = dataPtr.deref();
            var pt = data.parseValue();
            console.log(pt)
            if (pt.magnetometer === 3 && pt.gyroscope === 3 && pt.accelrometer === 3) {
                clearInterval(configInterval)
                handleImuCalibrationData(device)
                setupDevice(device)
            }
        });

        MetaWear.mbl_mw_datasignal_read(signal);
    }

    function handleImuCalibrationData(device) {
        const { board } = device;
        MetaWear.mbl_mw_sensor_fusion_read_calibration_data(board, ref.NULL, (context, board, data) => {
            // returns null if an error occured, such as using with unsupported firmware
            // write to board, or save to local file to always have on hand
            if (data != ref.NULL) {
                // calibration data is reloaded everytime mode changes
                MetaWear.mbl_mw_sensor_fusion_write_calibration_data(board, data);

                // free memory after we're done with the pointer
                MetaWear.mbl_mw_memory_free(data);
                // setupDevice(device)
            }
        });
    }


    function setupDevice(device) {

        console.log('Enable Quaterion')
        var quaternion = MetaWear.mbl_mw_sensor_fusion_get_data_signal(device.board, MetaWear.SensorFusionData.QUATERNION);
        MetaWear.mbl_mw_datasignal_subscribe(quaternion, ref.NULL, MetaWear.FnVoid_VoidP_DataP.toPointer(function gotTimer(context, dataPtr) {
            var data = dataPtr.deref();
            var pt = data.parseValue();
            // console.log('qtn',pt.x, pt.y, pt.z, pt.w);
            if (client) client.emit('quaternion', { x: pt.x, y: pt.y, z: pt.z, w: pt.w })
        }));
        MetaWear.mbl_mw_sensor_fusion_enable_data(device.board, MetaWear.SensorFusionData.QUATERNION);

        console.log('Enable Linear Acceleration')
        var acc = MetaWear.mbl_mw_sensor_fusion_get_data_signal(device.board, MetaWear.SensorFusionData.LINEAR_ACC); // LINEAR_ACC
        MetaWear.mbl_mw_datasignal_subscribe(acc, ref.NULL, MetaWear.FnVoid_VoidP_DataP.toPointer(function gotTimer(context, dataPtr) {
            var data = dataPtr.deref();
            var pt = data.parseValue();
            // console.log('acc', pt.x, pt.y, pt.z);
            if (client) client.emit('acc', { x: pt.x, y: pt.y, z: pt.z, t: Date.now() })
        }));
        MetaWear.mbl_mw_sensor_fusion_enable_data(device.board, MetaWear.SensorFusionData.LINEAR_ACC); // LINEAR_ACC


        console.log('Configure Mode')
        //MetaWear.mbl_mw_settings_set_connection_parameters(device.board, 7.5, 7.5, 0, 6000)
        MetaWear.mbl_mw_sensor_fusion_set_mode(device.board, MetaWear.SensorFusionMode.NDOF)
        MetaWear.mbl_mw_sensor_fusion_set_acc_range(device.board, MetaWear.SensorFusionAccRange._8G); //2
        MetaWear.mbl_mw_sensor_fusion_set_gyro_range(device.board, MetaWear.SensorFusionGyroRange._1000DPS);//250
        MetaWear.mbl_mw_sensor_fusion_write_config(device.board)

        console.log('Start streaming')
        MetaWear.mbl_mw_sensor_fusion_start(device.board)


        device.once('disconnect', function (reason) {
            console.log('erasing all')
            // MetaWear.mbl_mw_macro_erase_all(device.board);
            // MetaWear.mbl_mw_debug_reset_after_gc(device.board);
            MetaWear.mbl_mw_debug_disconnect(device.board);
            MetaWear.mbl_mw_sensor_fusion_stop(device.board)
            MetaWear.mbl_mw_sensor_fusion_clear_enabled_mask(device.board)
            MetaWear.mbl_mw_datasignal_unsubscribe(quaternion);
            MetaWear.mbl_mw_datasignal_unsubscribe(acc);
            MetaWear.mbl_mw_debug_disconnect(device.board);

            process.exit(0);
        })
    }

    // Stop after 5 seconds
    // setTimeout(function () {
    //     MetaWear.mbl_mw_sensor_fusion_stop(device.board)
    //     MetaWear.mbl_mw_sensor_fusion_clear_enabled_mask(device.board)
    //     MetaWear.mbl_mw_datasignal_unsubscribe(quaternion);
    //     MetaWear.mbl_mw_datasignal_unsubscribe(acc);
    //     MetaWear.mbl_mw_debug_disconnect(device.board);
    // }, 20000);

});


server.listen(8080);