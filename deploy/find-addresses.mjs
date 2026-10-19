// Fills deployments/4663.json from the issuers' official pages, and checks every address on-chain before proposing it.
// deploy/mainnet.sh runs it while addresses are still TODO. Nothing is written until you type YES.
//
//   node deploy/find-addresses.mjs <deployments/4663.json> <rpc url> <deployer address> <attester address>
//
// Where each address comes from (official sources only, fetched from this server):
//   USDG                 Paxos "USDG on Main Networks"
//   Uniswap v3           Uniswap "Robinhood Chain Deployments"
//   stock tokens, feeds  docs.robinhood.com/chain, Chainlink's feed directory and its Robinhood tokenized equities page
// What the chain must confirm before an address is proposed:
//   USDG          symbol() USDG and decimals() 6
//   stock token   symbol() is the ticker (NVDA or NVDAx), decimals(), and Robinhood's oraclePaused() and uiMultiplier()
//   feed          description() "<ticker> / USD", decimals(), and a positive latestRoundData() answer
//   Uniswap       the factory answers feeAmountTickSpacing(500) = 10; SwapRouter02 and QuoterV2 report that factory
//   Safe          getThreshold() and getOwners() match config/protocol.json (3 of 5)
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { createPublicClient, getAddress, http, isAddress, parseAbi } from "viem";

const [file, rpc, deployerArg, attesterArg] = process.argv.slice(2);
const deployer = getAddress(deployerArg);
const attester = getAddress(attesterArg);
const root = new URL("..", import.meta.url).pathname;
const cfg = JSON.parse(readFileSync(`${root}config/protocol.json`, "utf8"));
const dep = JSON.parse(readFileSync(file, "utf8"));
const EXPLORER = "https://robinhoodchain.blockscout.com/address/";
const client = createPublicClient({ transport: http(rpc) });

// Test runs point these at local copies (PARITAS_SOURCE_<NAME>); production always uses the official URLs.
const src = (name, url) => process.env[`PARITAS_SOURCE_${name}`] ?? url;
const PAXOS = src("PAXOS", "https://docs.paxos.com/guides/stablecoin/usdg/mainnet");
const UNISWAP = src("UNISWAP", "https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments");
const ROBINHOOD = src("ROBINHOOD", "https://docs.robinhood.com/chain/");
const ROBINHOOD_PAGES = ["stock-token-apis/", "building-with-stock-tokens/", "oracles-and-price-feeds/", "protocol-contracts/"];
const CHAINLINK_JSON = src("CHAINLINK_JSON", "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json");
const CHAINLINK_PAGE = src("CHAINLINK_PAGE", "https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood");

const ADDR = /0x[0-9a-fA-F]{40}/g;
const say = (s = "") => console.log(s);
const fail = (msg) => {
  console.error(`${msg} Nothing was written.`);
  process.exit(1);
};
const problems = [];

async function fetchText(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": "paritas-deploy" }, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch (e) {
    say(`  could not open ${url}: ${e.message}`);
    return "";
  }
}
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
const addressesIn = (s) => [...new Set((s.match(ADDR) ?? []).map((a) => getAddress(a.toLowerCase())))];

// on-chain reads that return undefined instead of throwing
async function read(address, sig, args = []) {
  const name = sig.match(/function (\w+)/)[1];
  try {
    return await client.readContract({ address, abi: parseAbi([sig]), functionName: name, args });
  } catch {
    return undefined;
  }
}
const hasCode = async (a) => ((await client.getCode({ address: a }).catch(() => undefined)) ?? "0x") !== "0x";

