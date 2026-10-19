# Wallet verification (no KYC)

Stock tokens are not for US persons, so `EligibilityRegistry` is enforced on mainnet. ALFA chose verification without
KYC (`docs/DECISIONS.md` #2): a country check on the connection, plus a statement the wallet signs. Paritas runs its
own attester, and nobody uploads documents.

## How a wallet gets verified

1. In the app, an unverified wallet sees **Verify wallet** in the ticket, in the pool and in the account menu.
2. The person ticks "I am not a US person. I do not live in the United States or its territories." Their wallet then
   signs the declaration from `packages/shared/src/eligibility.ts`. Signing is free.
3. `POST /api/eligibility/attest` (`apps/api/src/lib/eligibility.ts`) refuses the request when:
   - the connection's country is in `eligibility.blockedCountries` in `config/protocol.json` (US and its territories
     by default)
   - on mainnet, the country cannot be found
   - the signature does not match the wallet, or is more than 10 minutes old
   - the wallet is blocked on-chain
4. Otherwise the API's attester key signs an `EligibilityRegistry` attestation that lasts
   `eligibility.attestationTtlDays` (90 days).
5. The API sends `attest()` itself from the attester key and pays the network fee (about 0.000003 ETH), so the person
   confirms only one thing in their wallet: the free signature. The wallet can then trade and provide liquidity.
   - A wallet that is already verified for more than 7 more days gets no new transaction.
   - If the attester key has no ETH left, or the transaction fails, the API answers with the attestation and the
     wallet sends `attest()` itself (one more confirmation, small network fee). The app's copy follows `free` from
     `GET /eligibility`.
   - Keep some ETH on the attester address (`roles.attester`, printed by `deploy/mainnet.sh`): 0.001 ETH covers
     about 300 verifications. The API logs a warning when it runs low.

The API keeps a record of every attestation it signs (`EligibilityGrant`): wallet, country, times and the signed
declaration. It does not store IP addresses.

## What it does not do

- It does not verify identity. Someone using a VPN outside the US can pass the country check. The signed declaration is
  the record that they confirmed they are not a US person.
- `blockedCountries` lists only the US and its territories. Robinhood restricts stock tokens in more places. Add more
  countries in `config/protocol.json` if ALFA decides to (ISO 3166 two-letter codes), then redeploy the API.

## Keys and data

| Piece | Where | Notes |
|---|---|---|
| Attester key | `ATTESTER_PRIVATE_KEY` in `apps/api/.env` on the server | Created by `deploy/mainnet.sh`. Secret, mode 600, never committed. Its address is `roles.attester` in `deployments/4663.json`. |
| Country database | `/home/paritas/geo/country.mmdb` (`GEOIP_DB`) | DB-IP "IP to Country Lite", CC BY 4.0. `deploy/geoip.sh` downloads it, and refreshes it monthly by cron. The app credits "IP geolocation by DB-IP" in the verification window, as the licence requires. |
| Client IP | Nginx `X-Forwarded-For` | The API trusts the header only from Nginx on the same machine (`TRUST_PROXY`), so a client cannot fake its address. |

## Incidents

- **The attester key may have leaked:** the guardian calls `EligibilityRegistry.revokeAttester(attester)`. This takes
  effect at once and revokes every attestation that key signed. To restart verification:
  1. Put a new key in `apps/api/.env`.
  2. Approve its address with a timelock `setAttester(newAddress, true)`, which takes 48h.
  3. Wallets verify again.
- **One wallet must stop:** the guardian calls `blockAccounts([wallet])`. A blocked wallet can still withdraw its vault
  shares, but only to itself.
- **The country database is stale or missing:** on mainnet the API refuses new verifications ("We could not check your
  location"). Wallets that are already verified are not affected. Run `deploy/geoip.sh`.
