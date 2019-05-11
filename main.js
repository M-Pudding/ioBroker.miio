"use strict";

/*
 * Created with @iobroker/create-adapter v1.9.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const Controller = require("./lib/miio");

// Load your modules here, e.g.:
// const fs = require("fs");

/**
 * @class
 */
class Miio extends utils.Adapter {

    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "miio",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));

        /**
         * Save latest miio adapter objects.
         * @type {AdapterMiio.Objects}
         */
        this.miioObjects = {};
        /**
         * Save objects that updated before created.
         * @type {AdapterMiio.States}
         */
        this.delayed = {};
        /**
         * Save objects that needed to register.
         * @type {ioBroker.Object[]}
         */
        this.tasks = [];
        /**
         * miio Controller
         * @type {AdapterMiio.Controller | null | undefined}
         */
        this.miioController = null;
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here

        this.miioAdapterInit();
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        this.miioAdapterStop();
        callback && callback();
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} val
     */
    onStateChange(id, val) {
        if (!id || !val || val.ack) {
            return;
        }
        if (!this.miioObjects[id]) {
            this.log.warn(`Unknown ID: ${id}`);
            return;
        }
        if (this.miioController) {
            const channelEnd = id.lastIndexOf(".");
            const channelId = id.substring(0, channelEnd);
            const state = id.substring(channelEnd + 1);

            if (this.miioObjects[channelId] && this.miioObjects[channelId].native) {
                val = val.val;
                this.log.silly(`onStateChange. state=${state} val=${JSON.stringify(val)}`);
                this.miioController.setState(this.miioObjects[channelId].native.id, state, val);
            }
        } else {
            this.log.warn(`no miio controller`);
        }
    }

    /**
     * Is called to set adapter connection status
     * @param {boolean} conn
     */
    setConnected(conn) {
        this.setState("info.connection", conn, true);
    }

    /**
     */
    getObjectIDPrefix() {
        return this.namespace + ".devices";
    }

    /**
     */
    getSelfObjectIDPrefix() {
        return "devices";
    }

    /**
     * @param {string} id
     */
    generateChannelID(id) {
        return this.getObjectIDPrefix() + "." + id;
    }

    /**
     * 
     * @param {string} id 
     */
    generateSelfChannelID(id) {
        return this.getSelfObjectIDPrefix() + "." + id;
    }

    /**
     * Is called to find exist miio objects
     * @param {() => void} callback
     */
    readObjects(callback) {
        this.getForeignObjects(this.getObjectIDPrefix() + ".*", (err, list) => {
            // Read miio objects in database. This maybe set in prevrous running status.
            // No need set namespace
            this.subscribeStates("devices.*");
            this.miioObjects = list;
            callback && callback();
        });
    }

    /**
     * @param {string} id
     * @param {string} state
     * @param {any} val
     */
    miioAdapterUpdateState(id, state, val) {
        if (this.miioObjects[this.namespace + "." + id] ||
            this.miioObjects[this.namespace + "." + id + "." + state]) {
            //TODO: what if only id exist?
            this.setState(id + "." + state, val, true);
        } else {
            this.delayed[id + "." + state] = val;
        }
    }

    /**
     * @param {Miio} instant
     */
    miioAdapterSyncObjects(instant) {
        // This obj is obj with new value
        const obj = instant.tasks.shift();
        if (obj === undefined) {
            return;
        }

        instant.getObject(obj._id,
            (err, oObj) => {
                if (!oObj) {
                    //No obj._id data stored in database. Just set this obj
                    instant.miioObjects[instant.namespace + "." + obj._id] = obj;
                    instant.setObject(obj._id, obj, () => {
                        if (instant.delayed[obj._id] !== undefined) {
                            instant.setState(obj._id, instant.delayed[obj._id], true, () => {
                                delete instant.delayed[obj._id];
                                setImmediate(instant.miioAdapterSyncObjects, instant);
                            });
                        } else {
                            setImmediate(instant.miioAdapterSyncObjects, instant);
                        }
                    });
                } else {
                    //Database contains obj._id object. Check whether update is needed.
                    let changed = false;
                    for (const a in obj.common) {
                        if (obj.common.hasOwnProperty(a) &&
                            a !== "name" &&
                            a !== "icon" &&
                            oObj.common[a] !== obj.common[a]) {
                            // object value need update.
                            changed = true;
                            oObj.common[a] = obj.common[a];
                        }
                    }
                    if (JSON.stringify(obj.native) !== JSON.stringify(oObj.native)) {
                        changed = true;
                        oObj.native = obj.native;
                    }
                    // The newest data is saved in oObj.
                    instant.miioObjects[instant.namespace + "." + obj._id] = oObj;
                    if (changed) {
                        instant.extendObject(oObj._id, oObj, () => {
                            if (instant.delayed[oObj._id] !== undefined) {
                                instant.setState(oObj._id, instant.delayed[oObj._id], true, () => {
                                    delete instant.delayed[oObj._id];
                                    setImmediate(instant.miioAdapterSyncObjects, instant);
                                });
                            } else {
                                setImmediate(instant.miioAdapterSyncObjects, instant);
                            }
                        });
                    } else {
                        if (instant.delayed[oObj._id] !== undefined) {
                            instant.setState(oObj._id, instant.delayed[oObj._id], true, () => {
                                delete instant.delayed[oObj._id];
                                setImmediate(instant.miioAdapterSyncObjects, instant);
                            });
                        } else {
                            setImmediate(instant.miioAdapterSyncObjects, instant);
                        }
                    }
                }
            });
    }

    /**
     * 
     * @param {AdapterMiio.ControllerDevice} dev
     */
    miioAdapterCreateDevice(dev) {
        const id = this.generateSelfChannelID(dev.miioInfo.id);
        const isInitTasks = !this.tasks.length;
        const states =  dev.device.states;

        for (const state in states) {
            if (!states.hasOwnProperty(state)) continue;
            this.log.info(`Create state object ${id}.${state}`);
            this.tasks.push({
                _id: `${id}.${state}`,
                common: states[state],
                type: "state",
                native: {}
            });
        }

        this.tasks.push({
            _id: id,
            common: {
                name: dev.configData.name || dev.miioInfo.model,
                icon: `/icons/${dev.miioInfo.model}.png`
            },
            type: "channel",
            native: {
                id: dev.miioInfo.id,
                model: dev.miioInfo.model
            }
        });

        isInitTasks && this.miioAdapterSyncObjects(this);
    }

    /**
     * 
     * @param {AdapterMiio.ControllerDevice} dev
     */
    miioAdapterDeleteDevice(dev) {
        const id = this.generateSelfChannelID(dev.miioInfo.id);
        const states =  dev.device.states;

        for (const state in states) {
            if (!states.hasOwnProperty(state)) continue;
            this.log.info(`Delete state object ${id}.${state}`);
            this.delObject(`${id}.${state}`);
        }
        this.delObject(`${id}`);
    }

    /**
     */
    miioAdapterStop() {
        if (this.miioController) {
            try {
                this.miioController.stop();
                this.miioController = null;
            } catch (e) {
                this.log.error(`adapter stop failed.` + e);
            }
        }
    }

    /**
     */
    miioAdapterInit() {
        this.readObjects(() => {
            this.setConnected(false);
            if (!this.config ||
                !this.config.devices ||
                ("[]" === JSON.stringify(this.config.devices))) {
                if (!this.config.autoDiscover) {
                    this.log.error("No device defined and discover is also disabled.");
                }
            }
            this.miioController = new Controller({
                devicesDefined: this.config.devices,
                autoDiscover: this.config.autoDiscover,
                autoDiscoverTimeout: parseInt(this.config.autoDiscoverTimeout || "30") //
            });

            this.miioController.on("debug", /** @param {string} msg */ msg => this.log.debug(msg));
            this.miioController.on("info", /** @param {string} msg */ msg => this.log.info(msg));
            this.miioController.on("warning", /** @param {string} msg */ msg => this.log.warn(msg));
            this.miioController.on("error", /** @param {string} msg */ msg => {
                this.log.error(msg);
                this.miioAdapterStop();
            });
            // New device need add to adapter.
            this.miioController.on("device", (/** @param {AdapterMiio.ControllerDevice} dev */ dev, /** @param {string} opt */ opt) => {
                if (opt === "add") {
                    if (!this.miioObjects[this.generateChannelID(dev.miioInfo.id)]) {
                        this.log.info(`New device: ${dev.miioInfo.model}. ID ${dev.miioInfo.id}`);
                        this.miioAdapterCreateDevice(dev);
                    } else {
                        this.log.info(`Known device: ${dev.miioInfo.model} ${dev.miioInfo.id}`);
                    }
                } else if (opt === "delete") {
                    if (this.miioObjects[this.generateChannelID(dev.miioInfo.id)]) {
                        this.miioAdapterDeleteDevice(dev);
                        this.log.info(`Delete device: ${dev.miioInfo.model}. ID ${dev.miioInfo.id}`);
                    } else {
                        this.log.info(`Want to delete a non-registered device: ${dev.miioInfo.model}. ID ${dev.miioInfo.id}`);
                    }
                } else {
                    this.log.warn(`Unsupported device event operation "${opt}".`);
                }
            });
            this.miioController.on("data",
                /**
                 * @param {string} id
                 * @param {string} state
                 * @param {any} val
                 */
                (id, state, val) => {
                    this.miioAdapterUpdateState(this.generateSelfChannelID(id), state, val);
                }
            );
            this.miioController.listen();
            this.setConnected(true);
        });
    }
}

// @ts-ignore parent is not declared in core, can be ignored
if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<ioBroker.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Miio(options);
} else {
    // otherwise start the instance directly
    new Miio();
}