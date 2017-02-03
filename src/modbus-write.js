/**
 Copyright 2015 Mika Karaila, http://www.valmet.com/
 Copyright 2015-2016 Valmet Automation Inc.
 node-red-contrib-modbus - Apache 2.0

 Copyright (c) 2016, Jason D. Harper, Argonne National Laboratory
 Copyright 2016, UChicago Argonne, LLC
 node-red-contrib-modbustcp (ANL-SF-16-004) - The BSD 3-Clause License

 Copyright (c) 2016, Klaus Landsdorf (http://bianco-royal.de/)
 Copyright 2016-2017 Klaus Landsdorf (http://bianco-royal.de/)
 All rights reserved.
 node-red-contrib-modbus - The BSD 3-Clause License

 @author <a href="mailto:klaus.landsdorf@bianco-royal.de">Klaus Landsdorf</a> (Bianco Royal)
 **/
/**
 * Modbus Write node.
 * @module NodeRedModbusWrite
 *
 * @param RED
 */
module.exports = function (RED) {
  'use strict'
  let mbBasics = require('./modbus-basics')

  function ModbusWrite (config) {
    RED.nodes.createNode(this, config)

    this.name = config.name
    this.showStatusActivities = config.showStatusActivities

    this.unitid = config.unitid
    this.dataType = config.dataType
    this.adr = Number(config.adr)
    this.quantity = config.quantity

    let node = this
    let modbusClient = RED.nodes.getNode(config.server)

    setNodeStatusTo('waiting')

    node.onModbusInit = function () {
      setNodeStatusTo('initialize')
    }

    node.onModbusConnect = function () {
      setNodeStatusTo('connected')
    }

    node.onModbusActive = function () {
      setNodeStatusTo('active')
    }

    node.onModbusError = function (failureMsg) {
      setNodeStatusTo('failure')
      node.warn(failureMsg)
    }

    node.onModbusClose = function () {
      setNodeStatusTo('closed')
    }

    modbusClient.on('mbinit', node.onModbusInit)
    modbusClient.on('mbconnected', node.onModbusConnect)
    modbusClient.on('mbactive', node.onModbusActive)
    modbusClient.on('mberror', node.onModbusError)
    modbusClient.on('mbclosed', node.onModbusClose)

    node.on('input', function (msg) {
      if (!(msg && msg.hasOwnProperty('payload'))) return

      if (msg.payload == null) {
        setNodeStatusTo('payload error')
        node.error('invalid msg.payload', msg)
        return
      }

      if (!modbusClient.client) {
        return
      }

      if (node.showStatusActivities) {
        setNodeStatusTo(modbusClient.statlyMachine.getMachineState())
      }

      msg.payload = {
        value: msg.payload,
        unitid: node.unitid,
        fc: node.functionCodeModbus(node.dataType),
        address: node.adr,
        quantity: node.quantity
      }
      modbusClient.emit('writeModbus', msg, node.onModbusWriteDone, node.onModbusWriteError)
    })

    node.functionCodeModbus = function (dataType) {
      switch (dataType) {
        case 'Coil':
          return 5
        case 'HoldingRegister':
          return 6
        case 'MCoils':
          return 15
        case 'MHoldingRegisters':
          return 16
        default:
          return dataType
      }
    }

    node.onModbusWriteDone = function (resp, msg) {
      if (node.showStatusActivities) {
        setNodeStatusTo('write done')
      }
      node.send(buildMessage(msg.payload, resp))
    }

    node.onModbusWriteError = function (err, msg) {
      setModbusError(err, msg)
    }

    node.on('close', function () {
      setNodeStatusTo('closed')
    })

    function verboseLog (logMessage) {
      if (RED.settings.verbose) {
        node.log(logMessage)
      }
    }

    function buildMessage (values, response) {
      return [{payload: values}, {payload: response}]
    }

    function setNodeStatusTo (statusValue) {
      let statusOptions = mbBasics.set_node_status_properties(statusValue, false)
      if (mbBasics.statusLog) {
        verboseLog('status options: ' + JSON.stringify(statusOptions))
      }
      node.status({
        fill: statusOptions.fill,
        shape: statusOptions.shape,
        text: statusOptions.status
      })
    }

    function setModbusError (err, msg) {
      let working = false

      if (err) {
        node.error(err, msg)
        switch (err) {
          case 'Timed out':
            setNodeStatusTo('timeout')
            working = true
            break
          case 'Port Not Open':
            setNodeStatusTo('reconnect')
            modbusClient.emit('reconnect')
            working = true
            break
          default:
            setNodeStatusTo('error: ' + JSON.stringify(err))
        }
      }
      return working
    }
  }

  RED.nodes.registerType('modbus-write', ModbusWrite)
}
