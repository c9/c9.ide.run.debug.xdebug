define(function(require, exports, module) {
"use strict";

module.exports = SocketStream;

var inherits = require("util").inherits;
var Stream = require("stream").Stream;

var RECONNECT_PAYLOAD = "Content-Length:0\r\n\r\n";

function SocketStream(socket) {
    Stream.call(this);
    
    var stream = this;
    
    function onData(data) {
        if (data === RECONNECT_PAYLOAD)
            return;
        
        stream.emit("data", data);
    }
    socket.on("data", onData);
    
    function onAway() {
        stream._away = true;
    }
    socket.on("away", onAway);
    
    function onBack() {
        stream._away = false;
        stream.write();
    }
    socket.on("back", onBack);
    
    function onEnd(err) {
        if (err)
            stream.emit("error", err);
        else
            stream.emit("end");
    }
    socket.on("end", onEnd);
    
    function onError(err) {
        stream.emit("error", err);
    }
    socket.on("err", onError);
    socket.on("error", onError);
    
    this._socket = socket;
    this._buffer = "";
    this._away = false;
    
    this.writable = true;
}

inherits(SocketStream, Stream);

SocketStream.prototype.write = function(data) {
    if (this._away || this._socket.connected !== this._socket.CONNECTED) {
        this._buffer += data;
        return false;
    }

    if (this._buffer) {
        this._socket.send(this._buffer);
        this._buffer = "";
        this.emit("drain");
    }
    
    if (data !== null)
        this._socket.send(data);
    
    return true;
}

SocketStream.prototype.connect = function() {
    var _this = this;
    
    function onConnect() {
        _this.emit("connect");
    }
    
    if (this._socket.connected) {
        onConnect();
    } else {
        this._socket.once("connect", onConnect);
        this._socket.connect();
    }
}

SocketStream.prototype.end = function(data) {
    this._socket.close();
}

});