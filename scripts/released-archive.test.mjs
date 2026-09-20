import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {downloadReleasedArchive} from './released-archive.mjs';

const version = '0.5.0-preview.1';
const name = `shellpigeon-${version}-windows.zip`;
const content = Buffer.from('test archive bytes');
const sha256 = createHash('sha256').update(content).digest('hex');
function fakeFetch(checksum = `${sha256}  ${name}\n`, bytes = content) {
  return async url => new Response(url.endsWith('.sha256') ? checksum : bytes);
}

test('released package download verifies bytes, filename and public source', async t => {
  const root = await mkdtemp(join(tmpdir(), 'shellpigeon-release-download-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const result = await downloadReleasedArchive(version, root, {platform: 'win32', fetcher: fakeFetch()});
  assert.deepEqual(await readFile(result.archive), content);
  assert.equal(result.sha256, sha256);
  assert.equal(result.url, `https://github.com/christian-regg/shellpigeon/releases/download/v${version}/${name}`);
});

test('corrupt archives and mismatched checksum filenames are not saved', async t => {
  const root = await mkdtemp(join(tmpdir(), 'shellpigeon-release-download-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await assert.rejects(downloadReleasedArchive(version, root, {platform: 'win32', fetcher: fakeFetch(undefined, Buffer.from('corrupt'))}), /checksum mismatch/);
  await assert.rejects(downloadReleasedArchive(version, root, {platform: 'win32', fetcher: fakeFetch(`${sha256}  other.zip\n`)}), /different release archive/);
  await assert.rejects(downloadReleasedArchive(version, root, {platform: 'win32', fetcher: fakeFetch('not a checksum')}), /Invalid release checksum/);
  assert.deepEqual(await readdir(root), []);
});

test('invalid versions, unsupported platforms and missing release assets fail before installation', async () => {
  const noFetch = async () => { throw new Error('Unexpected download'); };
  await assert.rejects(downloadReleasedArchive('../secret', '.', {platform: 'win32', fetcher: noFetch}), /Invalid release version/);
  await assert.rejects(downloadReleasedArchive(version, '.', {platform: 'darwin', fetcher: noFetch}), /support Windows and Linux/);
  await assert.rejects(downloadReleasedArchive(version, '.', {platform: 'linux', fetcher: async () => new Response('', {status: 404})}), /Both releases must contain a package for this platform/);
});
