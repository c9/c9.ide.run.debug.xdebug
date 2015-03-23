define(function(require, exports, module) {
"use strict";

exports.parseXml = function parseXml(data) {
    var parser = new DOMParser();

    var xmlDoc = parser.parseFromString(data, "application/xml");
    var errors = xmlDoc.getElementsByTagName("parsererror");
    var error = errors && errors[0];

    if (error) {
        throw new Error("Invalid XML message: " + error.innerText);
    }

    return xmlDoc;
};

/**
 * @see https://developer.mozilla.org/en-US/docs/JXON
 */
exports.xmlToObject = function xmlToObject(xml) {
    if (typeof xml === "string")
        xml = exports.parseXml(xml);
    else if (!(xml instanceof Node))
        throw new TypeError("Expected xml to be string or Node");

    function parseText(sValue) {
        if (/^\s*$/.test(sValue)) { return null; }
        if (/^(?:true|false)$/i.test(sValue)) { return sValue.toLowerCase() === "true"; }
        if (isFinite(sValue)) { return parseFloat(sValue); }
        return sValue;
    }

    var result = null, // default node value
        length = 0,
        text = "";

    if (xml.hasAttributes && xml.hasAttributes()) {
        result = {};
        for (length; length < xml.attributes.length; length++) {
            var attrib = xml.attributes.item(length);
            result["@" + attrib.name.toLowerCase()] = parseText(attrib.value.trim());
        }
    }

    if (xml.hasChildNodes()) {
        for (var i = 0; i < xml.childNodes.length; i++) {
            var node = xml.childNodes.item(i);

            if (node.nodeType === 4) {
                text += node.nodeValue;
            } /* nodeType is "CDATASection" (4) */
            else if (node.nodeType === 3) {
                text += node.nodeValue.trim();
            } /* nodeType is "Text" (3) */
            else if (node.nodeType === 1 && !node.prefix) { /* nodeType is "Element" (1) */
                if (length === 0) {
                    result = {};
                }
                var name = node.nodeName.toLowerCase();
                var children = xmlToObject(node);

                if (result.hasOwnProperty(name)) {
                    if (result[name].constructor !== Array) {
                        result[name] = [result[name]];
                    }
                    result[name].push(children);
                }
                else {
                    result[name] = children;
                    length++;
                }
            }
        }
    }

    if (text) {
        if (length > 0) result["$"] = parseText(text);
        else result = parseText(text);
    }

    return result;
}

exports.base64Decode = function base64Decode(str) {
    if (!str) return "";
    return window.atob(str);
}

exports.base64Encode = function base64Encode(raw) {
    return window.btoa(raw);
};

});
