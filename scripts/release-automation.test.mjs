import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {releasePlan, archiveNames, recordBuild, assembleCandidate, verifyCandidate, repository} from './release-automation.mjs';
import {createDraft} from './github-draft.mjs';

const version = '0.5.0-preview.2';
const commit = 'a'.repeat(40);
const changes = `# Changelog\n\n## ${version} — 2026-09-20\n\n- A tested change.\n\n## 0.5.0-preview.1 — 2026-09-19\n\n- Previous change.\n`;
const versions = [version, version, version, version, version];
const plan = {...releasePlan(versions, changes), commit, repository};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (file, data) => writeFile(file, JSON.stringify(data));
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'shellpigeon-release-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const name of archiveNames(version)) {
    const bytes = Buffer.from('archive: ' + name);
    await writeFile(join(root, name), bytes);
    await writeFile(join(root, name + '.sha256'), hash(bytes) + '  ' + name + '\n');
  }
  await save(join(root, archiveNames(version)[2] + '.json'), {version, commit, historyIncluded: false, projectLicense: 'MIT'});
  const probe = {version, passed: true, cleanedUp: true, modelCalls: 0};
  await recordBuild(root, plan, 'win32', probe);
  await recordBuild(root, plan, 'linux', probe);
  // Output is a sibling: the input directory must contain only the recorded files.
  const output = root + '-candidate';
  t.after(() => rm(output, {recursive: true, force: true}));
  return {root, output};
}
function api(candidate, initial, {annotated = false, tagCommit = commit} = {}) {
  let release = initial ? structuredClone(initial) : undefined;
  const writes = [];
  const request = async (route, options = {}) => {
    if (route.includes('/git/ref/tags/')) return {object: {type: annotated ? 'tag' : 'commit', sha: annotated ? 'b'.repeat(40) : tagCommit}};
    if (route.includes('/git/tags/')) return {object: {type: 'commit', sha: tagCommit}};
    if (route.includes('/releases?')) return release ? [structuredClone(release)] : [];
    if (route.includes('/releases/tags/')) return release?.draft ? undefined : structuredClone(release);
    if (options.method === 'POST') {
      writes.push({route, ...options});
      if (route.endsWith('/releases')) {
        release = {...options.body, id: 17, assets: [], html_url: 'https://github.com/' + repository + '/releases/tag/' + candidate.tag};
        return structuredClone(release);
      }
      assert.ok(route.includes('/assets?name='));
      const name = new URL('https://api.github.com' + route).searchParams.get('name');
      const asset = {name, size: options.bytes.length, digest: 'sha256:' + hash(options.bytes), state: 'uploaded'};
      release.assets.push(asset);
      return structuredClone(asset);
    }
    assert.ok(!options.method || options.method === 'GET', 'No publish, overwrite or delete API calls.');
    return release ? structuredClone(release) : undefined;
  };
  return {request, writes, current: () => structuredClone(release)};
}
const existingDraft = candidate => ({id: 17, tag_name: candidate.tag, target_commitish: commit, prerelease: true, draft: true, assets: [], html_url: 'https://github.com/' + repository + '/releases/tag/' + candidate.tag});

test('release tags require matching versions and dated nonempty release notes', () => {
  const result = releasePlan(versions, changes, {event: 'push', ref: 'refs/tags/v' + version});
  assert.equal(result.tagPush, true);
  assert.equal(result.notes, '- A tested change.');
  assert.equal(result.prerelease, true);
  assert.throws(() => releasePlan([...versions, '0.0.0'], changes), /versions must match/);
  assert.throws(() => releasePlan(versions, changes, {event: 'push', ref: 'refs/tags/v9.9.9'}), /Tag and package/);
  assert.throws(() => releasePlan(versions, changes.replace('2026-09-20', 'in development'), {event: 'push', ref: 'refs/tags/v' + version}), /Date the changelog/);
  assert.throws(() => releasePlan(versions, changes.replace('- A tested change.', '')), /notes are empty/);
});

