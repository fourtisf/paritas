/**
 * Wallets the connect modal lists. Logos are in public/wallets/ (web3icons, MIT; see its README).
 * `rdns` is the wallet's EIP-6963 id: when the extension is installed it announces itself under that id, with its own
 * icon, and the modal lists it under "Detected" instead. Not installed: WalletConnect when it is configured (every
 * wallet below supports it), otherwise a link to the wallet's own download page. Coinbase has its own connector.
 */
export interface WalletInfo {
  id: string;
  name: string;
  rdns: string;
  url: string;
}

export const WALLETS: readonly WalletInfo[] = [
  { id: "metamask", name: "MetaMask", rdns: "io.metamask", url: "https://metamask.io/download/" },
  { id: "coinbase", name: "Coinbase Wallet", rdns: "com.coinbase.wallet", url: "https://www.coinbase.com/wallet" },
  { id: "rabby", name: "Rabby", rdns: "io.rabby", url: "https://rabby.io/" },
  { id: "trust", name: "Trust Wallet", rdns: "com.trustwallet.app", url: "https://trustwallet.com/download" },
  { id: "okx", name: "OKX Wallet", rdns: "com.okex.wallet", url: "https://www.okx.com/web3" },
  { id: "rainbow", name: "Rainbow", rdns: "me.rainbow", url: "https://rainbow.me/" },
  { id: "phantom", name: "Phantom", rdns: "app.phantom", url: "https://phantom.app/download" },
  { id: "zerion", name: "Zerion", rdns: "io.zerion.wallet", url: "https://zerion.io/" },
];

export const walletLogo = (id: string) => `/wallets/${id}.svg`;
