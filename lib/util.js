define(function(require, exports, module) {
"use strict";

exports.parseXml = function parseXml(data) {
    var parser = new DOMParser()
        , xmlDoc = parser.parseFromString(data, "application/xml")
        , errors = xmlDoc.getElementsByTagName("parsererror")
        , error = errors && errors[0];
    
    if (error) {
        throw new Error("Invalid XML message: " + error.innerText);
    }
    
    return xmlDoc;
};

exports.base64Decode = function base64Decode(str) {
    return window.atob(str);
}

exports.base64Encode = function base64Encode(raw) {
    return window.btoa(raw);
};

});