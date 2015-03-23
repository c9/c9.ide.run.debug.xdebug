define(function(require, exports, module) {
"use strict";

module.exports = DbgpClient;

var inherits = require('util').inherits;
var EventEmitter = require("events").EventEmitter;

var DbgpSession = require("./DbgpSession");
var DbgpStreamReader = require("./DbgpStreamReader");
var DbgpStreamWriter = require("./DbgpStreamWriter");
var XmlStreamReader = require("./XmlStreamReader");
var SocketStream = require("./SocketStream");

/**
 * The `DbgpClient` controls interaction between IDE, netproxy socket, and
 * debugger processes.
 *
 * A client is bound to a netproxy socket, on which it listens for incoming
 * connections. When a process connects, a new debugger session is created and
 * initialized. This session can then be used to interact with the process.
 */
function DbgpClient() {
    EventEmitter.call(this);

    this.listening = false;
}

inherits(DbgpClient, EventEmitter);

/**
 * Connect with the given netproxy `Socket` and begin listening for debugger
 * connections.
 *
 * When a debugger connects, a new `DbgpSession` is initialized and the
 * `session` event will be emitted.
 *
 * @param {c9.ide.run.debug:debugger.socket:Socket} socket The netproxy socket to bind to.
 */
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
        var xmlReader = new XmlStreamReader();
        var session = new DbgpSession(client.ideKey);

        // input stream
        socketStream.pipe(dbgpReader).pipe(xmlReader).pipe(session);

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
