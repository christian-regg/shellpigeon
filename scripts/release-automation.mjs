import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, readdir, lstat, copyFile, appendFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDraft, githubClient} from './github-draft.mjs';

export const repository = 'christian-regg/shellpigeon';
const execute = promisify(execFile);
const git = async (...args) => (await execute('git', args, {encoding: 'utf8', windowsHide: true})).stdout.trim();
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const versionPattern = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*)?$/;

export function releasePlan(versions, changelog, {event = '', ref = ''} = {}) {
  const version = versions[0];
  assert.match(version, versionPattern, 'Invalid release version.');
  assert.ok(versions.every(value => value === version), 'Package, lockfile and plugin versions must match.');
  const tag = 'v' + version;
  const tagPush = event === 'push' && ref.startsWith('refs/tags/');
  if (tagPush) assert.equal(ref, 'refs/tags/' + tag, 'Tag and package version must match.');
  const lines = changelog.split(/\r?\n/);
  const heading = lines.findIndex(line => line.startsWith('## ' + version + ' — '));
  assert.ok(heading >= 0, 'The changelog needs an entry for this version.');
  if (tagPush) assert.match(lines[heading], / — \d{4}-\d{2}-\d{2}$/, 'Date the changelog entry before tagging a release.');
  const next = lines.findIndex((line, index) => index > heading && line.startsWith('## '));
  const notes = lines.slice(heading + 1, next < 0 ? undefined : next).join('\n').trim();
  assert.ok(notes, 'Release notes are empty.');
  return {version, tag, tagPush, prerelease: version.includes('-'), notes};
}

export function archiveNames(version) {
  assert.match(version, versionPattern);
  return ['windows.zip', 'linux.tar.gz', 'source.zip'].map(suffix => `shellpigeon-${version}-${suffix}`);
}
const assetNames = version => archiveNames(version).flatMap(name => [name, name + '.sha256']);
async function fileRecord(directory, name) {
  const file = join(directory, name);
  assert.ok((await lstat(file)).isFile(), 'Artifact must be a regular file: ' + name);
  const bytes = await readFile(file);
  return {name, size: bytes.length, sha256: digest(bytes)};
}
async function checkedArchives(directory, names) {
  const records = [];
  for (const name of names) {
    const archive = await fileRecord(directory, name);
    const checksum = await fileRecord(directory, name + '.sha256');
    assert.equal((await readFile(join(directory, checksum.name), 'utf8')).trim(), archive.sha256 + '  ' + name, 'Archive checksum mismatch: ' + name);
    records.push(archive, checksum);
  }
  return records;
}

async function context() {
  const pkg = await json('package.json');
  const lock = await json('package-lock.json');
  const codex = await json('plugins/codex/agent-session-messaging/.codex-plugin/plugin.json');
  const claude = await json('plugins/claude/agent-session-messaging/.claude-plugin/plugin.json');
  assert.equal(pkg.artifactName, 'shellpigeon');
  assert.equal(pkg.license, 'MIT');
  const plan = releasePlan([pkg.version, lock.version, lock.packages[''].version, codex.version, claude.version], await readFile('CHANGELOG.md', 'utf8'), {event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF});
  const commit = await git('rev-parse', 'HEAD');
  assert.match(commit, /^[a-f0-9]{40}$/);
  if (plan.tagPush) {
    assert.equal(await git('rev-parse', plan.tag + '^{commit}'), commit, 'Checkout does not match the release tag.');
    try { await git('merge-base', '--is-ancestor', commit, 'origin/main'); }
    catch { throw new Error('Release tags must point to a commit already merged into main.'); }
  }
  return {...plan, commit, repository};
}

export async function recordBuild(directory, plan, platform, probe) {
  assert.ok(['win32', 'linux'].includes(platform));
  assert.equal(probe.passed, true, 'Package installation failed.');
  assert.equal(probe.cleanedUp, true, 'Temporary profiles were not cleaned up.');
  assert.equal(probe.modelCalls, 0, 'CI must not run models.');
  assert.equal(probe.version, plan.version);
  const names = archiveNames(plan.version);
  const files = await checkedArchives(directory, platform === 'win32' ? [names[0]] : [names[1], names[2]]);
  if (platform === 'linux') {
    const source = await json(join(directory, names[2] + '.json'));
    assert.equal(source.commit, plan.commit, 'Source archive commit differs.');
    assert.equal(source.version, plan.version);
    assert.equal(source.historyIncluded, false);
    assert.equal(source.projectLicense, 'MIT');
  }
  const record = {schema: 1, platform, version: plan.version, commit: plan.commit, packageInstallation: true, files};
  await save(join(directory, 'build-' + platform + '.json'), record);
  return record;
}

