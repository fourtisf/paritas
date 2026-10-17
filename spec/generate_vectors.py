#!/usr/bin/env python3
"""Reference implementation used to generate the shared test vectors.

This is deliberately a third, independent implementation:
  - sessions use Python's zoneinfo (IANA tz database) for New York time, not our DST formula
  - vault quotes use Python big integers with explicit floor / ceil division

Solidity (contracts/test/Vectors.t.sol) and TypeScript (packages/shared/test/vectors.test.ts)
must both reproduce every vector exactly. Regenerate with:  python3 spec/generate_vectors.py
"""
import datetime as dt
import json
import os
import random
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NY = ZoneInfo("America/New_York")
EPOCH = dt.date(1970, 1, 1)

REGULAR, EXTENDED, OVERNIGHT, CLOSED = 0, 1, 2, 3
NAMES = ["regular", "extended", "overnight", "closed"]

hol = json.load(open(os.path.join(ROOT, "config", "holidays.json")))
HOLIDAYS = {h["day"] for h in hol["holidays"]}
EARLY = {h["day"] for h in hol["earlyCloses"]}


def ny(ts):
    d = dt.datetime.fromtimestamp(ts, dt.timezone.utc).astimezone(NY)
    day = (d.date() - EPOCH).days
    return day, d.hour * 60 + d.minute, d


def trading_day(day):
    wd = (EPOCH + dt.timedelta(days=day)).isoweekday()  # 1 = Monday .. 7 = Sunday
    return wd <= 5 and day not in HOLIDAYS


def session_at(ts):
    day, minute, _ = ny(ts)
    nxt = trading_day(day + 1)
    if not trading_day(day):
        return OVERNIGHT if (minute >= 1200 and nxt) else CLOSED
    if minute < 240:
        return OVERNIGHT
    if minute < 570:
        return EXTENDED
    close = 780 if day in EARLY else 960
    if minute < close:
        return REGULAR
    if minute < 1200:
        return EXTENDED
    return OVERNIGHT if nxt else CLOSED


def ts_ny(y, m, d, hh, mm):
    return int(dt.datetime(y, m, d, hh, mm, tzinfo=NY).timestamp())


def session_vectors():
    pts = []
    # session boundaries on an ordinary week (Mon 2026-10-19 .. Sun 2026-10-25)
    for d in range(19, 26):
        for hh, mm in [(0, 0), (3, 59), (4, 0), (9, 29), (9, 30), (15, 59), (16, 0), (19, 59), (20, 0), (23, 59)]:
            pts.append((ts_ny(2026, 10, d, hh, mm), f"2026-10-{d} {hh:02d}:{mm:02d} NY"))
    # DST switches (UTC instants either side)
    for y in (2026, 2027, 2028, 2030):
        for month, day_range in ((3, range(8, 15)), (11, range(1, 8))):
            for d in day_range:
                if dt.date(y, month, d).isoweekday() == 7:
                    utc_h = 7 if month == 3 else 6
                    t = int(dt.datetime(y, month, d, utc_h, 0, tzinfo=dt.timezone.utc).timestamp())
                    for off in (-61, -1, 0, 1, 3600 * 3, 3600 * 13 + 1800):
                        pts.append((t + off, f"DST switch {y}-{month:02d}-{d:02d} {off:+d}s"))
    # holidays and early closes from config/holidays.json
    for h in hol["holidays"] + hol["earlyCloses"]:
        y, m, d = map(int, h["date"].split("-"))
        for hh, mm in [(3, 0), (10, 0), (12, 59), (13, 0), (15, 0), (19, 0), (20, 0)]:
            pts.append((ts_ny(y, m, d, hh, mm), f"{h['date']} {hh:02d}:{mm:02d} NY"))
        prev = dt.date(y, m, d) - dt.timedelta(days=1)
        pts.append((ts_ny(prev.year, prev.month, prev.day, 20, 30), f"eve of {h['date']} 20:30 NY"))
    # random instants 2026-2031
    rng = random.Random(4663)
    lo = int(dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc).timestamp())
    hi = int(dt.datetime(2031, 1, 1, tzinfo=dt.timezone.utc).timestamp())
    for _ in range(300):
        pts.append((rng.randrange(lo, hi), "random"))
    out = []
    for ts, note in pts:
        day, minute, d = ny(ts)
        out.append({
            "ts": ts,
            "session": session_at(ts),
            "name": NAMES[session_at(ts)],
            "nyDay": day,
            "nyMinute": minute,
            "dst": bool(d.dst()),
            "note": note,
        })
    return out


# ------------------------------------------------------------------ vault quotes

WAD = 10**18
BPS = 10_000


def mul_div(a, b, c, up=False):
    q, r = divmod(a * b, c)
    return q + (1 if up and r else 0)


