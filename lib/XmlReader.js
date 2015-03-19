define(function(require, exports, module) {
"use strict";

module.exports = XmlReader;

function identity(value) {
    return value;
}

function XmlReader(xmlDocument, nsResolver, _element) {
    if (!(xmlDocument instanceof Document))
        throw new TypeError("Expected xmlDocument to be a Document");
        
    this._doc = xmlDocument;
    this._res = nsResolver || this._createResolver(xmlDocument);
    this._el = _element || xmlDocument;
}

XmlReader.prototype.nodes = function(xpath, iterator, thisArg) {
    var result = [];
    
    var nodes = document.evaluate(xpath, this._el, this._res, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
    var node;
    
    iterator = iterator || identity;
    
    while ((node = nodes.iterateNext())) {
        node = new XmlReader(this._doc, this._res, node);
        result.push(iterator.call(thisArg, node));
    }
    
    return result;
}

XmlReader.prototype.text = function(xpath) {
    var result = document.evaluate(xpath, this._el, this._res, XPathResult.STRING_TYPE, null);
    return result && result.stringValue;
}

XmlReader.prototype._createResolver = function(node) {
    var documentElement = (
        node.ownerDocument == null
        ? node.documentElement
        : node.ownerDocument.documentElement
    );
        
    var nsResolver = document.createNSResolver(documentElement);
    
    return function(prefix) {
        if (prefix === "x") {
            return documentElement.namespaceURI;
        }
        
        return nsResolver.lookupNamespaceURI(prefix);
    }
}

});