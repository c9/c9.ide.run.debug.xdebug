define(function(require, exports, module) {
"use strict";

module.exports = DbgpClient;

var inherits = require('util').inherits;
var EventEmitter = require("events").EventEmitter;

var DbgpSession = require("./DbgpSession");
var DbgpStreamReader = require("./DbgpStreamReader");
var DbgpStreamWriter = require("./DbgpStreamWriter");
var SocketStream = require("./SocketStream");
var XmlStream = require("./XmlStream");

function DbgpClient(ideKey) {
    EventEmitter.call(this);
    
    this.ideKey = ideKey || 'cloud9ide';
    
    this.listening = false;
    this.connected = false;
}

inherits(DbgpClient, EventEmitter);

DbgpClient.prototype.listen = function(socket) {
    var client = this;
    var socketStream = new SocketStream(socket);
    
    function onError(err) {
        client.emit("error", err);
    }
    socketStream.on("error", onError);
    
    function onConnect() {
        var dbgpWriter = new DbgpStreamWriter();
        var dbgpReader = new DbgpStreamReader();
        var xmlStream = new XmlStream();
        var session = new DbgpSession();
        
        // input stream
        socketStream.pipe(dbgpReader).pipe(xmlStream).pipe(session);
        
        // output stream
        session.pipe(dbgpWriter).pipe(socketStream);
        
        session.on("init", function() {
            client.emit("session", session);
        });
        
        client.listening = true;
        client.emit("listening");
    }
    socketStream.on("connect", onConnect);
    
    socketStream.connect();
}

DbgpClient.prototype.end = function() {
    // FIXME: socketStream.end() -> socket.unload() ?
    this.emit("end");
}

});