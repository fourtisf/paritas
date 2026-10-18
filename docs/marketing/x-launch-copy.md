# X launch copy (@useparitas)

Plain English, the site's own words. Every number comes from the landing page. Keep the eligibility line on every post: Stock Tokens are not for US persons.

Images are in `apps/web/public/brand/`:
- `paritas-x-profile.png`: profile photo.
- `paritas-x-header.png`: profile header (NVDA coin, USDG stream, receipt strip).
- `paritas-x-article-cover.png`: article cover, 5:2 (USDG ⇄ NVDA inside the swap arrows).

The "Swap settled" numbers in the images are an illustration. Replace them with a real fill after launch.

## Bio (141 / 160)

```
The best price on every stock token. Three venues, one ticket, a receipt for every trade. Coming soon on Robinhood Chain. Not for US persons.
```

## First post, with the video (190 / 280)

```
The best price on every stock token.

One ticket. Three venues. A price limit on every leg. A receipt for every trade.

Paritas. Coming soon on Robinhood Chain.

Not available to US persons.
```

Thread replies:

```
How it works: three venues quote every trade at once.

The Paritas vault quotes around the Chainlink share price. Uniswap pools trade around the clock. Market makers send signed quotes.

The cheapest one wins.
```

```
Every leg has a price limit. A fill outside the limit reverts, whichever venue quoted it.
```

```
Every trade prints a receipt: share price, spread, fees and the price you got. Every cost is on it.
```

```
Paritas is independent and not affiliated with Robinhood. Stock Tokens are not available in the United States or to US persons. Nothing here is investment advice.
```

## Post that shares the article (225 / 280)

```
What is Paritas?

Three venues quote every stock token trade at once. The cheapest one fills you, inside a hard price limit, with every cost printed on your receipt.

The full breakdown is below.

Not available to US persons.
```

## Article

Cover: `paritas-x-article-cover.png`. In the X editor, lines starting with ## become a Heading (Body ▾ → Heading). Every number below comes from `config/protocol.json` and `docs/BRIEF.md`; change them there first if they change.

**Title:** What is Paritas? How the best-price router for stock tokens works

Stock Tokens put shares like NVIDIA, Apple, Tesla and the S&P 500 on Robinhood Chain. You hold them in your own wallet and trade them against USDG, any time of day.

There is one catch. The same token can trade at different prices in different places. A pool can drift away from the real share price. A quote can hide its cost inside the number. And on a weekend, when the stock market is shut, prices can move a long way.

Paritas fixes that. It is a swap router for Stock Tokens. Every time you trade, it asks three venues for a price, picks the best one, checks it against the real share price, and gives you a receipt that shows every cost.

This article explains what Paritas is and how it works, step by step.

## Paritas in one minute

- **One ticket.** You choose a stock and a size. Paritas does the rest.
- **Three venues.** The Paritas vault, Uniswap pools and professional market makers all quote your trade.
- **The best mix.** The router fills you at the cheapest venue, or splits a large order across venues when that is cheaper.
- **A price limit on every leg.** No fill can settle too far from the Chainlink share price, on any venue.
- **A receipt for every trade.** Share price, spread, inventory adjustment and fee are printed before you sign and again on-chain.
- **Your wallet, your tokens.** Swaps settle from your wallet straight back to your wallet. There is no deposit account.

## How a trade works

1. **You size the trade.** Pick a market, say NVDAx, and how much USDG you want to spend, or how many tokens you want to sell.
2. **Three venues quote.** Paritas reads the vault's price, asks the Uniswap pool what it would pay and, for orders from $25,000, asks approved market makers for a signed quote.
3. **The router builds the route.** It compares what each venue would give you after all costs. The cheapest one wins. If an order is bigger than the vault's largest order, the router can fill part in the vault and the rest on another venue.
4. **You see everything before you sign.** The ticket shows every venue side by side, the route, each cost line and the minimum you will receive.
5. **One transaction settles it.** The router runs each leg, checks each one against the price limit, checks your minimum and sends the tokens to your wallet. If any check fails, the whole trade reverts and nothing moves.
6. **You get a receipt.** The trade emits one route event and one fill per leg, so anyone can check it on Blockscout.

## Venue 1: the Paritas vault

Each stock has its own vault. The vault holds the stock token and USDG, and quotes both sides around the Chainlink share price:

Your price = Share price + Spread × session ± Inventory + Fee

- **Share price.** The live Chainlink price for the stock, already adjusted for splits and dividends.
- **Spread.** What the vault charges for taking the other side. It depends on the market's tier: 0.10% on Tier A, 0.20% on Tier B and 0.40% on Tier C. It widens outside regular hours.
- **Inventory.** A nudge that keeps the vault balanced: up to 0.15% on Tier A. When your trade helps rebalance the vault, it works in your favour.
- **Fee.** A flat 0.02% protocol fee, the same on every venue.

The vault has one hard rule: it never sells below the share price and never buys above it. The inventory nudge can shrink the spread to zero, never past it.

Each vault also has a largest order. In regular hours it is 50,000 USDG on Tier A, 20,000 on Tier B and 5,000 on Tier C. Bigger orders go to the other venues, or are split.

## Venue 2: Uniswap pools

