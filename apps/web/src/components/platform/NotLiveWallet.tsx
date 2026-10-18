"use client";
/** Connect on the not-live page: the app's own wallet modal, so visitors can connect before the contracts exist. */
import { useAccount, useDisconnect } from "wagmi";
import { short } from "@/lib/format";
import { Icon } from "./Icon";
import { ConnectModal } from "./modals";
import { UIProvider, useUI } from "./ui";

function WalletButton() {
  const ui = useUI();
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  if (isConnected && address) {
    return (
      <button
        className="btn btn-line"
        title="Disconnect"
        onClick={() => {
          disconnect();
          ui.toast("Wallet disconnected", "", "out");
        }}
      >
        <Icon n="wallet" />
        {short(address)}
      </button>
    );
  }
  return (
    <button className="btn btn-holo" onClick={() => ui.openModal(<ConnectModal />)}>
      <Icon n="wallet" />
      Connect
    </button>
  );
}

export function NotLiveWallet() {
  return (
    <UIProvider>
      <WalletButton />
    </UIProvider>
  );
}
