/**
 Copyright (c) 2016,2017,2018,2019,2020 Klaus Landsdorf (https://bianco-royal.com/)
 Copyright 2016 - Jason D. Harper, Argonne National Laboratory
 Copyright 2015,2016 - Mika Karaila, Valmet Automation Inc.
 All rights reserved.
 node-red-contrib-modbus

 @author <a href="mailto:klaus.landsdorf@bianco-royal.de">Klaus Landsdorf</a> (Bianco Royal)
 */
/**
 * Modbus connection node.
 * @module NodeRedModbusClient
 *
 * @param RED
 */
module.exports = function (RED) {
  'use strict'
  // SOURCE-MAP-REQUIRED
  const mbBasics = require('./modbus-basics')
  const coreModbusClient = require('./core/modbus-client-core')
  const coreModbusQueue = require('./core/modbus-queue-core')

  function ModbusClientNode (config) {
    RED.nodes.createNode(this, config)

    // create an empty modbus client
    const ModbusRTU = require('modbus-serial')

    const unlimitedListeners = 0
    const minCommandDelayMilliseconds = 1
    const defaultUnitId = 1
    const serialConnectionDelayTimeMS = 500
    const timeoutTimeMS = 1000
    const reconnectTimeMS = 2000
    const logHintText = ' Get More About It By Logging'

    this.clienttype = config.clienttype

    if (config.parallelUnitIdsAllowed === undefined) {
      this.bufferCommands = true
    } else {
      this.bufferCommands = config.bufferCommands
    }

    this.queueLogEnabled = config.queueLogEnabled
    this.stateLogEnabled = config.stateLogEnabled

    this.tcpHost = config.tcpHost
    this.tcpPort = parseInt(config.tcpPort) || 502
    this.tcpType = config.tcpType

    this.serialPort = config.serialPort
    this.serialBaudrate = config.serialBaudrate
    this.serialDatabits = config.serialDatabits
    this.serialStopbits = config.serialStopbits
    this.serialParity = config.serialParity
    this.serialType = config.serialType
    this.serialConnectionDelay = parseInt(config.serialConnectionDelay) || serialConnectionDelayTimeMS

    this.unit_id = parseInt(config.unit_id) || defaultUnitId
    this.commandDelay = parseInt(config.commandDelay) || minCommandDelayMilliseconds
    this.clientTimeout = parseInt(config.clientTimeout) || timeoutTimeMS
    this.reconnectTimeout = parseInt(config.reconnectTimeout) || reconnectTimeMS
    this.reconnectOnTimeout = config.reconnectOnTimeout

    if (config.parallelUnitIdsAllowed === undefined) {
      this.parallelUnitIdsAllowed = true
    } else {
      this.parallelUnitIdsAllowed = config.parallelUnitIdsAllowed
    }

    const node = this
    node.isFirstInitOfConnection = true
    node.closingModbus = false
    node.client = null
    node.bufferCommandList = new Map()
    node.sendingAllowed = new Map()
    node.unitSendingAllowed = []
    node.messageAllowedStates = coreModbusClient.messagesAllowedStates
    node.serverInfo = ''

    node.stateMachine = null
    node.stateService = null
    node.stateMachine = coreModbusClient.createStateMachineService()
    node.actualServiceState = node.stateMachine.initialState
    node.actualServiceStateBefore = node.actualServiceState
    node.stateService = coreModbusClient.startStateService(node.stateMachine)
    node.reconnectTimeoutId = 0
    node.serialSendingAllowed = false

    node.setUnitIdFromPayload = function (msg) {
      const unitId = coreModbusClient.getActualUnitId(node, msg)
      if (!coreModbusClient.checkUnitId(unitId, node.clienttype)) {
        node.unit_id = defaultUnitId
      }
      node.client.setID(unitId)
      msg.unitId = unitId
    }

    if (Number.isNaN(node.unit_id) || !coreModbusClient.checkUnitId(node.unit_id, node.clienttype)) {
      node.unit_id = defaultUnitId
    }

    node.updateServerinfo = function () {
      if (node.clienttype === 'tcp') {
        node.serverInfo = ' TCP@' + node.tcpHost + ':' + node.tcpPort
      } else {
        node.serverInfo = ' Serial@' + node.serialPort + ':' + node.serialBaudrate + 'bit/s'
      }
      node.serverInfo += ' default Unit-Id: ' + node.unit_id
    }

    function verboseWarn (logMessage) {
      if (RED.settings.verbose) {
        node.warn('Client -> ' + logMessage + node.serverInfo)
      }
    }

    function verboseLog (logMessage) {
      if (RED.settings.verbose) {
        coreModbusClient.internalDebug('Client -> ' + logMessage + node.serverInfo)
      }
    }

    function stateLog (logMessage) {
      if (node.stateLogEnabled) {
        verboseLog(logMessage)
      }
    }

    node.queueLog = function (logMessage) {
      if (node.bufferCommands && node.queueLogEnabled) {
        verboseLog(logMessage)
      }
    }

    node.stateService.subscribe(state => {
      node.actualServiceStateBefore = node.actualServiceState
      node.actualServiceState = state
      stateLog(state.value)

      if (state.matches('init')) {
        node.updateServerinfo()
        coreModbusQueue.initQueue(node)
        node.reconnectTimeoutId = 0

        try {
          if (node.isFirstInitOfConnection) {
            node.isFirstInitOfConnection = false
            verboseWarn('init in ' + serialConnectionDelayTimeMS + ' ms')
            setTimeout(node.connectClient, serialConnectionDelayTimeMS)
          } else {
            verboseWarn('init in ' + node.reconnectTimeout + ' ms')
            setTimeout(node.connectClient, node.reconnectTimeout)
          }
        } catch (err) {
          node.error(err, { payload: 'client connection error ' + logHintText })
        }

        node.emit('mbinit')
      }

      if (state.matches('connected')) {
        node.emit('mbconnected')
      }

      if (state.matches('activated')) {
        node.emit('mbactive')
        if (node.bufferCommands && !coreModbusQueue.checkQueuesAreEmpty(node)) {
          node.stateService.send('QUEUE')
        }
      }

      if (state.matches('queueing')) {
        setTimeout(() => {
          coreModbusQueue.dequeueCommand(node)
        }, node.commandDelay)
        node.emit('mbqueue')
      }

      if (state.matches('opened')) {
        node.serialSendingAllowed = true
        node.emit('mbopen')
      }

      if (state.matches('closed')) {
        node.emit('mbclosed')
        node.stateService.send('RECONNECT')
      }

      if (state.matches('stopped')) {
        verboseWarn('stopped state without reconnecting')
        node.emit('mbclosed')
      }

      if (state.matches('failed')) {
        node.emit('mberror', 'Modbus Failure On State ' + node.actualServiceStateBefore.value + logHintText)
        node.stateService.send('BREAK')
      }

      if (state.matches('broken')) {
        node.emit('mbbroken', 'Modbus Broken On State ' + node.actualServiceStateBefore.value + logHintText)
        if (node.reconnectOnTimeout) {
          if (node.reconnectTimeout <= 0) {
            node.reconnectTimeout = reconnectTimeMS
          }
          node.stateService.send('RECONNECT')
        } else {
          node.stateService.send('ACTIVATE')
        }
      }

      if (state.matches('reconnecting')) {
        node.serialSendingAllowed = false
        node.emit('mbreconnecting')
        if (node.reconnectTimeout <= 0) {
          node.reconnectTimeout = reconnectTimeMS
        }
        setTimeout(() => {
          node.reconnectTimeoutId = 0
          node.stateService.send('INIT')
        }, node.reconnectTimeout)
      }
    })

    node.connectClient = function () {
      if (node.client) {
        try {
          node.client.close(function () {
            verboseLog('connection closed')
          })
          verboseLog('connection close sent')
        } catch (err) {
          verboseLog(err.message)
        }
      }
      node.client = null
      node.client = new ModbusRTU()

      if (!node.clientTimeout) {
        node.clientTimeout = timeoutTimeMS
      }

      if (!node.reconnectTimeout) {
        node.reconnectTimeout = reconnectTimeMS
      }

      if (node.clienttype === 'tcp') {
        if (!coreModbusClient.checkUnitId(node.unit_id, node.clienttype)) {
          node.error(new Error('wrong unit-id (0..255)'), { payload: node.unit_id })
          node.stateService.send('FAILURE')
          return
        }

        switch (node.tcpType) {
          case 'C701':
            verboseLog('C701 port UDP bridge')
            node.client.connectC701(node.tcpHost, {
              port: node.tcpPort,
              autoOpen: true
            }).then(node.setTCPConnectionOptions)
              .then(node.setTCPConnected)
              .catch(node.modbusTcpErrorHandling)
            break
          case 'TELNET':
            verboseLog('Telnet port')
            node.client.connectTelnet(node.tcpHost, {
              port: node.tcpPort,
              autoOpen: true
            }).then(node.setTCPConnectionOptions)
              .catch(node.modbusTcpErrorHandling)
            break
          case 'TPC-RTU-BUFFERED':
            verboseLog('TCP RTU buffered port')
            node.client.connectTcpRTUBuffered(node.tcpHost, {
              port: node.tcpPort,
              autoOpen: true
            }).then(node.setTCPConnectionOptions)
              .catch(node.modbusTcpErrorHandling)
            break
          default:
            verboseLog('TCP port')
            node.client.connectTCP(node.tcpHost, {
              port: node.tcpPort,
              autoOpen: true
            }).then(node.setTCPConnectionOptions)
              .catch(node.modbusTcpErrorHandling)
        }
      } else {
        if (!coreModbusClient.checkUnitId(node.unit_id, node.clienttype)) {
          node.error(new Error('wrong unit-id serial (1..247)'), { payload: node.unit_id })
          node.stateService.send('FAILURE')
          return
        }

        if (!node.serialConnectionDelay) {
          node.serialConnectionDelay = serialConnectionDelayTimeMS
        }

        if (!node.serialPort) {
          node.error(new Error('wrong serial port'), { payload: node.serialPort })
          node.stateService.send('FAILURE')
          return
        }

        const serialPortOptions = {
          baudRate: parseInt(node.serialBaudrate),
          dataBits: parseInt(node.serialDatabits),
          stopBits: parseInt(node.serialStopbits),
          parity: node.serialParity,
          autoOpen: false
        }

        switch (node.serialType) {
          case 'ASCII':
            verboseLog('ASCII port serial')
            node.client.connectAsciiSerial(node.serialPort, serialPortOptions).then(node.setSerialConnectionOptions)
              .catch(node.modbusSerialErrorHandling)
            break
          case 'RTU':
            verboseLog('RTU port serial')
            node.client.connectRTU(node.serialPort, serialPortOptions).then(node.setSerialConnectionOptions)
              .catch(node.modbusSerialErrorHandling)
            break
          default:
            verboseLog('RTU buffered port serial')
            node.client.connectRTUBuffered(node.serialPort, serialPortOptions).then(node.setSerialConnectionOptions)
              .catch(node.modbusSerialErrorHandling)
            break
        }
      }
    }

    node.setTCPConnectionOptions = function () {
      node.client.setID(node.unit_id)
      node.client.setTimeout(node.clientTimeout)
      node.stateService.send('CONNECT')
    }

    node.setTCPConnected = function () {
      coreModbusClient.modbusSerialDebug('modbus tcp connected on ' + node.tcpHost)
    }

    node.setSerialConnectionOptions = function () {
      node.stateService.send('OPENSERIAL')
      setTimeout(node.openSerialClient, parseInt(node.serialConnectionDelay))
    }

    node.modbusErrorHandling = function (err) {
      if (err.message) {
        coreModbusClient.modbusSerialDebug('modbusErrorHandling:' + err.message)
      } else {
        coreModbusClient.modbusSerialDebug('modbusErrorHandling:' + JSON.stringify(err))
      }
      if (err.errno && coreModbusClient.networkErrors.includes(err.errno)) {
        node.stateService.send('FAILURE')
      }
    }

    node.modbusTcpErrorHandling = function (err) {
      if (node.showErrors) {
        node.error(err)
      }

      if (err.message) {
        coreModbusClient.modbusSerialDebug('modbusTcpErrorHandling:' + err.message)
      } else {
        coreModbusClient.modbusSerialDebug('modbusTcpErrorHandling:' + JSON.stringify(err))
      }

      if (err.errno && coreModbusClient.networkErrors.includes(err.errno)) {
        node.stateService.send('BREAK')
      }
    }

    node.modbusSerialErrorHandling = function (err) {
      if (node.showErrors) {
        node.error(err)
      }

      if (err.message) {
        coreModbusClient.modbusSerialDebug('modbusSerialErrorHandling:' + err.message)
      } else {
        coreModbusClient.modbusSerialDebug('modbusSerialErrorHandling:' + JSON.stringify(err))
      }
      node.stateService.send('BREAK')
    }

    node.openSerialClient = function () {
      // some delay for windows
      if (node.actualServiceState.value === 'opened') {
        verboseLog('time to open Unit ' + node.unit_id)
        coreModbusClient.modbusSerialDebug('modbus connection opened')
        node.client.setID(node.unit_id)
        node.client.setTimeout(parseInt(node.clientTimeout))
        node.client._port.on('close', node.onModbusClose)
        node.stateService.send('CONNECT')
      } else {
        verboseLog('wrong state on connect serial ' + node.actualServiceState.value)
        coreModbusClient.modbusSerialDebug('modbus connection not opened state is %s', node.actualServiceState.value)
        node.stateService.send('BREAK')
      }
    }

    node.onModbusClose = function () {
      verboseWarn('Modbus closed port')
      coreModbusClient.modbusSerialDebug('modbus closed port')
      node.stateService.send('CLOSE')
    }

    node.on('readModbus', function (msg, cb, cberr) {
      const state = node.actualServiceState

      if (node.messageAllowedStates.indexOf(state.value) === -1) {
        cberr(new Error('Client Not Ready To Read At State ' + state.value), msg)
      } else {
        if (node.bufferCommands) {
          coreModbusQueue.pushToQueueByUnitId(node, coreModbusClient.readModbus, msg, cb, cberr).then(function () {
            node.queueLog(JSON.stringify({
              info: 'queued read msg',
              message: msg.payload,
              state: state.value,
              queueLength: node.bufferCommandList.get(msg.queueUnitId).length
            }))
          }).catch(function (err) {
            cberr(err, msg)
          }).finally(function () {
            node.stateService.send('QUEUE')
          })
        } else {
          coreModbusClient.readModbus(node, msg, cb, cberr)
        }
      }
    })

    node.on('writeModbus', function (msg, cb, cberr) {
      const state = node.actualServiceState

      if (node.messageAllowedStates.indexOf(state.value) === -1) {
        cberr(new Error('Client Not Ready To Write At State ' + state.value), msg)
      } else {
        if (node.bufferCommands) {
          coreModbusQueue.pushToQueueByUnitId(node, coreModbusClient.writeModbus, msg, cb, cberr).then(function () {
            node.queueLog(JSON.stringify({
              info: 'queued write msg',
              message: msg.payload,
              state: state.value,
              queueLength: node.bufferCommandList.get(msg.queueUnitId).length
            }))
          }).catch(function (err) {
            cberr(err, msg)
          }).finally(function () {
            node.stateService.send('QUEUE')
          })
        } else {
          coreModbusClient.writeModbus(node, msg, cb, cberr)
        }
      }
    })

    node.activateSending = function (msg) {
      node.sendingAllowed.set(msg.queueUnitId, true)
      node.serialSendingAllowed = true

      return new Promise(
        function (resolve, reject) {
          try {
            if (node.bufferCommands) {
              node.queueLog(JSON.stringify({
                info: 'queue response activate sending',
                message: msg.payload,
                queueLength: node.bufferCommandList.length,
                queueUnitId: msg.queueUnitId
              }))

              if (coreModbusQueue.checkQueuesAreEmpty(node)) {
                node.stateService.send('EMPTY')
              } else {
                node.stateService.send('ACTIVATE')
              }
            } else {
              node.stateService.send('ACTIVATE')
            }
            resolve()
          } catch (err) {
            reject(err)
          }
        })
    }

    verboseLog('initialized')
    node.setMaxListeners(unlimitedListeners)

    node.on('reconnect', function () {
      node.stateService.send('CLOSE')
    })

    node.on('dynamicReconnect', function (msg, cb, cberr) {
      if (mbBasics.invalidPayloadIn(msg)) {
        throw new Error('Message Or Payload Not Valid')
      }

      coreModbusClient.internalDebug('Dynamic Reconnect Parameters ' + JSON.stringify(msg.payload))
      if (coreModbusClient.setNewNodeSettings(node, msg)) {
        cb(msg)
      } else {
        cberr(new Error('Message Or Payload Not Valid'), msg)
      }
      coreModbusClient.internalDebug('Dynamic Reconnect Starts on actual state ' + node.actualServiceState.value)
      node.stateService.send('CLOSE')
    })

    node.on('close', function (done) {
      node.closingModbus = true
      verboseLog('stop fsm on close ' + node.name)
      node.stateService.send('STOP')
      verboseLog('close node ' + node.name)
      if (node.client) {
        if (node.client.isOpen) {
          node.client.close(function (err) {
            if (err) {
              verboseLog('Connection closed with error ' + node.name)
            } else {
              verboseLog('Connection closed well ' + node.name)
            }
            done()
          })
        } else {
          verboseLog('connection was closed ' + node.name)
          done()
        }
      } else {
        verboseLog('Connection closed simple ' + node.name)
        done()
      }
    })

    // handle using as config node
    node.registeredNodeList = {}

    node.registerForModbus = function (modbusNode) {
      node.registeredNodeList[modbusNode.id] = modbusNode
      if (Object.keys(node.registeredNodeList).length === 1) {
        node.closingModbus = false
        node.stateService.send('NEW')
        node.stateService.send('INIT')
      }
    }

    node.closeConnectionWithoutRegisteredNodes = function (done) {
      if (Object.keys(node.registeredNodeList).length === 0) {
        node.closingModbus = true
        if (node.client && node.actualServiceState.value !== 'stopped') {
          if (node.client.isOpen) {
            node.client.close(function () {
              node.stateService.send('STOP')
              done()
            })
          } else {
            node.stateService.send('STOP')
            done()
          }
        } else {
          node.stateService.send('STOP')
          done()
        }
      } else {
        done()
      }
    }

    node.deregisterForModbus = function (modbusNode, done) {
      delete node.registeredNodeList[modbusNode.id]
      if (node.closingModbus) {
        done()
      } else {
        node.closeConnectionWithoutRegisteredNodes(done)
      }
    }
  }

  RED.nodes.registerType('modbus-client', ModbusClientNode)

  RED.httpAdmin.get('/modbus/serial/ports', RED.auth.needsPermission('serial.read'), function (req, res) {
    const SerialPort = require('serialport')
    SerialPort.list().then(ports => {
      res.json(ports)
    }).catch(err => {
      res.json([err.message])
      coreModbusClient.internalDebug(err.message)
    })
  })
}
