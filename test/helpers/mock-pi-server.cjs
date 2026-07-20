#!/usr/bin/env node
'use strict';
/**
 * Mock pi server for Playwright e2e tests.
 *
 * Implements the v2 RPC protocol over stdio (JSONL).
 * Spawned by Electron's main process when GSD_TAU_MOCK_PI env var is set
 * (see client-factory.ts bypass).  Receives commands on stdin and emits
 * responses/events on stdout.
 *
 * Environment variables:
 *   GSD_TAU_MOCK_SCENARIO      – JSON: array of per-prompt event arrays.
 *                                Index N = events to emit after the N-th prompt.
 *   GSD_TAU_MOCK_RESPONSE_FILE – Absolute path where received ui-responses are
 *                                persisted as JSON (keyed by UI-request id).
 *
 * Protocol (from @opengsd/rpc-client):
 *   Commands stdin:  { type, id?, ...payload }         JSONL
 *   Responses stdout:{ type:"response", id, success, data } JSONL
 *   Events stdout:   { type, ...payload }               JSONL
 *
 * extension_ui_response is fire-and-forget:
 *   { type:"extension_ui_response", id:<uiReqId>, ...responsePayload }
 */

const fs = require('fs');

// ── Config ─────────────────────────────────────────────────────────────────────

const responseFile = process.env.GSD_TAU_MOCK_RESPONSE_FILE || '';

/** Per-prompt event arrays. scenarios[N] is emitted after the N-th prompt. */
let scenarios = [];
try {
  const raw = process.env.GSD_TAU_MOCK_SCENARIO;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0])) {
      scenarios = parsed;         // array of arrays
    } else if (Array.isArray(parsed)) {
      scenarios = [parsed];       // single scenario wrapped
    }
  }
} catch (e) {
  process.stderr.write('[mock-pi] SCENARIO parse error: ' + e.message + '\n');
}

/**
 * Received extension_ui_response payloads.
 * Key = UI-request id; value = response fields (type stripped).
 */
const receivedResponses = {};

/** Number of prompt commands received so far. */
let promptCount = 0;

// ── JSONL send helpers ─────────────────────────────────────────────────────────

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function sendOk(id, data) {
  send({ type: 'response', id: id, success: true, data: data !== undefined ? data : {} });
}

// ── Persist responses ──────────────────────────────────────────────────────────

function saveResponses() {
  if (!responseFile) return;
  try {
    fs.writeFileSync(responseFile, JSON.stringify(receivedResponses, null, 2), 'utf8');
  } catch (e) {
    process.stderr.write('[mock-pi] save error: ' + e.message + '\n');
  }
}

// ── Scenario emission ──────────────────────────────────────────────────────────

function delayMs(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

async function emitScenario(idx) {
  const events = scenarios[idx] !== undefined
    ? scenarios[idx]
    : [{ type: 'agent_start' }, { type: 'agent_end' }];

  for (const evt of events) {
    // Honour an explicit _delay field; otherwise use a small inter-event gap
    if (typeof evt._delay === 'number') {
      await delayMs(evt._delay);
    } else {
      await delayMs(25);
    }
    // Strip private fields before emitting
    const payload = Object.assign({}, evt);
    delete payload._delay;
    send(payload);
    process.stderr.write(
      '[mock-pi] emit ' + payload.type + (payload.id ? '#' + payload.id : '') + '\n'
    );
  }
}

// ── Stdin JSONL reader ─────────────────────────────────────────────────────────

let buf = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', function(chunk) {
  buf += chunk;
  var nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    var line = buf.slice(0, nl).replace(/\r$/, '');
    buf = buf.slice(nl + 1);
    if (line.trim()) handleLine(line);
  }
});

process.stdin.on('end', function() {
  saveResponses();
  process.exit(0);
});

process.on('SIGTERM', function() {
  saveResponses();
  process.exit(0);
});

// ── Command dispatcher ─────────────────────────────────────────────────────────

function handleLine(line) {
  var cmd;
  try { cmd = JSON.parse(line); } catch (e) { return; }
  process.stderr.write('[mock-pi] cmd=' + cmd.type + (cmd.id ? ' id=' + cmd.id : '') + '\n');

  switch (cmd.type) {
    case 'init':
      sendOk(cmd.id, {
        protocolVersion: 2,
        sessionId: 'mock-' + Math.random().toString(36).slice(2, 10),
        capabilities: { events: ['*'], commands: [] },
      });
      break;

    case 'subscribe':
      sendOk(cmd.id, {});
      break;

    case 'prompt': {
      var idx = promptCount++;
      sendOk(cmd.id, {});
      // Emit events asynchronously so command processing is never blocked
      setImmediate(function() {
        emitScenario(idx).catch(function(e) {
          process.stderr.write('[mock-pi] emit error: ' + e.message + '\n');
        });
      });
      break;
    }

    case 'extension_ui_response': {
      // Fire-and-forget from rpc-client.sendUIResponse():
      //   { type, id: <uiReqId>, ...responsePayload }
      // cmd.id is the UI-request id, NOT a command-tracking req_N.
      var uiReqId = cmd.id;
      var payload = Object.assign({}, cmd);
      delete payload.type;
      delete payload.id;
      receivedResponses[uiReqId] = payload;
      saveResponses();
      process.stderr.write(
        '[mock-pi] ui-resp ' + uiReqId + ' => ' + JSON.stringify(payload) + '\n'
      );
      break;
    }

    case 'abort':
      sendOk(cmd.id, {});
      break;

    case 'shutdown':
      sendOk(cmd.id, {});
      saveResponses();
      // Give the response a moment to flush, then exit
      setTimeout(function() { process.exit(0); }, 50);
      break;

    default:
      // Respond empty so the client's pending-request timeout never fires
      if (cmd.id) sendOk(cmd.id, {});
      break;
  }
}