def imbalance(price, rs, ru, unit, u2w):
    s = mul_div(rs, price, unit)
    u = ru * u2w
    if s + u == 0:
        return 0
    num = (s - u) * WAD
    den = s + u
    # Solidity int division truncates toward zero
    q = abs(num) // den
    return q if num >= 0 else -q


def trunc_div(a, b):
    q = abs(a) // abs(b)
    return q if (a >= 0) == (b > 0) else -q


def quote(v):
    price, rs, ru = v["priceWad"], v["reserveStock"], v["reserveUsd"]
    unit, u2w = 10 ** v["stockDecimals"], 10 ** (18 - v["usdDecimals"])
    hs, sk, mul, share = v["halfSpreadBps"], v["skewBps"], v["spreadMulBps"], v["spreadShareBps"]
    buy, amt = v["buy"], v["amountIn"]
    imb = imbalance(price, rs, ru, unit, u2w)
    skew = trunc_div(sk * 10**14 * imb, WAD)
    raw = hs * mul * 10**10 + (-skew if buy else skew)
    cost = raw if raw > 0 else 0
    if buy:
        usd_w = amt * u2w
        notional = usd_w
        ask = mul_div(price, WAD + cost, WAD, up=True)
        out = mul_div(usd_w, unit, ask)
        fair = mul_div(out, price, unit)
        rev = usd_w - fair if usd_w > fair else 0
    else:
        notional = mul_div(amt, price, unit)
        bid = mul_div(price, WAD - cost, WAD)
        out = mul_div(amt, bid, unit) // u2w
        paid = out * u2w
        rev = notional - paid if notional > paid else 0
    spread_share = rev * share // BPS // u2w
    return {"amountOut": out, "notionalWad": notional, "costWad": cost, "imbalanceWad": imb, "spreadShare": spread_share}


def quote_vectors():
    rng = random.Random(46630)
    tiers = [(10, 15), (20, 25), (40, 50)]
    muls = [10000, 15000, 20000]
    out = []
    # the prototype's headline case: NVDA at 182.40, balanced 1.28M vault, 10k USDG buy, tier A regular
    cases = [dict(priceWad=18240 * 10**16, reserveStock=3509 * 10**18, reserveUsd=640_000 * 10**6, stockDecimals=18,
                  usdDecimals=6, halfSpreadBps=10, skewBps=15, spreadMulBps=10000, spreadShareBps=1000, buy=True,
                  amountIn=10_000 * 10**6)]
    for _ in range(199):
        price = rng.randrange(5 * 10**18, 900 * 10**18)
        stock_dec = rng.choice([18, 18, 18, 8])
        usd_dec = rng.choice([6, 6, 18])
        tvl_usd = rng.randrange(1_000, 2_500_000)
        tok_share = rng.random()
        rs = int(tvl_usd * tok_share * 10**stock_dec * WAD // price) if rng.random() > 0.05 else 0
        ru = int(tvl_usd * (1 - tok_share) * 10**usd_dec) if rng.random() > 0.05 else 0
        hs, sk = rng.choice(tiers)
        buy = rng.random() < 0.5
        size_usd = rng.randrange(1, 60_000)
        amount = size_usd * 10**usd_dec if buy else size_usd * 10**stock_dec * WAD // price
        if amount == 0:
            amount = 1
        cases.append(dict(priceWad=price, reserveStock=rs, reserveUsd=ru, stockDecimals=stock_dec, usdDecimals=usd_dec,
                          halfSpreadBps=hs, skewBps=sk, spreadMulBps=rng.choice(muls), spreadShareBps=1000,
                          buy=buy, amountIn=amount))
    for c in cases:
        r = quote(c)
        # big numbers are strings so JavaScript JSON.parse keeps full precision
        out.append({k: (str(v) if isinstance(v, int) and not isinstance(v, bool) else v) for k, v in {**c, **r}.items()})
    return out


if __name__ == "__main__":
    s = session_vectors()
    q = quote_vectors()
    vec = os.path.join(HERE, "vectors")
    os.makedirs(vec, exist_ok=True)
    json.dump({"_comment": "Generated by spec/generate_vectors.py. Do not edit by hand.", "count": len(s), "vectors": s},
              open(os.path.join(vec, "sessions.json"), "w"), indent=1)
    json.dump({"_comment": "Generated by spec/generate_vectors.py. Do not edit by hand. Integers are decimal strings.",
               "count": len(q), "vectors": q}, open(os.path.join(vec, "vault-quotes.json"), "w"), indent=1)
    print(f"sessions: {len(s)}  vault quotes: {len(q)}")
    head = q[0]
    print("headline: 10k USDG buy of NVDA ->", int(head["amountOut"]) / 1e18, "tokens, cost",
          int(head["costWad"]) / 1e14, "bps, spread share", int(head["spreadShare"]) / 1e6, "USDG")
