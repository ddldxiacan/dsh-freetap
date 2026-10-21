import { createRequire } from "node:module";
import { join } from "node:path";
import { homedir } from "node:os";

//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function() {
	return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (all) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	return target;
};
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
var __require = /* @__PURE__ */ createRequire(import.meta.url);

//#endregion
//#region src/pool/rotate.ts
let delegate = null;
/** Install the runtime's rotate delegate (startIpPool). */
function setRotateDelegate(next) {
	delegate = next;
}
/** Ask the installed delegate; false when no pool is running. */
function shouldRotate(failure, model, session, attempt, deterministic = false) {
	return delegate?.decide(failure, model, session, attempt, deterministic) ?? false;
}
/** Map a pi-ai error message to the failure taxonomy (adapter-side parse). */
function classifyStreamFailure(errorMessage) {
	const text = errorMessage.toLowerCase();
	if (/\b429\b|rate.?limit|freeusagelimit/.test(text)) return "limited";
	if (/\b(?:401|403)\b/.test(text)) return "refused";
	if (/\b(?:network|connection|socket|fetch|terminated|premature close)\b|\beconn[a-z]+\b|timeout|timed out/.test(text)) return "transport";
	if (/\b5\d\d\b|internal server error|server error/.test(text)) return "transport";
	return null;
}
/** True when the error body names a deterministic region block (Zen's
*  RegionError): the exit's IP cannot serve this model — ban the pairing on
*  sight instead of collecting two samples (docs 4.2). */
function isRegionBlocked(errorMessage) {
	return /regionerror|not available in your country/i.test(errorMessage);
}
/**
* Build the runtime delegate over the live pool (ip-pool.ts assembly).
* Passive bookkeeping mirrors the dispatcher observer: the stream that died
* before content already recorded its verdict through the routing layer when
* it could see it — the sentinel covers the mute-connection case — so this
* delegate only breaks stickiness and checks whether a usable exit remains.
*/
function createRotateDelegate(pool, options = {}) {
	const maxAttempts = options.maxAttempts ?? 3;
	return { decide(failure, model, session, attempt, deterministic = false) {
		if (deterministic) {
			const failedExit = pool.exitOfSession(session);
			if (failedExit !== null) pool.markModelBanned(failedExit, model);
		}
		if (attempt > maxAttempts) return false;
		if (!pool.list().some((entry) => pool.isUsable(entry.id, model))) return false;
		pool.rerouteSession(session);
		return true;
	} };
}

//#endregion
//#region src/pool/subscription-defaults.ts
/** Shared by the host and browser; keep this module free of parser dependencies. */
const DEFAULT_SUBSCRIPTION_USER_AGENT = "clash-verge/v2.0";
function normalizeSubscriptionUserAgent(value) {
	return value?.trim() || DEFAULT_SUBSCRIPTION_USER_AGENT;
}

//#endregion
//#region src/data-dir.ts
/** Absolute data directory for the current user. */
function dataDir(home = homedir()) {
	return join(home, ".dsh-freetap");
}

//#endregion
export { createRotateDelegate as a, shouldRotate as c, __require as d, __toESM as f, classifyStreamFailure as i, __commonJS as l, DEFAULT_SUBSCRIPTION_USER_AGENT as n, isRegionBlocked as o, normalizeSubscriptionUserAgent as r, setRotateDelegate as s, dataDir as t, __export as u };