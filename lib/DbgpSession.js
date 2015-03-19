define(function(require, exports, module) {
"use strict";

module.exports = DbgpSession;

var inherits = require("util").inherits;
var Stream = require("stream").Stream;

function noop() {};

function DbgpSession() {
    Stream.call(this);
    
    this.writable = true;
    
    this.seq = 0;
    this._callbacks = {};
    
    this.ideKey = 'cloud9ide';
    this.breakOnFirstLine = true;
    
    this.initialized = false;
    this.status = "starting";
    
    var session = this;
    
    this.on("stopping", function() {
        session.end();
    });
}

inherits(DbgpSession, Stream);

DbgpSession.prototype.write = function(xml) {
    var type = xml.text("name(x:*)");
    
    switch (type) {
        case "init":
            return this.handleInit(xml);
            
        case "response":
            return this.handleResponse(xml);
            
        default:
            // throw new Error("Unhandled message type: " + type);
            console.error(new Error("Unhandled message type: " + type));
    }
};

DbgpSession.prototype.end = function() {
    this.emit("end");
}

DbgpSession.prototype.sendCommand = function(command, args, data, callback) {
    var seq = this.seq++;
    
    this.emit("data", {
        seq: seq,
        command: command,
        args: args,
        data: data
    });
    
    this._callbacks["" + seq] = callback;
    
    return seq;
}

DbgpSession.prototype.handleInit = function(xml) {
    if (this.initialized)
        throw new Error("Cannot initialize debugger session more than once");   
        
    xml.nodes("x:init", function(init) {
        this.protocolVersion = init.text("@protocol_version");
        
        this.appId = init.text("@appid");
        this.ideKey = init.text("@idekey");
        this.sessionId = init.text("@session");
        this.threadId = init.text("@thread");
        this.parentAppId = init.text("@parent");
        
        this.language = init.text("@language");
        this.fileURI = init.text("@fileuri");
        
        this.engine = {};
        init.nodes("x:engine", function(engine) {
            this.version = engine.text("@version");
            this.name = engine.text("text()");
        }, this.engine);
        
        this.engine.info = {};
        init.nodes("x:*[name() != \"engine\"]", function(field) {
            this[field.text("name()")] = field.text("text()");
        }, this.engine.info);
    }, this);
    
    /*
     * break on line zero
     */
    
    var _this = this;
    
    this.stepInto(function(err) {
        if (err) {
            _this.emit("error", err);
            return;
        }
        
        _this.emit("init");
    });
    
    this.initialized = true;
}

DbgpSession.prototype.handleResponse = function(xml) {
    // command response
    
    var command = xml.text("x:response/@command")
        , seq = xml.text("x:response/@transaction_id");
        
    if (command && this._callbacks[seq]) {
        var data = xml.text("x:response/x:*/text()")
            , args = {};
            
        xml.nodes("x:response/x:*/@*", function(node) {
            args[node.text("name()")] = node.text("string()");
        });
            
        this._callbacks[seq](null, args, data);
        delete this._callbacks[seq];
    }
    
    // status
    
    var status = xml.text("x:response/@status")
        , reason = xml.text("x:response/@reason");
        
    if (status) {
        this._handleStatus(status);
    }
}

DbgpSession.prototype._handleStatus = function(status) {
    if (this.status !== status) {
        this.status = status;
        this.emit("status", status);
        this.emit(status);
    }
}

DbgpSession.prototype.getStatus = function(callback) {
    callback = callback || noop;
    this.sendCommand("status", null, null, callback);
}

DbgpSession.prototype.eval = function(script, callback) {
    callback = callback || noop;
    this.sendCommand("eval", null, script, callback);
}

// continuation ////////////////////////////////////////////////////////////////

DbgpSession.prototype.run = function(callback) {
    this._continue("run", callback);
}

DbgpSession.prototype.stepInto = function(callback) {
    this._continue("step_into", callback);
}

DbgpSession.prototype.stepOver = function(callback) {
    this._continue("step_over", callback);
}

DbgpSession.prototype.stepOut = function(callback) {
    this._continue("step_out", callback);
}

DbgpSession.prototype.stop = function(callback) {
    this._continue("stop", callback);
}

DbgpSession.prototype._continue = function(command, callback) {
    callback = callback || noop;
    this._handleStatus("running");
    this.sendCommand(command, null, null, callback);
}

// feature negotiation /////////////////////////////////////////////////////////

/**
 * The feature commands are used to request feature support from the debugger
 * engine.
 * 
 * @see http://xdebug.org/docs-dbgp.php#feature-get
 */
DbgpSession.prototype.getFeature = function(feature, callback) {
    callback = callback || noop;
    
    var _this = this;
    var params = {
        n: feature
    };
    
    _this.sendCommand("feature_get", params, null, function(err, args, data, raw) {
        if (err) return callback(err);
            
        if (args.supported !== "1")
            return callback(new Error("No support for debugger feature: " + feature));
            
        callback(null, data);
    });
}

/**
 * The feature set command allows a IDE to tell the debugger engine what
 * additional capabilities it has.
 * 
 * @see http://xdebug.org/docs-dbgp.php#feature-set
 */
DbgpSession.prototype.setFeature = function(feature, value, callback) {
    callback = callback || noop;
    
    var _this = this;
    var params = {
        n: feature,
        v: value
    };
    
    _this.sendCommand("feature_set", params, null, function(err, args, data, raw) {
        if (err) return callback(err);
            
        if (args.success !== "1")
            return callback(new Error("Could not set debugger feature: " + feature));
            
        callback();
    });
}

// contexts ////////////////////////////////////////////////////////////////////

DbgpSession.prototype.getContext = function(stackDepth, contextId, callback) {
    callback = callback || noop;
    
    var _this = this;
    var params = {
        d: stackDepth,
        c: contextId
    };
    
    _this.setFeature("max_depth", 0, function() {
        _this.sendCommand("context_get", params, null, function(err, args, data, raw) {
            if (err) return callback(err);
            
            if (!data)
                data = [];
            else if (!Array.isArray(data))
                data = [data];

            callback(null, data);
        });
    });
}

// properties //////////////////////////////////////////////////////////////////

DbgpSession.prototype.getChildProperties = function(propertyName, contextId, callback) {
    callback = callback || noop;
    
    var _this = this;
    var params = {
        c: contextId,
        n: propertyName
    };
    
    _this.setFeature("max_depth", 1, function() {
        _this.sendCommand("property_get", params, null, function(err, args, data, raw) {
            if (err) return callback(err);
            
            var props = data && data.property;
            
            if (!props)
                props = [];
            else if (!Array.isArray(props))
                props = [props];

            callback(null, props);
        });
    });
}

});