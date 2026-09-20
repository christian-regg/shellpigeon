import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// This probe downloads only this project's published platform packages.
export async function downloadReleasedArchive(version, directory, {platform = process.platform, fetcher = fetch} = {}) {
  assert.match(version, /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/, 'Invalid release version.');
  assert.ok(['win32', 'linux'].includes(platform), 'Release upgrade probes support Windows and Linux.');
  const name = `shellpigeon-${version}-${platform === 'win32' ? 'windows.zip' : 'linux.tar.gz'}`;
  const url = `https://github.com/christian-regg/shellpigeon/releases/download/v${version}/${name}`;
  const responses = await Promise.all([url, url + '.sha256'].map(address => fetcher(address, {signal: AbortSignal.timeout(30_000)})));
  for (const response of responses) {
    if (!response.ok) throw new Error(`Published package ${name} unavailable: HTTP ${response.status}. Both releases must contain a package for this platform.`);
  }
  const [bytes, checksum] = await Promise.all([responses[0].arrayBuffer(), responses[1].text()]);
  const fields = checksum.trim().split(/\s+/);
  assert.equal(fields.length, 2, 'Invalid release checksum file.');
  assert.match(fields[0], /^[a-fA-F0-9]{64}$/, 'Invalid release checksum.');
  assert.equal(fields[1], name, 'Checksum names a different release archive.');
  const content = Buffer.from(bytes);
  const sha256 = createHash('sha256').update(content).digest('hex');
  assert.equal(sha256, fields[0].toLowerCase(), 'Published release archive checksum mismatch.');
  await mkdir(directory, {recursive: true});
  const archive = join(directory, name);
  await writeFile(archive, content);
  return {archive, version, url, sha256};
}
