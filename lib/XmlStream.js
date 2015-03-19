define(function(require, exports, module) {
"use strict";

module.exports = XmlStream;

var inherits = require("util").inherits;
var Stream = require("stream").Stream;

var parseXml = require("./util").parseXml;
var XmlReader = require("./XmlReader");

function XmlStream() {
    Stream.call(this);
    this.writable = true;
}

inherits(XmlStream, Stream);

XmlStream.prototype.write = function(data) {
    var xml;
    
    try {
        xml = parseXml(data);
    } catch (err) {
        this.emit("error", err);
        return;
    }
    
    var reader = new XmlReader(xml);
    this.emit("data", reader);
    
    return true;
}

XmlStream.prototype.end = function() {
    this.emit("end");
}

});