import Image from "next/image";
import { PROTOCOL, SESSION_PARAMS, TIERS } from "@paritas/shared";
import "@/styles/landing.css";
import { LandingCanvas } from "@/components/three/LandingCanvas";
import { Effects } from "@/components/landing/Effects";
import { ExampleReceipt } from "@/components/landing/ExampleReceipt";
import { HoursNow, TzName, Week } from "@/components/landing/Hours";
import { LiveList } from "@/components/landing/LiveList";
import { SealMark } from "@/components/brand/Seal";
import { Marquee } from "@/components/landing/Marquee";
import { Nav } from "@/components/landing/Nav";
import { Poster } from "@/components/landing/Poster";
import { QuoteCard } from "@/components/landing/QuoteCard";
import { RouterLab } from "@/components/landing/RouterLab";
import { VaultCards } from "@/components/landing/VaultCards";
import { pct, usd } from "@/components/landing/format";
import { CHAIN_ID } from "@/lib/env";
import { loadDeployment } from "@/lib/deployment.server";
import { X_URL } from "@/lib/links";
import appPreview from "@/components/landing/app-preview.jpg";

/**
 * Landing page, ported 1:1 from prototypes/paritas-landing.html: same ids, classes and data-pose attributes, so
 * three/landing-scene.js drives the camera exactly as in the prototype. Links into the app are plain <a> on purpose
 * (landing.css and the platform CSS share class names). Numbers in the copy come from config/protocol.json.
 */
const FEE = pct(PROTOCOL.fees.protocolFeeBps);
const ext = SESSION_PARAMS.extended, ovn = SESSION_PARAMS.overnight;
const wider = (mulBps: number) => (mulBps === 20_000 ? "doubles" : `${mulBps / 10_000} times wider`);
const clip = (mulBps: number) => (mulBps === 5_000 ? "halves" : `drops to ${mulBps / 100}%`);
const TIMELOCK_HOURS = PROTOCOL.governance.timelockDelaySec / 3600;

const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
);

