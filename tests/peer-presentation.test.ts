import test from 'node:test';
import assert from 'node:assert/strict';
import { publicPeer, peerListView, deliveryDetails } from '../src/peer-presentation.js';
import type { Peer } from '../src/peer-discovery.js';

const id = '11111111-1111-4111-8111-111111111111';
const candidate: Peer = {provider: 'codex', id, address: 'codex:' + id, name: 'CLI-looking name',
  cwd: process.cwd(), evidence: 'writer-lock', transport: 'codex-queue'};

test('recorded host origin changes queue support without claiming a live CLI', () => {
  const cli = publicPeer({...candidate, codexSource: 'cli'});
  assert.equal(cli.sessionKind, 'codex-cli');
  assert.equal(cli.runtimeStatus, 'unverified');
  assert.equal(cli.delivery.mode, 'cli-queue');
  assert.equal(cli.delivery.resumeCommand, 'codex resume ' + id);
  const editor = publicPeer({...candidate, codexSource: 'vscode'});
  assert.equal(editor.sessionKind, 'codex-app-server-or-editor');
  assert.equal(editor.runtimeStatus, 'unverified');
  assert.equal(editor.delivery.mode, 'unverified');
  assert.equal(editor.delivery.resumeCommand, undefined);
  assert.equal(publicPeer(candidate).sessionKind, 'codex-unknown');
  assert.equal(deliveryDetails(candidate).resumeCommand, undefined);
});

test('list presentation separates evidence and self without exposing private registration fields', () => {
  const claude: Peer = {...candidate, provider: 'claude', address: 'claude:' + id,
    evidence: 'live-process', transport: 'claude-ipc', registry: 'private-registration', processStart: 'private-start'};
  const native: Peer = {...candidate, id: 'native', address: 'codex:native', codexSource: 'vscode',
    transport: 'codex-native', evidence: 'loaded-thread'};
  const result = peerListView([claude, native, {...candidate, codexSource: 'cli'}], claude.address);
  assert.deepEqual(result.counts, {listed: 3, currentSession: 1, processConfirmed: 1, threadLoaded: 1, unverifiedQueueCandidates: 1});
  assert.equal(result.peers[0]!.isCurrentSession, true);
  assert.equal(result.peers[1]!.isCurrentSession, false);
  assert.equal(result.peers[1]!.sessionKind, 'codex-app-server-or-editor');
  assert.equal(result.peers[1]!.delivery.mode, 'automatic');
  assert.equal(result.peers[2]!.runtimeStatus, 'unverified');
  assert.equal('registry' in result.peers[0]!, false);
  assert.equal('processStart' in result.peers[0]!, false);
  assert.equal(peerListView([claude], null).counts.currentSession, 0);
});

test('actual native or IPC delivery takes precedence over recorded host and queue guidance', () => {
  assert.equal(deliveryDetails({...candidate, codexSource: 'vscode'}, 'codex-native').mode, 'automatic');
  assert.equal(deliveryDetails({...candidate, provider: 'claude'}, 'claude-ipc').mode, 'automatic');
  assert.equal(deliveryDetails({...candidate, codexSource: 'exec'}, 'codex-queue').mode, 'unverified');
  assert.equal(deliveryDetails({...candidate, codexSource: 'appServer'}, 'codex-queue').resumeCommand, undefined);
});