Uniswap pools are public and trade around the clock. They have no opening hours, so they carry trading on weekends and holidays while the vault is paused. Paritas routes into Uniswap v3 pools on Robinhood Chain and holds them to the same price limit as every other venue.

## Venue 3: market makers

For orders from $25,000 up to $2,000,000, approved market makers can send a signed quote. Each quote is:

- bound to your wallet, so nobody else can use it
- good for one use only
- valid for 30 seconds
- checked on-chain against the share price before it settles

The maker pays a 0.02% fee on its side. Your costs stay on your receipt.

## The price limit

The price limit is the most important safety rule in Paritas. Every leg of every trade is checked on-chain: its all-in cost against the share price, fee included, must stay inside the market's limit.

- **Tier A** (NVDAx, SPYx, AAPLx, QQQx, MSFTx): 0.75%
- **Tier B** (TSLAx, AMZNx): 1.50%
- **Tier C** (PLTRx): 3.00%

When the stock market is shut for a weekend or a holiday, the limit doubles, because the news keeps moving while the share price cannot. A fill outside the limit reverts, whichever venue quoted it. Your own minimum received is checked too, after fees. If either check fails, nothing moves.

## The receipt

Most venues bury their cost inside the price. Paritas prints each line separately:

- Share price (Chainlink)
- Spread
- Inventory adjustment
- Protocol fee
- Your price
- Price limit used

You see it before you sign. After the trade, the same numbers are in the fill events on-chain. Traders can check what they paid, and liquidity providers can check what they earned.

## The vault keeps Wall Street's hours

Share prices only move when the market does, so the vault follows the New York clock, holidays and early closes included:

- **Regular hours**, 9:30 to 16:00: the tightest spread and the full order size.
- **Extended hours**, 4:00 to 9:30 and 16:00 to 20:00: spread 1.5 times wider, largest order 75%.
- **Overnight**, 20:00 to 4:00 before a trading day: spread doubles, largest order halves.
- **Weekends and holidays**, Friday 20:00 to Sunday 20:00: the vault pauses. Uniswap pools and market makers keep filling.

## When Paritas stops quoting

Paritas would rather stop than guess. The vault stops quoting when:

- the Chainlink price is more than one hour old
- the Robinhood Chain sequencer is down, or came back less than an hour ago
- the token's issuer pauses its price for a corporate action, such as a split
- the market is closed

When only the vault is closed, Uniswap pools and market makers keep working, still held to the price limit.

## For liquidity providers: earn the spread, not emissions

Anyone eligible can deposit into a vault and earn the spread traders pay.

- **Real yield.** Returns come from the spread. There are no reward tokens and no points to farm. 90% of the spread stays in the vault and 10% goes to the protocol.
- **Fair deposits.** A deposit is priced like a trade, so nobody can farm a stale price.
- **Withdraw any time, in kind.** You get your share of both tokens back. The withdraw function has no pause switch: it works during a halt, a weekend, an oracle outage, or after a market is retired.
- **No weekend gaps.** The vault stops quoting when the market closes, so Monday-morning jumps cannot be traded against you.
- **Sized with care.** Each vault has a cap: 2.5 million USDG on Tier A, 1 million on Tier B and 400,000 on Tier C.

## Fees

- **Protocol fee:** 0.02% of the USDG side, on every venue.
- **Vault spread:** set by tier and session, shown on your receipt.
- **Market maker fee:** 0.02%, paid by the maker.
- **Network fee:** Robinhood Chain gas, usually a fraction of a cent.

## Safety you can check

- **You keep custody.** Swaps settle wallet to wallet, and the router holds nothing after a trade.
- **Changes wait in public.** Every parameter change waits 48 hours in a timelock run by a 3-of-5 multisig. Hard limits written into the contracts hold even for the timelock.
- **The guardian can only pause.** It cannot unpause, change parameters or move funds.
- **Tested math.** 61 contract tests, including fuzz tests for each core guarantee. The contracts, the app and an independent Python reference agree on 602 session cases and 200 vault-quote cases.
- **Open code.** Contracts and app are public. Once deployed, every contract will show verified source on Blockscout.
- **Audited before deposits open.** No vault accepts deposits until an independent audit is finished and published.

## Who can use Paritas

Stock Tokens are issued by Robinhood Assets (Jersey) Limited. They are tokenized debt securities that track the price of a listed share or ETF: you get price exposure, not voting rights. They are not available in the United States or to US persons, and are restricted in other regions.

Paritas checks this on-chain. Before your first trade, your wallet is verified once by a verification provider, and the check lasts 90 days.

## Markets

Paritas is built for eight markets to start: NVDAx, SPYx, AAPLx, QQQx, MSFTx, TSLAx, AMZNx and PLTRx.

## What's next

Paritas is not live yet. An independent audit comes first, then a full rehearsal on Robinhood Chain testnet, with trades across every venue and every session. Follow @useparitas for every step.

*Paritas is an independent interface and is not affiliated with, operated by or endorsed by Robinhood Markets, Inc. or its affiliates. Stock Tokens are tokenized debt securities issued by Robinhood Assets (Jersey) Limited. They are not available in the United States or to US persons and are restricted in other jurisdictions. Nothing here is investment advice.*
