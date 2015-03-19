define(function(require, exports, module) {
    main.consumes = ["Plugin", "c9", "util", "debugger"];
    main.provides = ["debugger.xdebug"];
    return main;

    function main(options, imports, register) {
        var Plugin = imports.Plugin;
        var c9 = imports.c9;
        var util = imports.util;
        var debug = imports["debugger"];

        var Frame = debug.Frame;
        var Source = debug.Source;
        var Breakpoint = debug.Breakpoint;
        var Variable = debug.Variable;
        var Scope = debug.Scope;

        var DbgpClient = require("./lib/DbgpClient");

        /***** Initialization *****/

        var TYPE = "xdebug";
        var PROXY = require("text!./netproxy.js");

        var plugin = new Plugin("Cloud9 IDE, Inc.", main.consumes);
        var emit = plugin.getEmitter();

        emit.setMaxListeners(1000);

        var SCOPE_TYPES = {
            "Locals": "Locals",
            "Superglobals": "Globals",
            "User defined constants": "Contants",
        };

        function absolutePath(path) {
            if (!path) return path;
            return path.replace(/^~\//, c9.home + "/");
        }
        
        /***** Methods *****/
        
        var socket, client, session;
        
        var attached = false
          , state = null
          , breakOnExceptions = false
          , breakOnUncaughtExceptions = false;

        function load() {
            debug.registerDebugger(TYPE, plugin);
        }
        
        function unload() {
            debug.unregisterDebugger(TYPE, plugin);
        }

        function getProxySource(process) {
            return PROXY
                .replace(/\/\/.*/g, "")
                .replace(/[\n\r]/g, "")
                .replace(/\{PORT\}/, process.runner[0].debugport);
        }

        function attach(socket_, reconnect, callback) {
            console.info('attach()');
            
            socket = socket_;
            
            client = new DbgpClient();

            client.on("session", function(session_) {
                console.info("=== session ===");

                session = session_;
                
                session.on("status", onStatus);
                session.on("break", onBreak);
                
                session.setFeature("max_depth", 0);
                session.setFeature("max_data", 1024);
                session.setFeature("max_children", 150);

                setBreakpoints(emit("getBreakpoints"), function(breakpoints) {
                    if (!attached) {
                        attached = true;
                        emit("attach", { breakpoints: breakpoints });
                    }
                    
                    callback();
                });
            });

            client.on("error", function(err) {
                emit("error", err);
            }, plugin);
            
            client.listen(socket);
        }

        function detach() {
            console.info('detach()');

            if (client) client.end();
            if (socket) socket.unload();

            emit("frameActivate", { frame: null });
            setState(null);

            socket = null;
            client = null;
            session = null;
            attached = false;

            emit("detach");
        }

        /***** Event Handlers *****/
        
        function onBreak() {
            getFrames(function(err, frames) {
                emit("frameActivate", { frame: frames[0] });
                emit("break", { frame: frames[0], frames: frames });
            });
        }        
        
        function onStatus(status) {
            switch (status) {
                case "starting":
                case "stopping":
                case "stopped":
                    setState(null);
                    break;
                    
                case "running":
                    setState("running");
                    break;
                    
                case "break":
                    setState("stopped");
                    break;
                    
                default:
                    throw new TypeError("Unknown debugger status: " + status);
            }
        }
        
        /***** Helper Functions *****/
                
        function formatType(property) {
            if (property.type === "uninitialized") {
                return null;
            }
            
            if (property.type === "object" && property.classname === "Closure") {
                return "callable";
            }
            
            return property.type;
        }
        
        function formatValue(property, value) {
            if (property.encoding === "base64") {
                value = base64Decode(value);
            }
            
            switch (property.type) {
                case "null":
                    return property.type;
                    
                case "array":
                    return "array(" + property.numchildren + ")";
    
                case "bool":
                    return (value === "1" ? "true" : "false");
                    
                case "int":
                    return parseInt(value, 10) + "";
                    
                case "float":
                    return parseFloat(value) + "";
                    
                case "string":
                    return JSON.stringify(value);
    
                case "object":
                    if (property.classname === "Closure") {
                        return "callable";
                    }
                    
                    return property.classname;
    
                default:
                    return value;
            }
        }
                
        function createVariable(data) {
            var value = data["#"];
            var children = data["property"];
            var property = data["@"];
            
            if (children && !Array.isArray(children))
                children = [children];

            return new Variable({
                name: property.name,
                value: formatValue(property, value),
                type: formatType(property),
                ref: property.fullname,
                address: property.address,
                children: (property.children === "1"),
                properties: children && children.map(function(child) {
                    return createVariable(child);
                })
            });
        }
        
        function findScope(variable) {
            if (variable.scope)
                return variable.scope;
            else if (variable.parent)
                return findScope(variable.parent);
            else
                throw new Error("Could not find scope in variable or parents");
        }
        
        function setState(state_) {
            if (state === state_)
                return;
                
            console.info(state_);
            state = state_;
            emit("stateChange", { state: state });
        }
        
        /***** Methods *****/

        function getFrames(callback, silent) {
            session.sendCommand("stack_get", null, null, function(err, args, data, raw) {
                if (err) return callback(err);
                
                if (!data)
                    data = [];
                else if (!Array.isArray(data))
                    data = [data];

                var frames = data.map(function(frame) {
                    frame = frame["@"];

                    var path, file;

                    if (frame.filename.indexOf("file://") === 0) {
                        path = frame.filename.substring(7);
                        // FIXME: properly resolve relative path
                        path = path.substring(c9.workspaceDir.length);
                        file = path.substring(path.lastIndexOf("/") + 1);
                    } else {
                        file = frame.filename;
                    }

                    var level = parseInt(frame.level, 10);
                    var line = parseInt(frame.lineno, 10) - 1;

                    return new Frame({
                        index: level,
                        name: frame.where,
                        line: line,
                        column: 0, // TODO: cmdbegin = line:col
                        id: null,
                        script: file,
                        path: path,
                        sourceId: frame.filename,
                        scopes: [
                            new Scope({ index: 0, type: "Locals", frameIndex: level }),
                            new Scope({ index: 1, type: "Superglobals", frameIndex: level }),
                            
                            /* FIXME: Xdebug 2.3.0+ only */
                            // new Scope({ index: 2, type: "Contants", frameIndex: level })
                        ],
                        variables: [],
                        istop: (level === 0)
                    });
                });

                emit("getFrames", { frames: frames });
                callback(null, frames);
            });
        }

        function getScope(frame, scope, callback) {
            var params = {
                d: frame.index,
                c: scope.index
            };
            
            session.sendCommand("feature_set", { n: "max_depth", v: 0 }, null, function() {
                session.sendCommand("context_get", params, null, function(err, args, data, raw) {
                    if (err) return callback(err);
                    
                    if (!data)
                        data = [];
                    else if (!Array.isArray(data))
                        data = [data];
    
                    var variables = data.map(function(property) {
                        var result = createVariable(property);
                        result.scope = scope;
                        return result;
                    });
    
                    scope.variables = variables;
    
                    callback(null, variables, scope, frame);
                });
            });
        }
        
        function getProperties(variable, callback) {
            var scope = findScope(variable);
            
            var params = {
                c: scope.index,
                n: variable.ref,    
            };
            
            session.sendCommand("feature_set", { n: "max_depth", v: 1 }, null, function() {
                session.sendCommand("property_get", params, null, function(err, args, data, raw) {
                    if (err) return callback(err);
                    
                    var props = data && data.property;
                    
                    if (!props)
                        props = [];
                    else if (!Array.isArray(props))
                        props = [props];
    
                    var properties = props.map(function(property) {
                        return createVariable(property);
                    });
            
                    variable.properties = properties;
                    
                    callback(null, properties, variable);
                });
            });
        }
               
        function setVariable(variable, parents, value, frame, callback) {
            var scope = findScope(variable);
            
            var params = {
                d: frame.index,
                c: scope.index,
                n: variable.ref,
                a: variable.address
            };
            
            session.sendCommand("property_set", params, value, function(err, args, data, raw) {
                if (err) return callback(err);
                
                if (args.success !== "1") {
                    return callback(new Error("Could not set value in debugger"));
                }
                
                session.sendCommand("property_value", params, null, function(err, args, data, raw) {
                    if (err) return callback(err);
                    
                    variable.type = formatType(args);
                    variable.value = formatValue(args, data);
                    variable.children = (args.children === "1");
                    variable.properties = undefined;
                    
                    callback(null, variable);
                });
            });
        }
        
        function setBreakpoints(breakpoints, callback) {
            function _setBPs(breakpoints, callback, i) {
                // run callback once we've exhausted setting breakpoints
                if (i == breakpoints.length) {
                    callback();
                    return;
                }

                var bp = breakpoints[i];
                
                setBreakpoint(bp, function() {
                    _setBPs(breakpoints, callback, i+1);
                });
            }

            _setBPs(breakpoints, callback, 0);
        }
        
        function setBreakpoint(bp, callback) {
            var args = {
                t: "conditional",
                s: bp.enabled ? "enabled" : "disabled",
                f: "file://" + absolutePath(bp.path),
                n: (bp.line + 1),
                h: bp.ignoreCount
            };

            var condition = bp.condition || "true";
            
            session.sendCommand("breakpoint_set", args, condition, function(err, args, data, raw) {
                bp.id = args.id;
                callback && callback(err, bp);
            });
        }
        
        function changeBreakpoint(bp, callback) {
            var args = {
                d: bp.id,
                s: bp.enabled ? "enabled" : "disabled",
                h: bp.ignoreCount
            };
            
            var condition = bp.condition || "true";
            
            session.sendCommand("breakpoint_update", args, condition, function(err, args, data, raw) {
                callback && callback(err, bp);
            });
        }
        
        function clearBreakpoint(bp, callback) {
            session.sendCommand("breakpoint_remove", { d: bp.id }, null, function(err, args, data, raw) {
                callback && callback(err, bp);
            });
        }
        
        function listBreakpoints(callback) {
            // normally we'd send breakpoint_list, but since breakpoint state
            // is entirely dependent on UI, we'll manage it globally
            callback && callback(null, emit("getBreakpoints"));
        }

        function stepInto(callback) {
            session.stepInto(function(err) { callback(err); });
        }

        function stepOver(callback) {
            session.stepOver(function(err) { callback(err); });
        }

        function stepOut(callback) {
            session.stepOut(function(err) { callback(err); });
        }

        function resume(callback) {
            session.run(function(err) { callback(err); });
        }

        /*
         * FIXME: This is not supported by PHP Xdebug
        function suspend(callback) {
            session.sendCommand("break", null, null, function(args, data, raw) {
                emit("suspend");
                callback && callback();
            });
        }
         */
         
        function evaluate(expression, frame, global, disableBreak, callback) {
            if (state !== "stopped")
                return callback(null, new Variable({ name: expression.trim() }));
             
            session.eval(expression, function(err, args, data) {
                if (err) return callback(err);
                    
                var variable = createVariable(data);
                variable.name = expression.trim();
                
                callback(null, variable);
            });
        }

        function setBreakBehavior(type, enabled, callback) {
            // TODO: review xdebug.show_exception_trace
            
            breakOnExceptions = enabled ? type == "all" : false;
            breakOnUncaughtExceptions = enabled ? type == "uncaught" : false;
            
            /*
            session.sendCommand("breakpoint_set", { t: "exception", x: "Exception" }, null, function(args, data, raw) {
                session.sendCommand("eval", {}, "$__c9_exception_handler = function($exception) { var_dump($exception); throw new Exception(); };", function(err, args, data, raw) {
                    session.sendCommand("eval", {}, "set_exception_handler($__c9_exception_handler);", function(err, args, data, raw) {
                        callback && callback(err);
                    });
                });
            });
            */
            
            // FIXME: execute this only if engine language is PHP:
            // var script = "require_once('/home/ubuntu/workspace/_test/__c9_error_handler.php');";
            
            // session.sendCommand("eval", {}, script, function(err, args, data, raw) {
                // callback && callback(err);
            // });
                
            // session.sendCommand("breakpoint_set", { t: "exception", x: "*", s: "enabled" }, null, function(err, args, data, raw) {
            // session.sendCommand("breakpoint_set", { t: "exception", x: "\"*\"", s: "enabled" }, null, function(args, data, raw) {
                // session.sendCommand("breakpoint_set", { t: "exception", x: "Fatal error", s: "enabled" }, null, function(args, data, raw) {
                    // session.sendCommand("breakpoint_set", { t: "exception", x: "\\RuntimeException", s: "enabled" }, null, function(args, data, raw) {
                        // session.sendCommand("breakpoint_set", { t: "exception", x: "MyException", s: "enabled" }, null, function(args, data, raw) {
                            // TODO: store args.id and use it to toggle exception bp on/off
                            // callback && callback();
                        // });
                    // });
                // });
            // });
            // });
        }
 
        /***** Register and define API *****/

        plugin.on("load", load);
        plugin.on("unload", unload);

        /**
         * Debugger implementation for Cloud9. When you are implementing a
         * custom debugger, implement this API. If you are looking for the
         * debugger interface of Cloud9, check out the {@link debugger}.
         *
         * This interface is defined to be as stateless as possible. By
         * implementing these methods and events you'll be able to hook your
         * debugger seamlessly into the Cloud9 debugger UI.
         *
         * See also {@link debugger#registerDebugger}.
         *
         * @class debugger.implementation
         */
        plugin.freezePublicAPI({
            /**
             * Contains the source code of the proxy to run
             */
            proxySource: require("text!./netproxy.js"),

            /**
             * Specifies the features that this debugger implementation supports
             * @property {Object} features
             * @property {Boolean} features.scripts                 Able to download code (disable the scripts button)
             * @property {Boolean} features.conditionalBreakpoints  Able to have conditional breakpoints (disable menu item)
             * @property {Boolean} features.liveUpdate              Able to update code live (don't do anything when saving)
             * @property {Boolean} features.updateWatchedVariables  Able to edit variables in watches (don't show editor)
             * @property {Boolean} features.updateScopeVariables    Able to edit variables in variables panel (don't show editor)
             * @property {Boolean} features.setBreakBehavior        Able to configure break behavior (disable break behavior button)
             * @property {Boolean} features.executeCode             Able to execute code (disable REPL)
             */
            features: {
                // scripts: true,
                conditionalBreakpoints: true,
                // liveUpdate: true,
                updateWatchedVariables: true,
                updateScopeVariables: true,
                setBreakBehavior: true,
                executeCode: true

                // TODO: flag to disable "suspend" command
            },
            
            /**
             * The type of the debugger implementation. This is the identifier
             * with which the runner selects the debugger implementation.
             * @property {String} type
             * @readonly
             */
            type: TYPE,
            
            /**
             * @property {null|"running"|"stopped"} state  The state of the debugger process
             * <table>
             * <tr><td>Value</td><td>      Description</td></tr>
             * <tr><td>null</td><td>       process doesn't exist</td></tr>
             * <tr><td>"stopped"</td><td>  paused on breakpoint</td></tr>
             * <tr><td>"running"</td><td>  process is running</td></tr>
             * </table>
             * @readonly
             */
            get state(){ return state; },
            
            /**
             *
             */
            get attached(){ return attached; },
            
            /**
             * Whether the debugger will break when it encounters any exception.
             * This includes exceptions in try/catch blocks.
             * @property {Boolean} breakOnExceptions
             * @readonly
             */
            get breakOnExceptions(){ return breakOnExceptions; },
            
            /**
             * Whether the debugger will break when it encounters an uncaught
             * exception.
             * @property {Boolean} breakOnUncaughtExceptions
             * @readonly
             */
            get breakOnUncaughtExceptions(){ return breakOnUncaughtExceptions; },

            _events: [
                /**
                 * Fires when the debugger hits a breakpoint.
                 * @event break
                 * @param {Object}           e
                 * @param {debugger.Frame}   e.frame        The frame where the debugger has breaked at.
                 * @param {debugger.Frame[]} [e.frames]     The callstack frames.
                 */
                "break",
                /**
                 * Fires when the {@link #state} property changes
                 * @event stateChange
                 * @param {Object}          e
                 * @param {debugger.Frame}  e.state  The new value of the state property.
                 */
                "stateChange",
                /**
                 * Fires when the debugger hits an exception.
                 * @event exception
                 * @param {Object}          e
                 * @param {debugger.Frame}  e.frame      The frame where the debugger has breaked at.
                 * @param {Error}           e.exception  The exception that the debugger breaked at.
                 */
                "exception",
                /**
                 * Fires when a frame becomes active. This happens when the debugger
                 * hits a breakpoint, or when it starts running again.
                 * @event frameActivate
                 * @param {Object}          e
                 * @param {debugger.Frame/null}  e.frame  The current frame or null if there is no active frame.
                 */
                "frameActivate",
                /**
                 * Fires when the result of the {@link #method-getFrames} call comes in.
                 * @event getFrames
                 * @param {Object}            e
                 * @param {debugger.Frame[]}  e.frames  The frames that were retrieved.
                 */
                "getFrames",
                /**
                 * Fires when the result of the {@link #getSources} call comes in.
                 * @event sources
                 * @param {Object}            e
                 * @param {debugger.Source[]} e.sources  The sources that were retrieved.
                 */
                "sources",
                /**
                 * Fires when a source file is (re-)compiled. In your event
                 * handler, make sure you check against the sources you already
                 * have collected to see if you need to update or add your source.
                 * @event sourcesCompile
                 * @param {Object}          e
                 * @param {debugger.Source} e.file  the source file that is compiled.
                 **/
                "sourcesCompile"
            ],

            /**
             * Attaches the debugger to the started process.
             * @param {Object}                runner        A runner as specified by {@link run#run}.
             * @param {debugger.Breakpoint[]} breakpoints   The set of breakpoints that should be set from the start
             */
            attach: attach,

            /**
             * Detaches the debugger from the started process.
             */
            detach: detach,

            /**
             * Loads all the active sources from the process
             *
             * @param {Function}          callback          Called when the sources are retrieved.
             * @param {Error}             callback.err      The error object if an error occured.
             * @param {debugger.Source[]} callback.sources  A list of the active sources.
             * @fires sources
             */
            // getSources: getSources,

            /**
             * Retrieves the contents of a source file
             * @param {debugger.Source} source             The source to retrieve the contents for
             * @param {Function}        callback           Called when the contents is retrieved
             * @param {Error}           callback.err       The error object if an error occured.
             * @param {String}          callback.contents  The contents of the source file
             */
            // getSource: getSource,

            /**
             * Retrieves the current stack of frames (aka "the call stack")
             * from the debugger.
             * @param {Function}          callback          Called when the frame are retrieved.
             * @param {Error}             callback.err      The error object if an error occured.
             * @param {debugger.Frame[]}  callback.frames   A list of frames, where index 0 is the frame where the debugger has breaked in.
             * @fires getFrames
             */
            getFrames: getFrames,

            /**
             * Retrieves the variables from a scope.
             * @param {debugger.Frame}      frame               The frame to which the scope is related.
             * @param {debugger.Scope}      scope               The scope from which to load the variables.
             * @param {Function}            callback            Called when the variables are loaded
             * @param {Error}               callback.err        The error object if an error occured.
             * @param {debugger.Variable[]} callback.variables  A list of variables defined in the `scope`.
             * @param {debugger.Scope}      callback.scope      The scope to which these variables belong
             * @param {debugger.Frame}      callback.frame      The frame related to the scope.
             */
            getScope: getScope,

            /**
             * Retrieves and sets the properties of a variable.
             * @param {debugger.Variable}   variable             The variable for which to retrieve the properties.
             * @param {Function}            callback             Called when the properties are loaded
             * @param {Error}               callback.err         The error object if an error occured.
             * @param {debugger.Variable[]} callback.properties  A list of properties of the variable.
             * @param {debugger.Variable}   callback.variable    The variable to which the properties belong.
             */
            getProperties: getProperties,

            /**
             * Step into the next statement.
             */
            stepInto: stepInto,

            /**
             * Step over the next statement.
             */
            stepOver: stepOver,

            /**
             * Step out of the current statement.
             */
            stepOut: stepOut,

            /**
             * Continues execution of a process after it has hit a breakpoint.
             */
            resume: resume,

            /**
             * Pauses the execution of a process at the next statement.
             */
            // suspend: suspend,

            /**
             * Evaluates an expression in a frame or in global space.
             * @param {String}            expression         The expression.
             * @param {debugger.Frame}    frame              The stack frame which serves as the contenxt of the expression.
             * @param {Boolean}           global             Specifies whether to execute the expression in global space.
             * @param {Boolean}           disableBreak       Specifies whether to disabled breaking when executing this expression.
             * @param {Function}          callback           Called after the expression has executed.
             * @param {Error}             callback.err       The error if any error occured.
             * @param {debugger.Variable} callback.variable  The result of the expression.
             */
            evaluate: evaluate,

            /**
             * Change a live running source to the latest code state
             * @param {debugger.Source} source        The source file to update.
             * @param {String}          value         The new contents of the source file.
             * @param {Boolean}         previewOnly
             * @param {Function}        callback      Called after the expression has executed.
             * @param {Error}           callback.err  The error if any error occured.
             */
            // setScriptSource: setScriptSource,

            /**
             * Adds a breakpoint to a line in a source file.
             * @param {debugger.Breakpoint} breakpoint           The breakpoint to add.
             * @param {Function}            callback             Called after the expression has executed.
             * @param {Error}               callback.err         The error if any error occured.
             * @param {debugger.Breakpoint} callback.breakpoint  The added breakpoint
             * @param {Object}              callback.data        Additional debugger specific information.
             */
            setBreakpoint: setBreakpoint,

            /**
             * Updates properties of a breakpoint
             * @param {debugger.Breakpoint} breakpoint  The breakpoint to update.
             * @param {Function}            callback             Called after the expression has executed.
             * @param {Error}               callback.err         The error if any error occured.
             * @param {debugger.Breakpoint} callback.breakpoint  The updated breakpoint
             */
            changeBreakpoint: changeBreakpoint,

            /**
             * Removes a breakpoint from a line in a source file.
             * @param {debugger.Breakpoint} breakpoint  The breakpoint to remove.
             * @param {Function}            callback             Called after the expression has executed.
             * @param {Error}               callback.err         The error if any error occured.
             * @param {debugger.Breakpoint} callback.breakpoint  The removed breakpoint
             */
            clearBreakpoint: clearBreakpoint,

            /**
             * Retrieves a list of all the breakpoints that are set in the
             * debugger.
             * @param {Function}              callback              Called when the breakpoints are retrieved.
             * @param {Error}                 callback.err          The error if any error occured.
             * @param {debugger.Breakpoint[]} callback.breakpoints  A list of breakpoints
             */
            listBreakpoints: listBreakpoints,

            /**
             * Sets the value of a variable.
             * @param {debugger.Variable}   variable       The variable to set the value of.
             * @param {debugger.Variable[]} parents        The parent variables (i.e. the objects of which the variable is the property).
             * @param {Mixed}               value          The new value of the variable.
             * @param {debugger.Frame}      frame          The frame to which the variable belongs.
             * @param {Function}            callback
             * @param {Function}            callback       Called when the breakpoints are retrieved.
             * @param {Error}               callback.err   The error if any error occured.
             * @param {Object}              callback.data  Additional debugger specific information.
             */
            setVariable: setVariable,

            /**
             *
             */
            // restartFrame: restartFrame,

            /**
             *
             */
            // serializeVariable: serializeVariable,

            /**
             * Defines how the debugger deals with exceptions.
             * @param {"all"/"uncaught"} type          Specifies which errors to break on.
             * @param {Boolean}          enabled       Specifies whether to enable breaking on exceptions.
             * @param {Function}         callback      Called after the setting is changed.
             * @param {Error}            callback.err  The error if any error occured.
             */
            setBreakBehavior: setBreakBehavior,

            /**
             * Returns the source of the proxy
             */
            getProxySource: getProxySource
        });

        register(null, {
            "debugger.xdebug" : plugin
        });
    }
});