export default async function Landing() {
  const testFeeds = (await loadDeployment(CHAIN_ID)).deployment?.mocks === true;
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true"><defs><linearGradient id="silver" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset=".5" stopColor="#B8B8C0" /><stop offset="1" stopColor="#6C6C76" /></linearGradient></defs></svg>

      <LandingCanvas />
      <Poster />
      <div className="veil" aria-hidden="true"></div>

      <Nav logo={<SealMark paint="url(#silver)" className="js-mark" />} />

      <div className="page">
        <main id="main">
          <section className="hero" id="top" data-pose="hero">
            <div className="hero-shade" aria-hidden="true"></div>
            <div className="wrap">
              <div className="hero-grid">
                <div>
                  <p className="tagline"><span className="pulse" aria-hidden="true"></span>Stock Tokens on Robinhood Chain</p>
                  <h1 className="disp h1">The best price on every stock token.</h1>
                  <p className="lede">Paritas checks an oracle-priced vault, Uniswap and professional market makers on every trade, then fills you at whichever is cheapest. Every cost is printed on your receipt.</p>
                  <div className="actions">
                    <a className="btn btn-w" href="/app/trade">Launch app<Arrow /></a>
                    <a className="btn btn-g" href="#quote">Get a quote</a>
                  </div>
                </div>
                <LiveList />
              </div>
              <p className="scroll-cue"><i aria-hidden="true"></i>Scroll to follow a trade through the router</p>
            </div>
          </section>

          <Marquee testFeeds={testFeeds} />

          <section className="section" id="quote" data-pose="quote">
            <div className="wrap q-grid">
              <div>
                <p className="idx">01 · Quote</p>
                <h2 className="disp h2">One ticket. Three venues.</h2>
                <p className="lede" style={{ marginTop: 20 }}>Type an amount and watch all three venues price it at once. The best one wins, and the ticket shows exactly why.</p>
                <ul className="vlegend">
                  <li className="glass" data-v="vault"><span className="vd"></span><div><h3 className="h3">Paritas vault</h3><p>Quotes both sides around the Chainlink share price. Usually best for everyday sizes while the US market is open.</p></div></li>
                  <li className="glass" data-v="pool"><span className="vd"></span><div><h3 className="h3">Uniswap pools</h3><p>Public pools that trade around the clock. They carry the weekend while the vault is paused.</p></div></li>
                  <li className="glass" data-v="rfq"><span className="vd"></span><div><h3 className="h3">Market makers</h3><p>Signed quotes for orders from {usd(PROTOCOL.rfq.minUsd)}, checked on-chain against the share price before they settle.</p></div></li>
                </ul>
              </div>
              <QuoteCard />
            </div>
          </section>

          <section className="section" id="router" data-pose="router">
            <div className="wrap">
              <div className="sh center">
                <p className="idx">02 · Router</p>
                <h2 className="disp h2">Drag the size. Watch the winner change.</h2>
                <p className="lede">The vault wins everyday trades while the market is open, makers win blocks, and Uniswap carries the weekend. The router checks all three on every quote.</p>
              </div>
              <RouterLab />
              <ol className="flow">
                <li><h3 className="h3">Quote</h3><p>The vault prices from Chainlink, the router reads Uniswap, and makers sign their quotes.</p></li>
                <li><h3 className="h3">Compare</h3><p>The router picks the route that gives you the most tokens or the most USDG.</p></li>
                <li><h3 className="h3">Check</h3><p>The fill must sit inside the price limit, your slippage and your deadline.</p></li>
                <li><h3 className="h3">Settle</h3><p>Everything clears in one transaction. If any check fails, nothing moves.</p></li>
              </ol>
            </div>
          </section>

          <section className="section" id="receipt" data-pose="receipt">
            <div className="wrap rcv">
              <div>
                <p className="idx">03 · Receipt</p>
                <h2 className="disp h2">A receipt for every trade.</h2>
                <p className="lede" style={{ margin: "20px 0 36px" }}>Most venues bury their cost inside the price. Paritas prints each line separately, before you sign and again in the fill event on-chain.</p>
                <div className="formula" aria-label="Your price equals share price plus spread times session plus or minus inventory plus fee"><span className="fx res">Your price</span><span className="op">=</span><span className="fx">Share price</span><span className="op">+</span><span className="fx">Spread × session</span><span className="op">±</span><span className="fx">Inventory</span><span className="op">+</span><span className="fx">Fee</span></div>
                <dl className="defs">
                  <div className="def"><dt>Share price</dt><dd>The live Chainlink price for the stock, already adjusted for splits and dividends.</dd></div>
                  <div className="def"><dt>Spread × session</dt><dd>What the vault charges for taking the other side. It widens outside regular hours, when prices are thinner.</dd></div>
                  <div className="def"><dt>Inventory</dt><dd>A nudge of up to {pct(TIERS.A.skewBps)} that keeps the vault balanced. When your trade helps rebalance it, it works in your favour.</dd></div>
                  <div className="def"><dt>Fee</dt><dd>A flat {FEE} on every swap, whichever venue fills it.</dd></div>
                </dl>
                <div className="limit glass"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3.5 5 6.5v5c0 4.2 2.9 7.6 7 8.8 4.1-1.2 7-4.6 7-8.8v-5l-7-3Z" /><path d="M8.5 12h7" /></svg><p><strong>A hard price limit.</strong> On Tier A markets no fill can settle more than {pct(TIERS.A.bandBps)} from the share price, on any venue. If a feed goes stale, a corporate action is pending or the sequencer is down, quoting stops instead of guessing.</p></div>
              </div>
              <ExampleReceipt />
            </div>
          </section>

          <section className="section" id="hours" data-pose="hours">
            <div className="wrap">
              <div className="sh right">
                <p className="idx">04 · Hours</p>
                <h2 className="disp h2">The vault keeps Wall Street&apos;s hours.</h2>
                <p className="lede">Share prices only move when the market does, so the vault follows the same clock. This is the current week in your time zone, <TzName />.</p>
              </div>
              <HoursNow />
              <Week />
              <div className="legend">
                <div className="leg glass" data-r="regular"><div className="leg-h"><i></i><h3 className="h3">Regular hours</h3></div><p>Tightest vault spread and the full order size.</p><p className="small">9:30 to 16:00 New York</p></div>
                <div className="leg glass" data-r="extended"><div className="leg-h"><i></i><h3 className="h3">Extended</h3></div><p>Spread {wider(ext.spreadMulBps)}. Largest order {clip(ext.clipMulBps)}.</p><p className="small">4:00 to 9:30 and 16:00 to 20:00</p></div>
                <div className="leg glass" data-r="overnight"><div className="leg-h"><i></i><h3 className="h3">Overnight</h3></div><p>Spread {wider(ovn.spreadMulBps)} and the largest order {clip(ovn.clipMulBps)}.</p><p className="small">20:00 to 4:00, Sunday to Friday</p></div>
                <div className="leg glass" data-r="weekend"><div className="leg-h"><i></i><h3 className="h3">Weekend</h3></div><p>The vault pauses. Uniswap and makers keep filling.</p><p className="small">Friday 20:00 to Sunday 20:00</p></div>
              </div>
            </div>
          </section>

          <section className="section" id="app-preview" data-pose="app">
            <div className="wrap">
              <div className="sh center">
                <p className="idx">05 · App</p>
                <h2 className="disp h2">A trading terminal for stock tokens.</h2>
                <p className="lede">Watchlist, chart, venue ladder and ticket on one screen. Size the trade and see exactly where each venue would fill you before you sign.</p>
              </div>
              <div className="pv">
                <figure className="frame" id="frame">
                  <div className="frame-in">
                    <div className="frame-bar"><i></i><i></i><i></i><span>Paritas App</span></div>
                    <Image src={appPreview} width={1680} height={1050} alt="The Paritas trading terminal: market watchlist, SPYx price chart, venue ladder and swap ticket" sizes="(max-width: 1240px) 100vw, 1184px" />
                  </div>
                </figure>
              </div>
              <div className="feats">
                <div className="feat glass"><span className="feat-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 17.5 9 12l3.5 3.5L20 7" /><path d="M15 7h5v5" /></svg></span><h3 className="h3">Every venue in view</h3><p>The ladder shows where the vault, Uniswap and makers would fill you, inside the price limit.</p></div>
                <div className="feat glass"><span className="feat-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3.5s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z" /></svg></span><h3 className="h3">Pool without guesswork</h3><p>Capacity, inventory balance and spread returns for each vault, with withdrawals that never pause.</p></div>
                <div className="feat glass"><span className="feat-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 3.5h10a1 1 0 0 1 1 1V20l-2.5-1.5L13 20l-2.5-1.5L8 20l-2-1.5V4.5a1 1 0 0 1 1-1Z" /><path d="M9 8h6M9 11.5h6M9 15h3" /></svg></span><h3 className="h3">Receipts for every fill</h3><p>Open any trade on the venue to see its share price, each cost line, the venue and the block.</p></div>
              </div>
              <div className="ctr"><a className="btn btn-w" href="/app/trade">Launch app<Arrow /></a></div>
            </div>
          </section>

          <section className="section" id="vaults" data-pose="vaults">
            <div className="wrap lp">
              <div>
                <p className="idx">06 · Vaults</p>
                <h2 className="disp h2">Earn the spread, not emissions.</h2>
                <p className="lede" style={{ marginTop: 20 }}>Vault returns come from the spread traders pay. There are no reward tokens and no points to farm.</p>
                <ul className="lp-pts">
                  <li><b>Withdraw any time, in kind.</b>Halted, paused or retired, the withdraw button still works. You get your share of both tokens back.</li>
                  <li><b>Weekend gaps are not yours to absorb.</b>The vault stops quoting when the market closes, so Monday-morning jumps cannot be traded against you.</li>
                  <li><b>Every fill is itemized.</b>Mid, spread, inventory adjustment and fee are logged on-chain, so you can check what your vault earned.</li>
                </ul>
                <div className="actions"><a className="btn btn-g" href="/app/pool">Explore the vaults</a></div>
              </div>
              <VaultCards />
            </div>
          </section>

          <section className="section" id="safety" data-pose="safety">
            <div className="wrap">
              <div className="sh">
                <p className="idx">07 · Safety</p>
                <h2 className="disp h2">Promises you can check.</h2>
                <p className="lede">Each one is enforced by the contracts, not a policy page, and each comes with a way to verify it yourself.</p>
              </div>
              <div className="prom">
                <div className="pr glass"><span className="glare"></span><span className="feat-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2.2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></svg></span><h3 className="h3">You keep custody</h3><p>Swaps settle from your wallet straight back to your wallet. There is no deposit account to top up.</p><p className="chk"><b>Check it:</b> open any fill on Blockscout and follow the transfers.</p></div>
                <div className="pr glass"><span className="glare"></span><span className="feat-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 12h16M4 7h16M4 17h16" strokeDasharray="2 3" /><path d="M12 4v16" /></svg></span><h3 className="h3">Prices stay near the share</h3><p>A fill outside the tier&apos;s price limit reverts, whichever venue quoted it.</p><p className="chk"><b>Check it:</b> the limit lives in the router contract and its invariant tests.</p></div>
                <div className="pr glass"><span className="glare"></span><span className="feat-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" /></svg></span><h3 className="h3">Withdrawals never pause</h3><p>Not by governance, not by the guardian, not during a halt or after a market is retired.</p><p className="chk"><b>Check it:</b> the vault&apos;s withdraw function has no pause switch.</p></div>
                <div className="pr glass"><span className="glare"></span><span className="feat-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></svg></span><h3 className="h3">Changes wait in public</h3><p>Spreads, limits and fees only change after a {TIMELOCK_HOURS}-hour timelock, visible before they apply.</p><p className="chk"><b>Check it:</b> queued changes appear on the app&apos;s governance timeline.</p></div>
                <div className="pr glass"><span className="glare"></span><span className="feat-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 8-4 4 4 4m6-8 4 4-4 4" /></svg></span><h3 className="h3">The code is open</h3><p>Contracts and app are public, and the deployed bytecode is matched to the published source.</p><p className="chk"><b>Check it:</b> every contract shows verified source on Blockscout.</p></div>
                <div className="pr glass"><span className="glare"></span><span className="feat-i"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 4h7l4 4v12H7z" /><path d="M14 4v4h4M10 13l1.6 1.6L15 11" /></svg></span><h3 className="h3">Audited before deposits open</h3><p>No vault accepts deposits until an independent audit is finished and published.</p><p className="chk"><b>Check it:</b> the reports will be linked from this page.</p></div>
              </div>
            </div>
          </section>

          <section className="section" id="faq" data-pose="faq">
            <div className="wrap faq-g">
              <div><p className="idx">08 · FAQ</p><h2 className="disp h2">Plain answers.</h2><p className="lede" style={{ marginTop: 20 }}>Something missing? The docs cover every parameter and contract.</p></div>
              <div className="faq">
                <details className="glass"><summary>Who can use Paritas?<span className="pm" aria-hidden="true"></span></summary><p className="ans">Anyone outside the United States and other restricted regions who holds USDG or Stock Tokens in their own wallet. Stock Tokens are not available to US persons.</p></details>
                <details className="glass"><summary>What are Stock Tokens?<span className="pm" aria-hidden="true"></span></summary><p className="ans">Tokens issued by Robinhood Assets (Jersey) Limited that track the price of a listed share or ETF. They are tokenized debt securities: you get price exposure, not voting rights in the company.</p></details>
                <details className="glass"><summary>Why does the vault pause on weekends?<span className="pm" aria-hidden="true"></span></summary><p className="ans">The stock market is closed, so the Chainlink price stops moving while the news does not. Pausing protects liquidity providers from Monday-morning gaps. Uniswap pools and market makers keep filling your trades in the meantime.</p></details>
                <details className="glass"><summary>What does a swap cost?<span className="pm" aria-hidden="true"></span></summary><p className="ans">The venue&apos;s spread plus a {FEE} protocol fee, both on the receipt before you sign. Network fees on Robinhood Chain are usually a fraction of a cent.</p></details>
                <details className="glass"><summary>Do I need an account?<span className="pm" aria-hidden="true"></span></summary><p className="ans">No sign-up and no deposit. Connect a wallet, get a quote, swap, and leave whenever you like.</p></details>
                <details className="glass"><summary>Is Paritas part of Robinhood?<span className="pm" aria-hidden="true"></span></summary><p className="ans">No. Paritas is an independent app built on Robinhood Chain. Robinhood does not operate or endorse it.</p></details>
              </div>
            </div>
          </section>

          <section className="cta" id="launch" data-pose="cta">
            <div className="wrap">
              <h2 className="disp h2">Get the best of three, every time.</h2>
              <p className="lede">Connect a wallet and see the vault, Uniswap and makers side by side in seconds.</p>
              <div className="actions"><a className="btn btn-w" href="/app/trade">Launch app<Arrow /></a><a className="btn btn-g" href="#faq">Read the FAQ</a></div>
            </div>
          </section>
        </main>

        <footer className="footer">
          <div className="wrap">
            <div className="foot">
              <a className="logo" href="#top" aria-label="Paritas home"><SealMark paint="url(#silver)" className="js-mark" /><b>Paritas</b></a>
              <ul className="foot-l"><li><a href="/app/trade">App</a></li><li><a href="#faq">FAQ</a></li><li><a href={X_URL} target="_blank" rel="noopener noreferrer">X</a></li><li><a href="#">Blockscout</a></li><li><a href="mailto:hello@example.com">Contact</a></li></ul>
            </div>
            <p className="disc">Paritas is an independent interface and is not affiliated with, operated by or endorsed by Robinhood Markets, Inc. or its affiliates. Company names and logos belong to their owners and only identify the stock behind each token. Stock Tokens are tokenized debt securities issued by Robinhood Assets (Jersey) Limited. They are not available in the United States or to US persons and are restricted in other jurisdictions. Prices on this page come from Chainlink and Uniswap and are for information only. Nothing here is investment advice. Trading tokenized securities carries risk, including loss of the amount you trade.</p>
          </div>
        </footer>
      </div>
      <Effects />
    </>
  );
}
