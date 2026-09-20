import type { Peer } from './peer-discovery.js';

export type SessionKind = 'claude-code' | 'codex-cli' | 'codex-app-server-or-editor' | 'codex-exec' | 'codex-app-server' | 'codex-unknown';

export function sessionKind(peer: Peer): SessionKind {
  if (peer.provider === 'claude') return 'claude-code';
  switch (peer.codexSource) {
    case 'cli': return 'codex-cli';
    case 'vscode': return 'codex-app-server-or-editor';
    case 'exec': return 'codex-exec';
    case 'appServer': return 'codex-app-server';
    default: return 'codex-unknown';
  }
}

export interface DeliveryDetails {
  mode: 'automatic' | 'cli-queue' | 'unverified';
  explanation: string;
  resumeCommand?: string;
}

export function deliveryDetails(peer: Peer, transport = peer.transport): DeliveryDetails {
  if (transport === 'claude-ipc') return {
    mode: 'automatic',
    explanation: 'When Claude allows the incoming peer message, an idle session starts a turn automatically; a busy session reads it at a tool/model boundary. No mailbox polling is needed. A successful write alone does not confirm model receipt.',
  };
  if (transport === 'codex-native') return {
    mode: 'automatic',
    explanation: 'The owning native endpoint can start an idle turn or deliver into an active turn without interrupting an in-flight tool. RPC acceptance does not confirm model receipt or completion.',
  };
  if (peer.codexSource === 'cli') return {
    mode: 'cli-queue',
    explanation: 'Stored as ordinary user input. An open idle Codex CLI processes its queue automatically; a busy CLI finishes its current turn first. A closed or interrupted CLI waits until resumed. A writer-lock file alone does not prove this CLI is open. Resume only if its previous owner has exited.',
    resumeCommand: 'codex resume ' + peer.id,
  };
  return {
    mode: 'unverified',
    explanation: 'Queue storage is available, but no live CLI owner is established for this target. A recorded vscode/app-server source can belong to a Desktop/editor task or an attached CLI. Automatic Desktop/editor processing is unverified; storage does not confirm receipt.',
  };
}

export function publicPeer(peer: Peer, currentAddress: string | null = null) {
  const {registry, processStart, ...visible} = peer;
  const runtimeStatus = peer.evidence === 'live-process' ? 'process-confirmed'
    : peer.evidence === 'loaded-thread' ? 'thread-loaded' : 'unverified';
  const status = runtimeStatus === 'process-confirmed'
    ? 'Live Claude process verified; idle/busy activity was not checked.'
    : runtimeStatus === 'thread-loaded'
      ? 'Thread loaded at a reachable native endpoint; a visible CLI window is not established.'
      : 'Writer-lock candidate only: it may be a closed session or a leftover lock. No live recipient is confirmed.';
  const originExplanation = peer.codexSource === 'vscode'
    ? 'Codex records vscode for Desktop/editor tasks and CLIs attached to an app-server; this field cannot identify the currently attached UI.' : undefined;
  return {...visible, sessionKind: sessionKind(peer), originExplanation, isCurrentSession: peer.address === currentAddress,
    runtimeStatus, status, delivery: deliveryDetails(peer)};
}

export function peerListView(peers: Peer[], currentAddress: string | null) {
  const visible = peers.map(peer => publicPeer(peer, currentAddress));
  return {
    currentAddress,
    counts: {
      listed: visible.length,
      currentSession: visible.filter(peer => peer.isCurrentSession).length,
      processConfirmed: visible.filter(peer => peer.runtimeStatus === 'process-confirmed').length,
      threadLoaded: visible.filter(peer => peer.runtimeStatus === 'thread-loaded').length,
      unverifiedQueueCandidates: visible.filter(peer => peer.runtimeStatus === 'unverified').length,
    },
    peers: visible,
  };
}
