/* global describe it before after beforeEach afterEach define */

"use strict";
"use client";
"use mocha";

if (typeof define === "undefined") {
    require("c9/inline-mocha")(module);
    require("amd-loader");
    require("../../test/setup_paths");
}

define(function(require, exports, module) {

var expect = require("lib/chai/chai").expect;

// begin test ////

var parseXml = require("./lib/util").parseXml;

describe("util.parseXml()", function() {
    it("should read well-formed XML", function() {
        var xmlDoc = parseXml("<foo><bar/></foo>");
        expect(xmlDoc).to.be.instanceOf(Document);
        expect(xmlDoc.documentElement.tagName).to.equal("foo");
        expect(xmlDoc.documentElement.childNodes[0].tagName).to.equal("bar");
    });

    it("should read well-formed XML with a declaration", function() {
        var xmlDoc = parseXml('<?xml version="1.0" encoding="UTF-8"?><foo><bar/></foo>');
        expect(xmlDoc).to.be.instanceOf(Document);
        expect(xmlDoc.documentElement.tagName).to.equal("foo");
    });

    it("should fail with invalid XML", function() {
        expect(function() {
            parseXml("<foo>&such; this is not xml!");
        }).to.throw(Error, /Entity 'such' not defined/);

        expect(function() {
            parseXml("<foo>incomplete doc");
        }).to.throw(Error, /Extra content at the end of the document/);

        expect(function() {
            parseXml();
        }).to.throw(Error, /empty/);
    });
});

// end test ///
/// begin test ////

var xmlToObject = require("./lib/util").xmlToObject;

describe("util.xmlToObject()", function() {
    var mockInput, mockOutput;

    before(function() {
        mockInput = require("text!./mock/jxon.xml");
        mockOutput = require("./mock/jxon.js");
    });

    it("should read well-formed XML", function() {
        var obj = xmlToObject(mockInput);
        expect(obj).to.deep.equal(mockOutput);
    });
});

// end test ////
// begin test ////

var XmlReader = require("./lib/XmlReader");

describe("XmlReader", function() {
    var reader;

    beforeEach(function() {
        var xmlDoc = parseXml(require("text!./mock/init.xml"));
        reader = new XmlReader(xmlDoc);
    });

    it("should run", function() {
        var ctx = {};

        reader.map("x:init", function(init) {
            this.language = init.string("@language");
            this.protocolVersion = init.string("@protocol_version");

            this.appId = init.string("@appid");
            this.ideKey = init.string("@idekey");

            this.path = init.string("@fileuri");

            this.engine = {};
            init.map("x:engine", function(engine) {
                this.version = engine.string("@version");
                this.name = engine.string("text()");
            }, this.engine);

            this.engine.info = {};
            init.map("x:*[name() != \"engine\"]", function(field) {
                this[field.string("name()")] = field.string("text()");
            }, this.engine.info);
        }, ctx);

        console.log(ctx);
    });
});

// end test ////
// begin test ////

var Stream = require("stream").Stream;
var DbgpStreamReader = require("./lib/DbgpStreamReader");

describe("DbgpStreamReader", function() {
    var stream;

    beforeEach(function() {
        stream = new DbgpStreamReader();
    });

    describe("implements stream", function() {
        it("should be a Stream", function() {
            expect(stream).to.be.instanceOf(Stream);
        });
        it("should be a writable", function() {
            expect(stream.writable).to.be.true;
        });
    });

    describe("reading data", function() {
        it("should read a single message in one chunk", function(done) {
            stream.once("data", function(data) {
                expect(data).to.equal("test");
                done();
            });

            stream.write("4\u0000test\u0000");
        });

        it("should read multiple messages in one chunk", function(done) {
            stream.once("data", function(data) {
                expect(data).to.equal("test");
                stream.once("data", function(data) {
                    expect(data).to.equal("foo");
                    done();
                });
            });

            stream.write("4\u0000test\u00003\u0000foo\u0000");
        });

        it("should read multiple messages in partial chunks", function(done) {
            stream.once("data", function(data) {
                expect(data).to.equal("test");

                stream.once("data", function(data) {
                    expect(data).to.equal("foo");
                    done();
                });

                stream.write("o\u0000");
            });

            stream.write("4\u0000test\u00003\u0000fo");
        });

        it("should stream partial length chunks", function(done) {
            stream.once("data", function(data) {
                expect(data).to.equal("xxxxxxxxxx");
                done();
            });

            stream.write("1");
            stream.write("0\u0000xxxxxxxxxx\u0000");
        });

        it("should stream partial data chunks", function(done) {
            stream.once("data", function(data) {
                expect(data).to.equal("test");
                done();
            });

            stream.write("4\u0000te");
            stream.write("st\u0000");
        });

        it("should emit error if length header and data size do not match", function(done) {
            stream.on("data", function() {
                done(new Error("should not emit data"));
            });

            stream.once("error", function(err) {
                expect(err).to.be.instanceOf(Error);
                expect(err.message).to.match(/data length does not match header/);
                done();
            });

            stream.write("8\u0000test\u0000");
        });
    });
});

// end test ////
// begin test ////

var Stream = require("stream").Stream;
var DbgpStreamWriter = require("./lib/DbgpStreamWriter");

describe("DbgpStreamWriter", function() {
    var stream;

    beforeEach(function() {
        stream = new DbgpStreamWriter();
    });

    describe("implements stream", function() {
        it("should be a Stream", function() {
            expect(stream).to.be.instanceOf(Stream);
        });
        it("should be a writable", function() {
            expect(stream.writable).to.be.true;
        });
    });

    describe("writing data", function() {
        it("should write a valid message without data", function(done) {
            stream.on("error", done);

            stream.once("data", function(data) {
                expect(data).to.equal("property_get -i 100 -n \"$foo\"\u0000");
                done();
            });

            stream.write({ seq: 100, command: "property_get", args: { n: "$foo" }});
        });

        it("should write a valid message with data", function(done) {
            stream.on("error", done);

            stream.once("data", function(data) {
                expect(data).to.equal("property_set -i 100 -n \"$foo\" -l 10 -- eHh4eHh4eHh4eA==\u0000");
                done();
            });

            stream.write({ seq: 100, command: "property_set", args: { n: "$foo", l: 10 }, data: "xxxxxxxxxx" });
        });

        it("should accept message if seq is zero", function(done) {
            stream.on("error", done);
            stream.once("data", function(data) { done(); });
            stream.write({ seq: 0, command: "status" });
        });

        it("should skip argument if value is undefined", function(done) {
            stream.on("error", done);

            stream.once("data", function(data) {
                expect(data).to.equal("property_set -i 100 -l 10\u0000");
                done();
            });

            stream.write({ seq: 100, command: "property_set", args: { l: 10, o: undefined }});
        });

        it("should not skip argument if value is zero", function(done) {
            stream.on("error", done);

            stream.once("data", function(data) {
                expect(data).to.equal("property_set -i 100 -l 10 -o 0\u0000");
                done();
            });

            stream.write({ seq: 100, command: "property_set", args: { l: 10, o: 0 }});
        });

        it("should escape quotes in arguments", function(done) {
            stream.on("error", done);

            stream.once("data", function(data) {
                expect(data).to.equal("property_get -i 100 -n \"$x[\\\"a b\\\"]\"\u0000");
                done();
            });

            stream.write({ seq: 100, command: "property_get", args: { n: "$x[\"a b\"]" }});
        });

        it("should emit error if seq is missing", function(done) {
            stream.on("data", function() {
                done(new Error("should not emit data"));
            });

            stream.once("error", function(err) {
                expect(err).to.be.instanceOf(Error);
                expect(err.message).to.match(/seq/);
                done();
            });

            stream.write({ command: "property_set", args: { n: "$foo", l: 10 }, data: "xxxxxxxxxx" });
        });

        it("should emit error if command is missing", function(done) {
            stream.on("data", function() {
                done(new Error("should not emit data"));
            });

            stream.once("error", function(err) {
                expect(err).to.be.instanceOf(Error);
                expect(err.message).to.match(/command/);
                done();
            });

            stream.write({ seq: 100, args: { n: "$foo", l: 10 }, data: "xxxxxxxxxx" });
        });

        it("should emit error if an argument key is invalid", function(done) {
            stream.on("data", function() {
                done(new Error("should not emit data"));
            });

            stream.once("error", function(err) {
                expect(err).to.be.instanceOf(Error);
                expect(err.message).to.match(/argument key/i);
                done();
            });

            stream.write({ seq: 100, command: "foo", args: { "not valid!": 10 }});
        });
    });
});

// end test ////
// begin test ////

var Stream = require("stream").Stream;
var XmlStream = require("./lib/XmlStream");

describe("XmlStream", function() {
    var stream;

    beforeEach(function() {
        stream = new XmlStream();
    });

    describe("implements stream", function() {
        it("should be a Stream", function() {
            expect(stream).to.be.instanceOf(Stream);
        });
        it("should be a writable", function() {
            expect(stream.writable).to.be.true;
        });
    });

    describe("reading data", function() {
        it("should read valid xml", function(done) {
            stream.once("data", function(data) {
                expect(data).to.be.an.object;
                done();
            });

            stream.write(require("text!./mock/init.xml"));
        });

        it("should return an XmlReader", function(done) {
            stream.once("data", function(data) {
                expect(data).to.be.instanceOf(XmlReader);
                expect(data.text("//x:init/x:engine/text()")).to.equal("Xdebug");
                done();
            });

            stream.write(require("text!./mock/init.xml"));
        });

        it("should emit error for invalid xml", function(done) {
            stream.on("data", function() {
                done(new Error("should not emit data"));
            });

            stream.once("error", function(err) {
                expect(err).to.be.instanceOf(Error);
                expect(err.message).to.match(/Invalid XML message/);
                done();
            });

            stream.write("<foo>malformed xml");
        });
    });
});

// end test ////

if (typeof onload !== "undefined")
    onload();

});