export async function assembleCandidate(input, output, plan, runUrl = '') {
  const names = assetNames(plan.version);
  const sourceName = archiveNames(plan.version)[2] + '.json';
  assert.deepEqual((await readdir(input)).sort(), [...names, sourceName, 'build-win32.json', 'build-linux.json'].sort(), 'Unexpected or missing build artifacts.');
  const files = await checkedArchives(input, archiveNames(plan.version));
  for (const platform of ['win32', 'linux']) {
    const record = await json(join(input, 'build-' + platform + '.json'));
    assert.equal(record.schema, 1);
    assert.equal(record.platform, platform);
    assert.equal(record.version, plan.version);
    assert.equal(record.commit, plan.commit, 'Platform packages came from different commits.');
    assert.equal(record.packageInstallation, true);
    const expected = files.filter(file => platform === 'win32' ? file.name.includes('-windows.zip') : !file.name.includes('-windows.zip'));
    assert.deepEqual(record.files, expected, 'Build receipt does not match its archives.');
  }
  const source = await json(join(input, sourceName));
  assert.equal(source.commit, plan.commit, 'Source archive commit differs.');
  assert.equal(source.version, plan.version);
  assert.equal(source.historyIncluded, false);
  assert.equal(source.projectLicense, 'MIT');
  const base = `https://github.com/${repository}`;
  const body = plan.notes + `\n\n## Install or update\n\nDownload the Windows ZIP or Linux tar.gz and its adjacent SHA-256 file. Follow [INSTALL.md](${base}/blob/${plan.tag}/INSTALL.md). Node and the host CLIs are installed separately. The source ZIP is for development.\n\n` + (runUrl ? `Both platform builds, tests, package integrity and isolated installation checks passed in [GitHub Actions](${runUrl}).\n\n` : '') + 'MIT licensed; bundled dependencies retain their own license notices.\n';
  const candidate = {schema: 1, repository, version: plan.version, tag: plan.tag, commit: plan.commit, prerelease: plan.prerelease, name: 'ShellPigeon ' + plan.version, body, assets: files};
  await mkdir(output, {recursive: true});
  assert.deepEqual(await readdir(output), [], 'Candidate directory must be empty.');
  for (const file of files) await copyFile(join(input, file.name), join(output, file.name));
  await save(join(output, 'candidate.json'), candidate);
  return candidate;
}

export async function verifyCandidate(directory, plan) {
  const candidate = await json(join(directory, 'candidate.json'));
  assert.equal(candidate.schema, 1);
  assert.equal(candidate.repository, repository);
  for (const field of ['version', 'tag', 'commit', 'prerelease']) assert.equal(candidate[field], plan[field], 'Candidate ' + field + ' differs.');
  assert.equal(candidate.name, 'ShellPigeon ' + plan.version);
  assert.ok(typeof candidate.body === 'string' && candidate.body.trim());
  assert.deepEqual((await readdir(directory)).sort(), [...assetNames(plan.version), 'candidate.json'].sort());
  assert.deepEqual(candidate.assets, await checkedArchives(directory, archiveNames(plan.version)), 'Candidate files changed.');
  return candidate;
}

async function main() {
  const command = process.argv[2];
  const plan = await context();
  if (command === 'check') {
    console.log(JSON.stringify({version: plan.version, tag: plan.tag, commit: plan.commit, mode: plan.tagPush ? 'release-tag' : 'dry-run'}));
  } else if (command === 'record') {
    await recordBuild('artifacts/release', plan, process.platform, await json('artifacts/package-install-probe.json'));
  } else if (command === 'assemble') {
    const runUrl = process.env.GITHUB_RUN_ID ? `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';
    const candidate = await assembleCandidate('artifacts/release-parts', 'artifacts/release-candidate', plan, runUrl);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Release candidate **${candidate.tag}** verified: six assets from commit ${candidate.commit}.\n\n${plan.tagPush ? 'The next job may create a draft. Publication remains manual.' : 'Dry run only: no release or tag is created.'}\n`);
    console.log('Verified candidate: ' + candidate.tag);
  } else if (command === 'draft') {
    assert.equal(plan.tagPush, true, 'Draft creation requires a pushed release tag.');
    assert.equal(process.env.GITHUB_REPOSITORY, repository);
    const candidate = await verifyCandidate('artifacts/release-candidate', plan);
    const token = process.env.GH_TOKEN;
    assert.ok(token, 'The draft job needs its GITHUB_TOKEN.');
    const result = await createDraft(candidate, 'artifacts/release-candidate', githubClient(token));
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Release draft: [${candidate.tag}](${result.url})\n\nAll six assets are present. Review the draft and publish it manually on GitHub.\n`);
    console.log(JSON.stringify(result));
  } else throw new Error('Use check, record, assemble or draft.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {console.error(error.message); process.exitCode = 1;});
