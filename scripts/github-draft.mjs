import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

export function githubClient(token) {
  return async (route, {method = 'GET', body, bytes} = {}) => {
    const host = bytes ? 'https://uploads.github.com' : 'https://api.github.com';
    const response = await fetch(host + route, {method, headers: {Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: 'Bearer ' + token,
      ...(body ? {'Content-Type': 'application/json'} : {}), ...(bytes ? {'Content-Type': 'application/octet-stream'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {}), ...(bytes ? {body: bytes} : {}), signal: AbortSignal.timeout(60_000)});
    if (!response.ok) throw new Error(`GitHub ${method} returned HTTP ${response.status}. Rerun the failed draft job with the same artifacts; no existing asset will be replaced.`);
    return response.json();
  };
}

export async function createDraft(candidate, directory, request) {
  const root = '/repos/' + candidate.repository;
  const ref = await request(root + '/git/ref/tags/' + encodeURIComponent(candidate.tag));
  let target = ref.object;
  if (target.type === 'tag') target = (await request(root + '/git/tags/' + target.sha)).object;
  assert.equal(target.type, 'commit', 'Release tag must resolve to a commit.');
  assert.equal(target.sha, candidate.commit, 'Remote tag moved; stop before changing a release.');
  const checkDraft = release => {
    assert.equal(release.draft, true, 'A published release is never changed.');
    assert.equal(release.tag_name, candidate.tag);
    assert.equal(release.target_commitish, candidate.commit, 'Existing draft targets a different commit.');
    assert.equal(release.prerelease, candidate.prerelease);
    for (const asset of release.assets) {
      const expected = candidate.assets.find(file => file.name === asset.name);
      assert.ok(expected, 'Existing draft contains an unexpected asset.');
      assert.equal(asset.state, 'uploaded');
      assert.equal(asset.size, expected.size);
      assert.equal(asset.digest, 'sha256:' + expected.sha256, 'Existing draft asset differs; it will not be replaced.');
    }
  };
  // The tag endpoint returns published releases; list with write access to find drafts too.
  const matches = [];
  for (let page = 1; ; page++) {
    const releases = await request(root + '/releases?per_page=100&page=' + page);
    assert.ok(Array.isArray(releases));
    matches.push(...releases.filter(item => item.tag_name === candidate.tag));
    if (releases.length < 100) break;
  }
  assert.ok(matches.length <= 1, 'More than one release uses this tag; inspect before retrying.');
  let release = matches[0];
  if (release) checkDraft(release);
  else release = await request(root + '/releases', {method: 'POST', body: {tag_name: candidate.tag, target_commitish: candidate.commit, name: candidate.name, body: candidate.body, draft: true, prerelease: candidate.prerelease}});
  checkDraft(release);
  for (const expected of candidate.assets) {
    // Also stop if a person published the draft while this job was running.
    release = await request(root + '/releases/' + release.id);
    checkDraft(release);
    if (release.assets.some(asset => asset.name === expected.name)) continue;
    const bytes = await readFile(join(directory, expected.name));
    assert.equal(bytes.length, expected.size);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256);
    const asset = await request(root + '/releases/' + release.id + '/assets?name=' + encodeURIComponent(expected.name), {method: 'POST', bytes});
    checkDraft({...release, assets: [...release.assets, asset]});
  }
  release = await request(root + '/releases/' + release.id);
  checkDraft(release);
  assert.deepEqual(release.assets.map(asset => asset.name).sort(), candidate.assets.map(asset => asset.name).sort());
  return {url: release.html_url, tag: release.tag_name, draft: true, assets: release.assets.length};
}