// ------------------------------------------------------------------ sources
say("Opening the official pages from this server:");
const paxosHtml = await fetchText(PAXOS);
const uniHtml = await fetchText(UNISWAP);
const rhPages = [ROBINHOOD, ...ROBINHOOD_PAGES.map((p) => new URL(p, ROBINHOOD).href)];
let rhHtml = "";
for (const u of rhPages) rhHtml += await fetchText(u);
// follow links to other token or contract pages of the same docs (the token list page)
for (const m of rhHtml.matchAll(/href="([^"#]*\/chain\/[^"#]*(?:token|contract)[^"#]*)"/gi)) {
  const u = new URL(m[1], ROBINHOOD).href;
  if (!rhPages.includes(u) && rhPages.length < 20) {
    rhPages.push(u);
    rhHtml += await fetchText(u);
  }
}
const clJsonText = await fetchText(CHAINLINK_JSON);
const clPage = await fetchText(CHAINLINK_PAGE);
let clFeeds = [];
try {
  clFeeds = JSON.parse(clJsonText);
} catch {}
say(`  found ${addressesIn(paxosHtml).length} addresses at Paxos, ${addressesIn(uniHtml).length} at Uniswap, ${addressesIn(rhHtml).length} in the Robinhood docs, ${clFeeds.length} Chainlink directory entries`);

// ------------------------------------------------------------------ USDG
const found = {};
const usdgCandidates = [];
for (const a of addressesIn(paxosHtml)) {
  if ((await read(a, "function symbol() view returns (string)")) === "USDG" && Number(await read(a, "function decimals() view returns (uint8)")) === 6) usdgCandidates.push(a);
}
if (usdgCandidates.length === 1) found.usdg = usdgCandidates[0];
else problems.push(usdgCandidates.length ? `USDG: ${usdgCandidates.length} contracts on the Paxos page answer as USDG with 6 decimals: ${usdgCandidates.join(", ")}` : "USDG: no address on the Paxos page answers as USDG with 6 decimals on Robinhood Chain");

// ------------------------------------------------------------------ Uniswap
const uniText = textOf(uniHtml);
const after = (label) => {
  const i = uniText.search(new RegExp(`\\b${label}\\b`));
  if (i < 0) return undefined;
  const m = uniText.slice(i, i + 400).match(/0x[0-9a-fA-F]{40}/);
  return m ? getAddress(m[0].toLowerCase()) : undefined;
};
const factory = after("UniswapV3Factory");
const router02 = after("SwapRouter02");
const quoter = after("QuoterV2");
if (factory && Number(await read(factory, "function feeAmountTickSpacing(uint24) view returns (int24)", [500])) === 10) found.factory = factory;
else problems.push(`Uniswap V3 Factory: ${factory ? `${factory} does not answer as a v3 factory` : "not found on the Uniswap page"}`);
const factoryOf = (a) => read(a, "function factory() view returns (address)");
if (router02 && found.factory && (await factoryOf(router02)) === found.factory && (await read(router02, "function factoryV2() view returns (address)")) !== undefined) found.router02 = router02;
else problems.push(`Uniswap SwapRouter02: ${router02 ? `${router02} does not report the v3 factory` : "not found on the Uniswap page"}`);
if (quoter && found.factory && (await factoryOf(quoter)) === found.factory && (await read(quoter, "function name() view returns (string)")) === undefined) found.quoter = quoter;
else problems.push(`Uniswap QuoterV2: ${quoter ? `${quoter} does not report the v3 factory` : "not found on the Uniswap page"}`);

// ------------------------------------------------------------------ stock tokens and feeds
const pool = [...new Set([...addressesIn(rhHtml), ...addressesIn(clPage), ...clFeeds.flatMap((f) => [f.proxyAddress, f.contractAddress].filter((x) => x && isAddress(x)).map((x) => getAddress(x.toLowerCase())))])];
const tokens = [];
const feeds = [];
for (const a of pool) {
  if (!(await hasCode(a))) continue;
  const sym = await read(a, "function symbol() view returns (string)");
  if (sym !== undefined) {
    const paused = await read(a, "function oraclePaused() view returns (bool)");
    const mult = await read(a, "function uiMultiplier() view returns (uint256)");
    if (paused !== undefined && mult !== undefined) tokens.push({ a, sym, mult, dec: Number(await read(a, "function decimals() view returns (uint8)")) });
    continue;
  }
  const desc = await read(a, "function description() view returns (string)");
  if (desc !== undefined) {
    const round = await read(a, "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)");
    feeds.push({ a, desc, dec: Number(await read(a, "function decimals() view returns (uint8)")), answer: round?.[1], updatedAt: round?.[3], startedAt: round?.[2] });
  }
}
const tickerOf = (s) => s.toUpperCase().replace(/X$/, "");
const now = (await client.getBlock()).timestamp; // chain time, as the feeds use
const markets = {};
for (const m of cfg.markets) {
  const t = tickerOf(m.symbol);
  const tk = tokens.filter((x) => tickerOf(x.sym) === t);
  const fd = feeds.filter((x) => {
    const base = x.desc.split("/")[0]?.trim() ?? "";
    return /\/\s*USD\b/i.test(x.desc) && tickerOf(base) === t && x.answer !== undefined && x.answer > 0n;
  });
  // with more than one feed, prefer the one named after the token's own symbol ("NVDAx / USD" for NVDAx)
  const fdPick = fd.length > 1 && tk.length === 1 ? fd.filter((x) => x.desc.split("/")[0].trim() === tk[0].sym) : fd;
  if (tk.length !== 1) problems.push(`${m.symbol} token: ${tk.length ? `${tk.length} Robinhood stock tokens answer as ${t}: ${tk.map((x) => `${x.a} (${x.sym})`).join(", ")}` : "no Robinhood stock token for this ticker on the official pages"}`);
  if (fdPick.length !== 1) problems.push(`${m.symbol} feed: ${fdPick.length ? `${fdPick.length} feeds for ${t} / USD: ${fdPick.map((x) => `${x.a} (${x.desc})`).join(", ")}` : `no live "${t} / USD" feed on the official pages`}`);
  if (tk.length === 1 && fdPick.length === 1) {
    const meta = clFeeds.find((f) => f.proxyAddress && f.proxyAddress.toLowerCase() === fdPick[0].a.toLowerCase());
    markets[m.symbol] = { token: tk[0], feed: fdPick[0], heartbeat: Number(meta?.heartbeat ?? 0) };
  }
}

// ------------------------------------------------------------------ sequencer uptime feed
const seq = feeds.filter((x) => /sequencer|uptime/i.test(x.desc) && (x.answer === 0n || x.answer === 1n));
const seqMeta = clFeeds.filter((f) => /sequencer|uptime/i.test(`${f.name ?? ""} ${f.feedType ?? ""}`) && f.proxyAddress);
let sequencer = seq.length === 1 ? seq[0].a : seqMeta.length === 1 ? getAddress(seqMeta[0].proxyAddress.toLowerCase()) : undefined;

// ------------------------------------------------------------------ report what the pages and the chain gave
say();
say("Checked on-chain:");
const row = (k, a, note = "") => say(`  ${k.padEnd(26)} ${a ?? "-".padEnd(42)}  ${note}`);
row("USDG", found.usdg, found.usdg ? "symbol USDG, 6 decimals" : "");
row("Uniswap V3 Factory", found.factory, found.factory ? "fee 500 -> tick spacing 10" : "");
row("Uniswap SwapRouter02", found.router02, found.router02 ? "factory() matches" : "");
row("Uniswap QuoterV2", found.quoter, found.quoter ? "factory() matches" : "");
for (const m of cfg.markets) {
  const x = markets[m.symbol];
  if (!x) continue;
  const age = x.feed.updatedAt ? `${(Number(now - x.feed.updatedAt) / 3600).toFixed(1)}h old` : "";
  row(`${m.symbol} token`, x.token.a, `${x.token.sym}, ${x.token.dec} decimals, uiMultiplier ${x.token.mult}`);
  row(`${m.symbol} feed`, x.feed.a, `"${x.feed.desc}", ${x.feed.dec} decimals, ${Number(x.feed.answer) / 10 ** x.feed.dec} USD, ${age}`);
  if (x.token.mult !== 10n ** 18n) problems.push(`${m.symbol}: uiMultiplier is ${x.token.mult}, not 1e18. Decide useUiMultiplier with Michael before deploying (docs/VERIFY_ON_CHAIN.md).`);
  if (found.factory && found.usdg) {
    const p = await read(found.factory, "function getPool(address,address,uint24) view returns (address)", [found.usdg, x.token.a, m.uniswapPoolFee]);
    if (!p || /^0x0{40}$/i.test(p)) say(`  ${"".padEnd(26)} note: no Uniswap USDG/${m.symbol} pool at fee ${m.uniswapPoolFee}; that market routes through the vault and makers only`);
  }
}
row("Sequencer uptime feed", sequencer, sequencer ? "Chainlink L2 sequencer feed" : "");

if (problems.length) {
  say();
  say("Not proposed (the official pages and the chain do not agree):");
  for (const p of problems) say(`  - ${p}`);
  say();
  say("Nothing was written. Send this output to be fixed, or fill those entries in deployments/4663.json by hand.");
  process.exit(1);
}

// ------------------------------------------------------------------ roles you choose
// read answers line by line from the iterator, so none is lost when they arrive together
const rl = createInterface({ input: process.stdin });
const lines = rl[Symbol.asyncIterator]();
const ask = async (q) => {
  process.stdout.write(q);
  const { value } = await lines.next();
  return (value ?? "").trim();
};
if (!sequencer) {
  const a = await ask("No Chainlink sequencer uptime feed was found for Robinhood Chain. Deploy without one (DECISIONS #10)? Type YES: ");
  if (a !== "YES") fail("Stopped.");
  sequencer = "0x0000000000000000000000000000000000000000";
}
const g = cfg.governance;
const safeIn = await ask(`Address of your Safe on Robinhood Chain (${g.multisigThreshold}-of-${g.multisigSigners}): `);
if (!isAddress(safeIn)) fail("That is not an address.");
const safe = getAddress(safeIn);
const threshold = await read(safe, "function getThreshold() view returns (uint256)");
const owners = await read(safe, "function getOwners() view returns (address[])");
if (threshold === undefined || owners === undefined) fail(`${safe} is not a Safe on Robinhood Chain.`);
if (Number(threshold) !== g.multisigThreshold || owners.length !== g.multisigSigners) {
  fail(`The Safe is ${threshold}-of-${owners.length}; config/protocol.json asks for ${g.multisigThreshold}-of-${g.multisigSigners}.`);
}
say(`  Safe ${safe}: ${threshold}-of-${owners.length}, owners ${owners.join(", ")}`);
const guardianIn = await ask("Guardian address (a wallet that may only pause; not the deployer): ");
if (!isAddress(guardianIn)) fail("That is not an address.");
const guardian = getAddress(guardianIn);
if (guardian === deployer) fail("The guardian must not be the deployer wallet.");
const treasuryIn = await ask(`Treasury address for fees (Enter for the Safe ${safe}): `);
const treasury = treasuryIn ? getAddress(treasuryIn) : safe;

// ------------------------------------------------------------------ confirm and write
say();
say("Open any line on Blockscout to check it yourself:");
say(`  ${EXPLORER}${found.usdg}`);
for (const m of cfg.markets) say(`  ${EXPLORER}${markets[m.symbol].token.a}   ${EXPLORER}${markets[m.symbol].feed.a}`);
say(`  ${EXPLORER}${safe}`);
const yes = await ask("Type YES to write these addresses into deployments/4663.json: ");
rl.close();
if (yes !== "YES") {
  say("Nothing was written.");
  process.exit(1);
}
dep.external.usdg.address = found.usdg;
dep.external.uniswapV3SwapRouter02.address = found.router02;
dep.external.uniswapV3Factory.address = found.factory;
dep.external.uniswapQuoterV2.address = found.quoter;
dep.external.sequencerUptimeFeed.address = sequencer;
for (const m of cfg.markets) {
  const s = dep.external.stocks[m.symbol];
  s.token = markets[m.symbol].token.a;
  s.chainlinkFeed = markets[m.symbol].feed.a;
  s.feedHeartbeatSec = markets[m.symbol].heartbeat;
}
dep.roles.multisig = safe;
dep.roles.guardian = guardian;
dep.roles.attester = attester;
dep.roles.treasury = treasury;
writeFileSync(file, JSON.stringify(dep, null, 2) + "\n");
say(`Written to ${file}.`);