test('branches, PRs and manual tag runs are dry runs', () => {
  for (const [event, ref] of [['push', 'refs/heads/main'], ['pull_request', 'refs/pull/3/merge'], ['workflow_dispatch', 'refs/tags/v' + version]]) assert.equal(releasePlan(versions, changes, {event, ref}).tagPush, false);
});

test('candidate assembly verifies both builds and the source commit', async t => {
  const {root, output} = await fixture(t);
  const candidate = await assembleCandidate(root, output, plan);
  assert.equal(candidate.assets.length, 6);
  assert.deepEqual(await verifyCandidate(output, plan), candidate);
});

test('candidate assembly rejects corruption, mixed commits and missing files', async t => {
  const {root, output} = await fixture(t);
  const name = archiveNames(version)[0];
  const original = await readFile(join(root, name));
  await writeFile(join(root, name), 'corrupted');
  await assert.rejects(assembleCandidate(root, output, plan), /checksum mismatch/);
  await writeFile(join(root, name), original);
  const record = JSON.parse(await readFile(join(root, 'build-win32.json'), 'utf8'));
  await save(join(root, 'build-win32.json'), {...record, commit: 'c'.repeat(40)});
  await assert.rejects(assembleCandidate(root, output, plan), /different commits/);
  await save(join(root, 'build-win32.json'), record);
  await rm(join(root, name));
  await assert.rejects(assembleCandidate(root, output, plan), /missing build artifacts/);
});

test('failed installation probes cannot produce a build receipt', async t => {
  const {root} = await fixture(t);
  await assert.rejects(recordBuild(root, plan, 'win32', {passed: false}), /installation failed/);
});

test('changed candidate bytes and commit are rejected before uploading', async t => {
  const {root, output} = await fixture(t);
  await assembleCandidate(root, output, plan);
  await assert.rejects(verifyCandidate(output, {...plan, commit: 'c'.repeat(40)}), /Candidate commit differs/);
  await writeFile(join(output, archiveNames(version)[0]), 'corrupt');
  await assert.rejects(verifyCandidate(output, plan), /checksum mismatch/);
});

test('draft upload supports annotated tags and never publishes', async t => {
  const {root, output} = await fixture(t);
  const candidate = await assembleCandidate(root, output, plan);
  const remote = api(candidate, undefined, {annotated: true});
  const result = await createDraft(candidate, output, remote.request);
  assert.equal(result.draft, true);
  assert.equal(result.assets, 6);
  assert.equal(remote.writes.length, 7);
  assert.equal(remote.writes[0].body.draft, true);
  assert.ok(remote.writes.every(call => call.method === 'POST'));
});

test('rerunning a partial draft uploads only missing matching assets', async t => {
  const {root, output} = await fixture(t);
  const candidate = await assembleCandidate(root, output, plan);
  const draft = existingDraft(candidate);
  draft.assets = candidate.assets.slice(0, 2).map(file => ({name: file.name, size: file.size, digest: 'sha256:' + file.sha256, state: 'uploaded'}));
  const remote = api(candidate, draft);
  await createDraft(candidate, output, remote.request);
  assert.equal(remote.writes.length, 4);
  await createDraft(candidate, output, remote.request);
  assert.equal(remote.writes.length, 4);
});

test('published releases, changed tags and conflicting assets are preserved', async t => {
  const {root, output} = await fixture(t);
  const candidate = await assembleCandidate(root, output, plan);
  const draft = existingDraft(candidate);
  for (const [remote, message] of [
    [api(candidate, {...draft, draft: false}), /published release/],
    [api(candidate, undefined, {tagCommit: 'c'.repeat(40)}), /Remote tag moved/],
    [api(candidate, {...draft, assets: [{name: 'unexpected.zip'}]}), /unexpected asset/],
    [api(candidate, {...draft, assets: [{name: candidate.assets[0].name, size: candidate.assets[0].size, digest: 'sha256:' + '0'.repeat(64), state: 'uploaded'}]}), /will not be replaced/]
  ]) {
    await assert.rejects(createDraft(candidate, output, remote.request), message);
    assert.equal(remote.writes.length, 0);
  }
});
