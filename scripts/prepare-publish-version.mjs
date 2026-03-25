import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const packageJsonPath = new URL("../package.json", import.meta.url);
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const currentVersion = packageJson.version;
const publishedVersion = readPublishedVersion(packageJson.name);
const nextVersion = resolveNextVersion(currentVersion, publishedVersion);

if (nextVersion !== currentVersion) {
	packageJson.version = nextVersion;
	writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, "\t")}\n`);
}

process.stdout.write(nextVersion);

function readPublishedVersion(packageName) {
	const override = process.env.PUBLISHED_VERSION;
	if (override) {
		return override.trim();
	}

	try {
		return execFileSync("npm", ["view", packageName, "version"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return undefined;
	}
}

function resolveNextVersion(currentVersion, publishedVersion) {
	if (!publishedVersion) {
		return currentVersion;
	}

	return compareVersions(currentVersion, publishedVersion) > 0 ? currentVersion : incrementPatch(publishedVersion);
}

function incrementPatch(version) {
	const [major, minor, patch] = parseVersion(version);
	return `${major}.${minor}.${patch + 1}`;
}

function compareVersions(left, right) {
	const leftParts = parseVersion(left);
	const rightParts = parseVersion(right);

	for (let index = 0; index < leftParts.length; index += 1) {
		if (leftParts[index] !== rightParts[index]) {
			return leftParts[index] - rightParts[index];
		}
	}

	return 0;
}

function parseVersion(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (!match) {
		throw new Error(`Unsupported package version: ${version}`);
	}

	return match.slice(1).map(value => Number.parseInt(value, 10));
}
