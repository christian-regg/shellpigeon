import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { claudeRegistrationGap, discoverPeers, exactPeer, sourcePeer, sameDirectory, type Peer } from './peer-discovery.js';
import { sendPeer, DeliveryUnknown } from './peer-transport.js';
import { peerListView } from './peer-presentation.js';

async function main() {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {
    all: {type: 'boolean'}, native: {type: 'boolean'}, queue: {type: 'boolean'},
    provider: {type: 'string'}, 'message-file': {type: 'string'}, help: {type: 'boolean'},
  }});
  const [verb, target, summary, inline] = positionals;
  if (values.help || !verb) {
    console.log('ShellPigeon — local session messaging\n\npeer.cjs list [--all] [--provider claude|codex]\npeer.cjs self\npeer.cjs doctor (Codex native endpoint diagnosis; read-only)\npeer.cjs send <exact-address-or-name> <summary> <message> [--native|--queue]\nUse --message-file <path> instead of <message> for literal or multiline content.\nNames default to this project; --all includes other projects. Exact addresses work across projects.');
    return;
  }
  if (!['list', 'self', 'send', 'doctor'].includes(verb)) throw new Error('Unknown command. Use --help.');
  if (values.provider && !['claude', 'codex'].includes(values.provider)) throw new Error('Invalid provider.');
  if (values.native && values.queue) throw new Error('Choose only one of --native and --queue.');
  if (verb === 'send' && (!target || !summary || (inline === undefined) === !values['message-file'] || positionals.length > 4)) {
    throw new Error('send requires exact target, summary and either one message argument or --message-file.');
  }
  const provider = verb === 'doctor' ? 'codex' : verb === 'list' ? values.provider as 'claude' | 'codex' | undefined : undefined;
  const discovery = await discoverPeers({all: true, provider});
  const registrationGap = provider === 'codex' ? null : await claudeRegistrationGap();
  if (registrationGap) discovery.diagnostics.push(registrationGap);
  if (verb === 'list') {
    let current: Peer | null = null;
    try { current = sourcePeer(discovery.peers, process.env, registrationGap); } catch { /* Discovery also works outside a host session. */ }
    // The tool shell may have left the project directory; the project is the current session's directory.
    const project = current?.cwd ?? process.cwd();
    const peers = discovery.peers.filter(p => values.all || sameDirectory(p.cwd, project));
    console.log(JSON.stringify({...discovery, ...peerListView(peers, current?.address ?? null)}, null, 2));
  } else if (verb === 'doctor') {
    console.log(JSON.stringify({codexEndpoints: discovery.codexEndpoints, diagnostics: discovery.diagnostics,
      nativePeers: discovery.peers.filter(p => p.transport === 'codex-native').map(p => p.address),
      queueCandidates: discovery.peers.filter(p => p.transport === 'codex-queue').map(p => p.address),
      guidance: [
        'Ordinary session listing and default delivery need no extra terminal, daemon or Codex installation.',
        'Default delivery uses an available native Codex route, otherwise codex queue; queue input runs in a separate turn.',
        'Verified for Codex 0.154.0: ordinary CLI starts reuse an existing default listener; they do not start one.',
        'A fresh empty CLI may lack saved thread metadata. Send its first ordinary user message, then list again; use --all for other projects.',
        'A writer-lock candidate may be a closed CLI; queue input waits until that CLI is resumed. No live recipient is proven by the lock.',
        'Recorded source vscode can mean Desktop/editor or a CLI attached to an app-server; the current UI is unknown. Desktop queue dispatch remains unverified.',
        'Claude IPC replies can activate an idle session automatically when inbound policy allows them; no mailbox polling is needed.',
        'CLI -c/--config, profile and certain other launch overrides select an embedded server instead.',
        'A later listener does not adopt open embedded sessions or the Desktop stdio server.',
        'A CLI can attach on a new start or resume after its previous owner exits. Never force a locked thread.',
        ...(process.platform === 'win32' ? ['Only the optional managed daemon start workflow requires a standalone install; the existing npm CLI supports queue delivery.',
        'Windows daemon start requires a non-administrator terminal whose host allows detached processes.',
        'Optional setup-listener.ps1 previews changes by default; it is not a prerequisite for listing or default delivery.'] :
        ['Linux peers must share the same OS user and PID namespace; Windows-to-WSL and cross-distribution messaging are not supported.']),
        'No daemon, model turn or persistent configuration was started or changed by this diagnosis.',
      ]}, null, 2));
  } else if (verb === 'self') {
    console.log(JSON.stringify({address: sourcePeer(discovery.peers, process.env, registrationGap).address}));
  } else {
    const source = sourcePeer(discovery.peers, process.env, registrationGap);
    const candidates = discovery.peers.filter(p => values.all || p.address === target || p.id === target || sameDirectory(p.cwd, source.cwd));
    const peer = exactPeer(candidates, target!);
    const message = values['message-file'] ? await readFile(values['message-file'], 'utf8') : inline;
    console.log(JSON.stringify(await sendPeer(peer, source, summary!, message!, {mode: values.native ? 'native' : values.queue ? 'queue' : 'auto'}), null, 2));
  }
}
main().catch(error => {
  console.error(JSON.stringify({error: error.message, outcome: error instanceof DeliveryUnknown ? 'unknown' : 'not-sent'}));
  process.exitCode = error instanceof DeliveryUnknown ? 2 : 1;
});
