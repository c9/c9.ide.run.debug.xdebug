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

require([
    "lib/architect/architect",
    "lib/chai/chai",
    "/vfs-root"
], function (architect, chai, baseProc) {
    var expect = chai.expect;
    
    expect.setupArchitectTest([
        {
            packagePath: "plugins/c9.core/c9",
            workspaceId: "ubuntu/ip-10-35-77-180",
            startdate: new Date(),
            debug: true,
            hosted: true,
            local: false,
            hostname: "dev.javruben.c9.io",
            workspaceDir: baseProc,
            davPrefix: "/"
        },
        
        "plugins/c9.core/ext",
        "plugins/c9.core/util",
        "plugins/c9.core/http-xhr",
        "plugins/c9.fs/proc",
        "plugins/c9.fs/net",
        "plugins/c9.fs/fs",
        "plugins/c9.vfs.client/vfs_client",
        "plugins/c9.vfs.client/endpoint",
        "plugins/c9.ide.auth/auth",
        "plugins/c9.ide.run.debug/debuggers/socket",
        
        {
            consumes: [],
            provides: ["c9"],
            setup: expect.html.mocked
        },
        {
            consumes: ["debugger.socket", "proc", "fs"],
            provides: [],
            setup: main
        }
    ], architect);
    
    function main(options, imports, register) {
        var Socket = imports["debugger.socket"];
        var proc = imports["proc"];
        var fs = imports["fs"];

// begin test ////

var DbgpClient = require("./lib/DbgpClient");

describe("Full Client Test", function() {
    this.timeout(30000);
    
    var client, socket;
    
    beforeEach(function(done) {
        clearLog(done);
        client = new DbgpClient();
        socket = new Socket(15155, require("text!./netproxy.js").replace("{PORT}", "15155"), true);
    });
    
    function clearLog(done) {
        // fs.rmfile("/xdebug.log", function() {
        // });
        
        proc.execFile("rm", { 
            args: ["-f", "xdebug.log"],
            cwd: "/home/ubuntu/workspace"
        }, function(err, stdout, stderr) {
            done(err);
        });
    }
    
    function dumpLog(done) {
        // fs.readFile("/xdebug.log", function(err, content){
        //     console.info(content);
        // }); 
            
        proc.execFile("cat", { 
            args: ["xdebug.log"],
            cwd: "/home/ubuntu/workspace"
        }, function(err, stdout, stderr) {
            console.info(stderr, stdout);
            done(err);
        });
    }
    
    function runPhpScript(done) {
        // console.log("Starting PHP process");
        
        proc.spawn("/usr/bin/php", { 
            args: ["plugins/c9.ide.run.debug.xdebug/mock/simple.php"],
            env: {
                "XDEBUG_CONFIG": "remote_log=xdebug.log idekey=session_name remote_host=localhost remote_port=15155 remote_mode=req remote_enable=true"
            }
        }, function(err, process) {
            // console.log("Process started");
            
            if (err) {
                console.error(err);
                return done(err);
            }
        
            process.stderr.on("data", function(data) {
                console.log(data);    
            });
            
            process.stdout.on("data", function(data) {
                console.log(data);    
            });
            
            process.on("exit", function(code) {
                console.log("Process Stopped"); 
                done();
            });
        });
    }
    
    it("should connect via socket", function(done) {
        client.on("listening", function() {
            console.log("== listening ==")
            runPhpScript(done);
        });
        
        client.on("session", function(session) {
            console.log(session);
            
            session.on("status", function(status) {
                console.info(status);
            });
            
            session.eval("print('HELLO WORLD');", function(err, args, data) {
                if (err) return done(err);
                
                session.run(function(err, args, data) {
                    if (err) return done(err);
                });
            });
        });
        
        client.listen(socket);
    });
    
    afterEach(function(done) {
        socket.close();
        dumpLog(done);
    });
});

// end test ////

if (typeof onload !== "undefined")
    onload();

    }
});
});