/**
 * Original Work Copyright 2014 IBM Corp.
 * node-red
 *
 * Copyright (c) since the year 2016 Klaus Landsdorf (http://plus4nodered.com/)
 * All rights reserved.
 * node-red-contrib-modbus - The BSD 3-Clause License
 *
 **/

'use strict'

const injectNode = require('@node-red/nodes/core/common/20-inject.js')

const clientNode = require('../../src/modbus-client.js')
const serverNode = require('../../src/modbus-server.js')
const getterNode = require('../../src/modbus-getter.js')
const ioConfigNode = require('../../src/modbus-io-config')
const sinon = require('sinon')
const helper = require('node-red-node-test-helper')
helper.init(require.resolve('node-red'))

const testGetterNodes = [injectNode, ioConfigNode, clientNode, serverNode, getterNode]

const testFlows = require('./flows/modbus-getter-flows')
const mbBasics = require('../../src/modbus-basics')
const { getPort } = require('../helper/test-helper-extensions')
const mBasics = require('../../src/modbus-basics')

describe('Getter node Unit Testing', function () {
  before(function (done) {
    helper.startServer(function () {
      done()
    })
  })

  afterEach(function (done) {
    helper.unload().then(function () {
      done()
    }).catch(function () {
      done()
    })
  })

  after(function (done) {
    helper.stopServer(function () {
      done()
    })
  })

  describe('Node', function () {
    it('simple Node should be loaded without client config', function (done) {
      helper.load(testGetterNodes, testFlows.testGetterWithoutClientConfigFlow, function () {
        const modbusGetter = helper.getNode('3ffe153acc21d72b')
        modbusGetter.should.have.property('name', 'modbusGetter')

        done()
      }, function () {
        helper.log('function callback')
      })
    })

    it('simple Node should be loaded', function (done) {
      const flow = Array.from(testFlows.testGetterWithClientFlow)

      getPort().then((port) => {
        flow[2].serverPort = port
        flow[3].tcpPort = port

        helper.load(testGetterNodes, flow, function () {
          const modbusServer = helper.getNode('996023fe.ea04b')
          modbusServer.should.have.property('name', 'modbusServer')

          const modbusClient = helper.getNode('9660d4a8f8cc2b44')
          modbusClient.should.have.property('name', 'modbusClient')

          const modbusGetter = helper.getNode('322daf89.be8dd')
          modbusGetter.should.have.property('name', 'modbusGetter')

          done()
        }, function () {
          helper.log('function callback')
        })
      })
    })

    it('simple flow with inject should be loaded', function (done) {
      const flow = Array.from(testFlows.testInjectGetterWithClientFlow)

      getPort().then((port) => {
        flow[1].serverPort = port
        flow[5].tcpPort = port

        helper.load(testGetterNodes, flow, function () {
          const h1 = helper.getNode('h1')
          let counter = 0
          h1.on('input', function () {
            counter++
            if (counter === 1) {
              done()
            }
          })
        }, function () {
          helper.log('function callback')
        })
      })
    })

    it('should work as simple flow with inject and IO', function (done) {
      const flow = Array.from(testFlows.testGetterFlowWithInjectIo)

      getPort().then((port) => {
        flow[1].serverPort = port
        flow[5].tcpPort = port

        helper.load(testGetterNodes, flow, function () {
          const modbusGetter = helper.getNode('a9b0b8a7cec1de86')
          const h1 = helper.getNode('dee228d8d9eaea8a')
          let counter = 0
          h1.on('input', function () {
            counter++
            if (modbusGetter.bufferMessageList.size === 0 && counter === 1) {
              done()
            }
          })
        }, function () {
          helper.log('function callback')
        })
      })
    })

    it('should work as simple flow with inject and IO with read done', function (done) {
      const flow = Array.from(testFlows.testGetterFlowWithInjectIo)

      getPort().then((port) => {
        flow[1].serverPort = port
        flow[5].tcpPort = port

        helper.load(testGetterNodes, flow, function () {
          const modbusGetter = helper.getNode('a9b0b8a7cec1de86')
          let counter = 0
          modbusGetter.on('modbusGetterNodeDone', function () {
            counter++
            if (modbusGetter.bufferMessageList.size === 0 && counter === 1) {
              done()
            }
          })
        }, function () {
          helper.log('function callback')
        })
      })
    })

    it('should work as simple flow with wrong write inject and IO', function (done) {
      const flow = Array.from(testFlows.testGetterFlow)

      getPort().then((port) => {
        flow[1].serverPort = port
        flow[4].tcpPort = port

        helper.load(testGetterNodes, flow, function () {
          const modbusGetter = helper.getNode('cea01c8.36f8f6')
          setTimeout(function () {
            modbusGetter.receive({ payload: '{ "value": "true", "fc": 5, "unitid": 1,"address": 0, "quantity": 4 }' })
            done()
          }, 800)
        }, function () {
          helper.log('function callback')
        })
      })
    })

    it('should work as simple flow with wrong address inject and IO', function (done) {
      const flow = Array.from(testFlows.testGetterFlow)

      getPort().then((port) => {
        flow[1].serverPort = port
        flow[4].tcpPort = port

        helper.load(testGetterNodes, flow, function () {
          const modbusGetter = helper.getNode('cea01c8.36f8f6')
          setTimeout(function () {
            modbusGetter.receive({ payload: '{ "fc": 1, "unitid": 1,"address": -1, "quantity": 4 }' })
            done()
          }, 800)
        }, function () {
          helper.log('function callback')
        })
      })
    })

    it('should work as simple flow with wrong quantity inject and IO', function (done) {
      const flow = Array.from(testFlows.testGetterFlow)

      getPort().then((port) => {
        flow[1].serverPort = port
        flow[4].tcpPort = port

        helper.load(testGetterNodes, flow, function () {
          const modbusGetter = helper.getNode('cea01c8.36f8f6')
          setTimeout(function () {
            modbusGetter.receive({ payload: '{ "fc": 1, "unitid": 1,"address": 0, "quantity": -1 }' })
            done()
          }, 800)
        }, function () {
          helper.log('function callback')
        })
      })
    })

    it('should be state queueing - ready to send', function (done) {
      const flow = Array.from(testFlows.testGetterFlowWithInjectIo)

      getPort().then((port) => {
        flow[1].serverPort = port
        flow[5].tcpPort = port

        helper.load(testGetterNodes, flow, function () {
          const modbusGetterNode = helper.getNode('a9b0b8a7cec1de86')
          setTimeout(() => {
            mBasics.setNodeStatusTo('queueing', modbusGetterNode)
            modbusGetterNode.statusText.should.equal('queueing')
            done()
          }, 1500)
        })
      })
    })

    it('should be not state queueing - not ready to send', function (done) {
      const flow = Array.from(testFlows.testGetterFlowWithInjectIo)

      getPort().then((port) => {
        flow[1].serverPort = port
        flow[5].tcpPort = port

        helper.load(testGetterNodes, flow, function () {
          const modbusGetterNode = helper.getNode('a9b0b8a7cec1de86')
          setTimeout(() => {
            mBasics.setNodeStatusTo('stopped', modbusGetterNode)
            modbusGetterNode.statusText.should.equal('stopped')
            done()
          }, 1500)
        })
      })
    })

    it('should handle modbus command error correctly', async () => {
      const flow = Array.from(testFlows.testGetterFlowWithInjectIo)

      getPort().then((port) => {
        flow[1].serverPort = port
        flow[5].tcpPort = port

        helper.load(testGetterNodes, flow, function () {
          const modbusClientNode = helper.getNode('a9b0b8a7cec1de86')
          const errorMessage = new Error('Test error')
          const msg = { payload: 'test' }

          getterNode.onModbusCommandError(errorMessage, msg)
          sinon.assert.calledWith(modbusClientNode.internalDebugLog, errorMessage)

          modbusClientNode.internalDebugLog = sinon.spy()
          modbusClientNode.errorProtocolMsg = sinon.spy()
          modbusClientNode.emit = sinon.spy()
          modbusClientNode.bufferMessageList = []

          modbusClientNode.modbusClient = {}

          sinon.stub(modbusClientNode, 'internalDebugLog')
          sinon.stub(modbusClientNode, 'errorProtocolMsg')
          sinon.stub(mbBasics, 'sendEmptyMsgOnFail')
          sinon.stub(mbBasics, 'setModbusError')
        })
      })
    })
  })

  describe('post', function () {
    it('should fail for invalid node', function (done) {
      helper.load(testGetterNodes, [], function () {
        helper.request().post('/modbus-getter/invalid').expect(404).end(done)
      })
    })
  })
})
