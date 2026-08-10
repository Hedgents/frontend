export interface RpcTokenBalance {
  mint?: string;
  owner?: string;
  uiTokenAmount?: {
    amount?: string;
  };
}

function ownerMintBalance(
  balances: RpcTokenBalance[] | null | undefined,
  owner: string,
  mint: string,
) {
  return (balances ?? []).reduce((total, balance) => {
    if (balance.owner !== owner || balance.mint !== mint) return total;
    const amount = balance.uiTokenAmount?.amount;
    return amount && /^\d+$/.test(amount) ? total + BigInt(amount) : total;
  }, 0n);
}

export function calculateOwnerTokenDelta(
  preBalances: RpcTokenBalance[] | null | undefined,
  postBalances: RpcTokenBalance[] | null | undefined,
  owner: string,
  mint: string,
) {
  return ownerMintBalance(postBalances, owner, mint) - ownerMintBalance(preBalances, owner, mint);
}
