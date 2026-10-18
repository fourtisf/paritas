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

Cover: `paritas-x-article-cover.png`. In the X editor, lines starting with ## become a Heading (Body ▾ → Heading).

**Title:** What is Paritas?

Stock Tokens bring shares like NVIDIA, Apple and Tesla to Robinhood Chain. You trade them from your own wallet, with no sign-up and no deposit account. But the same token can trade at different prices in different places. Paritas is a swap router that checks those places for you and fills you at the best one.

## One ticket. Three venues.

Every trade on Paritas is quoted by three venues at once:

- **Paritas vault.** Quotes both sides around the Chainlink share price. Usually best for everyday sizes while the US market is open.
- **Uniswap pools.** Public pools that trade around the clock. They carry the weekend while the vault is paused.
- **Market makers.** Signed quotes for orders from $25k, checked on-chain against the share price before they settle.

You see every venue side by side before you sign. The cheapest one fills you.

## Every leg has a price limit.

Each market has a hard price limit around the share price. On Tier A markets, no fill can settle more than 0.75% from the share price, on any venue. A fill outside the limit reverts, whichever venue quoted it. If a feed goes stale, a corporate action is pending or the sequencer is down, quoting stops instead of guessing.

## A receipt for every trade.

Most venues bury their cost inside the price. Paritas prints each line separately, before you sign and again on-chain:

- **Share price.** The live Chainlink price for the stock, already adjusted for splits and dividends.
- **Spread.** What the vault charges for taking the other side. It widens outside regular hours.
- **Inventory.** A nudge of up to 0.15% that keeps the vault balanced. When your trade helps rebalance it, it works in your favour.
- **Fee.** A flat 0.02% on every swap, whichever venue fills it.

## The vault keeps Wall Street's hours.

Share prices only move when the market does, so the vault follows the same clock:

- **Regular hours** (9:30 to 16:00 New York): tightest spread and the full order size.
- **Extended** (4:00 to 9:30 and 16:00 to 20:00): spread 1.5 times wider, largest order 75%.
- **Overnight** (20:00 to 4:00, Sunday to Friday): spread doubles, largest order halves.
- **Weekend:** the vault pauses. Uniswap and market makers keep filling.

## Earn the spread, not emissions.

Liquidity providers earn the spread traders pay. There are no reward tokens and no points to farm. You can withdraw any time, in kind, even when a market is halted, paused or retired. The vault stops quoting when the market closes, so Monday-morning gaps cannot be traded against you.

## Promises you can check.

Each one is enforced by the contracts, not a policy page:

- **You keep custody.** Swaps settle from your wallet straight back to your wallet.
- **Withdrawals never pause.** The vault's withdraw function has no pause switch.
- **Changes wait in public.** Spreads, limits and fees only change after a 48-hour timelock.
- **The code is open.** Deployed contracts show verified source on Blockscout.
- **Audited before deposits open.** No vault accepts deposits until an independent audit is finished and published.

## What's next

Paritas is not live yet. An independent audit and a testnet rehearsal come first. Follow @useparitas for every step.

*Paritas is an independent interface and is not affiliated with, operated by or endorsed by Robinhood Markets, Inc. or its affiliates. Stock Tokens are tokenized debt securities issued by Robinhood Assets (Jersey) Limited. They are not available in the United States or to US persons and are restricted in other jurisdictions. Nothing here is investment advice.*
